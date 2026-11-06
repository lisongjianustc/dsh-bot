import assert from 'node:assert/strict'
import test from 'node:test'
import { BotError } from '../src/host/errors.js'
import { createHelpers } from '../src/host/helpers.js'

/** Poll until the predicate holds, so the async settle path is observable. */
async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return false
}

function makeHarness({ subagents = true, providers = ['spawn'], language = 'zh' } = {}) {
  const records = new Map()
  const updates = []
  const appended = []
  const published = []
  const sent = []
  let activations = 0

  const services = {
    language: () => language,
    helpers: {
      async create(input) {
        const record = {
          id: `helper_${records.size + 1}`,
          status: 'queued',
          createdAt: Date.now(),
          ...input,
        }
        records.set(record.id, record)
        return record
      },
      get(id) {
        return records.get(id)
      },
      require(id) {
        const record = records.get(id)
        if (record === undefined) throw new BotError('helper-not-found', 'no helper')
        return record
      },
      async update(id, patch) {
        const record = records.get(id)
        if (record === undefined) throw new BotError('helper-not-found', 'no helper')
        Object.assign(record, patch)
        updates.push({ id, patch })
        return record
      },
      list({ botId } = {}) {
        return [...records.values()].filter(record => botId === undefined || record.botId === botId)
      },
    },
    chats: {
      get(id) {
        return id === 'chat_a' ? { id: 'chat_a', kind: 'dm', title: 'Alice' } : undefined
      },
      view(chat) {
        return { ...chat }
      },
      async setSession() {},
    },
    bots: {
      get(id) {
        return id === 'bot_a' ? { id: 'bot_a', name: 'Alice' } : undefined
      },
    },
    messages: {
      async append(chatId, partial) {
        const message = { ...partial, id: `msg_${appended.length + 1}`, chatId, seq: appended.length + 1 }
        appended.push(message)
        return message
      },
      list() {
        return []
      },
    },
    stampOf: () => ({ stamp: null, memoryStamp: null, lastSeenSeq: 0 }),
    memorySelectionFor: () => ({ entries: [], text: '', used: 0, limit: 6000, total: 0, omitted: 0 }),
  }

  let lastActivation
  const subagentService = subagents ? {
    list: () => [...providers],
    async startActivation(spec) {
      activations += 1
      let resolveResult
      let rejectResult
      const result = new Promise((resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
      })
      const activation = {
        spec,
        childId: `child_${activations}`,
        result,
        resolve: resolveResult,
        reject: rejectResult,
        disposed: false,
        async dispose() {
          activation.disposed = true
        },
      }
      lastActivation = activation
      return activation
    },
  } : undefined

  const runtime = {
    publish(payload) {
      published.push(payload)
    },
    onEvent() {
      return () => {}
    },
    activeFor() {
      return undefined
    },
    async send(input) {
      sent.push(input)
      return { status: 'done', text: '' }
    },
  }

  const ctx = {
    get(key) {
      return key === 'subagents' ? subagentService : undefined
    },
    logger: { warn() {}, error() {} },
  }

  const helpers = createHelpers({ ctx, services, runtime })
  return {
    helpers,
    services,
    appended,
    published,
    sent,
    get lastActivation() {
      return lastActivation
    },
    get activations() {
      return activations
    },
  }
}

const bot = { id: 'bot_a', name: 'Alice' }
const chat = { id: 'chat_a', kind: 'dm', title: 'Alice' }
const parentAgent = { id: 'session-a' }

test('helpers: startActivation is called with the first provider and the helper brief', async () => {
  const harness = makeHarness()
  const record = await harness.helpers.start({ parentAgent, chat, bot, task: 'summarize the repo', title: 'summary' })
  assert.equal(record.status, 'running')
  assert.equal(record.childId, 'child_1')
  const spec = harness.lastActivation.spec
  assert.equal(spec.provider, 'spawn')
  assert.equal(spec.delivery, 'parent')
  assert.equal(spec.request.parent, parentAgent)
  assert.equal(spec.request.prompt[0].type, 'text')
  assert.match(spec.request.prompt[0].text, /summarize the repo/)
  assert.match(spec.request.prompt[0].text, /dsh-bot-helper/)
  assert.equal(harness.published.length, 0)
})

