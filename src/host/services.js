/**
 * Business state over the store: Bots, groups, chats, messages, memory, usage,
 * plus the one Workspace every Bot session shares.
 *
 * Everything here is event-free and Host-free: it owns validation, identifiers,
 * cursors and the ledger's public projection, but never a DSH session. The
 * runtime owns sessions; the dispatcher owns who speaks; the routes own HTTP.
 *
 * @module @lisongjianustc/dsh-bot/host/services
 */
import { mkdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { createAttachments } from './attachments.js'
import { avatarForBot, isAvatarId, matchAvatar, normalizeAvatar } from './avatars.js'
import { BotError, describeError } from './errors.js'
import {
  ENTRY_MAX,
  MAX_ENTRIES,
  MEMORY_CONTEXT_MAX,
  STORAGE_MAX,
  entryRevision,
  makeMemoryEntry,
  secretReason,
  selectMemoryContext,
  storageBudget,
  validateMemoryWrite,
} from './memory.js'
import { GROUP_NOTE_MARK, HOP_LIMIT_MAX, NOTE_MAX_CHARS, appendNote, noteEntries } from './mention.js'
import { clean, clip, dayStamp, newId, sha1 } from './util.js'

/** Longest Bot or group name. */
export const NAME_MAX = 24
/** Longest Bot role line. */
export const ROLE_MAX = 60
/** Longest Bot instruction text. */
export const INSTRUCTIONS_MAX = 4000
/** Longest group notice. */
export const NOTICE_MAX = 500
/** How many project directories one group may hold. */
export const GROUP_WORKSPACES_MAX = 8
/** How many days of usage the panel may ask for. */
export const USAGE_DAYS_MAX = 365

/** The permission presets a Bot may pin. */
export const PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access']
/** The reply modes a group may pick. */
export const REPLY_MODES = ['admin', 'all']

/** The limits the client shows in its forms. */
export const LIMITS = {
  maxHops: HOP_LIMIT_MAX,
  memoryEntryMax: ENTRY_MAX,
  memoryStorageMax: STORAGE_MAX,
  memoryContextMax: MEMORY_CONTEXT_MAX,
  memoryEntriesMax: MAX_ENTRIES,
  groupNoteMax: NOTE_MAX_CHARS,
  nameMax: NAME_MAX,
  roleMax: ROLE_MAX,
  instructionsMax: INSTRUCTIONS_MAX,
  noticeMax: NOTICE_MAX,
}

/** One Bot draft as the panel sends it. */
function botDraft(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BotError('invalid-request', 'a bot draft must be an object')
  }
  const name = String(input.name ?? '').trim()
  if (name === '') throw new BotError('invalid-request', 'a bot needs a name')
  if (name.length > NAME_MAX) throw new BotError('invalid-request', `a bot name holds at most ${NAME_MAX} characters`)
  if (name.includes('@') || /[\r\n]/.test(name)) throw new BotError('invalid-request', 'a bot name cannot contain @ or a line break')
  const role = clip(String(input.role ?? '').trim(), ROLE_MAX)
  const instructions = clip(String(input.instructions ?? '').trim(), INSTRUCTIONS_MAX)
  const permission = input.permission === undefined ? 'danger-full-access' : String(input.permission)
  if (!PERMISSIONS.includes(permission)) throw new BotError('invalid-request', 'a bot permission is read-only, workspace-write or danger-full-access')
  const model = input.model === undefined || input.model === null ? null : modelPin(input.model)
  const color = /^#[0-9a-fA-F]{6}$/.test(String(input.color ?? '')) ? String(input.color) : '#6b7cff'
  const skin = clip(String(input.skin ?? 'default').trim(), 40) || 'default'
  const workspace = input.workspaceId === undefined || input.workspaceId === null || String(input.workspaceId).trim() === ''
    ? undefined
    : String(input.workspaceId).trim()
  return {
    name,
    role,
    instructions,
    permission,
    model,
    color,
    skin,
    avatarInput: input.avatar,
    ...(workspace === undefined ? {} : { workspaceId: workspace }),
    autoHelper: input.autoHelper !== false,
    autoAvatar: input.autoAvatar !== false,
    isMain: input.isMain === true,
    // Unattended Bot turns answer their own approval requests unless the user
    // opts out; an explicit `false` is what sends them down the waterfall.
    autoApprove: input.autoApprove !== false,
  }
}

/** One model pin, or null when the Bot follows the deployment default. */
function modelPin(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BotError('invalid-request', 'a bot model must be an object or null')
  }
  const provider = String(input.provider ?? '').trim()
  const model = String(input.model ?? '').trim()
  if (provider === '' || model === '') throw new BotError('invalid-request', 'a bot model needs a provider and a model id')
  const reasoningEffort = input.reasoningEffort === undefined || input.reasoningEffort === null || input.reasoningEffort === ''
    ? undefined
    : String(input.reasoningEffort)
  return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
}

/**
 * Resolve one Bot reference: an id, a name, or `@name`.
 * @param {object[]} bots - the roster.
 * @param {unknown} ref - the reference.
 * @returns {string | undefined} the Bot id, or undefined when nothing matches.
 */
function resolveBotRef(bots, ref) {
  const raw = String(ref ?? '').trim()
  if (raw === '') return undefined
  const key = raw.replace(/^@/, '')
  const byId = bots.find(bot => bot.id === key)
  if (byId !== undefined) return byId.id
  const byName = bots.find(bot => bot.name.toLowerCase() === key.toLowerCase())
  return byName?.id
}

/**
 * Normalize one group draft.
 *
 * Member/admin references may be ids or names. Project directories arrive as
 * ids, registered titles or absolute paths, and are resolved by the caller's
 * own resolver (it needs the live workspace registry and the filesystem).
 * @param {object} input - the draft.
 * @param {object[]} bots - the Bot roster.
 * @param {(ref: unknown) => object} resolveWorkspace - resolves one directory ref.
 * @returns {object} the normalized fields (workspaces only when supplied).
 */
