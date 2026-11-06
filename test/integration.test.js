import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import test from 'node:test'
import { apply, inject } from '../src/index.js'

/** Minimal request the route handler can iterate. */
function mockRequest({ method, url, body, rawBody, headers = {}, remoteAddress = '127.0.0.1' }) {
  const payload = rawBody !== undefined
    ? rawBody
    : (body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)))
  return {
    method,
    url,
    headers: {
      'content-type': rawBody === undefined ? 'application/json' : 'application/octet-stream',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      if (payload.length > 0) yield payload
    },
  }
}

/** Minimal response capturing status, headers and body. */
function mockResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    chunks: [],
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    write(chunk) {
      this.chunks.push(chunk)
      return true
    },
    end(chunk) {
      if (chunk !== undefined) this.body += chunk
      this.body += this.chunks.join('')
    },
    on() {},
    off() {},
  }
}

/** A Writable response for the /media stream route. */
function streamResponse() {
  const chunks = []
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  res.status = 0
  res.headers = {}
  res.writeHead = (status, headers) => {
    res.status = status
    res.headers = headers ?? {}
  }
  res.body = () => Buffer.concat(chunks)
  return res
}

function makeHost(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-host-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(dir, { recursive: true, force: true })
  })

  const listeners = new Map()
  const registrations = []
  const routes = []
  const tools = []
  const sections = []
  const live = new Map()
  const prompts = []
  const cancels = []
  let promptMode = 'normal'
  let created = 0
  let turnNumber = 0
  const workspace = {
    id: 'ws-bot',
    path: dir,
    attachSession: async () => {},
  }
  const userWorkspace = {
    id: 'ws-user',
    title: 'User Project',
    path: dir,
    attachSession: async () => {},
  }
  const createdWorkspaceIds = []
  const createRequests = []

  const controller = {
    async create(request) {
      created += 1
      createRequests.push({ ...request })
      createdWorkspaceIds.push(request?.workspaceId)
      const sessionId = `session-${created}`
      live.set(sessionId, { id: sessionId, header: {} })
      return { sessionId }
    },
    async prompt(request, signal) {
      if (signal === undefined || typeof signal.throwIfAborted !== 'function') {
        throw new TypeError('prompt requires an AbortSignal')
      }
      prompts.push(request)
      queueMicrotask(() => {
        // One turn with two model steps around a tool call, which is what the
        // Host really commits for a turn that uses a tool.
        turnNumber += 1
        if (promptMode === 'orphan-tool') {
          const session = live.get(request.sessionId)
          const turn = turnNumber
          emit('session/event', session, { type: 'turn/start', seq: 1, time: Date.now(), data: { turn } })
          emit('session/event', session, {
            type: 'assistant/message',
            seq: 2,
            time: Date.now(),
            data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'checking the team' }] }, stream: [] },
          })
          emit('session/event', session, {
            type: 'tool/call',
            seq: 3,
            time: Date.now(),
            data: { turn, step: 1, callId: 'call_orphan', name: 'bot_list_team', arguments: '{}' },
          })
          emit('session/event', session, { type: 'turn/end', seq: 4, time: Date.now(), data: { turn, reason: { kind: 'completed' } } })
          return
        }
        const session = live.get(request.sessionId)
        const turn = turnNumber
        emit('session/event', session, { type: 'turn/start', seq: 1, time: Date.now(), data: { turn } })
        emit('agent/assistant-stream', {
          agent: { id: request.sessionId },
          frame: { type: 'chunk', turn, step: 1, chunk: { type: 'text-delta', text: 'Hel' } },
        })
        emit('agent/assistant-stream', {
          agent: { id: request.sessionId },
          frame: { type: 'chunk', turn, step: 1, chunk: { type: 'text-delta', text: 'lo' } },
        })
        emit('session/event', session, {
          type: 'assistant/message',
          seq: 2,
          time: Date.now(),
          data: {
            turn,
            step: 1,
            message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
            stream: [],
            usage: { inputTokens: 10, outputTokens: 2 },
          },
        })
        emit('session/event', session, {
          type: 'tool/call',
          seq: 3,
          time: Date.now(),
          data: { turn, step: 1, callId: 'call_1', name: 'bash', arguments: '{}' },
        })
        emit('session/event', session, {
          type: 'tool/result',
          seq: 4,
          time: Date.now(),
          // The real Host commits the call id on the tool message, not at the
          // event-data root (`SessionEventMap['tool/result']` has no callId).
          data: { turn, step: 1, message: { role: 'tool', toolCallId: 'call_1', isError: false } },
        })
        emit('session/event', session, {
          type: 'assistant/message',
          seq: 5,
          time: Date.now(),
          data: {
            turn,
            step: 2,
            message: { role: 'assistant', content: [{ type: 'text', text: ' done' }] },
            stream: [],
            usage: { inputTokens: 3, outputTokens: 1 },
          },
        })
        emit('session/event', session, { type: 'turn/end', seq: 6, time: Date.now(), data: { turn, reason: { kind: 'completed' } } })
      })
      return { accepted: true }
    },
    async resolveAgent(sessionId) {
      const session = live.get(sessionId)
      if (session === undefined) return { error: { code: 'session/not-found' } }
      return { agent: { id: sessionId, session } }
    },
    cancel({ sessionId }) {
      cancels.push(sessionId)
      const session = live.get(sessionId)
      emit('session/event', session, { type: 'turn/end', seq: 7, time: Date.now(), data: { turn: turnNumber, reason: { kind: 'aborted' } } })
    },
    async modelCatalog() {
      return {
        default: { provider: 'deepseek', model: 'deepseek-chat' },
        groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'Chat', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }],
      }
    },
  }

  const emit = (event, ...args) => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }

  const scheduleService = {
    created: [],
    deleted: [],
    edited: [],
    ran: [],
    async create(request) {
      scheduleService.created.push(request)
      return { id: 'native-sched-1' }
    },
    async run(request) {
      scheduleService.ran.push(request)
    },
    async delete(request) {
      scheduleService.deleted.push(request)
    },
    async edit(request) {
      scheduleService.edited.push(request)
      return { deleted: true }
    },
  }

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    effect(fn, label) {
      const disposer = fn()
      t.after(() => {
        if (typeof disposer === 'function') disposer()
      })
      void label
      return disposer
    },
    on(event, listener, options) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      if (options !== undefined) registrations.push({ event, options })
      return () => {}
    },
    get(key) {
      if (key === 'workspaceRegistry') {
        return {
          async resolveByPath() {
            return workspace
          },
          async create() {
            return workspace
          },
          list() {
            return [workspace, userWorkspace]
          },
          get(id) {
            if (id === 'ws-user') return userWorkspace
            if (id === 'ws-bot') return workspace
            return undefined
          },
        }
      }
      if (key === 'schedule') return scheduleService
      if (key === 'sessionTitle') return { rename() {} }
      if (key === 'permissionPresets') return { set() {} }
      return undefined
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    systemPrompt: {
      getSectionOrder: () => 0,
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
    tools: {
      register(definition, options) {
        tools.push({ definition, options })
        return () => {}
      },
    },
    sessions: {
      get(sessionId) {
        return live.get(sessionId)
      },
    },
    sessionController: controller,
  }

  apply(ctx, {})
  t.after(() => {
    for (const disposer of t._disposers ?? []) disposer()
  })

  const route = routes[0]
  assert.ok(route, 'the host registered its API route')

  const setPromptMode = (mode) => {
    promptMode = mode
  }

  const call = async (method, path, options = {}) => {
    const req = mockRequest({ method, url: `/dsh-bot/api${path}`, ...options })
    const res = mockResponse()
    await route.handler(req, res)
    const parsed = res.chunks.length > 0 && res.headers['content-type']?.startsWith('text/event-stream')
      ? null
      : (() => {
          try {
            return JSON.parse(res.body)
          } catch {
            return undefined
          }
        })()
    return { status: res.status, body: parsed, raw: res.body, res }
  }

  return { ctx, dir, routes, route, call, prompts, cancels, tools, sections, live, emit, setPromptMode, registrations, createdWorkspaceIds, createRequests }
}