test('helpers: a finished helper posts a relay and asks the bot to verify it', async () => {
  const harness = makeHarness()
  await harness.helpers.start({ parentAgent, chat, bot, task: 'check the build', title: 'build' })
  harness.lastActivation.resolve({ output: [{ type: 'text', text: 'the build is green' }], stopReason: { kind: 'completed' } })
  assert.ok(await waitFor(() => harness.helpers.get('helper_1').status === 'done'))
  assert.equal(harness.helpers.get('helper_1').report, 'the build is green')
  const relay = harness.appended.find(message => message.role === 'relay')
  assert.ok(relay, 'a relay message was posted back')
  assert.equal(relay.botId, 'bot_a')
  assert.match(relay.text, /build/)
  assert.match(relay.text, /the build is green/)
  assert.ok(harness.published.some(frame => frame.type === 'message'))
  assert.ok(harness.published.some(frame => frame.type === 'chat'))
  assert.equal(harness.sent.length, 1)
  assert.match(harness.sent[0].text, /the build is green/)
  assert.match(harness.sent[0].text, /验收/)
})

test('helpers: a failed helper is settled as failed and still reported', async () => {
  const harness = makeHarness()
  await harness.helpers.start({ parentAgent, chat, bot, task: 'doomed' })
  harness.lastActivation.reject(new Error('provider crashed'))
  assert.ok(await waitFor(() => harness.helpers.get('helper_1').status === 'failed'))
  assert.match(harness.helpers.get('helper_1').error, /provider crashed/)
  const relay = harness.appended.find(message => message.role === 'relay')
  assert.match(relay.text, /failed/)
})

test('helpers: stopping a running helper suppresses its late report', async () => {
  const harness = makeHarness()
  const record = await harness.helpers.start({ parentAgent, chat, bot, task: 'long job' })
  const stopped = await harness.helpers.stop(record)
  assert.equal(stopped.status, 'stopped')
  assert.equal(harness.lastActivation.disposed, true)
  harness.lastActivation.resolve({ output: [{ type: 'text', text: 'too late' }], stopReason: { kind: 'completed' } })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(harness.helpers.get('helper_1').status, 'stopped')
  assert.equal(harness.appended.length, 0)
  assert.equal(harness.sent.length, 0)
})

test('helpers: a deployment without the subagent service answers helper-unavailable', async () => {
  const harness = makeHarness({ subagents: false })
  await assert.rejects(
    () => harness.helpers.start({ parentAgent, chat, bot, task: 'x' }),
    (error) => error instanceof BotError && error.code === 'helper-unavailable',
  )
  assert.equal(harness.helpers.list().length, 0)
})

test('helpers: no registered provider is helper-unavailable, not a crash', async () => {
  const harness = makeHarness({ providers: [] })
  await assert.rejects(
    () => harness.helpers.start({ parentAgent, chat, bot, task: 'x' }),
    (error) => error instanceof BotError && error.code === 'helper-unavailable',
  )
})

test('helpers: a blank task is refused before any record exists', async () => {
  const harness = makeHarness()
  await assert.rejects(
    () => harness.helpers.start({ parentAgent, chat, bot, task: '   ' }),
    (error) => error instanceof BotError && error.code === 'invalid-request',
  )
  assert.equal(harness.helpers.list().length, 0)
})

test('helpers: dispose stops every running activation and settles the record', async () => {
  const harness = makeHarness()
  await harness.helpers.start({ parentAgent, chat, bot, task: 'long job' })
  assert.equal(harness.helpers.activeCount, 1)
  await harness.helpers.dispose()
  assert.equal(harness.helpers.activeCount, 0)
  assert.equal(harness.helpers.get('helper_1').status, 'stopped')
})

test('helpers: English deployments get English relay and verification text', async () => {
  const harness = makeHarness({ language: 'en' })
  await harness.helpers.start({ parentAgent, chat, bot, task: 'check' })
  harness.lastActivation.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: { kind: 'completed' } })
  assert.ok(await waitFor(() => harness.helpers.get('helper_1').status === 'done'))
  assert.match(harness.appended[0].text, /background task/)
  assert.match(harness.sent[0].text, /Verify this in your own words/)
})