function groupDraft(input, bots, resolveWorkspace) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BotError('invalid-request', 'a group draft must be an object')
  }
  const name = String(input.name ?? '').trim()
  if (name === '') throw new BotError('invalid-request', 'a group needs a name')
  if (name.length > NAME_MAX) throw new BotError('invalid-request', `a group name holds at most ${NAME_MAX} characters`)
  if (name.includes('@') || /[\r\n]/.test(name)) throw new BotError('invalid-request', 'a group name cannot contain @ or a line break')
  const refs = [
    ...(Array.isArray(input.memberIds) ? input.memberIds : []),
  ]
  const memberIds = []
  for (const ref of refs) {
    const id = resolveBotRef(bots, ref)
    if (id === undefined) throw new BotError('bot-not-found', `the group names bot "${String(ref)}", which does not exist`)
    if (!memberIds.includes(id)) memberIds.push(id)
  }
  const adminRef = input.adminId
  let adminId = ''
  if (adminRef !== undefined && adminRef !== null && String(adminRef).trim() !== '') {
    const resolved = resolveBotRef(bots, adminRef)
    if (resolved === undefined) throw new BotError('bot-not-found', `the group admin "${String(adminRef)}" does not exist`)
    adminId = resolved
  } else {
    adminId = memberIds[0] ?? ''
  }
  // The admin always stays a member: Auto-add makes this write idempotent and
  // keeps a members-replacement from orphaning the admin silently.
  if (adminId !== '' && !memberIds.includes(adminId)) memberIds.unshift(adminId)
  const replyMode = input.replyMode === undefined ? 'admin' : String(input.replyMode)
  if (!REPLY_MODES.includes(replyMode)) throw new BotError('invalid-request', 'a group reply mode is admin or all')
  const maxHops = Math.max(0, Math.min(HOP_LIMIT_MAX, Math.floor(Number(input.maxHops) || 0)))
  let workspaces
  if (input.workspaces !== undefined) {
    const refs = Array.isArray(input.workspaces) ? input.workspaces : null
    if (refs === null) throw new BotError('invalid-request', 'group workspaces must be an array')
    if (refs.length > GROUP_WORKSPACES_MAX) {
      throw new BotError('invalid-request', `a group holds at most ${GROUP_WORKSPACES_MAX} project directories`)
    }
    const resolved = []
    const seen = new Set()
    for (const ref of refs) {
      const workspace = resolveWorkspace(ref)
      const key = workspace.id !== undefined ? `id:${workspace.id}` : `path:${workspace.path}`
      if (seen.has(key)) continue
      seen.add(key)
      resolved.push(workspace)
    }
    workspaces = resolved
  }
  return {
    name,
    adminId,
    memberIds,
    notice: clip(String(input.notice ?? '').trim(), NOTICE_MAX),
    replyMode,
    maxHops,
    handover: input.handover === true,
    useNote: input.useNote === true,
    ...(workspaces === undefined ? {} : { workspaces }),
  }
}

/** Trim undefined fields out of a projection so JSON stays compact. */
function compact(object) {
  const out = {}
  for (const [key, value] of Object.entries(object)) if (value !== undefined) out[key] = value
  return out
}

/**
 * Create the business services.
 * @param {{ ctx: object, config?: object, store: object }} input - wiring.
 * @returns {object} the services.
 */
