/**
 * The Host's HTTP surface: the frozen `/dsh-bot/api` contract the workbench page
 * talks to.
 *
 * One prefix route dispatches every path by hand, because the contract is one
 * small table and a prefix route keeps the registration count at one. Every
 * response is JSON in both directions; a refusal is a stable machine code plus
 * one bounded sentence. The fence admits this machine's own browser: a
 * cross-site request is refused outright and a non-loopback socket must prove
 * it speaks for the Host's own origin.
 *
 * @module @lisongjianustc/dsh-bot/host/routes
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_UPLOAD_BYTES } from './attachments.js'
import { isAvatarId } from './avatars.js'
import { BotError, describeError, isBotError, statusForCode } from './errors.js'
import { clip } from './util.js'

/** The root-absolute path prefix the Host registers. */
export const API_PREFIX = '/dsh-bot/api'
/** Byte cap for every request body this API accepts. */
export const BODY_LIMIT = 64 * 1024
/** How many messages one page may carry at most. */
export const MESSAGE_PAGE_MAX = 500

/**
 * The plugin package's own avatar assets. `import.meta.url` is this file's real
 * path (a profile link installation resolves to the workspace package), so two
 * levels up is the package root.
 */
const AVATAR_ASSETS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'avatars')

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
}

/** Harness browser-auth cookie prefix: only an application on this machine holds it. */
const BROWSER_AUTH_COOKIE_PREFIX = 'dsh-auth-'

/** Whether the socket is loopback. */
export function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Whether the request carries a browser same-origin signal. */
export function hasSameOriginMarker(req) {
  if (req.headers['sec-fetch-site'] === 'same-origin') return true
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin === 'string' && typeof host === 'string') {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  const cookie = req.headers.cookie
  if (typeof cookie === 'string') return cookie.split(';').some(part => part.trim().startsWith(BROWSER_AUTH_COOKIE_PREFIX))
  return false
}

/**
 * Whether a request may reach the bot API.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {boolean} true when the fence admits it.
 */
export function isTrustedRequest(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  if (isLoopbackAddress(req.socket?.remoteAddress)) return true
  return hasSameOriginMarker(req)
}

function writeJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

function refuse(res, status, code, message) {
  writeJson(res, status, { ok: false, code, message })
}

/** Map a thrown value to one stable refusal. */
function replyFailure(res, error, log) {
  if (isBotError(error)) {
    refuse(res, statusForCode(error.code), error.code, error.message)
    return
  }
  log?.('error', 'the bot API failed to serve a request', error)
  refuse(res, 500, 'internal', 'the dsh-bot host failed to serve this request')
}

/** Read one JSON body under the byte cap. */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new BotError('body-too-large', `the request body exceeds ${BODY_LIMIT} bytes`)
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BotError('invalid-request', 'the request body must be a JSON object')
    }
    return value
  } catch (error) {
    if (isBotError(error)) throw error
    throw new BotError('invalid-request', 'the request body is not valid JSON')
  }
}

