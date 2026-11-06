import assert from 'node:assert/strict'
import test from 'node:test'
import { registerApprovalAnswerers } from '../src/host/approval.js'

/** A Host context that only records waterfall registrations. */
function makeHost({ bots = {}, sessions = {}, language = 'zh' } = {}) {
  const registered = []
  const disposed = []
  const ctx = {
    on(event, listener, options) {
      registered.push({ event, listener, options })
      return () => disposed.push(event)
    },
  }
  const services = {
    chats: {
      bySession(sessionId) {
        return sessions[sessionId]
      },
    },
    bots: {
      get(botId) {
        return bots[botId]
      },
    },
    language: () => language,
  }
  const dispose = registerApprovalAnswerers({ ctx, services })
  return {
    registered,
    disposed,
    services,
    dispose,
    handler(event) {
      const found = registered.find(entry => entry.event === event)
      assert.ok(found, `no listener registered for ${event}`)
      return found
    },
  }
}

/** A `next()` stand-in that records calls and answers one value. */
function nextSpy(value) {
  const calls = []
  const next = async () => {
    calls.push(true)
    return value
  }
  next.calls = calls
  return next
}

test('approval answerer: both waterfalls are registered globally and prepended', () => {
  const host = makeHost()
  assert.equal(host.registered.length, 2)
  for (const event of ['approval/request', 'user-questions/request']) {
    const { options } = host.handler(event)
    assert.deepEqual(options, { global: true, prepend: true })
  }
})

test('approval answerer: a managed bot session is approved without calling next', async () => {
  const host = makeHost({
    bots: { bot_a: { id: 'bot_a', name: 'Alice' } },
    sessions: { 'session-a': { chat: { id: 'chat_a' }, botId: 'bot_a' } },
  })
  const next = nextSpy('unavailable')
  const outcome = await host.handler('approval/request').listener({ agent: { id: 'session-a' }, toolName: 'bash' }, next)
  assert.equal(outcome, 'allowed-once')
  assert.deepEqual(next.calls, [])
})

test('approval answerer: autoApprove=false delegates to the native waterfall', async () => {
  const host = makeHost({
    bots: { bot_a: { id: 'bot_a', name: 'Alice', autoApprove: false } },
    sessions: { 'session-a': { chat: { id: 'chat_a' }, botId: 'bot_a' } },
  })
  const next = nextSpy('rejected')
  const outcome = await host.handler('approval/request').listener({ agent: { id: 'session-a' } }, next)
  assert.equal(outcome, 'rejected')
  assert.deepEqual(next.calls, [true])
})

test('approval answerer: a foreign session always delegates', async () => {
  const host = makeHost()
  const next = nextSpy('allowed-once')
  const outcome = await host.handler('approval/request').listener({ agent: { id: 'session-user' } }, next)
  assert.equal(outcome, 'allowed-once')
  assert.deepEqual(next.calls, [true])
  // A request without an agent cannot be attributed and is not ours.
  const missing = nextSpy('unavailable')
  assert.equal(await host.handler('approval/request').listener({}, missing), 'unavailable')
  assert.deepEqual(missing.calls, [true])
})

test('approval answerer: a bot question is answered with an explainable refusal', async () => {
  const host = makeHost({
    bots: { bot_a: { id: 'bot_a', name: 'Alice' } },
    sessions: { 'session-a': { chat: { id: 'chat_a' }, botId: 'bot_a' } },
    language: 'zh',
  })
  const next = nextSpy()
  const answer = await host.handler('user-questions/request').listener({
    agent: { id: 'session-a' },
    questions: [{ id: 'q1', question: 'Which one?' }, { id: 'q2', question: 'Why?' }],
  }, next)
  assert.equal(next.calls.length, 0)
  assert.equal(answer.answers.length, 2)
  assert.deepEqual(answer.answers.map(item => item.id), ['q1', 'q2'])
  assert.match(answer.answers[0].custom, /没有人类在场/)
  assert.deepEqual(answer.answers[0].selected, [])
})

test('approval answerer: the question refusal follows the ledger language', async () => {
  const host = makeHost({
    bots: { bot_a: { id: 'bot_a', name: 'Alice' } },
    sessions: { 'session-a': { chat: { id: 'chat_a' }, botId: 'bot_a' } },
    language: 'en',
  })
  const answer = await host.handler('user-questions/request').listener({ agent: { id: 'session-a' }, questions: [{ id: 'q1' }] }, nextSpy())
  assert.match(answer.answers[0].custom, /No human is watching/)
})

test('approval answerer: a human session keeps the native question card', async () => {
  const host = makeHost()
  const next = nextSpy({ answers: [] })
  const answer = await host.handler('user-questions/request').listener({ agent: { id: 'session-user' }, questions: [] }, next)
  assert.deepEqual(answer, { answers: [] })
  assert.deepEqual(next.calls, [true])
})

test('approval answerer: dispose removes both registrations', () => {
  const host = makeHost()
  host.dispose()
  assert.deepEqual(host.disposed, ['approval/request', 'user-questions/request'])
})