async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return false
}

test('plugin entry: hard dependencies and one API route', (t) => {
  const host = makeHost(t)
  assert.deepEqual(inject, ['webServer', 'sessionController', 'systemPrompt', 'tools', 'sessions'])
  assert.equal(host.routes.length, 1)
  assert.equal(host.routes[0].kind, 'prefix')
  assert.equal(host.routes[0].path, '/dsh-bot/api')
  assert.equal(host.sections.length, 1)
  assert.equal(host.sections[0].name, 'dsh-bot:bot-persona')
  assert.equal(host.tools.length, 21)
})

test('plugin entry: approval answerers are registered prepended and global', (t) => {
  const host = makeHost(t)
  assert.ok(host.registrations.some(entry => entry.event === 'approval/request'
    && entry.options.global === true && entry.options.prepend === true))
  assert.ok(host.registrations.some(entry => entry.event === 'user-questions/request'
    && entry.options.global === true && entry.options.prepend === true))
})

test('api: state is the empty federation before anything exists', async (t) => {
  const host = makeHost(t)
  const { body } = await host.call('GET', '/state')
  assert.equal(body.ok, true)
  assert.deepEqual(body.state.bots, [])
  assert.deepEqual(body.state.groups, [])
  assert.deepEqual(body.state.chats, [])
  assert.deepEqual(body.state.running, [])
  assert.deepEqual(body.state.schedules, [])
  assert.deepEqual(body.state.helpers, [])
  assert.equal(body.state.settings.language, 'zh')
  assert.equal(typeof body.stateRev, 'number')
  assert.equal(body.stateRev, body.state.stateRev)
  assert.ok(body.state.models.providers.length >= 1)
})

