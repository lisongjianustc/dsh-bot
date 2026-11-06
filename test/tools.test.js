import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BOT_TOOL_NAMES } from '../src/host/prompt.js'
import { createServices } from '../src/host/services.js'
import { createStore } from '../src/host/store.js'
import { TOOL_NAMES, registerTools } from '../src/host/tools.js'

function make(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-tools-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const captured = []
  const ctx = {
    logger: { warn() {}, error() {} },
    tools: {
      register(definition, options) {
        captured.push({ definition, options })
        return () => {}
      },
    },
    get() {
      return undefined
    },
  }
  const store = createStore(ctx, { dir })
  const services = createServices({ ctx, store })
  const calls = []
  const dispatcher = {
    async messageBot(args) {
      calls.push(['messageBot', args])
      return { ok: true, from: args.to, to: args.callerBotId, status: 'done', text: 'answered' }
    },
    async postGroup(args) {
      calls.push(['postGroup', args])
      return { hops: 1, noteRound: [{ speaker: 'Alice', text: 'agreed' }] }
    },
  }
  const helperCalls = []
  const runtime = {
    ensureSession: async () => 'session-x',
    helpers: {
      async start(input) {
        helperCalls.push({ ...input, parentAgentId: input.parentAgent?.id })
        return { id: 'helper_new', title: input.title ?? input.task.slice(0, 40), status: 'running', childId: 'child_9' }
      },
      list({ botId } = {}) {
        return services.helpers.list({ botId })
      },
      async stop(record) {
        return await services.helpers.update(record.id, { status: 'stopped' })
      },
    },
  }
  const dispose = registerTools({ ctx, services, dispatcher, runtime })
  t.after(async () => {
    dispose()
    await store.close()
  })
  return { captured, calls, services, ctx, helperCalls }
}

test('tools: the registered names match the prompt announcement exactly', async (t) => {
  const { captured } = make(t)
  assert.deepEqual(captured.map(entry => entry.definition.name), TOOL_NAMES)
  assert.deepEqual(TOOL_NAMES, BOT_TOOL_NAMES)
  assert.equal(TOOL_NAMES.length, 21)
})

test('tools: every definition has the bare ToolDefinition shape and a working renderer', async (t) => {
  const { captured } = make(t)
  for (const { definition } of captured) {
    assert.equal(typeof definition.name, 'string')
    assert.equal(typeof definition.description, 'string')
    assert.ok(definition.description.length > 20, definition.name)
    assert.equal(definition.parameters.type, 'object', definition.name)
    assert.equal(typeof definition.parameters.properties, 'object', definition.name)
    assert.equal(typeof definition.execute, 'function', definition.name)
    assert.equal(typeof definition.output.render, 'function', definition.name)
    const rendered = definition.output.render({}, { ok: true })
    assert.equal(rendered[0].type, 'text')
    assert.match(rendered[0].text, /"ok": true/)
  }
})

