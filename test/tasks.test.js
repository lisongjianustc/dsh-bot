import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BotError } from '../src/host/errors.js'
import { createServices } from '../src/host/services.js'
import { createStore } from '../src/host/store.js'
import {
  TASK_MESSAGE_MAX,
  TASK_RESULT_MAX,
  TASKS_PER_BATCH,
  createTasks,
  fingerprintOf,
  resolveTarget,
} from '../src/host/tasks.js'

async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return false
}

function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-tasks-'))
  const ctx = { logger: { info() {}, warn() {}, error() {} }, get() { return undefined } }
  const store = createStore(ctx, { dir })
  const services = createServices({ ctx, store })
  const calls = []
  const gates = []
  let resultText = (input) => `answer to: ${input.text}`
  const dispatcher = {
    async messageBot(input) {
      calls.push({ kind: 'bot', ...input })
      const gate = gates.shift()
      if (gate !== undefined) await gate
      return { ok: true, from: input.to, to: input.callerBotId, status: 'done', text: resultText(input) }
    },
    async postGroup(input) {
      calls.push({ kind: 'discussion', ...input })
      const gate = gates.shift()
      if (gate !== undefined) await gate
      return { hops: 1, noteRound: [{ speaker: 'Alice', text: 'the round agreed' }] }
    },
  }
  const engine = createTasks({ ctx, services, dispatcher })
  return {
    dir,
    ctx,
    store,
    services,
    engine,
    calls,
    gates,
    setResultText(fn) { resultText = fn },
    async close() {
      engine.dispose()
      await store.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function seed(services) {
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  const carol = await services.bots.create({ name: 'Carol' })
  const group = await services.groups.create({ name: 'Inner', memberIds: [alice.id, bob.id], adminId: alice.id })
  return { alice, bob, carol, group, originChat: services.chats.findDm(alice.id) }
}

test('tasks: a dispatch is a receipt and the work runs in the background', async (t) => {
  const harness = makeHarness()
  t.after(() => harness.close())
  const { services, engine, calls } = harness
  const { alice, bob, group, originChat } = await seed(services)
  const receipt = await engine.dispatch({
    ownerBot: alice,
    originChat,
    entries: [
      { to: 'Bob', message: 'check the build', title: 'build' },
      { to: `group:${group.id}`, message: 'discuss the plan' },
    ],
  })
  assert.equal(receipt.ok, true)
  assert.match(receipt.batchId, /^batch_/)
  assert.match(receipt.requestId, /^req_/)
  assert.equal(receipt.tasks.length, 2)
  assert.ok(receipt.tasks.every(task => task.status === 'queued'))
  assert.ok(await waitFor(() => services.tasks.list().every(task => task.status === 'done')))
  assert.equal(calls.length, 2)
  const botCall = calls.find(call => call.kind === 'bot')
  const discussionCall = calls.find(call => call.kind === 'discussion')
  assert.equal(botCall.to, bob.id)
  assert.equal(discussionCall.group, group.id)
  const rows = services.tasks.list()
  assert.ok(rows.every(task => task.result.length > 0))
  // Every result is posted back once, with the deterministic relay id.
  const relays = services.messages.list(originChat.id).filter(message => message.role === 'relay')
  assert.equal(relays.length, 2)
  assert.deepEqual(relays.map(message => message.id).sort(), rows.map(task => `msg_task_${task.id}`).sort())
  const batch = services.tasks.batch(receipt.batchId)
  assert.equal(batch.status, 'done')
  const state = await services.stateView()
  assert.equal(state.tasks.length, 2)
  assert.equal(state.tasks[0].result.length > 0, true)
})

test('tasks: a group-origin dispatch posts its result back into the group chat', async (t) => {
  const harness = makeHarness()
  t.after(() => harness.close())
  const { services, engine } = harness
  const { alice, bob, group } = await seed(services)
  const groupChat = services.chats.findGroupChat(group.id)
  const receipt = await engine.dispatch({
    ownerBot: alice,
    originChat: groupChat,
    entries: [{ to: 'Bob', message: 'report status' }],
  })
  assert.ok(await waitFor(() => services.tasks.list().every(task => task.status === 'done')))
  const relay = services.messages.list(groupChat.id).find(message => message.id === `msg_task_${receipt.tasks[0].id}`)
  assert.ok(relay, 'the task result was posted into the group chat')
  assert.equal(relay.role, 'relay')
  // The DM chat of the caller did not receive the group's task result.
  assert.equal(services.messages.list(services.chats.findDm(alice.id).id).some(message => message.role === 'relay'), false)
  void bob
})

test('tasks: request_id is idempotent for the same work and conflicts for different work', async (t) => {
  const harness = makeHarness()
  t.after(() => harness.close())
  const { services, engine, calls } = harness
  const { alice, originChat } = await seed(services)
  const entries = [{ to: 'Bob', message: 'same work' }]
  const first = await engine.dispatch({ ownerBot: alice, originChat, entries, requestId: 'req-1' })
  assert.equal(first.duplicate, undefined)
  assert.ok(await waitFor(() => services.tasks.list().every(task => task.status === 'done')))
  const callsAfterFirst = calls.length
  const again = await engine.dispatch({ ownerBot: alice, originChat, entries, requestId: 'req-1' })
  assert.equal(again.duplicate, true)
  assert.equal(again.batchId, first.batchId)
  assert.equal(calls.length, callsAfterFirst)
  await assert.rejects(
    () => engine.dispatch({ ownerBot: alice, originChat, entries: [{ to: 'Bob', message: 'different work' }], requestId: 'req-1' }),
    (error) => error instanceof BotError && error.code === 'request-conflict',
  )
  assert.equal(fingerprintOf(alice.id, entries), fingerprintOf(alice.id, entries))
  assert.notEqual(fingerprintOf(alice.id, entries), fingerprintOf('someone-else', entries))
})

test('tasks: dispatch validation refuses blank, over-long and oversized batches', async (t) => {
  const harness = makeHarness()
  t.after(() => harness.close())
  const { services, engine } = harness
  const { alice, originChat } = await seed(services)
  const dispatch = (entries, requestId) => engine.dispatch({ ownerBot: alice, originChat, entries, requestId })
  await assert.rejects(() => dispatch([]), (error) => error.code === 'invalid-request')
  await assert.rejects(
    () => dispatch(Array.from({ length: TASKS_PER_BATCH + 1 }, () => ({ to: 'Bob', message: 'x' }))),
    (error) => error.code === 'invalid-request',
  )
  await assert.rejects(() => dispatch([{ to: 'Bob', message: '   ' }]), (error) => error.code === 'invalid-request')
  await assert.rejects(
    () => dispatch([{ to: 'Bob', message: 'x'.repeat(TASK_MESSAGE_MAX + 1) }]),
    (error) => error.code === 'invalid-request',
  )
  await assert.rejects(() => dispatch([{ to: 'Bob', message: 'x' }], 'bad id!'), (error) => error.code === 'invalid-request')
})

test('tasks: get waits for a status change and pages long results', async (t) => {
  const harness = makeHarness()
  t.after(() => harness.close())
  const { services, engine, gates, setResultText } = harness
  const { alice, originChat } = await seed(services)
  setResultText(() => 'r'.repeat(TASK_RESULT_MAX + 500))
  let release
  gates.push(new Promise((resolve) => { release = resolve }))
  const receipt = await engine.dispatch({ ownerBot: alice, originChat, entries: [{ to: 'Bob', message: 'slow' }] })
  const taskId = receipt.tasks[0].id
  const waiting = engine.get({ ownerBotId: alice.id, taskId, waitMs: 2000 })
  await new Promise(resolve => setTimeout(resolve, 60))
  release()
  const value = await waiting
  assert.equal(value.tasks[0].status, 'done')
  assert.equal(value.tasks[0].result.length, TASK_RESULT_MAX)
  assert.equal(value.tasks[0].resultComplete, true)
  assert.equal(value.tasks[0].nextResultOffset, null)
  assert.ok(services.messages.list(originChat.id).some(message => message.id === `msg_task_${taskId}`))
})

test('tasks: cancel takes queued tasks and drops the late output of a running one', async (t) => {
  const harness = makeHarness()
  t.after(() => harness.close())
  const { services, engine, gates } = harness
  const { alice, originChat } = await seed(services)
  let release
  gates.push(new Promise((resolve) => { release = resolve }))
  const receipt = await engine.dispatch({
    ownerBot: alice,
    originChat,
    entries: [{ to: 'Bob', message: 'slow first' }, { to: 'Bob', message: 'still queued' }],
  })
  // The first task is running; the second is still queued behind it (concurrency
  // would pick it up, so cancel immediately).
  const cancelled = await engine.cancel({ ownerBotId: alice.id, batchId: receipt.batchId })
  assert.equal(cancelled.ok, true)
  release()
  assert.ok(await waitFor(() => services.tasks.list().every(task => task.status === 'cancelled')))
  const relays = services.messages.list(originChat.id).filter(message => message.role === 'relay')
  assert.equal(relays.length, 0)
  assert.equal(services.tasks.batch(receipt.batchId).status, 'cancelled')
})

test('tasks: a task the host was running becomes unknown and is not replayed', async (t) => {
  const harness = makeHarness()
  t.after(() => harness.close())
  const { services, engine, calls } = harness
  const { alice, originChat } = await seed(services)
  const runningTask = {
    id: 'task_running', kind: 'bot', botId: alice.id, text: 'x', title: 'x', status: 'running',
    requestId: 'r', batchId: 'batch_old', ownerBotId: alice.id, originChatId: originChat.id, createdAt: 1,
  }
  const queuedTask = {
    id: 'task_queued', kind: 'bot', botId: alice.id, text: 'y', title: 'y', status: 'queued',
    requestId: 'r2', batchId: 'batch_new', ownerBotId: alice.id, originChatId: originChat.id, createdAt: 2,
  }
  await services.tasks.createMany([runningTask, queuedTask])
  await services.tasks.createBatch({ id: 'batch_old', ownerBotId: alice.id, requestId: 'r', fingerprint: 'f', taskIds: ['task_running'], status: 'running', createdAt: 1 })
  await services.tasks.createBatch({ id: 'batch_new', ownerBotId: alice.id, requestId: 'r2', fingerprint: 'f', taskIds: ['task_queued'], status: 'queued', createdAt: 2 })
  engine.dispose()
  harness.engine = createTasks({ ctx: harness.ctx, services, dispatcher: { messageBot: async (input) => { calls.push(input); return { ok: true, text: 'resumed' } }, postGroup: async () => ({}) } })
  // The queued task resumes; the running one is only marked unknown.
  assert.ok(await waitFor(() => services.tasks.get('task_queued')?.status === 'done'))
  assert.equal(services.tasks.get('task_running').status, 'unknown')
  assert.match(services.tasks.get('task_running').error, /not replayed/)
})

test('tasks: a target resolves as a bot, a group prefix or a bare group name', async (t) => {
  const harness = makeHarness()
  t.after(() => harness.close())
  const { services } = harness
  const { alice, bob, group } = await seed(services)
  assert.deepEqual(resolveTarget(services, 'Bob'), { kind: 'bot', botId: bob.id })
  assert.deepEqual(resolveTarget(services, bob.id), { kind: 'bot', botId: bob.id })
  assert.deepEqual(resolveTarget(services, `group:${group.id}`), { kind: 'discussion', groupId: group.id })
  assert.deepEqual(resolveTarget(services, 'group:Inner'), { kind: 'discussion', groupId: group.id })
  assert.deepEqual(resolveTarget(services, '#Inner'), { kind: 'discussion', groupId: group.id })
  assert.deepEqual(resolveTarget(services, 'Inner'), { kind: 'discussion', groupId: group.id })
  assert.throws(() => resolveTarget(services, 'group:missing'), (error) => error.code === 'group-not-found')
  assert.throws(() => resolveTarget(services, 'Nobody'), (error) => error.code === 'bot-not-found')
  void alice
})

test('tasks: get requires a selector and cannot see another owner batch', async (t) => {
  const harness = makeHarness()
  t.after(() => harness.close())
  const { services, engine } = harness
  const { alice, originChat } = await seed(services)
  await assert.rejects(() => engine.get({ ownerBotId: alice.id }), (error) => error.code === 'invalid-request')
  const receipt = await engine.dispatch({ ownerBot: alice, originChat, entries: [{ to: 'Bob', message: 'x' }] })
  await assert.rejects(
    () => engine.get({ ownerBotId: 'someone-else', batchId: receipt.batchId }),
    (error) => error.code === 'invalid-request',
  )
  // Let the dispatched task settle before the harness closes its ledger.
  assert.ok(await waitFor(() => services.tasks.list().every(task => task.status === 'done')))
})