test('api: a bot is created through the route and answered by a real turn', async (t) => {
  const host = makeHost(t)
  const before = (await host.call('GET', '/state')).body.stateRev
  const created = await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice', role: 'planner' } } })
  assert.equal(created.status, 200)
  assert.ok(created.body.state.stateRev > before, 'a write advances stateRev')
  assert.equal(created.body.ok, true)
  assert.equal(created.body.state.bots.length, 1)
  const bot = created.body.state.bots[0]
  assert.equal(bot.name, 'Alice')
  assert.equal(bot.isMain, true)
  assert.equal(created.body.state.chats.length, 1)
  const chat = created.body.state.chats[0]
  assert.equal(chat.kind, 'dm')
  assert.equal(chat.botId, bot.id)

  const sent = await host.call('POST', '/chat', { body: { action: 'send', chatId: chat.id, text: 'hello there' } })
  assert.equal(sent.status, 200)
  assert.equal(sent.body.ok, true)
  assert.ok(await waitFor(async () => {
    const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(chat.id)}`)
    return page.body.messages.some(message => message.role === 'bot' && message.status === 'done')
  }))
  const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(chat.id)}`)
  const messages = page.body.messages
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[1].role, 'bot')
  assert.equal(messages[1].text, 'Hello\n\n done')
  assert.deepEqual(messages[1].parts, [
    { type: 'text', text: 'Hello' },
    { type: 'tool', name: 'bash', status: 'ok' },
    { type: 'text', text: ' done' },
  ])
  assert.equal(messages[1].status, 'done')
  assert.equal(host.prompts.length, 1)
  assert.match(host.prompts[0].content[0].text, /hello there/)
  // The chat now carries the real DSH session it is backed by.
  const state = await host.call('GET', '/state')
  assert.equal(state.body.state.chats[0].sessionId, 'session-1')
  assert.equal(state.body.state.chats[0].lastSeq, 2)
  // Usage was recorded for the turn.
  const usage = await host.call('GET', '/usage?days=7')
  assert.equal(usage.body.usage.total.turns, 1)
  assert.equal(usage.body.usage.byBot[0].name, 'Alice')
})