/** Read one raw body under the upload cap. */
async function readRaw(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new BotError('body-too-large', `the uploaded file exceeds ${limit} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Read a required string field. */
function requireString(body, key) {
  const value = body?.[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BotError('invalid-request', `the request needs a non-blank "${key}"`)
  }
  return value
}

/**
 * Serve one avatar SVG from the packaged asset library.
 *
 * Only a known preset id can be requested: the id is whitelisted against the
 * same table the matcher uses, and the resolved path must stay inside the
 * chosen variant directory. Unknown ids and traversal attempts are a plain 404.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {URL} url - the parsed request URL.
 * @param {string} path - the path suffix after `/dsh-bot/api`.
 * @returns {boolean} whether the route answered.
 */
function serveAvatarAsset(res, url, path) {
  const match = /^\/avatar\/([a-z0-9-]+)\.svg$/.exec(path)
  if (match === null) return false
  const id = match[1]
  if (!isAvatarId(id)) {
    refuse(res, 404, 'invalid-request', `no avatar preset has the id "${id}"`)
    return true
  }
  const variant = url.searchParams.get('variant') === 'transparent' ? 'transparent' : 'tile'
  const directory = join(AVATAR_ASSETS_ROOT, variant)
  const file = join(directory, `${id}.svg`)
  const root = resolve(directory) + sep
  if (!resolve(file).startsWith(root) || !existsSync(file)) {
    refuse(res, 404, 'invalid-request', `the ${variant} avatar asset for "${id}" is unavailable`)
    return true
  }
  let size = 0
  try {
    size = statSync(file).size
  } catch {
    refuse(res, 404, 'invalid-request', `the ${variant} avatar asset for "${id}" is unavailable`)
    return true
  }
  res.writeHead(200, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'content-length': String(size),
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  createReadStream(file).pipe(res)
  return true
}

/**
 * Register the routes and the SSE endpoint.
 * @param {{ ctx: object, store: object, services: object, runtime: object, hub: object, prompt: object, dispatcher: object }} input - wiring.
 * @returns {() => void} the disposer.
 */
/** The one live prefix registration this process holds. */
let liveRouteDisposer

export function registerRoutes({ ctx, store, services, runtime, hub, prompt, dispatcher }) {
  // A profile reload can activate the new row before the old fiber's cleanup
  // runs, and the webserver rejects a duplicate prefix. Module state survives
  // the row restart (the ESM module is cached), so drop our own previous
  // registration first; the old fiber's later cleanup remains harmless.
  if (typeof liveRouteDisposer === 'function') {
    try {
      liveRouteDisposer()
    } catch {
      /* an already-removed registration is exactly what we want */
    }
    liveRouteDisposer = undefined
  }

  void prompt
  const log = (level, message, error) => {
    const logger = ctx?.logger
    if (logger && typeof logger[level] === 'function') logger[level](`[dsh-bot] ${message}`, error)
    else if (level === 'warn' || level === 'error') console.warn(`[dsh-bot] ${message}`, error ?? '')
  }

  /** Publish the full state after a structural change. */
  const broadcastState = async () => {
    try {
      const state = await services.fullStateView()
      hub?.publish?.({ type: 'state', state })
    } catch (error) {
      log('warn', 'the state frame could not be broadcast', error)
    }
  }

  /** The response every mutating action answers. */
  const stateReply = async (extra = {}) => ({ ok: true, state: await services.fullStateView(), ...extra })

  // ------------------------------------------------------------------ bots
  const handleBot = async (body) => {
    const action = String(body.action ?? 'create')
    if (action === 'create') {
      await services.bots.create(body.bot ?? body)
    } else if (action === 'update') {
      const id = body.botId ?? body.bot?.id
      if (id === undefined) throw new BotError('invalid-request', 'an update needs botId')
      await services.bots.update(id, body.bot ?? body)
    } else if (action === 'delete') {
      const id = body.botId ?? body.bot?.id
      if (id === undefined) throw new BotError('invalid-request', 'a delete needs botId')
      const bots = services.bots.list()
      const bot = services.bots.require(id)
      if (bot.isMain && bots.length <= 1) throw new BotError('invalid-request', 'the last bot cannot be deleted')
      await services.bots.remove(bot)
    } else {
      throw new BotError('invalid-request', `unknown bot action "${action}"`)
    }
    await broadcastState()
    return await stateReply()
  }

  // ---------------------------------------------------------------- groups
  const handleGroup = async (body) => {
    const action = String(body.action ?? 'create')
    if (action === 'create') {
      await services.groups.create(body.group ?? body)
    } else if (action === 'update') {
      const id = body.groupId ?? body.group?.id
      if (id === undefined) throw new BotError('invalid-request', 'an update needs groupId')
      // PROTOCOL puts resetSessions on the request body; the group patch keeps
      // every other field. Accept the nested spelling too so both callers work.
      const patch = { ...(body.group ?? body) }
      if (body.resetSessions !== undefined && patch.resetSessions === undefined) {
        patch.resetSessions = body.resetSessions
      }
      const result = await services.groups.update(id, patch)
      await broadcastState()
      return await stateReply({ sessionsReset: result.sessionsReset })
    } else if (action === 'delete') {
      const id = body.groupId ?? body.group?.id
      if (id === undefined) throw new BotError('invalid-request', 'a delete needs groupId')
      await services.groups.remove(id)
    } else {
      throw new BotError('invalid-request', `unknown group action "${action}"`)
    }
    await broadcastState()
    return await stateReply()
  }

  // ----------------------------------------------------------------- chats
  const resolveChat = async (body) => {
    if (typeof body.chatId === 'string' && body.chatId !== '') return services.chats.require(body.chatId)
    if (typeof body.botId === 'string' && body.botId !== '') {
      return await services.chats.ensureDm(services.bots.require(body.botId))
    }
    if (typeof body.groupId === 'string' && body.groupId !== '') {
      return await services.chats.ensureGroup(services.groups.require(body.groupId))
    }
    throw new BotError('invalid-request', 'the request names no chat')
  }

  const handleChat = async (body) => {
    const action = String(body.action ?? 'send')
    if (action === 'send') {
      const chat = await resolveChat(body)
      const attachmentIds = Array.isArray(body.attachments)
        ? body.attachments.filter(id => typeof id === 'string' && id !== '')
        : []
      const views = services.attachments.viewsOf(attachmentIds)
      const text = String(body.text ?? '').trim()
      if (text === '' && views.length === 0) throw new BotError('invalid-request', 'a message needs text or an attachment')
      const clientMessageId = typeof body.clientMessageId === 'string' && body.clientMessageId !== ''
        ? clip(body.clientMessageId, 120)
        : undefined
      if (clientMessageId !== undefined) {
        const existing = services.messages.list(chat.id).find(message => message.clientMessageId === clientMessageId)
        if (existing !== undefined) return await stateReply({ chat: services.chats.view(chat) })
      }
      const manifest = services.attachments.manifestFor(attachmentIds)
      const message = await services.messages.append(chat.id, {
        role: 'user',
        text,
        status: 'done',
        parts: [
          ...services.attachments.partsOf(views),
          ...(text === '' ? [] : [{ type: 'text', text }]),
        ],
        ...(views.length === 0 ? {} : { attachments: views }),
        ...(manifest === '' ? {} : { attachmentManifest: manifest }),
        ...(clientMessageId === undefined ? {} : { clientMessageId }),
      })
      hub?.publish?.({ type: 'message', message })
      hub?.publish?.({ type: 'chat', chat: services.chats.view(chat) })
      try {
        await dispatcher.handle(chat, message)
      } catch (error) {
        await services.messages.update(chat.id, message.id, {
          status: 'error',
          error: describeError(error),
        })
        throw error
      }
      return await stateReply({ chat: services.chats.view(chat) })
    }
    if (action === 'cancel') {
      const chat = services.chats.require(requireString(body, 'chatId'))
      await dispatcher.cancel(chat.id)
      return await stateReply({ chat: services.chats.view(chat) })
    }
    if (action === 'retry') {
      const chat = services.chats.require(requireString(body, 'chatId'))
      void runtime.retry(chat.id).catch((error) => log('warn', 'a retried turn failed', error))
      return await stateReply({ chat: services.chats.view(chat) })
    }
    if (action === 'pin') {
      const chat = services.chats.require(requireString(body, 'chatId'))
      if (typeof body.pinned !== 'boolean') throw new BotError('invalid-request', '"pinned" must be a boolean')
      const updated = await services.chats.setPinned(chat.id, body.pinned)
      const view = services.chats.view(updated)
      hub?.publish?.({ type: 'chat', chat: view })
      await broadcastState()
      return await stateReply({ chat: view })
    }
    if (action === 'read') {
      const chat = services.chats.require(requireString(body, 'chatId'))
      await services.chats.read(chat.id)
      return { ok: true, chat: services.chats.view(chat) }
    }
    if (action === 'clear') {
      const chat = services.chats.require(requireString(body, 'chatId'))
      await services.chats.clear(chat.id)
      await broadcastState()
      return await stateReply({ chat: services.chats.view(chat) })
    }
    if (action === 'create') {
      const chat = await resolveChat(body)
      return await stateReply({ chat: services.chats.view(chat) })
    }
    throw new BotError('invalid-request', `unknown chat action "${action}"`)
  }

  // -------------------------------------------------------------- messages
  const handleMessages = (url) => {
    const chatId = url.searchParams.get('chatId')
    if (typeof chatId !== 'string' || chatId === '') throw new BotError('invalid-request', 'the request names no chat')
    const chat = services.chats.require(chatId)
    const beforeRaw = url.searchParams.get('before')
    const limitRaw = Number(url.searchParams.get('limit'))
    const page = services.messages.page(chat.id, {
      before: beforeRaw === null ? undefined : Number(beforeRaw),
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(MESSAGE_PAGE_MAX, limitRaw) : 200,
    })
    return { ok: true, messages: page.messages, hasMore: page.hasMore }
  }

  // ----------------------------------------------------------------- usage
  const handleUsage = (url) => {
    const days = Number(url.searchParams.get('days') ?? 7)
    return { ok: true, usage: services.usage.view(days) }
  }

  // ---------------------------------------------------------------- memory
  const handleMemory = async (body) => {
    const action = String(body.action ?? 'list')
    if (action === 'list') {
      const scope = body.scope === 'bot' ? 'bot' : body.scope === 'self' ? 'self' : 'team'
      const entries = services.memory.list({
        scope,
        botId: body.botId ?? body.targetBotId,
        targetBotId: body.targetBotId,
      })
      return { ok: true, entries, budgets: services.memory.budgets() }
    }
    if (action === 'remember') {
      const scope = body.scope === 'bot' ? 'bot' : body.scope === 'self' ? 'self' : 'team'
      const result = await services.memory.remember({
        scope,
        text: requireString(body, 'text'),
        key: typeof body.key === 'string' ? body.key : undefined,
        id: typeof body.id === 'string' ? body.id : undefined,
        replaceId: typeof body.id === 'string' ? body.id : undefined,
        pinned: body.pinned === true,
        botId: body.botId,
        targetBotId: body.targetBotId,
        source: 'panel',
      })
      hub?.publish?.({ type: 'memory' })
      await broadcastState()
      return { ok: true, entry: result.entry, entries: result.entries, budgets: services.memory.budgets() }
    }
    if (action === 'forget') {
      const scope = body.scope === 'bot' ? 'bot' : body.scope === 'self' ? 'self' : 'team'
      const result = await services.memory.forget({
        scope,
        id: typeof body.id === 'string' ? body.id : undefined,
        text: typeof body.text === 'string' ? body.text : undefined,
        key: typeof body.key === 'string' ? body.key : undefined,
        botId: body.botId,
        targetBotId: body.targetBotId,
      })
      hub?.publish?.({ type: 'memory' })
      await broadcastState()
      return { ok: true, entries: result.entries, budgets: services.memory.budgets() }
    }
    throw new BotError('invalid-request', `unknown memory action "${action}"`)
  }

  // -------------------------------------------------------------- schedule
  /** Map the panel's timing form onto one native schedule timing. */
  const nativeTimingOf = (timing) => {
    const zone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      } catch {
        return 'UTC'
      }
    })()
    const kind = timing?.kind
    if (kind === 'daily') {
      // The Host's schedule timing takes HH:mm:ss; the panel and the model both
      // speak HH:mm, so normalize here instead of letting the Host refuse it.
      const raw = /^\d{2}:\d{2}$/.test(String(timing.time ?? '')) ? String(timing.time) : '09:00'
      const time = `${raw}:00`
      return { kind: 'daily', daily: { time, time_zone: timing.timeZone ?? zone } }
    }
    if (kind === 'interval' || kind === 'every') {
      const minutes = Math.max(1, Math.floor(Number(timing.everyMinutes ?? timing.minutes) || 5))
      return { kind: 'every', every_seconds: minutes * 60 }
    }
    if (kind === 'once' || kind === 'after') {
      const minutes = Math.max(1, Math.floor(Number(timing.inMinutes ?? timing.minutes) || 10))
      return { kind: 'after', after_seconds: minutes * 60 }
    }
    if (kind === 'at' && typeof timing.at === 'string') return { kind: 'at', at: timing.at }
    throw new BotError('invalid-request', 'the schedule timing names no supported kind')
  }

  const handleSchedule = async (body) => {
    const action = String(body.action ?? 'create')
    if (action === 'list') {
      return { ok: true, schedules: services.schedules.list().map(services.scheduleView) }
    }
    if (action === 'create') {
      const bot = services.bots.require(requireString(body, 'botId'))
      const prompt = requireString(body, 'prompt')
      const timing = nativeTimingOf(body.timing)
      const chat = await services.chats.ensureDm(bot)
      const sessionId = await runtime.ensureSession(chat, bot)
      const record = await services.schedules.create({
        botId: bot.id,
        title: body.title ?? clip(prompt, 40),
        prompt,
        timing: body.timing ?? { kind: 'daily', time: '09:00' },
      })
      const service = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined
      if (service === undefined || typeof service.create !== 'function') {
        await services.schedules.remove(record.id)
        throw new BotError('schedule-unavailable', 'this deployment serves no schedule service')
      }
      try {
        const native = await service.create({
          title: record.title,
          prompt: record.prompt,
          timing,
          target: { kind: 'session', sessionId },
        })
        const nativeId = typeof native?.id === 'string' ? native.id : undefined
        await services.schedules.update(record.id, { nativeId })
      } catch (error) {
        await services.schedules.remove(record.id)
        throw new BotError('schedule-unavailable', `the host refused the scheduled task: ${describeError(error)}`, { cause: error })
      }
      await broadcastState()
      return await stateReply()
    }
    if (action === 'update') {
      const record = services.schedules.require(requireString(body, 'scheduleId'))
      const bot = services.bots.require(record.botId)
      const prompt = typeof body.prompt === 'string' && body.prompt.trim() !== '' ? body.prompt.trim() : record.prompt
      const title = typeof body.title === 'string' && body.title.trim() !== '' ? clip(body.title.trim(), 120) : record.title
      const timingInput = body.timing ?? record.timing
      const timing = nativeTimingOf(timingInput)
      const chat = await services.chats.ensureDm(bot)
      const sessionId = await runtime.ensureSession(chat, bot)
      const service = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined
      if (service === undefined || typeof service.create !== 'function') {
        throw new BotError('schedule-unavailable', 'this deployment serves no schedule service')
      }
      // Replace the native task in one step: delete the old one when it exists,
      // then create the new one; the local record keeps the new native id.
      if (record.nativeId !== undefined && typeof service.edit === 'function') {
        try {
          await service.edit({ id: record.nativeId, action: 'delete' })
        } catch {
          /* an already-removed native task is exactly what we want */
        }
      }
      let nativeId
      try {
        const native = await service.create({
          title,
          prompt,
          timing,
          target: { kind: 'session', sessionId },
        })
        nativeId = typeof native?.id === 'string' ? native.id : undefined
      } catch (error) {
        throw new BotError('schedule-unavailable', `the host refused the scheduled task: ${describeError(error)}`, { cause: error })
      }
      await services.schedules.update(record.id, { title, prompt, timing: timingInput, nativeId })
      await broadcastState()
      return await stateReply()
    }
    if (action === 'delete') {
      const record = services.schedules.require(requireString(body, 'scheduleId'))
      await services.schedules.removeNative(record)
      await services.schedules.remove(record.id)
      await broadcastState()
      return await stateReply()
    }
    if (action === 'run') {
      const record = services.schedules.require(requireString(body, 'scheduleId'))
      const service = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined
      if (service === undefined || typeof service.run !== 'function') {
        throw new BotError('schedule-unavailable', 'this deployment serves no schedule service')
      }
      if (record.nativeId === undefined) throw new BotError('schedule-unavailable', 'this task has no host schedule attached')
      await service.run({ id: record.nativeId })
      return { ok: true }
    }
    throw new BotError('invalid-request', `unknown schedule action "${action}"`)
  }

  // ---------------------------------------------------------------- config
  const handleConfig = async (body) => {
    const patch = typeof body.patch === 'object' && body.patch !== null ? body.patch : {}
    if (patch.userName !== undefined) {
      const name = String(patch.userName).trim()
      store.db.settings.userName = clip(name, 40) || store.db.settings.userName
      store.db.self.name = store.db.settings.userName
    }
    if (patch.language !== undefined) {
      store.db.settings.language = patch.language === 'en' ? 'en' : 'zh'
    }
    await store.save()
    await broadcastState()
    return await stateReply()
  }

  // ---------------------------------------------------------------- router
  const handler = async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'cache-control': 'no-store' })
      res.end()
      return
    }
    if (!isTrustedRequest(req)) {
      refuse(res, 403, 'forbidden', 'this route is served to this machine\'s own browser only')
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const suffix = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname
    const path = suffix === '' ? '/' : suffix
    const method = req.method ?? 'GET'
    try {
      if (path === '/events') {
        if (method !== 'GET') {
          refuse(res, 405, 'method-not-allowed', 'the event stream serves GET only')
          return
        }
        const initial = { type: 'state', state: await services.fullStateView() }
        hub.attach(res, initial)
        return
      }
      if (method === 'GET') {
        if (path.startsWith('/avatar/')) {
          if (serveAvatarAsset(res, url, path)) return
          refuse(res, 404, 'invalid-request', `no route serves ${method} ${path}`)
          return
        }
        if (path === '/media') {
          const id = url.searchParams.get('id')
          if (id === null || id === '') throw new BotError('invalid-request', 'the media route needs an id')
          services.attachments.send(res, id)
          return
        }
        if (path === '/state') {
          const state = await services.fullStateView()
          // The revision is answered twice on purpose: `stateRev` lets a poller
          // compare cheaply, and `state.stateRev` keeps the SSE frame and this
          // response the same shape.
          writeJson(res, 200, { ok: true, stateRev: state.stateRev, state })
          return
        }
        if (path === '/messages') {
          writeJson(res, 200, handleMessages(url))
          return
        }
        if (path === '/usage') {
          writeJson(res, 200, handleUsage(url))
          return
        }
        if (path === '/models') {
          const models = await services.modelCatalog()
          if (models === undefined) throw new BotError('model-unavailable', 'this deployment serves no model catalog')
          writeJson(res, 200, { ok: true, models })
          return
        }
        refuse(res, 404, 'invalid-request', `no route serves ${method} ${path}`)
        return
      }
      if (method === 'POST') {
        // The upload route carries raw bytes, not JSON.
        if (path === '/upload') {
          const name = url.searchParams.get('name') ?? 'file'
          const declared = String(req.headers['content-type'] ?? '')
          const bytes = await readRaw(req, MAX_UPLOAD_BYTES)
          const stored = await services.attachments.put(bytes, { name, mime: declared })
          writeJson(res, 200, { ok: true, attachment: stored.attachment })
          return
        }
        const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
        if (!contentType.startsWith('application/json')) {
          refuse(res, 415, 'json-required', 'this route accepts application/json only')
          return
        }
        const body = await readJson(req)
        if (path === '/bot') {
          writeJson(res, 200, await handleBot(body))
          return
        }
        if (path === '/group') {
          writeJson(res, 200, await handleGroup(body))
          return
        }
        if (path === '/chat') {
          writeJson(res, 200, await handleChat(body))
          return
        }
        if (path === '/memory') {
          writeJson(res, 200, await handleMemory(body))
          return
        }
        if (path === '/schedule') {
          writeJson(res, 200, await handleSchedule(body))
          return
        }
        if (path === '/config') {
          writeJson(res, 200, await handleConfig(body))
          return
        }
        refuse(res, 404, 'invalid-request', `no route serves ${method} ${path}`)
        return
      }
      refuse(res, 405, 'method-not-allowed', `this API does not serve ${method}`)
    } catch (error) {
      replyFailure(res, error, log)
    }
  }

  const dispose = ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
  liveRouteDisposer = dispose
  return () => {
    if (liveRouteDisposer === dispose) liveRouteDisposer = undefined
    dispose()
  }
}