test('tools: the when condition is true only inside a Bot session', async (t) => {
  const { captured, services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const chat = services.chats.findDm(alice.id)
  await services.chats.setSession(chat.id, alice.id, { sessionId: 'session-alice' })
  const when = captured[0].options.when
  assert.equal(typeof when, 'function')
  assert.equal(when({ agent: { id: 'session-other' } }), false)
  assert.equal(when({ agent: { id: 'session-alice' } }), true)
  assert.equal(when({ agent: undefined }), false)
})

test('tools: helper tools follow the bot autoHelper switch', async (t) => {
  const { captured, services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const chat = services.chats.findDm(alice.id)
  await services.chats.setSession(chat.id, alice.id, { sessionId: 'session-alice' })
  const helper = captured.find(entry => entry.definition.name === 'bot_start_helper')
  assert.equal(helper.options.when({ agent: { id: 'session-alice' } }), true)
  await services.bots.update(alice.id, { autoHelper: false })
  assert.equal(helper.options.when({ agent: { id: 'session-alice' } }), false)
  // Non-helper tools stay visible.
  const list = captured.find(entry => entry.definition.name === 'bot_list_team')
  assert.equal(list.options.when({ agent: { id: 'session-alice' } }), true)
})

test('tools: bot_list_team answers for the caller', async (t) => {
  const { captured, services } = make(t)
  const alice = await services.bots.create({ name: 'Alice', role: 'admin' })
  const chat = services.chats.findDm(alice.id)
  await services.chats.setSession(chat.id, alice.id, { sessionId: 'session-alice' })
  const tool = captured.find(entry => entry.definition.name === 'bot_list_team').definition
  const value = await tool.execute({}, { agent: { id: 'session-alice' } })
  assert.equal(value.ok, true)
  assert.equal(value.bots.length, 1)
  assert.equal(value.bots[0].name, 'Alice')
  assert.equal(value.bots[0].main, true)
})

test('tools: bot_create is refused for a non-main Bot as a value, not a throw', async (t) => {
  const { captured, services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  const chat = services.chats.findDm(bob.id)
  await services.chats.setSession(chat.id, bob.id, { sessionId: 'session-bob' })
  const tool = captured.find(entry => entry.definition.name === 'bot_create').definition
  const refused = await tool.execute({ name: 'Carol' }, { agent: { id: 'session-bob' } })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'invalid-request')
  const mainChat = services.chats.findDm(alice.id)
  await services.chats.setSession(mainChat.id, alice.id, { sessionId: 'session-alice' })
  const created = await tool.execute({ name: 'Carol', role: 'writer' }, { agent: { id: 'session-alice' } })
  assert.equal(created.ok, true)
  assert.equal(services.bots.get('Carol').role, 'writer')
})

test('tools: an anonymous caller gets a stable refusal', async (t) => {
  const { captured } = make(t)
  const tool = captured.find(entry => entry.definition.name === 'bot_list_team').definition
  const value = await tool.execute({}, {})
  assert.equal(value.ok, false)
  assert.equal(value.code, 'invalid-request')
})

test('tools: message_bot and post_group delegate to the dispatcher', async (t) => {
  const { captured, calls, services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  const chat = services.chats.findDm(alice.id)
  await services.chats.setSession(chat.id, alice.id, { sessionId: 'session-alice' })
  const messageTool = captured.find(entry => entry.definition.name === 'bot_message').definition
  const answer = await messageTool.execute({ to: 'Bob', message: 'check' }, { agent: { id: 'session-alice' } })
  assert.equal(answer.ok, true)
  assert.equal(calls[0][0], 'messageBot')
  assert.equal(calls[0][1].callerBotId, alice.id)
  // post_group is allowed from a private chat...
  const group = await services.groups.create({ name: 'Team', memberIds: [alice.id, bob.id] })
  const postTool = captured.find(entry => entry.definition.name === 'bot_post_group').definition
  const round = await postTool.execute({ group: group.id, message: 'discuss' }, { agent: { id: 'session-alice' } })
  assert.equal(round.ok, true)
  assert.equal(round.replies[0].speaker, 'Alice')
  // ...but refused from inside a group.
  const groupChat = services.chats.findGroupChat(group.id)
  await services.chats.setSession(groupChat.id, alice.id, { sessionId: 'session-group-alice' })
  const refused = await postTool.execute({ group: group.id, message: 'discuss' }, { agent: { id: 'session-group-alice' } })
  assert.equal(refused.ok, false)
})

test('tools: group tools enforce the permission matrix and resolve names', async (t) => {
  const { captured, services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' }) // main
  const bob = await services.bots.create({ name: 'Bob' })
  const carol = await services.bots.create({ name: 'Carol' })
  for (const bot of [alice, bob, carol]) {
    const chat = services.chats.findDm(bot.id)
    await services.chats.setSession(chat.id, bot.id, { sessionId: `session-${bot.name.toLowerCase()}` })
  }
  const tool = (name) => captured.find(entry => entry.definition.name === name).definition
  const createGroup = tool('bot_create_group')
  const updateGroup = tool('bot_update_group')
  const deleteGroup = tool('bot_delete_group')

  // Only the main Bot creates a group.
  const deniedCreate = await createGroup.execute({ name: 'Denied', members: [alice.id] }, { agent: { id: 'session-bob' } })
  assert.equal(deniedCreate.ok, false)
  assert.equal(deniedCreate.code, 'invalid-request')

  // Names and ids mix, the caller joins automatically, the admin defaults to the caller.
  const created = await createGroup.execute({ name: 'Task Group', members: ['Bob', carol.id] }, { agent: { id: 'session-alice' } })
  assert.equal(created.ok, true)
  assert.equal(created.group.adminId, alice.id)
  assert.deepEqual([...created.group.memberIds].sort(), [alice.id, bob.id, carol.id].sort())
  assert.equal(created.group.replyMode, 'admin')
  assert.ok(services.chats.findGroupChat(created.group.id))

  // An unknown member is a named refusal, not a crash.
  const unknown = await createGroup.execute({ name: 'Nope', members: ['Nobody'] }, { agent: { id: 'session-alice' } })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'bot-not-found')

  // An explicit admin outside the members list is added.
  const administered = await createGroup.execute({ name: 'Admin Group', members: ['Bob'], admin: 'Carol' }, { agent: { id: 'session-alice' } })
  assert.equal(administered.ok, true)
  assert.equal(administered.group.adminId, carol.id)
  assert.ok(administered.group.memberIds.includes(carol.id))
  assert.ok(administered.group.memberIds.includes(alice.id))

  // The main Bot may rewrite members and move the admin.
  const updated = await updateGroup.execute({
    group: created.group.id,
    name: 'Renamed',
    members: ['Bob'],
    admin: 'Bob',
    reply_mode: 'all',
    max_hops: 3,
  }, { agent: { id: 'session-alice' } })
  assert.equal(updated.ok, true)
  assert.equal(updated.group.name, 'Renamed')
  assert.deepEqual(updated.group.memberIds, [bob.id])
  assert.equal(updated.group.adminId, bob.id)
  assert.equal(updated.group.replyMode, 'all')
  assert.equal(updated.group.maxHops, 3)

  // The group admin may change settings, but never the admin.
  const byAdmin = await updateGroup.execute({ group: 'Renamed', notice: 'hello' }, { agent: { id: 'session-bob' } })
  assert.equal(byAdmin.ok, true)
  assert.equal(byAdmin.group.notice, 'hello')
  const adminChange = await updateGroup.execute({ group: 'Renamed', admin: 'Carol' }, { agent: { id: 'session-bob' } })
  assert.equal(adminChange.ok, false)
  assert.equal(adminChange.code, 'invalid-request')

  // A non-admin member cannot update the group.
  const byMember = await updateGroup.execute({ group: 'Renamed', notice: 'x' }, { agent: { id: 'session-carol' } })
  assert.equal(byMember.ok, false)

  // Only the main Bot deletes a group.
  const deniedDelete = await deleteGroup.execute({ group: 'Renamed' }, { agent: { id: 'session-bob' } })
  assert.equal(deniedDelete.ok, false)
  const deleted = await deleteGroup.execute({ group: 'Renamed' }, { agent: { id: 'session-alice' } })
  assert.equal(deleted.ok, true)
  assert.equal(services.groups.get('Renamed'), undefined)
})

test('tools: helper tools report a receipt and enforce ownership', async (t) => {
  const { captured, services, helperCalls } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  const aliceChat = services.chats.findDm(alice.id)
  const bobChat = services.chats.findDm(bob.id)
  await services.chats.setSession(aliceChat.id, alice.id, { sessionId: 'session-alice' })
  await services.chats.setSession(bobChat.id, bob.id, { sessionId: 'session-bob' })
  const start = captured.find(entry => entry.definition.name === 'bot_start_helper').definition
  const receipt = await start.execute({ task: 'check the build', title: 'build' }, { agent: { id: 'session-alice' } })
  assert.equal(receipt.ok, true)
  assert.equal(receipt.accepted, true)
  assert.equal(receipt.helper.id, 'helper_new')
  assert.equal(helperCalls[0].bot.id, alice.id)
  assert.equal(helperCalls[0].chat.id, aliceChat.id)
  assert.equal(helperCalls[0].parentAgentId, 'session-alice')
  const helper1 = await services.helpers.create({ botId: alice.id, chatId: aliceChat.id, title: 'a', task: 'a' })
  await services.helpers.update(helper1.id, { status: 'done' })
  const helper2 = await services.helpers.create({ botId: bob.id, chatId: bobChat.id, title: 'b', task: 'b' })
  await services.helpers.update(helper2.id, { status: 'running' })
  const list = captured.find(entry => entry.definition.name === 'bot_list_helpers').definition
  const all = await list.execute({}, { agent: { id: 'session-alice' } })
  assert.equal(all.ok, true)
  assert.equal(all.helpers.length, 2)
  const own = await list.execute({}, { agent: { id: 'session-bob' } })
  assert.equal(own.helpers.length, 1)
  const stop = captured.find(entry => entry.definition.name === 'bot_stop_helper').definition
  const refused = await stop.execute({ helper_id: helper1.id }, { agent: { id: 'session-bob' } })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'invalid-request')
  const stopped = await stop.execute({ helper_id: helper2.id }, { agent: { id: 'session-bob' } })
  assert.equal(stopped.ok, true)
  assert.equal(stopped.helper.status, 'stopped')
})

test('tools: task tools dispatch, read and cancel through the tool surface', async (t) => {
  const { captured, services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  const aliceChat = services.chats.findDm(alice.id)
  await services.chats.setSession(aliceChat.id, alice.id, { sessionId: 'session-alice' })
  const dispatch = captured.find(entry => entry.definition.name === 'bot_dispatch_tasks').definition
  const get = captured.find(entry => entry.definition.name === 'bot_get_tasks').definition
  const cancel = captured.find(entry => entry.definition.name === 'bot_cancel_tasks').definition

  const receipt = await dispatch.execute({ tasks: [{ to: 'Bob', message: 'check the build' }] }, { agent: { id: 'session-alice' } })
  assert.equal(receipt.ok, true)
  assert.match(receipt.batchId, /^batch_/)
  assert.equal(receipt.tasks[0].status, 'queued')
  assert.ok(receipt.note)

  const polled = await get.execute({ batch_id: receipt.batchId, wait_ms: 1000, result_offset: 0 }, { agent: { id: 'session-alice' } })
  assert.equal(polled.ok, true)
  assert.equal(polled.tasks[0].status, 'done')
  assert.match(polled.tasks[0].result, /answered/)
  assert.equal(polled.batches[0].status, 'done')
  const relay = services.messages.list(aliceChat.id).find(message => message.id === `msg_task_${receipt.tasks[0].id}`)
  assert.ok(relay)

  const cancelled = await cancel.execute({ batch_id: receipt.batchId }, { agent: { id: 'session-alice' } })
  assert.equal(cancelled.ok, true)
  assert.deepEqual(cancelled.cancelled, [])
  assert.deepEqual(cancelled.ignored, [receipt.tasks[0].id])

  const blank = await dispatch.execute({ tasks: [] }, { agent: { id: 'session-alice' } })
  assert.equal(blank.ok, false)
  assert.equal(blank.code, 'invalid-request')
  void bob
})

test('tools: remember and recall round-trip through the services', async (t) => {
  const { captured, services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const chat = services.chats.findDm(alice.id)
  await services.chats.setSession(chat.id, alice.id, { sessionId: 'session-alice' })
  const remember = captured.find(entry => entry.definition.name === 'bot_remember').definition
  const recall = captured.find(entry => entry.definition.name === 'bot_recall').definition
  const written = await remember.execute({ text: 'the user prefers tables', scope: 'self' }, { agent: { id: 'session-alice' } })
  assert.equal(written.ok, true)
  assert.match(written.entry.revision, /^[0-9a-f]{64}$/)
  const found = await recall.execute({ query: 'tables' }, { agent: { id: 'session-alice' } })
  assert.equal(found.ok, true)
  assert.equal(found.entries.length, 1)
  const secret = await remember.execute({ text: 'password: hunter2' }, { agent: { id: 'session-alice' } })
  assert.equal(secret.ok, false)
})