test('api: a turn that ends around an unreturned tool settles the tool part', async (t) => {
  const host = makeHost(t)
  const created = await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice' } } })
  const chat = created.body.state.chats[0]
  host.setPromptMode('orphan-tool')
  await host.call('POST', '/chat', { body: { action: 'send', chatId: chat.id, text: 'list the team' } })
  assert.ok(await waitFor(async () => {
    const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(chat.id)}`)
    return page.body.messages.some(message => message.role === 'bot' && message.status === 'done')
  }))
  const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(chat.id)}`)
  const bot = page.body.messages.find(message => message.role === 'bot')
  const tool = bot.parts.find(part => part.type === 'tool')
  assert.equal(tool.name, 'bot_list_team')
  assert.notEqual(tool.status, 'running')
  assert.equal(tool.status, 'failed')
  assert.match(tool.error, /本轮已结束|ended before this tool reported a result/)
})

test('api: avatar SVGs are served by id with the tile and transparent variants', async (t) => {
  const host = makeHost(t)
  const tile = streamResponse()
  const tileDone = new Promise(resolve => tile.on('finish', resolve))
  await host.route.handler(mockRequest({ method: 'GET', url: '/dsh-bot/api/avatar/lead-crown.svg' }), tile)
  await tileDone
  assert.equal(tile.status, 200)
  assert.equal(tile.headers['content-type'], 'image/svg+xml; charset=utf-8')
  assert.equal(tile.headers['x-content-type-options'], 'nosniff')
  assert.match(tile.headers['cache-control'], /immutable/)
  assert.match(tile.body().toString('utf8'), /<svg[\s>]/)

  const transparent = streamResponse()
  const transparentDone = new Promise(resolve => transparent.on('finish', resolve))
  await host.route.handler(mockRequest({ method: 'GET', url: '/dsh-bot/api/avatar/architect-stag.svg?variant=transparent' }), transparent)
  await transparentDone
  assert.equal(transparent.status, 200)
  assert.match(transparent.body().toString('utf8'), /<svg[\s>]/)

  // Unknown ids and traversal attempts are 404s, never a filesystem read.
  const unknown = await host.call('GET', '/avatar/no-such-avatar.svg')
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.code, 'invalid-request')
  const encodedTraversal = await host.call('GET', '/avatar/..%2F..%2Fstate.json.svg')
  assert.equal(encodedTraversal.status, 404)
  const normalizedTraversal = await host.call('GET', '/avatar/../lead-crown.svg')
  assert.equal(normalizedTraversal.status, 404)
  const bogusVariant = streamResponse()
  const bogusDone = new Promise(resolve => bogusVariant.on('finish', resolve))
  await host.route.handler(mockRequest({ method: 'GET', url: '/dsh-bot/api/avatar/lead-crown.svg?variant=bogus' }), bogusVariant)
  await bogusDone
  assert.equal(bogusVariant.status, 200)
})

test('api: an upload is stored once and served back as a media stream', async (t) => {
  const host = makeHost(t)
  const bytes = Buffer.from('fake png bytes for the integration test')
  const first = await host.call('POST', '/upload?name=pic.png', { rawBody: bytes, headers: { 'content-type': 'image/png' } })
  assert.equal(first.status, 200)
  assert.equal(first.body.ok, true)
  const attachment = first.body.attachment
  assert.match(attachment.id, /^[0-9a-f]{12}$/)
  assert.equal(attachment.name, 'pic.png')
  assert.equal(attachment.mime, 'image/png')
  assert.equal(attachment.size, bytes.length)
  assert.equal(attachment.url, `dsh-bot/api/media?id=${attachment.id}`)
  // Content addressing: the same bytes answer the same attachment id.
  const again = await host.call('POST', '/upload?name=copy.png', { rawBody: bytes, headers: { 'content-type': 'image/png' } })
  assert.equal(again.body.attachment.id, attachment.id)
  // The media route streams the exact bytes.
  const res = streamResponse()
  const finished = new Promise(resolve => res.on('finish', resolve))
  await host.route.handler(mockRequest({ method: 'GET', url: `/dsh-bot/api/media?id=${attachment.id}` }), res)
  await finished
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'image/png')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.deepEqual(res.body(), bytes)
  // An unknown id is a named refusal.
  const missing = await host.call('GET', '/media?id=deadbeef0000')
  assert.equal(missing.status, 400)
  assert.equal(missing.body.code, 'invalid-request')
})

