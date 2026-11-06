/**
 * A read-only file browser for the workbench: list, read and stream files under
 * the directories one conversation is actually allowed to touch.
 *
 * The allow-list is per chat, never global:
 * - a group exposes its project directories (the group's `workspaces`);
 * - a private chat exposes the Bot's pinned workspace, that Bot session's cwd,
 *   and the plugin's own workspace.
 *
 * Every request is resolved twice: `resolve` normalizes the spelling, then
 * `realpath` collapses symlinks. The final real path must be one of the roots or
 * inside one of them, so neither `..` nor a symlink can escape the allow-list.
 *
 * @module @lisongjianustc/dsh-bot/host/fs-browser
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { inferMime, isImageMime } from './attachments.js'
import { BotError } from './errors.js'

/** The largest text file `/fs/read` returns, in bytes. */
export const FS_TEXT_MAX_BYTES = 512 * 1024

/** Whether a buffer looks binary (a NUL byte is the cheap, reliable signal). */
export function looksBinary(buffer) {
  return buffer.includes(0)
}

/**
 * Create the per-chat file browser.
 * @param {{ ctx: object, services: object, store: object }} input - wiring.
 * @returns {object} the browser.
 */
export function createFsBrowser({ ctx, services, store }) {
  const registry = () => (typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined)

  /** Resolve one workspace pin to its path, if the registry still knows it. */
  const workspacePathOf = (workspaceId) => {
    const service = registry()
    if (service === undefined || service === null || workspaceId === undefined) return undefined
    let row
    try {
      row = typeof service.get === 'function' ? service.get(workspaceId) : undefined
    } catch {
      return undefined
    }
    return typeof row?.path === 'string' && row.path !== '' ? row.path : undefined
  }

  /**
   * The directories one chat may browse, canonicalized and deduplicated. A
   * directory that no longer exists is skipped, not reported.
   * @param {string} chatId - the conversation.
   * @returns {{ title: string, path: string }[]} the roots, in priority order.
   */
  const rootsFor = (chatId) => {
    if (typeof chatId !== 'string' || chatId === '') throw new BotError('invalid-request', 'the request needs a chatId')
    const chat = services.chats.require(chatId)
    const found = []
    const push = (title, path) => {
      if (typeof path !== 'string' || path === '') return
      try {
        const canonical = realpathSync(path)
        if (!statSync(canonical).isDirectory()) return
        found.push({ title: title || basename(canonical), path: canonical })
      } catch {
        // A root that vanished is simply not offered.
      }
    }
    if (chat.kind === 'group') {
      const group = services.groups.get(chat.groupId)
      for (const directory of group?.workspaces ?? []) {
        push(directory.title, directory.path ?? workspacePathOf(directory.id))
      }
    } else {
      const bot = chat.botId === undefined ? undefined : services.bots.get(chat.botId)
      if (bot?.workspaceId !== undefined) push('workspace', workspacePathOf(bot.workspaceId))
      const sessionId = chat.botId === undefined ? undefined : services.chats.sessionOf(chat.id, chat.botId)?.sessionId
      if (typeof sessionId === 'string' && sessionId !== '') {
        let session
        try {
          session = ctx.sessions?.get?.(sessionId)
        } catch {
          session = undefined
        }
        push('session', session?.header?.cwd)
      }
      push('dsh-bot', store.workspaceDir)
    }
    const seen = new Set()
    const roots = []
    for (const root of found) {
      if (seen.has(root.path)) continue
      seen.add(root.path)
      roots.push(root)
    }
    return roots
  }

  /** Resolve one requested path into a real path that a root contains. */
  const resolveInside = (chatId, requestPath) => {
    const roots = rootsFor(chatId)
    if (roots.length === 0) throw new BotError('workspace-unavailable', 'this conversation has no browsable directory')
    const primary = roots[0]
    const wanted = typeof requestPath === 'string' ? requestPath.trim() : ''
    const candidate = wanted === '' ? primary.path : (isAbsolute(wanted) ? resolve(wanted) : resolve(primary.path, wanted))
    let real
    try {
      real = realpathSync(candidate)
    } catch {
      throw new BotError('not-found', `"${wanted === '' ? primary.path : wanted}" does not exist`)
    }
    const inside = roots.some(root => real === root.path || real.startsWith(root.path + sep))
    if (!inside) throw new BotError('forbidden', 'this path is outside the conversation\'s allowed directories')
    return { real, roots, primary }
  }

  /** Whether one candidate path is inside the roots (symlinks already collapsed). */
  const isInside = (roots, real) => roots.some(root => real === root.path || real.startsWith(root.path + sep))

  /**
   * List one directory.
   * @param {{ chatId: string, path?: string }} input - the request.
   * @returns {{ path: string, entries: object[] }} the listing.
   */
  const list = ({ chatId, path }) => {
    const { real, roots } = resolveInside(chatId, path)
    let stat
    try {
      stat = statSync(real)
    } catch (error) {
      throw new BotError('not-found', `"${path}" does not exist`, { cause: error })
    }
    if (!stat.isDirectory()) throw new BotError('invalid-request', 'the requested path is not a directory')
    const entries = []
    for (const dirent of readdirSync(real, { withFileTypes: true })) {
      const full = join(real, dirent.name)
      let entryReal
      try {
        entryReal = realpathSync(full)
        if (!isInside(roots, entryReal)) continue
      } catch {
        // A broken or escaping symlink is not offered at all.
        continue
      }
      let entryStat
      try {
        entryStat = statSync(entryReal)
      } catch {
        continue
      }
      entries.push({
        name: dirent.name,
        path: full,
        type: entryStat.isDirectory() ? 'dir' : 'file',
        size: entryStat.isDirectory() ? 0 : entryStat.size,
        mtime: Math.round(entryStat.mtimeMs),
      })
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1)))
    return { path: real, entries }
  }

  /**
   * Read one text file.
   * @param {{ chatId: string, path?: string }} input - the request.
   * @returns {{ path: string, mime: string, size: number, text: string }} the file.
   */
  const read = ({ chatId, path }) => {
    const { real } = resolveInside(chatId, path)
    let stat
    try {
      stat = statSync(real)
    } catch (error) {
      throw new BotError('not-found', `"${path}" does not exist`, { cause: error })
    }
    if (stat.isDirectory()) throw new BotError('invalid-request', 'the requested path is a directory')
    if (stat.size > FS_TEXT_MAX_BYTES) {
      throw new BotError('body-too-large', `the file exceeds the ${FS_TEXT_MAX_BYTES}-byte text preview limit`)
    }
    let buffer
    try {
      buffer = readFileSync(real)
    } catch (error) {
      throw new BotError('not-found', `"${path}" could not be read`, { cause: error })
    }
    if (looksBinary(buffer)) throw new BotError('unsupported', 'this file is binary; use /fs/raw to preview it')
    const mime = inferMime(basename(real), undefined)
    return { path: real, mime, size: stat.size, text: buffer.toString('utf8') }
  }

  /**
   * Describe one file for streaming.
   * @param {{ chatId: string, path?: string }} input - the request.
   * @returns {{ path: string, mime: string, size: number, image: boolean }} the stream facts.
   */
  const raw = ({ chatId, path }) => {
    const { real } = resolveInside(chatId, path)
    let stat
    try {
      stat = statSync(real)
    } catch (error) {
      throw new BotError('not-found', `"${path}" does not exist`, { cause: error })
    }
    if (stat.isDirectory()) throw new BotError('invalid-request', 'the requested path is a directory')
    const mime = inferMime(basename(real), undefined)
    return { path: real, mime, size: stat.size, image: isImageMime(mime) }
  }

  return { rootsFor, list, read, raw, resolveInside }
}