export function createServices({ ctx, config = {}, store }) {
  const db = store.db
  const now = () => Date.now()
  const log = (level, message, error) => {
    const logger = ctx?.logger
    if (logger && typeof logger[level] === 'function') logger[level](`[dsh-bot] ${message}`, error)
    else if (level === 'error' || level === 'warn') console.warn(`[dsh-bot] ${message}`, error ?? '')
  }

  // ---------------------------------------------------------------- running
  /** chatId -> { botId, turnId, startedAt } */
  const running = new Map()
  const runningApi = {
    start(chatId, botId, turnId) {
      running.set(chatId, { chatId, botId, turnId, startedAt: now() })
    },
    end(chatId) {
      running.delete(chatId)
    },
    get(chatId) {
      return running.get(chatId)
    },
    list() {
      return [...running.values()]
    },
    ofBot(botId) {
      return [...running.values()].filter(entry => entry.botId === botId)
    },
  }

  /**
   * Resolve the DSH workspaces this deployment offers (the per-Bot cwd picker).
   * A deployment without the registry serves an empty list rather than failing.
   * @returns {{ id: string, title: string, path?: string }[]} the workspaces.
   */
  const workspaceList = () => {
    const registry = typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined
    if (registry === undefined || registry === null || typeof registry.list !== 'function') return []
    let rows
    try {
      rows = registry.list()
    } catch {
      return []
    }
    if (!Array.isArray(rows)) return []
    return rows.flatMap((row) => {
      const id = String(row?.id ?? '')
      if (id === '') return []
      return [{
        id,
        title: typeof row.title === 'string' && row.title !== '' ? row.title : id,
        ...(typeof row.path === 'string' && row.path !== '' ? { path: row.path } : {}),
      }]
    })
  }

  /**
   * Validate one Bot workspace pin. A pinned workspace must exist NOW; an
   * unknown id is refused rather than silently falling back to the shared one.
   * @param {string} workspaceId - the pinned id.
   * @returns {object} the workspace row.
   */
  const requireWorkspace = (workspaceId) => {
    const registry = typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined
    if (registry === undefined || registry === null) {
      throw new BotError('workspace-unavailable', 'this deployment serves no workspace registry, so a bot cannot pin a workspace')
    }
    let found
    try {
      found = typeof registry.get === 'function' ? registry.get(workspaceId) : undefined
    } catch {
      found = undefined
    }
    if (found === undefined || found === null) {
      found = workspaceList().find(row => row.id === workspaceId)
    }
    if (found === undefined || found === null) {
      throw new BotError('workspace-unavailable', `no workspace has the id "${workspaceId}"`)
    }
    return found
  }

  /**
   * Resolve one group project directory: a workspace id, a uniquely titled
   * workspace, or an existing absolute directory path.
   * @param {unknown} ref - the reference.
   * @returns {{ id?: string, title: string, path?: string }} the stored directory.
   */
  const resolveGroupWorkspace = (ref) => {
    const raw = typeof ref === 'object' && ref !== null
      ? String(ref.id ?? ref.path ?? ref.title ?? '').trim()
      : String(ref ?? '').trim()
    if (raw === '') throw new BotError('workspace-unavailable', 'a project directory reference is blank')
    const registry = typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined
    const rows = workspaceList()
    // 1) a registered workspace id
    let found
    if (registry !== undefined && registry !== null && typeof registry.get === 'function') {
      try {
        found = registry.get(raw)
      } catch {
        found = undefined
      }
    }
    if (found === undefined || found === null) found = rows.find(row => row.id === raw)
    if (found !== undefined && found !== null) {
      const path = typeof found.path === 'string' && found.path !== '' ? found.path : undefined
      return {
        id: String(found.id),
        title: typeof found.title === 'string' && found.title !== '' ? found.title : (path === undefined ? String(found.id) : basename(path)),
        ...(path === undefined ? {} : { path }),
      }
    }
    // 2) a uniquely titled registered workspace
    const byTitle = rows.filter(row => row.title.toLowerCase() === raw.toLowerCase())
    if (byTitle.length === 1) return { ...byTitle[0] }
    if (byTitle.length > 1) throw new BotError('workspace-unavailable', `more than one workspace is titled "${raw}"; use its id or path`)
    // 3) an absolute directory path (a leading ~ is expanded for convenience)
    const expanded = raw.startsWith('~') ? join(homedir(), raw.slice(1).replace(/^[/\\]/, '')) : raw
    if (!isAbsolute(expanded)) {
      throw new BotError('workspace-unavailable', `"${raw}" is neither a workspace id/title nor an absolute directory path`)
    }
    let canonical
    try {
      const stat = statSync(expanded)
      if (!stat.isDirectory()) throw new Error('not a directory')
      canonical = realpathSync(expanded)
    } catch {
      throw new BotError('workspace-unavailable', `the directory "${raw}" does not exist or is not a directory`)
    }
    let owner
    try {
      owner = rows.find((row) => {
        if (typeof row.path !== 'string' || row.path === '') return false
        try {
          return realpathSync(row.path) === canonical
        } catch {
          // A registered workspace whose directory vanished cannot own the path.
          return false
        }
      })
    } catch {
      owner = undefined
    }
    if (owner !== undefined) return { ...owner }
    return { title: basename(canonical), path: canonical }
  }

  // ------------------------------------------------------------------ bots
  const findBot = (ref) => {
    if (ref === undefined || ref === null || ref === '') return undefined
    if (typeof ref === 'object' && typeof ref.id === 'string') {
      const byId = db.bots.find(bot => bot.id === ref.id)
      if (byId !== undefined) return byId
    }
    const key = String(ref).trim().replace(/^@/, '')
    return db.bots.find(bot => bot.id === key) ?? db.bots.find(bot => bot.name.toLowerCase() === key.toLowerCase())
  }

  const pushError = (message, error) => {
    if (error !== undefined) log('warn', message, error)
    else log('warn', message)
  }

  const bots = {
    list() {
      return [...db.bots]
    },
    get(ref) {
      return findBot(ref)
    },
    require(ref) {
      const bot = findBot(ref)
      if (bot === undefined) throw new BotError('bot-not-found', `no bot matches "${String(ref ?? '')}"`)
      return bot
    },
    main() {
      return db.bots.find(bot => bot.isMain) ?? db.bots[0]
    },
    async create(draft) {
      const fields = botDraft(draft)
      if (db.bots.some(bot => bot.name.toLowerCase() === fields.name.toLowerCase())) {
        throw new BotError('invalid-request', `a bot named "${fields.name}" already exists`)
      }
      const first = db.bots.length === 0
      const wantsMain = fields.isMain && !db.bots.some(bot => bot.isMain)
      const isMain = first || wantsMain
      if (fields.workspaceId !== undefined) requireWorkspace(fields.workspaceId)
      const identity = { name: fields.name, role: fields.role, instructions: fields.instructions, isMain }
      const avatar = normalizeAvatar(fields.avatarInput, identity)
      const { avatarInput, ...rest } = fields
      void avatarInput
      const bot = {
        id: newId('bot'),
        ...rest,
        avatar: avatar.spec,
        avatarAuto: avatar.auto && fields.autoAvatar !== false,
        isMain,
        createdAt: now(),
        updatedAt: now(),
        rev: 1,
      }
      db.bots.push(bot)
      await store.save()
      await chats.ensureDm(bot)
      return bot
    },
    async update(ref, patch) {
      const bot = bots.require(ref)
      const source = typeof patch === 'object' && patch !== null ? patch : {}
      const merged = botDraft({
        name: source.name ?? bot.name,
        role: source.role ?? bot.role,
        instructions: source.instructions ?? bot.instructions,
        permission: source.permission ?? bot.permission,
        model: source.model === undefined ? bot.model : source.model,
        color: source.color ?? bot.color,
        skin: source.skin ?? bot.skin,
        avatar: source.avatar === undefined ? bot.avatar : source.avatar,
        autoHelper: source.autoHelper === undefined ? bot.autoHelper : source.autoHelper,
        autoAvatar: source.autoAvatar === undefined ? (bot.avatarAuto !== false) : source.autoAvatar,
        autoApprove: source.autoApprove === undefined ? (bot.autoApprove !== false) : source.autoApprove,
        workspaceId: source.workspaceId === undefined ? bot.workspaceId : source.workspaceId,
        isMain: bot.isMain,
      })
      if (merged.workspaceId !== undefined && merged.workspaceId !== bot.workspaceId) {
        requireWorkspace(merged.workspaceId)
      }
      const identity = { name: merged.name, role: merged.role, instructions: merged.instructions, isMain: bot.isMain }
      const identityChanged = merged.name !== bot.name || merged.role !== bot.role || merged.instructions !== bot.instructions
      // An explicit avatar wins; otherwise an auto avatar follows the identity.
      const avatar = source.avatar !== undefined
        ? normalizeAvatar(source.avatar, identity)
        : (bot.avatarAuto !== false && identityChanged ? normalizeAvatar(null, identity) : { spec: avatarForBot(bot), auto: bot.avatarAuto !== false })
      if (db.bots.some(other => other.id !== bot.id && other.name.toLowerCase() === merged.name.toLowerCase())) {
        throw new BotError('invalid-request', `a bot named "${merged.name}" already exists`)
      }
      if (source.isMain === true) {
        for (const other of db.bots) if (other.id !== bot.id) other.isMain = false
        merged.isMain = true
      } else if (source.isMain === false && bot.isMain) {
        // The roster always keeps exactly one main Bot: the oldest one takes over.
        const heir = db.bots.find(other => other.id !== bot.id)
        if (heir !== undefined) heir.isMain = true
        merged.isMain = false
      }
      // Destructure AFTER the main-flag decision, so the committed write carries it.
      const { avatarInput, ...rest } = merged
      void avatarInput
      rest.avatar = avatar.spec
      rest.avatarAuto = avatar.auto && merged.autoAvatar !== false
      Object.assign(bot, rest, { updatedAt: now(), rev: (bot.rev ?? 0) + 1 })
      if (source.workspaceId !== undefined && merged.workspaceId === undefined) delete bot.workspaceId
      await store.save()
      return bot
    },
    async remove(ref) {
      const bot = bots.require(ref)
      db.bots = db.bots.filter(candidate => candidate.id !== bot.id)
      // Membership, chats, schedules and memory travel with the Bot.
      for (const group of db.groups) {
        group.memberIds = group.memberIds.filter(id => id !== bot.id)
        if (group.adminId === bot.id) group.adminId = group.memberIds[0] ?? ''
      }
      const emptyGroups = db.groups.filter(group => group.memberIds.length === 0)
      for (const group of emptyGroups) {
        db.groups = db.groups.filter(candidate => candidate.id !== group.id)
        await chats.removeGroupChat(group.id)
      }
      for (const chat of [...db.chats]) {
        if (chat.kind === 'dm' && chat.botId === bot.id) await chats.remove(chat.id)
      }
      for (const schedule of Object.values(db.schedules)) {
        if (schedule.botId !== bot.id) continue
        try {
          await schedules.removeNative(schedule)
        } catch (error) {
          log('warn', `scheduled task ${schedule.nativeId ?? schedule.id} could not be removed from the host while deleting bot ${bot.id}`, error)
        }
        delete db.schedules[schedule.id]
      }
      delete db.memory.bots[bot.id]
      if (bot.isMain) {
        const heir = db.bots[0]
        if (heir !== undefined) heir.isMain = true
      }
      await store.save()
      return bot
    },
    botOfSession(sessionId) {
      if (sessionId === undefined || sessionId === null) return undefined
      const key = String(sessionId)
      for (const [chatId, perBot] of Object.entries(db.sessions)) {
        for (const [botId, record] of Object.entries(perBot)) {
          if (record?.sessionId === key) {
            const bot = db.bots.find(candidate => candidate.id === botId)
            if (bot !== undefined) return bot
          }
        }
      }
      return undefined
    },
    chatOfSession(sessionId) {
      const key = String(sessionId ?? '')
      for (const [chatId, perBot] of Object.entries(db.sessions)) {
        for (const [botId, record] of Object.entries(perBot)) {
          if (record?.sessionId !== key) continue
          const chat = db.chats.find(candidate => candidate.id === chatId)
          if (chat !== undefined) return { chat, botId }
        }
      }
      return undefined
    },
  }

  // ---------------------------------------------------------------- groups
  const findGroup = (ref) => {
    if (ref === undefined || ref === null || ref === '') return undefined
    if (typeof ref === 'object' && typeof ref.id === 'string') {
      const byId = db.groups.find(group => group.id === ref.id)
      if (byId !== undefined) return byId
    }
    const key = String(ref).trim().replace(/^#/, '')
    return db.groups.find(group => group.id === key) ?? db.groups.find(group => group.name.toLowerCase() === key.toLowerCase())
  }

  const groups = {
    list() {
      return [...db.groups]
    },
    get(ref) {
      return findGroup(ref)
    },
    require(ref) {
      const group = findGroup(ref)
      if (group === undefined) throw new BotError('group-not-found', `no group matches "${String(ref ?? '')}"`)
      return group
    },
    async create(draft) {
      const fields = groupDraft(draft, db.bots, resolveGroupWorkspace)
      if (db.groups.some(group => group.name.toLowerCase() === fields.name.toLowerCase())) {
        throw new BotError('invalid-request', `a group named "${fields.name}" already exists`)
      }
      const group = {
        id: newId('grp'),
        ...fields,
        workspaces: fields.workspaces ?? [],
        noteEntries: [],
        createdAt: now(),
        updatedAt: now(),
      }
      db.groups.push(group)
      await store.save()
      await chats.ensureGroup(group)
      return group
    },
    async update(ref, patch) {
      const group = groups.require(ref)
      const source = typeof patch === 'object' && patch !== null ? patch : {}
      const fields = groupDraft({
        name: source.name ?? group.name,
        adminId: source.adminId ?? group.adminId,
        memberIds: source.memberIds ?? group.memberIds,
        notice: source.notice ?? group.notice,
        replyMode: source.replyMode ?? group.replyMode,
        maxHops: source.maxHops ?? group.maxHops,
        handover: source.handover ?? group.handover,
        useNote: source.useNote ?? group.useNote,
        workspaces: source.workspaces === undefined ? group.workspaces : source.workspaces,
      }, db.bots, resolveGroupWorkspace)
      if (db.groups.some(other => other.id !== group.id && other.name.toLowerCase() === fields.name.toLowerCase())) {
        throw new BotError('invalid-request', `a group named "${fields.name}" already exists`)
      }
      Object.assign(group, fields, { updatedAt: now() })
      // The settings panel can clear or replace the note. Entries keep the
      // same bounded shape the round recorder writes.
      if (Array.isArray(source.noteEntries)) {
        group.noteEntries = source.noteEntries
          .filter(entry => entry !== null && typeof entry === 'object' && typeof entry.text === 'string')
          .slice(-24)
          .map(entry => ({
            id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : newId('note'),
            at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : now(),
            speaker: clip(String(entry.speaker ?? 'group'), 60),
            text: clip(entry.text, 400),
          }))
      }
      // Optional rebind: drop the group chat's member-session map so the next
      // message composes fresh sessions in the (possibly changed) directories.
      // The old DSH sessions themselves are left untouched, only unbound.
      let sessionsReset = false
      if (source.resetSessions === true) {
        const chat = chats.findGroupChat(group.id)
        if (chat !== undefined && db.sessions[chat.id] !== undefined) {
          delete db.sessions[chat.id]
          sessionsReset = true
        }
      }
      await store.save()
      return { group, sessionsReset }
    },
    async remove(ref) {
      const group = groups.require(ref)
      db.groups = db.groups.filter(candidate => candidate.id !== group.id)
      await chats.removeGroupChat(group.id)
      await store.save()
      return group
    },
    /** Rewrite the group's note from what this round said. */
    async recordNote(ref, round) {
      const group = groups.require(ref)
      if (group.useNote !== true || !Array.isArray(round) || round.length === 0) return group
      const next = appendNote(group, round)
      if (JSON.stringify(next) === JSON.stringify(noteEntries(group))) return group
      group.noteEntries = next
      group.updatedAt = now()
      await store.save()
      return group
    },
    noteText(ref) {
      return noteEntries(groups.require(ref))
    },
    noteMark: GROUP_NOTE_MARK,
  }

  // ----------------------------------------------------------------- chats
  const findChat = (ref) => {
    if (ref === undefined || ref === null || ref === '') return undefined
    if (typeof ref === 'object' && typeof ref.id === 'string') return db.chats.find(chat => chat.id === ref.id)
    return db.chats.find(chat => chat.id === String(ref))
  }

  const dmChatIdFor = (botId) => {
    const found = db.chats.find(chat => chat.kind === 'dm' && chat.botId === botId)
    return found?.id
  }

  const chats = {
    list() {
      return [...db.chats]
    },
    get(ref) {
      return findChat(ref)
    },
    require(ref) {
      const chat = findChat(ref)
      if (chat === undefined) throw new BotError('chat-not-found', `no chat matches "${String(ref ?? '')}"`)
      return chat
    },
    bySession(sessionId) {
      return bots.chatOfSession(sessionId)
    },
    findDm(botId) {
      return db.chats.find(chat => chat.kind === 'dm' && chat.botId === botId)
    },
    findGroupChat(groupId) {
      return db.chats.find(chat => chat.kind === 'group' && chat.groupId === groupId)
    },
    async ensureDm(bot) {
      const existing = chats.findDm(bot.id)
      if (existing !== undefined) {
        if (existing.title !== bot.name) {
          existing.title = bot.name
          await store.save()
        }
        return existing
      }
      const chat = {
        id: newId('chat'),
        kind: 'dm',
        botId: bot.id,
        title: bot.name,
        lastSeq: 0,
        updatedAt: now(),
        unread: 0,
        // The main/chief Bot is the workbench's default conversation.
        pinned: bot.isMain === true,
      }
      db.chats.push(chat)
      await store.save()
      return chat
    },
    async ensureGroup(group) {
      const existing = chats.findGroupChat(group.id)
      if (existing !== undefined) {
        if (existing.title !== group.name) {
          existing.title = group.name
          await store.save()
        }
        return existing
      }
      const chat = {
        id: newId('chat'),
        kind: 'group',
        groupId: group.id,
        title: group.name,
        lastSeq: 0,
        updatedAt: now(),
        unread: 0,
        pinned: false,
      }
      db.chats.push(chat)
      await store.save()
      return chat
    },
    async removeGroupChat(groupId) {
      const chat = chats.findGroupChat(groupId)
      if (chat !== undefined) await chats.remove(chat.id)
    },
    async remove(chatId) {
      db.chats = db.chats.filter(chat => chat.id !== chatId)
      delete db.sessions[chatId]
      store.dropMessages(chatId)
      await store.save()
    },
    async clear(chatId) {
      const chat = chats.require(chatId)
      store.dropMessages(chatId)
      chat.lastSeq = 0
      chat.unread = 0
      chat.updatedAt = now()
      for (const key of Object.keys(db.sessions[chatId] ?? {})) {
        const record = db.sessions[chatId][key]
        record.lastSeenSeq = 0
        record.stamp = null
        record.memoryStamp = null
      }
      await store.save()
      return chat
    },
    async touch(chatId, patch = {}) {
      const chat = chats.require(chatId)
      Object.assign(chat, patch, { updatedAt: now() })
      await store.save()
      return chat
    },
    async read(chatId) {
      return chats.touch(chatId, { unread: 0 })
    },
    /**
     * Pin or unpin one conversation.
     * @param {string} ref - the chat id.
     * @param {boolean} pinned - the new pin state.
     * @returns {Promise<object>} the updated chat.
     */
    async setPinned(ref, pinned) {
      if (typeof pinned !== 'boolean') throw new BotError('invalid-request', 'chat pinned must be a boolean')
      const chat = chats.require(ref)
      chat.pinned = pinned
      chat.updatedAt = now()
      await store.save()
      return chat
    },
    /** What the panel renders for one chat: never the internal session map. */
    view(chat) {
      const dmSession = chat.kind === 'dm' ? db.sessions[chat.id]?.[chat.botId]?.sessionId : undefined
      const active = running.get(chat.id)
      return compact({
        id: chat.id,
        kind: chat.kind,
        botId: chat.botId,
        groupId: chat.groupId,
        title: chat.title,
        ...(dmSession === undefined ? {} : { sessionId: dmSession }),
        lastSeq: chat.lastSeq ?? 0,
        updatedAt: chat.updatedAt ?? 0,
        unread: chat.unread ?? 0,
        pinned: chat.pinned === true,
        ...(active === undefined ? {} : { running: true }),
      })
    },
    /** The session record of one (chat, bot) pair. */
    sessionOf(chatId, botId) {
      return db.sessions[chatId]?.[botId]
    },
    async setSession(chatId, botId, patch) {
      db.sessions[chatId] ??= {}
      db.sessions[chatId][botId] = { ...(db.sessions[chatId][botId] ?? {}), ...patch, updatedAt: now() }
      await store.save()
      return db.sessions[chatId][botId]
    },
    /** Every (chat, bot) pair that already owns a session. */
    sessions() {
      const rows = []
      for (const [chatId, perBot] of Object.entries(db.sessions)) {
        for (const [botId, record] of Object.entries(perBot)) {
          if (typeof record?.sessionId === 'string') rows.push({ chatId, botId, ...record })
        }
      }
      return rows
    },
  }

  // -------------------------------------------------------------- messages
  const messages = {
    list(chatId) {
      return store.readMessages(chatId)
    },
    page(chatId, options) {
      return store.pageMessages(chatId, options)
    },
    latest(chatId) {
      const all = store.readMessages(chatId)
      return all.at(-1)
    },
    readMessage(chatId, messageId) {
      return store.readMessages(chatId).find(message => message.id === messageId)
    },
    async append(chatId, partial) {
      const chat = chats.require(chatId)
      const message = await store.appendMessage(chatId, {
        status: 'done',
        parts: [],
        ...partial,
        chatId,
      })
      if (message.seq > (chat.lastSeq ?? 0)) chat.lastSeq = message.seq
      chat.updatedAt = now()
      if (message.role === 'bot' || message.role === 'relay') chat.unread = (chat.unread ?? 0) + 1
      await store.save()
      return message
    },
    async update(chatId, messageId, patch) {
      const existing = store.readMessages(chatId).find(message => message.id === messageId)
      if (existing === undefined) throw new BotError('chat-not-found', `chat ${chatId} holds no message ${messageId}`)
      const message = await store.appendMessage(chatId, { ...existing, ...patch, id: messageId })
      const chat = findChat(chatId)
      if (chat !== undefined) {
        chat.updatedAt = now()
        await store.save()
      }
      return message
    },
    system(chatId, text) {
      return messages.append(chatId, { role: 'system', text, status: 'done', parts: [] })
    },
  }

  // ---------------------------------------------------------------- memory
  const scopeEntries = (scope, targetBotId) => {
    if (scope === 'team') return db.memory.team
    const botId = scope === 'self' ? targetBotId : scope
    if (botId === undefined || botId === null || botId === '') {
      throw new BotError('invalid-request', 'a bot memory scope needs a bot id')
    }
    db.memory.bots[botId] ??= []
    return db.memory.bots[botId]
  }

  const memory = {
    LIMITS,
    list({ scope = 'team', botId, targetBotId } = {}) {
      const resolved = scope === 'bot' && targetBotId !== undefined ? targetBotId : scope
      return [...scopeEntries(resolved, botId)]
    },
    budgets() {
      return {
        team: storageBudget(db.memory.team),
        bots: Object.fromEntries(Object.entries(db.memory.bots).map(([botId, entries]) => [botId, storageBudget(entries)])),
      }
    },
    async remember({ scope = 'team', text, key, id, replaceId, pinned, botId, targetBotId, by, source }) {
      const resolved = scope === 'bot' ? (targetBotId ?? botId) : scope
      const entries = scopeEntries(resolved, botId)
      const target = id ?? replaceId
      const decision = validateMemoryWrite({ text, key, entries, replaceId: target })
      if (!decision.ok) throw new BotError(decision.code, decision.message)
      const body = String(text).trim()
      const pinnedFlag = pinned === undefined ? undefined : pinned === true
      const replacing = target === undefined ? undefined : entries.find(entry => entry.id === target)
      const sameText = entries.find(entry => entry.text === body && (entry.key ?? '') === (key ?? ''))
      if (key !== undefined) {
        const conflict = entries.find(entry => entry.key === key && (replacing === undefined || entry.id !== replacing.id))
        if (conflict !== undefined && sameText?.id !== conflict.id) {
          throw new BotError('memory-conflict', `another memory entry already uses the key "${key}"`)
        }
      }
      const unchanged = (entry) => entry !== undefined
        && entry.text === body
        && (entry.key ?? '') === (key ?? '')
        && Boolean(entry.pinned) === Boolean(pinnedFlag ?? entry.pinned)
      if (replacing !== undefined) {
        if (unchanged(replacing)) return { entry: replacing, unchanged: true, entries: [...entries] }
        Object.assign(replacing, {
          text: body,
          ...(key === undefined ? {} : { key }),
          ...(pinnedFlag === undefined ? {} : { pinned: pinnedFlag }),
          addedAt: replacing.addedAt ?? now(),
        })
        replacing.revision = entryRevision(replacing)
        await store.save()
        return { entry: replacing, unchanged: false, entries: [...entries] }
      }
      if (sameText !== undefined && unchanged(sameText)) {
        return { entry: sameText, unchanged: true, entries: [...entries] }
      }
      const entry = makeMemoryEntry({
        id: newId('note'),
        text: body,
        ...(key === undefined ? {} : { key }),
        pinned: pinnedFlag === true,
        scope: resolved,
        ...(source === undefined ? {} : { source }),
        ...(by === undefined ? {} : { by }),
        now: now(),
      })
      // An entry with the same text and no key adopts the key instead of duplicating.
      const adoptable = key !== undefined ? entries.find(entry => entry.text === body && entry.key === undefined) : undefined
      if (adoptable !== undefined) {
        adoptable.key = key
        adoptable.revision = entryRevision(adoptable)
        await store.save()
        return { entry: adoptable, unchanged: false, entries: [...entries] }
      }
      entries.push(entry)
      await store.save()
      return { entry, unchanged: false, entries: [...entries] }
    },
    async forget({ scope = 'team', id, text, key, botId, targetBotId } = {}) {
      const resolved = scope === 'bot' ? (targetBotId ?? botId) : scope
      const entries = scopeEntries(resolved, botId)
      const index = entries.findIndex(entry => (id !== undefined && entry.id === id)
        || (id === undefined && text !== undefined && entry.text === text)
        || (id === undefined && text === undefined && key !== undefined && entry.key === key))
      if (index < 0) throw new BotError('memory-not-found', 'no memory entry matches that target')
      const [removed] = entries.splice(index, 1)
      await store.save()
      return { removed, entries: [...entries] }
    },
    /** The entries one Bot's next prompt may carry, already selected. */
    selectionFor(botId, query) {
      const own = (db.memory.bots[botId] ?? []).map(entry => ({ ...entry, scope: botId }))
      const team = db.memory.team.map(entry => ({ ...entry, scope: 'team' }))
      return selectMemoryContext([...own, ...team], { query })
    },
    /** The scope a caller may write: only the main Bot writes the team scope. */
    assertWritable({ scope, callerBotId, groupAdminId }) {
      if (scope === 'team') {
        const main = bots.main()
        if (callerBotId !== undefined && main !== undefined && main.id !== callerBotId) {
          throw new BotError('invalid-request', 'only the main bot writes team memory')
        }
        return
      }
      if (scope === 'bot') {
        const main = bots.main()
        if (callerBotId !== undefined && main !== undefined && main.id !== callerBotId) {
          throw new BotError('invalid-request', 'only the main bot writes another bot memory')
        }
      }
      void groupAdminId
    },
    secretReason,
    revisionOf: entryRevision,
  }

  // ----------------------------------------------------------------- usage
  const usage = {
    async record(row) {
      const chat = row.chatId === undefined ? undefined : findChat(row.chatId)
      const bot = row.botId === undefined ? undefined : findBot(row.botId)
      const turnId = String(row.turnId ?? '')
      if (turnId !== '' && store.hasUsage(turnId)) return false
      await store.appendUsage({
        ts: Number(row.ts) || now(),
        day: dayStamp(Number(row.ts) || now()),
        turnId,
        botId: row.botId ?? '',
        botName: row.botName ?? bot?.name ?? '',
        chatId: row.chatId ?? '',
        kind: row.kind ?? 'chat',
        status: row.status ?? 'done',
        durationMs: row.durationMs === null ? null : (Number(row.durationMs) || 0),
        chars: Number(row.chars) || 0,
        tools: Number(row.tools) || 0,
        modelCalls: Number(row.modelCalls) || 1,
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
      })
      void chat
      return true
    },
    view(days = 7) {
      const span = Math.max(1, Math.min(USAGE_DAYS_MAX, Math.floor(Number(days) || 7)))
      const since = now() - span * 86400000
      const rows = store.readUsage(since)
      const byDay = new Map()
      for (let offset = span - 1; offset >= 0; offset -= 1) {
        byDay.set(dayStamp(now() - offset * 86400000), { day: dayStamp(now() - offset * 86400000), turns: 0, chars: 0 })
      }
      const byBot = new Map()
      const total = { turns: 0, chars: 0 }
      for (const row of rows) {
        const day = byDay.get(row.day)
        if (day !== undefined) {
          day.turns += 1
          day.chars += Number(row.chars) || 0
        }
        const botId = String(row.botId ?? '')
        const bucket = byBot.get(botId) ?? { botId, name: row.botName || findBot(botId)?.name || botId, turns: 0, chars: 0 }
        bucket.turns += 1
        bucket.chars += Number(row.chars) || 0
        byBot.set(botId, bucket)
        total.turns += 1
        total.chars += Number(row.chars) || 0
      }
      return {
        days: span,
        total,
        byDay: [...byDay.values()],
        byBot: [...byBot.values()].sort((a, b) => b.turns - a.turns),
      }
    },
  }

  /** Uploaded files, content-addressed under `$DSH_HOME/dsh-bot/uploads`. */
  const attachments = createAttachments({ store })

  // ---------------------------------------------------------------- tasks
  /** The client-facing projection of one dispatched task. */
  const taskView = (record) => compact({
    id: record.id,
    kind: record.kind ?? 'bot',
    botId: record.botId,
    groupId: record.groupId,
    text: clip(record.text ?? '', 20000),
    title: record.title ?? '',
    status: record.status ?? 'queued',
    requestId: record.requestId,
    batchId: record.batchId,
    ...(Array.isArray(record.dependsOn) && record.dependsOn.length > 0 ? { dependsOn: [...record.dependsOn] } : {}),
    result: record.result === undefined ? undefined : clip(record.result, 8000),
    error: record.error === undefined ? undefined : clip(record.error, 800),
    messageId: record.messageId,
    originChatId: record.originChatId,
    createdAt: record.createdAt ?? 0,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
  })

  const tasks = {
    list() {
      return [...db.tasks]
    },
    get(id) {
      return db.tasks.find(record => record.id === String(id ?? ''))
    },
    require(id) {
      const record = tasks.get(id)
      if (record === undefined) throw new BotError('invalid-request', `no task matches "${String(id ?? '')}"`)
      return record
    },
    batch(id) {
      return db.taskBatches[String(id ?? '')]
    },
    batches() {
      return Object.values(db.taskBatches)
    },
    taskView,
    async createMany(records) {
      db.tasks.push(...records)
      await store.save()
      return records
    },
    async createBatch(batch) {
      db.taskBatches[batch.id] = batch
      await store.save()
      return batch
    },
    async update(id, patch) {
      const record = tasks.get(id)
      if (record === undefined) return undefined
      Object.assign(record, patch)
      await store.save()
      return record
    },
    async updateBatch(id, patch) {
      const batch = db.taskBatches[String(id ?? '')]
      if (batch === undefined) return undefined
      Object.assign(batch, patch)
      await store.save()
      return batch
    },
    /** Find a batch by its owner Bot and caller-supplied request id. */
    batchByRequest(ownerBotId, requestId) {
      return Object.values(db.taskBatches).find(batch => batch.ownerBotId === ownerBotId && batch.requestId === requestId)
    },
  }

  // -------------------------------------------------------------- helpers
  /** The client-facing projection of one background helper. */
  const helperView = (record) => compact({
    id: record.id,
    botId: record.botId,
    chatId: record.chatId,
    title: record.title,
    task: clip(record.task ?? '', 2000),
    status: record.status ?? 'queued',
    childId: record.childId,
    report: record.report === undefined ? undefined : clip(record.report, 8000),
    error: record.error === undefined ? undefined : clip(record.error, 800),
    parentTurnId: record.parentTurnId,
    createdAt: record.createdAt ?? 0,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
  })

  const helpers = {
    list({ botId } = {}) {
      const rows = db.helpers
        .filter(record => botId === undefined || record.botId === botId)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      return rows.map(helperView)
    },
    get(id) {
      return db.helpers.find(record => record.id === String(id ?? ''))
    },
    require(id) {
      const record = helpers.get(id)
      if (record === undefined) throw new BotError('helper-not-found', `no helper matches "${String(id ?? '')}"`)
      return record
    },
    async create({ botId, chatId, title, task, parentTurnId }) {
      const body = String(task ?? '').trim()
      if (body === '') throw new BotError('invalid-request', 'a helper needs a task')
      const record = {
        id: newId('helper'),
        botId,
        chatId,
        title: clip(String(title ?? '').trim() || body.slice(0, 40), 80),
        task: clip(body, 20000),
        status: 'queued',
        ...(parentTurnId === undefined ? {} : { parentTurnId }),
        createdAt: now(),
      }
      db.helpers.push(record)
      // Keep the ledger bounded: the oldest settled helpers fall off.
      const settled = db.helpers.filter(candidate => candidate.status !== 'queued' && candidate.status !== 'running')
      if (settled.length > 200) {
        const drop = new Set(settled.slice(0, settled.length - 200).map(candidate => candidate.id))
        db.helpers = db.helpers.filter(candidate => !drop.has(candidate.id))
      }
      await store.save()
      return record
    },
    async update(id, patch) {
      const record = helpers.get(id)
      if (record === undefined) throw new BotError('helper-not-found', `no helper matches "${String(id ?? '')}"`)
      Object.assign(record, patch)
      await store.save()
      return record
    },
    view: helperView,
  }

  // -------------------------------------------------------------- workspace
  let workspacePromise
  const ensureWorkspace = () => {
    workspacePromise ??= (async () => {
      mkdirSync(store.workspaceDir, { recursive: true })
      const registry = typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined
      if (registry === undefined || registry === null) {
        throw new BotError('workspace-unavailable', 'this deployment serves no workspace registry, so a bot session cannot be grouped')
      }
      if (typeof registry.resolveByPath === 'function') {
        try {
          const existing = await registry.resolveByPath(store.workspaceDir)
          if (existing !== undefined && existing !== null) return existing
        } catch {
          /* an unowned directory is created below */
        }
      }
      return await registry.create(store.workspaceDir, 'dsh-bot')
    })().catch((error) => {
      workspacePromise = undefined
      if (error instanceof BotError) throw error
      throw new BotError('workspace-unavailable', `the bot workspace could not be created: ${describeError(error)}`, { cause: error })
    })
    return workspacePromise
  }

  // ---------------------------------------------------------------- models
  const modelCatalog = async () => {
    // The whole read lives behind one guard: `ctx` belongs to the fiber, and a
    // disposed fiber may throw while a page request is still in flight. A model
    // catalog is optional data, so a failure degrades every view instead of
    // failing the request.
    try {
      const controller = ctx?.sessionController
      if (controller !== undefined && typeof controller.modelCatalog === 'function') {
        const catalog = await controller.modelCatalog()
        if (catalog && Array.isArray(catalog.groups)) {
          return {
            providers: catalog.groups.map(group => ({
              id: String(group.id),
              name: String(group.name ?? group.id),
              models: (group.models ?? []).map(model => compact({
                id: String(model.id),
                name: String(model.name ?? model.id),
                ...(model.reasoning?.efforts ? { reasoningEffort: model.reasoning.efforts.map(effort => String(effort.id)) } : {}),
              })),
            })),
            ...(catalog.default ? { default: { provider: String(catalog.default.provider), model: String(catalog.default.model) } } : {}),
          }
        }
      }
    } catch (error) {
      log('warn', 'the host model catalog could not be read', error)
    }
    return undefined
  }

  // ------------------------------------------------------------- scheduling
  /**
   * The client projection of one scheduled task: the panel's four timing shapes
   * (daily / every N minutes / once in N minutes / at an instant).
   * @param {object} record - the stored record.
   * @returns {object} the ScheduleView.
   */
  const scheduleView = (record) => {
    const timing = record?.timing ?? {}
    const projected = timing.kind === 'every' || timing.kind === 'interval'
      ? { kind: 'every', minutes: Number(timing.minutes) || 5 }
      : timing.kind === 'after' || timing.kind === 'once'
        ? { kind: 'once', minutes: Number(timing.minutes) || 10 }
        : timing.kind === 'at'
          ? { kind: 'at', at: String(timing.at ?? '') }
          : { kind: 'daily', time: typeof timing.time === 'string' ? timing.time : '09:00' }
    return compact({
      id: record.id,
      botId: record.botId,
      title: record.title,
      prompt: record.prompt,
      timing: projected,
      enabled: record.enabled !== false,
      nativeId: record.nativeId,
      createdAt: record.createdAt ?? 0,
    })
  }

  const schedules = {
    list() {
      return Object.values(db.schedules)
    },
    listForBot(botId) {
      return Object.values(db.schedules).filter(schedule => schedule.botId === botId)
    },
    get(id) {
      return db.schedules[String(id ?? '')]
    },
    require(id) {
      const schedule = schedules.get(id)
      if (schedule === undefined) throw new BotError('schedule-not-found', `no schedule matches "${String(id ?? '')}"`)
      return schedule
    },
    async create({ botId, title, prompt, timing, nativeId }) {
      const bot = bots.require(botId)
      const text = String(prompt ?? '').trim()
      if (text === '') throw new BotError('invalid-request', 'a scheduled task needs a prompt')
      const name = clip(String(title ?? '').trim() || text.slice(0, 40), 120)
      const record = {
        id: newId('sched'),
        botId: bot.id,
        title: name,
        prompt: text,
        timing: timing ?? { kind: 'daily', time: '09:00' },
        enabled: true,
        ...(nativeId === undefined ? {} : { nativeId }),
        createdAt: now(),
      }
      db.schedules[record.id] = record
      await store.save()
      return record
    },
    async update(id, patch) {
      const record = schedules.require(id)
      Object.assign(record, patch)
      await store.save()
      return record
    },
    async remove(id) {
      const record = schedules.require(id)
      delete db.schedules[record.id]
      await store.save()
      return record
    },
    /**
     * Delete the native schedule behind one local record.
     *
     * The Host has no `schedule.delete`: one task is removed through
     * `schedule.edit({ id, action: 'delete' })`, and only a `deleteInactive()`
     * batch could remove it otherwise (which would also drop unrelated tasks).
     * A failure is raised, so the caller keeps its local record and the user can
     * retry instead of the native task being silently orphaned.
     */
    async removeNative(record) {
      const service = typeof ctx?.get === 'function' ? ctx.get('schedule') : undefined
      if (record?.nativeId === undefined) return { deleted: false, reason: 'no-native-id' }
      if (service === undefined) return { deleted: false, reason: 'no-schedule-service' }
      try {
        if (typeof service.edit === 'function') {
          const result = await service.edit({ id: record.nativeId, action: 'delete' })
          const missed = result !== null && typeof result === 'object' && result.status === 'missing'
          return { deleted: !missed, result }
        }
        // A deployment that only exposes the legacy method still gets a chance.
        if (typeof service.delete === 'function') {
          await service.delete({ id: record.nativeId })
          return { deleted: true }
        }
        return { deleted: false, reason: 'no-delete-method' }
      } catch (error) {
        throw new BotError('schedule-unavailable', `the host refused to delete scheduled task ${record.nativeId}: ${describeError(error)}`, { cause: error })
      }
    },
  }

  // ------------------------------------------------------------- integrity
  /** Repair the one state a crash can leave: a message frozen mid-stream. */
  const recover = async () => {
    for (const chat of db.chats) {
      let dirty = false
      for (const message of store.readMessages(chat.id)) {
        if (message.status !== 'streaming' && message.status !== 'pending') continue
        await store.appendMessage(chat.id, {
          ...message,
          status: message.role === 'bot' ? 'aborted' : 'held',
          error: message.error ?? 'interrupted by a host restart',
        })
        dirty = true
      }
      if (dirty) chat.unread = chat.unread ?? 0
    }
  }

  // ------------------------------------------------------------- state view
  const stateView = async () => ({
    // Monotonic ledger revision: the page compares it with the last one it saw
    // to decide whether a full reload is needed. Every store.save() bumps it.
    stateRev: Number(db.rev) || 0,
    updatedAt: Number(db.updatedAt) || 0,
    self: { id: String(db.self.id ?? 'owner'), name: String(db.settings.userName ?? db.self.name ?? 'owner') },
    bots: db.bots.map(bot => compact({
      id: bot.id,
      name: bot.name,
      role: bot.role ?? '',
      instructions: bot.instructions ?? '',
      skin: bot.skin ?? 'default',
      color: bot.color ?? '#6b7cff',
      avatar: avatarForBot(bot),
      ...(bot.workspaceId === undefined ? {} : { workspaceId: bot.workspaceId }),
      isMain: bot.isMain === true,
      model: bot.model ?? null,
      permission: bot.permission ?? 'danger-full-access',
      autoHelper: bot.autoHelper !== false,
      autoApprove: bot.autoApprove !== false,
      createdAt: bot.createdAt ?? 0,
      updatedAt: bot.updatedAt ?? 0,
      rev: bot.rev ?? 1,
    })),
    groups: db.groups.map(group => compact({
      id: group.id,
      name: group.name,
      adminId: group.adminId ?? '',
      memberIds: [...(group.memberIds ?? [])],
      notice: group.notice ?? '',
      replyMode: group.replyMode ?? 'admin',
      maxHops: group.maxHops ?? 0,
      handover: group.handover === true,
      useNote: group.useNote === true,
      workspaces: (group.workspaces ?? []).map(workspace => ({ ...workspace })),
      noteEntries: noteEntries(group),
      createdAt: group.createdAt ?? 0,
      updatedAt: group.updatedAt ?? 0,
    })),
    chats: db.chats.map(chat => chats.view(chat)),
    running: runningApi.list(),
    settings: {
      userName: String(db.settings.userName ?? db.self.name ?? 'owner'),
      language: db.settings.language === 'en' ? 'en' : 'zh',
    },
    limits: LIMITS,
    schedules: Object.values(db.schedules).map(scheduleView),
    helpers: helpers.list(),
    tasks: tasks.list().map(taskView),
    workspaces: workspaceList(),
  })

  /** The view with the optional model catalog attached. */
  const fullStateView = async () => {
    const view = await stateView()
    const models = await modelCatalog()
    return models === undefined ? view : { ...view, models }
  }

  /**
   * Pin every main Bot's private chat ONCE, for ledgers written before pinning
   * existed. The flag is what makes it one-time: a user who unpins the chief
   * chat afterwards keeps it unpinned across restarts.
   */
  const migratePinnedChats = () => {
    if (db.settings.pinMigrated === true) return
    for (const chat of db.chats) {
      if (chat.kind !== 'dm') continue
      const bot = db.bots.find(candidate => candidate.id === chat.botId)
      if (bot !== undefined && bot.isMain === true) chat.pinned = true
    }
    db.settings.pinMigrated = true
    void store.save().catch(error => log('warn', 'the pin migration could not be persisted', error))
  }

  /**
   * Bring every AUTO avatar up to date with the current matching table.
   *
   * Two jobs in one pass: an old Bot with no avatar gets one, and a Bot whose
   * avatar was auto-matched keeps following the rules — so a matching-rule fix
   * reaches already-created Bots on the next load instead of needing them to be
   * recreated. A Bot the user pinned explicitly (`avatarAuto === false`) is
   * never touched. Nothing is written when nothing changed.
   */
  const backfillAvatars = async () => {
    let changed = false
    for (const bot of db.bots) {
      if (bot.avatarAuto === false) continue
      const next = matchAvatar({
        name: bot.name,
        role: bot.role,
        instructions: bot.instructions,
        isMain: bot.isMain === true,
      })
      const current = bot.avatar
      if (current !== undefined && current !== null
        && current.id === next.id && current.motif === next.motif
        && current.color === next.color && current.background === next.background) {
        if (bot.avatarAuto === undefined) {
          bot.avatarAuto = true
          changed = true
        }
        continue
      }
      bot.avatar = next
      if (bot.avatarAuto === undefined) bot.avatarAuto = true
      changed = true
    }
    if (changed) await store.save().catch(() => undefined)
  }

  const dispose = async () => {
    running.clear()
    await store.close()
  }

  // The pin migration is synchronous so the first state view already carries it.
  migratePinnedChats()

  // The mount-time integrity pass: old avatars are filled and a message frozen
  // mid-stream by a crash is settled, without blocking the plugin's activation.
  queueMicrotask(() => {
    void backfillAvatars()
      .then(() => recover())
      .catch(error => log('warn', 'the boot-time ledger repair did not finish', error))
  })

  return {
    bots,
    groups,
    chats,
    messages,
    memory,
    usage,
    schedules,
    running: runningApi,
    attachments,
    tasks,
    ensureWorkspace,
    /**
     * The workspace one Bot pins, or undefined when it uses the shared one.
     * A pin that no longer resolves is an error, never a silent fallback.
     */
    resolveWorkspace(bot) {
      if (bot === undefined || bot === null || bot.workspaceId === undefined) return undefined
      return requireWorkspace(bot.workspaceId)
    },
    stateView,
    fullStateView,
    modelCatalog,
    recover,
    dispose,
    limits: LIMITS,
    scheduleView,
    helpers,
    /** The prompt/notice language from the ledger settings. */
    language() {
      return db.settings.language === 'en' ? 'en' : 'zh'
    },
    /** Stamps used by the prompt composer. */
    stampOf(chatId, botId) {
      const record = db.sessions[chatId]?.[botId]
      return { stamp: record?.stamp ?? null, memoryStamp: record?.memoryStamp ?? null, lastSeenSeq: record?.lastSeenSeq ?? 0 }
    },
    /** The memory block one Bot's next turn may carry. */
    memorySelectionFor(botId, query) {
      return memory.selectionFor(botId, query)
    },
    /** The group note entries, for prompt rendering. */
    groupNote(group) {
      return noteEntries(group)
    },
    /** sha1 of a text, exported so the prompt and the driver agree on a stamp. */
    digest: sha1,
  }
}