test('api: a message carries attachment parts and the prompt carries absolute paths', async (t) => {
  const host = makeHost(t)
  const created = await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice' } } })
  const chat = created.body.state.chats[0]
  const bytes = Buffer.from('report body')
  const upload = await host.call('POST', '/upload?name=report.txt', { rawBody: bytes, headers: { 'content-type': 'text/plain' } })
  const attachment = upload.body.attachment
  const sent = await host.call('POST', '/chat', {
    body: { action: 'send', chatId: chat.id, text: 'read this', attachments: [attachment.id] },
  })
  assert.equal(sent.status, 200)
  assert.ok(await waitFor(async () => {
    const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(chat.id)}`)
    return page.body.messages.some(message => message.role === 'bot' && message.status === 'done')
  }))
  const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(chat.id)}`)
  const user = page.body.messages.find(message => message.role === 'user')
  assert.deepEqual(user.parts[0], { type: 'file', attachment })
  assert.equal(user.parts[1].type, 'text')
  assert.equal(user.attachments.length, 1)
  assert.equal(user.attachments[0].id, attachment.id)
  // The prompt carries the absolute path so the Bot can open the file.
  assert.match(host.prompts[0].content[0].text, /\[attachments\]/)
  assert.match(host.prompts[0].content[0].text, /report\.txt/)
  assert.match(host.prompts[0].content[0].text, /uploads/)
  // An unknown attachment id refuses the send.
  const refused = await host.call('POST', '/chat', {
    body: { action: 'send', chatId: chat.id, text: 'x', attachments: ['missing'] },
  })
  assert.equal(refused.status, 400)
  assert.equal(refused.body.code, 'invalid-request')
  // A raw body over the upload cap is refused before it is stored.
  const huge = await host.call('POST', '/upload?name=big.bin', { rawBody: Buffer.alloc(25 * 1024 * 1024 + 1) })
  assert.equal(huge.status, 413)
  assert.equal(huge.body.code, 'body-too-large')
})

test('api: a bot can pin a workspace and its sessions are created there', async (t) => {
  const host = makeHost(t)
  const created = await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice', workspaceId: 'ws-user' } } })
  assert.equal(created.body.ok, true)
  assert.equal(created.body.state.bots[0].workspaceId, 'ws-user')
  assert.deepEqual(created.body.state.workspaces.map(row => row.id), ['ws-bot', 'ws-user'])
  const chat = created.body.state.chats[0]
  await host.call('POST', '/chat', { body: { action: 'send', chatId: chat.id, text: 'hello' } })
  assert.ok(await waitFor(async () => {
    const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(chat.id)}`)
    return page.body.messages.some(message => message.role === 'bot' && message.status === 'done')
  }))
  assert.deepEqual(host.createdWorkspaceIds, ['ws-user'])
  // A default bot creates its session in the shared bot workspace.
  const second = await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Bob' } } })
  const bobChat = second.body.state.chats.find(entry => entry.title === 'Bob')
  await host.call('POST', '/chat', { body: { action: 'send', chatId: bobChat.id, text: 'hi' } })
  assert.ok(await waitFor(async () => {
    const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(bobChat.id)}`)
    return page.body.messages.some(message => message.role === 'bot' && message.status === 'done')
  }))
  assert.deepEqual(host.createdWorkspaceIds, ['ws-user', 'ws-bot'])
  const rejected = await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Carol', workspaceId: 'ws-missing' } } })
  assert.equal(rejected.status, 503)
  assert.equal(rejected.body.code, 'workspace-unavailable')
})

test('api: a chat can be pinned through the route and the frame reaches SSE', async (t) => {
  const host = makeHost(t)
  const alice = (await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice' } } })).body.state.bots[0]
  const bob = (await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Bob' } } })).body.state.bots[1]
  const bobChat = (await host.call('GET', '/state')).body.state.chats.find(chat => chat.botId === bob.id)
  assert.equal(bobChat.pinned, false)
  // The chief chat is pinned on creation.
  assert.equal((await host.call('GET', '/state')).body.state.chats.find(chat => chat.botId === alice.id).pinned, true)

  // Open the event stream first, so the pin frame can be observed.
  const stream = mockResponse()
  const finished = new Promise(resolve => stream.on('finish', resolve))
  await host.route.handler(mockRequest({ method: 'GET', url: '/dsh-bot/api/events' }), stream)
  const pinned = await host.call('POST', '/chat', { body: { action: 'pin', chatId: bobChat.id, pinned: true } })
  assert.equal(pinned.status, 200)
  assert.equal(pinned.body.ok, true)
  assert.equal(pinned.body.chat.pinned, true)
  assert.equal(pinned.body.state.chats.find(chat => chat.id === bobChat.id).pinned, true)
  // The hub published a `chat` frame for the change.
  const frames = stream.chunks.join('').split('\n\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line.replace(/^data: /, '')) } catch { return undefined } })
    .filter(Boolean)
  const frame = frames.find(entry => entry.type === 'chat' && entry.chat?.id === bobChat.id)
  assert.ok(frame, 'a chat frame carried the pin change')
  assert.equal(frame.chat.pinned, true)

  const unpinned = await host.call('POST', '/chat', { body: { action: 'pin', chatId: bobChat.id, pinned: false } })
  assert.equal(unpinned.body.chat.pinned, false)
  const bad = await host.call('POST', '/chat', { body: { action: 'pin', chatId: bobChat.id, pinned: 'yes' } })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, 'invalid-request')
  // An unknown conversation is a named refusal.
  const missing = await host.call('POST', '/chat', { body: { action: 'pin', chatId: 'chat_nope', pinned: true } })
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, 'chat-not-found')
  void finished
})

test('api: a group main directory decides where member sessions are created', async (t) => {
  const host = makeHost(t)
  const alice = (await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice' } } })).body.state.bots[0]
  const bob = (await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Bob' } } })).body.state.bots[1]
  // A registered workspace becomes the session's workspace.
  const byId = await host.call('POST', '/group', {
    body: { action: 'create', group: { name: 'ById', memberIds: [alice.id, bob.id], adminId: alice.id, workspaces: ['ws-user'] } },
  })
  assert.equal(byId.body.ok, true)
  const byIdGroup = byId.body.state.groups.find(group => group.name === 'ById')
  assert.deepEqual(byIdGroup.workspaces, [{ id: 'ws-user', title: 'User Project', path: host.dir }])
  const byIdChat = byId.body.state.chats.find(chat => chat.groupId === byIdGroup.id)
  await host.call('POST', '/chat', { body: { action: 'send', chatId: byIdChat.id, text: 'hello' } })
  assert.ok(await waitFor(async () => {
    const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(byIdChat.id)}`)
    return page.body.messages.some(message => message.role === 'bot' && message.status === 'done')
  }))
  assert.equal(host.createRequests[0].workspaceId, 'ws-user')
  assert.equal(host.createRequests[0].cwd, undefined)

  // A path-only directory (not registered as a workspace) becomes the session's cwd.
  const projectDir = join(host.dir, 'project')
  mkdirSync(projectDir, { recursive: true })
  const byPath = await host.call('POST', '/group', {
    body: { action: 'create', group: { name: 'ByPath', memberIds: [alice.id, bob.id], adminId: alice.id, workspaces: [projectDir] } },
  })
  assert.equal(byPath.body.ok, true)
  const byPathGroup = byPath.body.state.groups.find(group => group.name === 'ByPath')
  assert.equal(byPathGroup.workspaces.length, 1)
  assert.equal(byPathGroup.workspaces[0].title, 'project')
  assert.equal(byPathGroup.workspaces[0].id, undefined)
  const byPathChat = byPath.body.state.chats.find(chat => chat.groupId === byPathGroup.id)
  await host.call('POST', '/chat', { body: { action: 'send', chatId: byPathChat.id, text: 'hello' } })
  assert.ok(await waitFor(async () => {
    const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(byPathChat.id)}`)
    return page.body.messages.some(message => message.role === 'bot' && message.status === 'done')
  }))
  const pathRequest = host.createRequests.find(request => request.cwd !== undefined)
  assert.ok(pathRequest, 'a path-only group created its session with cwd')
  assert.equal(pathRequest.cwd, byPathGroup.workspaces[0].path)
  assert.equal(pathRequest.workspaceId, undefined)

  // A group without directories falls back to the shared bot workspace.
  const plain = await host.call('POST', '/group', {
    body: { action: 'create', group: { name: 'Plain', memberIds: [alice.id, bob.id], adminId: alice.id } },
  })
  const plainGroup = plain.body.state.groups.find(group => group.name === 'Plain')
  assert.deepEqual(plainGroup.workspaces, [])
  const plainChat = plain.body.state.chats.find(chat => chat.groupId === plainGroup.id)
  await host.call('POST', '/chat', { body: { action: 'send', chatId: plainChat.id, text: 'hello' } })
  assert.ok(await waitFor(async () => {
    const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(plainChat.id)}`)
    return page.body.messages.some(message => message.role === 'bot' && message.status === 'done')
  }))
  const fallback = host.createRequests.at(-1)
  assert.equal(fallback.workspaceId, 'ws-bot')
})

test('api: a bot carries autoApprove and the panel can switch it off', async (t) => {
  const host = makeHost(t)
  const created = await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice' } } })
  assert.equal(created.body.state.bots[0].autoApprove, true)
  const updated = await host.call('POST', '/bot', {
    body: { action: 'update', botId: created.body.state.bots[0].id, bot: { autoApprove: false } },
  })
  assert.equal(updated.body.state.bots[0].autoApprove, false)
})

test('api: a refused body answers the stable code and status', async (t) => {
  const host = makeHost(t)
  const invalid = await host.call('POST', '/bot', { body: { action: 'create', bot: { name: '' } } })
  assert.equal(invalid.status, 400)
  assert.deepEqual(invalid.body, { ok: false, code: 'invalid-request', message: 'a bot needs a name' })
  const missing = await host.call('GET', '/messages?chatId=chat_nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, 'chat-not-found')
  const method = await host.call('PUT', '/state')
  assert.equal(method.status, 405)
  assert.equal(method.body.code, 'method-not-allowed')
})

test('api: an oversized body is refused before it is parsed', async (t) => {
  const host = makeHost(t)
  const big = await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'x'.repeat(70 * 1024) } } })
  assert.equal(big.status, 413)
  assert.equal(big.body.code, 'body-too-large')
})

test('api: a cross-site request is refused by the fence', async (t) => {
  const host = makeHost(t)
  const cross = await host.call('GET', '/state', { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(cross.status, 403)
  assert.equal(cross.body.code, 'forbidden')
  const remote = await host.call('GET', '/state', { remoteAddress: '10.0.0.9', headers: { 'sec-fetch-site': 'none' } })
  assert.equal(remote.status, 403)
})

test('api: the event stream opens with a full state frame', async (t) => {
  const host = makeHost(t)
  const req = mockRequest({ method: 'GET', url: '/dsh-bot/api/events' })
  const res = mockResponse()
  await host.route.handler(req, res)
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/event-stream/)
  const lines = res.chunks.join('').split('\n\n').filter(Boolean)
  assert.ok(lines.length >= 1)
  const payload = JSON.parse(lines[0].replace(/^data: /, ''))
  assert.equal(payload.type, 'state')
  assert.deepEqual(payload.state.bots, [])
  assert.equal(typeof payload.state.stateRev, 'number')
})

test('api: memory and config routes act on the ledger', async (t) => {
  const host = makeHost(t)
  const bot = (await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice' } } })).body.state.bots[0]
  const remembered = await host.call('POST', '/memory', { body: { action: 'remember', scope: 'team', text: 'the project is dsh-bot' } })
  assert.equal(remembered.status, 200)
  assert.equal(remembered.body.entries.length, 1)
  const listed = await host.call('POST', '/memory', { body: { action: 'list', scope: 'team' } })
  assert.equal(listed.body.entries.length, 1)
  assert.equal(listed.body.budgets.team.entryCount, 1)
  const forgotten = await host.call('POST', '/memory', { body: { action: 'forget', scope: 'team', id: recalledId(listed.body.entries) } })
  assert.equal(forgotten.body.entries.length, 0)
  const configured = await host.call('POST', '/config', { body: { patch: { userName: 'Ada', language: 'en' } } })
  assert.equal(configured.body.state.settings.userName, 'Ada')
  assert.equal(configured.body.state.settings.language, 'en')
  void bot
})

function recalledId(entries) {
  return entries[0].id
}

test('api: schedules are created, listed and deleted through the route', async (t) => {
  const host = makeHost(t)
  const bot = (await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice' } } })).body.state.bots[0]
  const created = await host.call('POST', '/schedule', {
    body: { action: 'create', botId: bot.id, title: 'standup', prompt: 'summarize the day', timing: { kind: 'daily', time: '09:30' } },
  })
  assert.equal(created.status, 200)
  assert.equal(created.body.ok, true)
  assert.equal(created.body.state.schedules.length, 1)
  const schedule = created.body.state.schedules[0]
  assert.equal(schedule.botId, bot.id)
  assert.equal(schedule.title, 'standup')
  assert.deepEqual(schedule.timing, { kind: 'daily', time: '09:30' })
  assert.equal(schedule.enabled, true)
  assert.equal(schedule.nativeId, 'native-sched-1')
  const scheduleService = host.ctx.get('schedule')
  assert.equal(scheduleService.created.length, 1)
  assert.deepEqual(scheduleService.created[0].target, { kind: 'session', sessionId: 'session-1' })
  assert.equal(scheduleService.created[0].timing.kind, 'daily')
  const listed = await host.call('POST', '/schedule', { body: { action: 'list' } })
  assert.equal(listed.body.ok, true)
  assert.equal(listed.body.schedules.length, 1)
  const once = await host.call('POST', '/schedule', {
    body: { action: 'create', botId: bot.id, title: 'once', prompt: 'in a minute', timing: { kind: 'once', minutes: 1 } },
  })
  const onceView = once.body.state.schedules.find(entry => entry.title === 'once')
  assert.deepEqual(onceView.timing, { kind: 'once', minutes: 1 })
  assert.equal(scheduleService.created.at(-1).timing.kind, 'after')
  assert.equal(scheduleService.created.at(-1).timing.after_seconds, 60)
  const run = await host.call('POST', '/schedule', { body: { action: 'run', scheduleId: schedule.id } })
  assert.equal(run.body.ok, true)
  assert.deepEqual(scheduleService.ran, [{ id: 'native-sched-1' }])
  const deleted = await host.call('POST', '/schedule', { body: { action: 'delete', scheduleId: schedule.id } })
  assert.equal(deleted.body.state.schedules.length, 1)
  assert.equal(deleted.body.state.schedules[0].title, 'once')
  assert.equal(deleted.body.state.schedules.some(entry => entry.id === schedule.id), false)
  // The Host deletes one task through edit({action:'delete'}), not schedule.delete.
  assert.deepEqual(scheduleService.edited, [{ id: 'native-sched-1', action: 'delete' }])
  assert.deepEqual(scheduleService.deleted, [])
})

test('api: a group chat runs a relay round through the route', async (t) => {
  const host = makeHost(t)
  const alice = (await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Alice' } } })).body.state.bots[0]
  const bob = (await host.call('POST', '/bot', { body: { action: 'create', bot: { name: 'Bob' } } })).body.state.bots[1]
  const group = await host.call('POST', '/group', {
    body: { action: 'create', group: { name: 'Team', memberIds: [alice.id, bob.id], adminId: alice.id } },
  })
  assert.equal(group.status, 200)
  assert.equal(group.body.state.groups.length, 1)
  const groupChat = group.body.state.chats.find(chat => chat.kind === 'group')
  assert.ok(groupChat)
  const sent = await host.call('POST', '/chat', { body: { action: 'send', chatId: groupChat.id, text: 'hello team' } })
  assert.equal(sent.status, 200)
  assert.ok(await waitFor(async () => {
    const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(groupChat.id)}`)
    return page.body.messages.some(message => message.role === 'bot' && (message.status === 'done' || message.status === 'pass'))
  }))
  const page = await host.call('GET', `/messages?chatId=${encodeURIComponent(groupChat.id)}`)
  assert.equal(page.body.messages[0].role, 'user')
  const botReplies = page.body.messages.filter(message => message.role === 'bot')
  assert.equal(botReplies.length, 1)
  assert.equal(botReplies[0].botId, alice.id)
})
