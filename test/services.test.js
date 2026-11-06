import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { avatarById } from '../src/host/avatars.js'
import { BotError } from '../src/host/errors.js'
import { createServices } from '../src/host/services.js'
import { createStore } from '../src/host/store.js'

async function waitUntil(predicate, timeoutMs = 1000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return false
}

function servicesAvatarId(services, botId) {
  return services.bots.get(botId)?.avatar?.id
}

function make(t, registry) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-services-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ctx = {
    logger: { warn() {}, error() {} },
    get(key) {
      if (key === 'workspaceRegistry') return registry
      return undefined
    },
  }
  const store = createStore(ctx, { dir })
  const services = createServices({ ctx, store })
  t.after(() => store.close())
  return { dir, ctx, store, services }
}

test('services: the first bot is the main bot and owns one private chat', async (t) => {
  const { services } = make(t)
  const bot = await services.bots.create({ name: 'Alice', role: 'planner', instructions: 'be brief' })
  assert.equal(bot.isMain, true)
  assert.equal(bot.permission, 'danger-full-access')
  assert.equal(bot.model, null)
  const chat = services.chats.findDm(bot.id)
  assert.ok(chat)
  assert.equal(chat.title, 'Alice')
  const view = await services.stateView()
  assert.equal(view.bots.length, 1)
  assert.equal(view.chats.length, 1)
  assert.equal(view.self.name.length > 0, true)
  assert.equal(view.limits.maxHops, 20)
})

test('services: bot validation refuses a blank name, @, duplicates and bad permissions', async (t) => {
  const { services } = make(t)
  await services.bots.create({ name: 'Alice' })
  await assert.rejects(() => services.bots.create({ name: '  ' }), (error) => error.code === 'invalid-request')
  await assert.rejects(() => services.bots.create({ name: '@nope' }), (error) => error.code === 'invalid-request')
  await assert.rejects(() => services.bots.create({ name: 'alice' }), (error) => error.code === 'invalid-request')
  await assert.rejects(() => services.bots.create({ name: 'Bob', permission: 'root' }), (error) => error.code === 'invalid-request')
  await assert.rejects(() => services.bots.create({ name: 'Bob', model: { provider: 'p' } }), (error) => error.code === 'invalid-request')
})

test('services: bot update replaces fields and moves the main flag safely', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  const revBefore = alice.rev
  const updated = await services.bots.update(alice.id, {
    role: 'architect',
    permission: 'workspace-write',
    model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
  })
  assert.equal(updated.role, 'architect')
  assert.equal(updated.permission, 'workspace-write')
  assert.deepEqual(updated.model, { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' })
  assert.equal(updated.rev, revBefore + 1)
  const changed = await services.bots.update(bob.id, { isMain: true })
  assert.equal(changed.isMain, true)
  assert.equal(services.bots.get(alice.id).isMain, false)
  await assert.rejects(() => services.bots.update(alice.id, { name: 'Bob' }), (error) => error.code === 'invalid-request')
})

test('services: deleting a bot cascades groups, chats, schedules and memory', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  const group = await services.groups.create({ name: 'Team', memberIds: [alice.id, bob.id], adminId: alice.id })
  await services.chats.setSession(services.chats.findDm(bob.id).id, bob.id, { sessionId: 'session-bob' })
  await services.memory.remember({ scope: 'self', text: 'bob fact', botId: bob.id })
  await services.schedules.create({ botId: bob.id, prompt: 'daily check' })
  const groupChat = services.chats.findGroupChat(group.id)
  assert.ok(groupChat)
  await services.messages.append(groupChat.id, { role: 'user', text: 'hello group' })
  await services.bots.remove(bob)
  assert.equal(services.chats.findDm(bob.id), undefined)
  // The group still has Alice, so its chat and its messages survive.
  assert.equal(services.messages.list(groupChat.id).length, 1)
  const fresh = services.groups.get(group.id)
  assert.deepEqual(fresh.memberIds, [alice.id])
  assert.equal(services.schedules.list().length, 0)
  assert.equal(services.memory.list({ scope: 'bot', targetBotId: bob.id, botId: bob.id }).length, 0)
})

test('services: group validation keeps the admin a member', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  // An admin named outside the members is added, so the group is never headless.
  const auto = await services.groups.create({ name: 'Auto', memberIds: [alice.id], adminId: bob.id })
  assert.deepEqual(auto.memberIds, [bob.id, alice.id])
  assert.equal(auto.adminId, bob.id)
  await assert.rejects(
    () => services.groups.create({ name: 'Team', memberIds: ['bot_missing'] }),
    (error) => error.code === 'bot-not-found',
  )
  await assert.rejects(
    () => services.groups.create({ name: 'Team', memberIds: [alice.id], adminId: 'Nobody' }),
    (error) => error.code === 'bot-not-found',
  )
  const byName = await services.groups.create({ name: 'ByName', memberIds: ['Alice', '@Bob', bob.id] })
  assert.deepEqual(byName.memberIds, [alice.id, bob.id])
  const group = await services.groups.create({ name: 'Team', memberIds: [alice.id, bob.id], maxHops: 99, useNote: true })
  assert.equal(group.maxHops, 20)
  assert.equal(group.replyMode, 'admin')
  assert.equal(group.adminId, alice.id)
  assert.ok(services.chats.findGroupChat(group.id))
  await assert.rejects(() => services.groups.create({ name: 'Team', memberIds: [alice.id] }), (error) => error.code === 'invalid-request')
})

test('services: a group note is written only for a note-keeping group', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const quiet = await services.groups.create({ name: 'Quiet', memberIds: [alice.id] })
  await services.groups.recordNote(quiet.id, [{ speaker: 'Alice', text: 'a conclusion' }])
  assert.equal(services.groups.get(quiet.id).noteEntries.length, 0)
  const noted = await services.groups.create({ name: 'Noted', memberIds: [alice.id], useNote: true })
  await services.groups.recordNote(noted.id, [{ speaker: 'Alice', text: 'a conclusion' }])
  const entries = services.groupNote(services.groups.get(noted.id))
  assert.deepEqual(entries, [{ speaker: 'Alice', text: 'a conclusion' }])
})

test('services: memory remembers, adopts a key, refuses a key conflict and forgets', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const first = await services.memory.remember({ scope: 'team', text: 'the project is dsh-bot', botId: alice.id })
  assert.equal(first.unchanged, false)
  assert.match(first.entry.revision, /^[0-9a-f]{64}$/)
  const repeated = await services.memory.remember({ scope: 'team', text: 'the project is dsh-bot', botId: alice.id })
  assert.equal(repeated.unchanged, true)
  const adopted = await services.memory.remember({ scope: 'team', text: 'the project is dsh-bot', key: 'project', botId: alice.id })
  assert.equal(adopted.entry.key, 'project')
  await assert.rejects(
    () => services.memory.remember({ scope: 'team', text: 'another fact', key: 'project', botId: alice.id }),
    (error) => error.code === 'memory-conflict',
  )
  const replaced = await services.memory.remember({
    scope: 'team',
    text: 'the project is dsh-bot v1',
    id: adopted.entry.id,
    key: 'project',
    pinned: true,
    botId: alice.id,
  })
  assert.equal(replaced.entry.pinned, true)
  const listed = services.memory.list({ scope: 'team' })
  assert.equal(listed.length, 1)
  const budgets = services.memory.budgets()
  assert.equal(budgets.team.entryCount, 1)
  await services.memory.forget({ scope: 'team', id: replaced.entry.id })
  assert.equal(services.memory.list({ scope: 'team' }).length, 0)
  await assert.rejects(() => services.memory.forget({ scope: 'team', id: 'gone' }), (error) => error.code === 'memory-not-found')
})

test('services: only the main bot may write team memory', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  services.memory.assertWritable({ scope: 'team', callerBotId: alice.id })
  assert.throws(() => services.memory.assertWritable({ scope: 'team', callerBotId: bob.id }), (error) => error.code === 'invalid-request')
})

test('services: usage records once per turn and aggregates by day and bot', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const now = Date.now()
  assert.equal(await services.usage.record({ ts: now, turnId: 't1', botId: alice.id, chatId: 'c', chars: 10, durationMs: 5, tools: 2 }), true)
  assert.equal(await services.usage.record({ ts: now, turnId: 't1', botId: alice.id, chars: 999 }), false)
  await services.usage.record({ ts: now, turnId: 't2', botId: alice.id, chars: 20 })
  const view = services.usage.view(7)
  assert.equal(view.days, 7)
  assert.equal(view.total.turns, 2)
  assert.equal(view.total.chars, 30)
  assert.equal(view.byBot[0].botId, alice.id)
  assert.equal(view.byBot[0].name, 'Alice')
  assert.equal(view.byDay.at(-1).turns, 2)
  assert.equal(view.byDay.length, 7)
})

test('services: sessions reverse-look-up to their bot and chat', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const chat = services.chats.findDm(alice.id)
  await services.chats.setSession(chat.id, alice.id, { sessionId: 'session-a' })
  assert.equal(services.bots.botOfSession('session-a').id, alice.id)
  assert.equal(services.bots.botOfSession('session-other'), undefined)
  const found = services.chats.bySession('session-a')
  assert.equal(found.chat.id, chat.id)
  assert.equal(found.botId, alice.id)
  assert.equal(services.chats.view(chat).sessionId, 'session-a')
})

test('services: a message frozen mid-stream is repaired on recovery', async (t) => {
  const { services, store } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const chat = services.chats.findDm(alice.id)
  await store.appendMessage(chat.id, { id: 'msg_1', role: 'bot', status: 'streaming', text: 'half', parts: [] })
  await store.appendMessage(chat.id, { id: 'msg_2', role: 'user', status: 'pending', text: 'queued' })
  await services.recover()
  const messages = services.messages.list(chat.id)
  assert.equal(messages.find(message => message.id === 'msg_1').status, 'aborted')
  assert.equal(messages.find(message => message.id === 'msg_2').status, 'held')
  assert.match(messages.find(message => message.id === 'msg_1').error, /interrupted/)
})

test('services: ensureWorkspace reuses an existing directory workspace', async (t) => {
  const calls = []
  const workspace = { id: 'ws-1', path: '/tmp/bot-ws', attachSession: async () => {} }
  const registry = {
    async resolveByPath(path) {
      calls.push(['resolve', path])
      return path.endsWith('workspace') ? workspace : undefined
    },
    async create(path, title) {
      calls.push(['create', path, title])
      return workspace
    },
  }
  const { services, store } = make(t, registry)
  const found = await services.ensureWorkspace()
  assert.equal(found, workspace)
  assert.deepEqual(calls, [['resolve', store.workspaceDir]])
})

test('services: ensureWorkspace creates the directory workspace when none is owned', async (t) => {
  const calls = []
  const workspace = { id: 'ws-2', path: '/tmp/bot-ws-2', attachSession: async () => {} }
  const registry = {
    async resolveByPath() {
      throw new Error('ENOENT')
    },
    async create(path, title) {
      calls.push(['create', path, title])
      return workspace
    },
  }
  const { services } = make(t, registry)
  assert.equal(await services.ensureWorkspace(), workspace)
  assert.deepEqual(calls, [['create', calls[0][1], 'dsh-bot']])
  // A second call reuses the memoised workspace.
  await services.ensureWorkspace()
  assert.equal(calls.length, 1)
})

test('services: a bot approves its own unattended tool requests unless autoApprove is off', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  assert.equal(alice.autoApprove, true)
  let view = await services.stateView()
  assert.equal(view.bots[0].autoApprove, true)
  await services.bots.update(alice.id, { autoApprove: false })
  view = await services.stateView()
  assert.equal(view.bots[0].autoApprove, false)
  await services.bots.update(alice.id, { autoApprove: true })
  assert.equal(services.bots.get(alice.id).autoApprove, true)
})

test('services: every bot gets a renderable avatar, and an explicit one wins', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice', role: '研究员' })
  assert.equal(alice.avatar.id, 'research-flask')
  const view = await services.stateView()
  assert.equal(view.bots[0].avatar.kind, 'library')
  assert.match(view.bots[0].avatar.color, /^#[0-9a-f]{6}$/)
  assert.ok(view.bots[0].avatar.background)
  const explicit = await services.bots.create({ name: 'Bob', role: '工程师', avatar: 'star-star' })
  assert.equal(explicit.avatar.id, 'star-star')
  // An auto avatar follows the identity...
  const rerolled = await services.bots.update(alice.id, { role: '视觉设计' })
  assert.equal(rerolled.avatar.id, 'design-palette')
  // ...an explicit one stays put...
  const kept = await services.bots.update(explicit.id, { role: '法务合规' })
  assert.equal(kept.avatar.id, 'star-star')
  // ...and null means "match me again".
  const rematched = await services.bots.update(explicit.id, { avatar: null })
  assert.equal(rematched.avatar.id, 'legal-scale')
  await assert.rejects(() => services.bots.update(alice.id, { avatar: 'no-such-avatar' }), (error) => error.code === 'invalid-request')
})

test('services: the state view carries a monotonic stateRev', async (t) => {
  const { services } = make(t)
  const first = (await services.stateView()).stateRev
  assert.equal(typeof first, 'number')
  await services.bots.create({ name: 'Alice' })
  const second = (await services.stateView()).stateRev
  assert.ok(second > first)
  await services.chats.setPinned(services.chats.findDm(services.bots.get('Alice').id).id, false)
  const third = (await services.stateView()).stateRev
  assert.ok(third > second)
})

test('services: mount recomputes auto avatars when the matching rules changed', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-avatar-refresh-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ctx = { logger: { warn() {}, error() {} }, get() { return undefined } }
  const first = createStore(ctx, { dir })
  const services = createServices({ ctx, store: first })
  const autoBot = await services.bots.create({ name: '剧情策划', role: '世界观、主线支线与关卡叙事结构的设计者' })
  const explicitBot = await services.bots.create({ name: '数值策划', role: '属性、公式、成长曲线与经济平衡的设计者', avatar: 'star-star' })
  // Simulate a stale auto spec written by an older matching table.
  autoBot.avatar = avatarById('lead-crown')
  assert.equal(explicitBot.avatarAuto, false)
  await first.save()
  await first.close()

  const second = createStore(ctx, { dir })
  const reopened = createServices({ ctx, store: second })
  assert.ok(await waitUntil(() => servicesAvatarId(reopened, autoBot.id) === 'writer-quill'))
  // The explicit pin is never recomputed.
  assert.equal(servicesAvatarId(reopened, explicitBot.id), 'star-star')
  // A second mount with nothing to fix writes nothing.
  let saves = 0
  const original = second.save
  second.save = (...args) => {
    saves += 1
    return original.apply(second, args)
  }
  createServices({ ctx, store: second })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(saves, 0)
  await second.close()
})

test('services: an old bot without an avatar still renders one', async (t) => {
  const { services, store } = make(t)
  const alice = await services.bots.create({ name: 'Alice', role: '工程师' })
  delete alice.avatar
  delete alice.avatarAuto
  const view = await services.stateView()
  assert.equal(view.bots[0].avatar.id, 'engineer-wrench')
  void store
})

test('services: the main bot chat is pinned by default, the others are not', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' }) // first bot -> main
  const bob = await services.bots.create({ name: 'Bob' })
  assert.equal(services.chats.findDm(alice.id).pinned, true)
  assert.equal(services.chats.findDm(bob.id).pinned, false)
  const view = await services.stateView()
  assert.equal(view.chats.find(chat => chat.botId === alice.id).pinned, true)
  assert.equal(view.chats.find(chat => chat.botId === bob.id).pinned, false)
})

test('services: a chat can be pinned and unpinned, and mis-calls are refused', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  const bobChat = services.chats.findDm(bob.id)
  const pinned = await services.chats.setPinned(bobChat.id, true)
  assert.equal(pinned.pinned, true)
  assert.equal(services.chats.view(pinned).pinned, true)
  const unpinned = await services.chats.setPinned(bobChat.id, false)
  assert.equal(unpinned.pinned, false)
  await assert.rejects(() => services.chats.setPinned('chat_nope', true), (error) => error.code === 'chat-not-found')
  await assert.rejects(() => services.chats.setPinned(bobChat.id, 'yes'), (error) => error.code === 'invalid-request')
  void alice
})

test('services: the chief-chat pin migration runs once and respects a manual unpin', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-pin-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ctx = { logger: { warn() {}, error() {} }, get() { return undefined } }
  const first = createStore(ctx, { dir })
  const services = createServices({ ctx, store: first })
  const alice = await services.bots.create({ name: 'Alice' }) // main
  const bob = await services.bots.create({ name: 'Bob' })
  // Simulate a ledger written before pinning existed: main chat not pinned, no marker.
  services.chats.findDm(alice.id).pinned = false
  delete first.db.settings.pinMigrated
  await first.save()
  await first.close()

  // Reopening runs the one-time migration and pins the chief chat.
  const second = createStore(ctx, { dir })
  const migrated = createServices({ ctx, store: second })
  assert.equal(migrated.chats.findDm(alice.id).pinned, true)
  assert.equal(second.db.settings.pinMigrated, true)
  assert.equal(migrated.chats.findDm(bob.id).pinned, false)

  // A manual unpin survives the next restart: the migration must not run again.
  await migrated.chats.setPinned(migrated.chats.findDm(alice.id).id, false)
  await second.close()
  const third = createStore(ctx, { dir })
  const reopened = createServices({ ctx, store: third })
  assert.equal(reopened.chats.findDm(alice.id).pinned, false)
  await third.close()
})

test('services: a bot may pin a DSH workspace by id', async (t) => {
  const workspace = { id: 'ws-user', title: 'My Project', path: '/tmp/project' }
  const registry = {
    list: () => [workspace, { id: 'ws-other', title: 'Other', path: '/tmp/other' }],
    get: (id) => (id === workspace.id || id === 'ws-other' ? workspace : undefined),
    async resolveByPath() {
      return workspace
    },
    async create() {
      return workspace
    },
  }
  const { services } = make(t, registry)
  const view = await services.stateView()
  assert.deepEqual(view.workspaces.map(row => row.id), ['ws-user', 'ws-other'])
  assert.equal(view.workspaces[0].title, 'My Project')
  const alice = await services.bots.create({ name: 'Alice', workspaceId: 'ws-user' })
  assert.equal(alice.workspaceId, 'ws-user')
  assert.equal((await services.stateView()).bots[0].workspaceId, 'ws-user')
  const updated = await services.bots.update(alice.id, { workspaceId: 'ws-other' })
  assert.equal(updated.workspaceId, 'ws-other')
  await assert.rejects(
    () => services.bots.update(alice.id, { workspaceId: 'ws-missing' }),
    (error) => error.code === 'workspace-unavailable',
  )
  // null/blank clears the pin and returns to the shared bot workspace.
  const cleared = await services.bots.update(alice.id, { workspaceId: null })
  assert.equal(cleared.workspaceId, undefined)
})

test('services: a deployment without a workspace registry reports plain behaviours', async (t) => {
  const { services } = make(t)
  const view = await services.stateView()
  assert.deepEqual(view.workspaces, [])
  await assert.rejects(
    () => services.bots.create({ name: 'Alice', workspaceId: 'ws-any' }),
    (error) => error.code === 'workspace-unavailable',
  )
})

test('services: helper records are created, listed and settled', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const chat = services.chats.findDm(alice.id)
  const created = await services.helpers.create({ botId: alice.id, chatId: chat.id, title: 'build', task: 'check the build' })
  assert.equal(created.status, 'queued')
  assert.equal(services.helpers.list().length, 1)
  assert.equal(services.helpers.list({ botId: alice.id }).length, 1)
  assert.equal(services.helpers.list({ botId: 'bot_other' }).length, 0)
  await services.helpers.update(created.id, { status: 'running', childId: 'child_1' })
  assert.equal(services.helpers.get(created.id).status, 'running')
  await services.helpers.update(created.id, { status: 'done', report: 'green', endedAt: 1 })
  const view = await services.stateView()
  assert.equal(view.helpers.length, 1)
  assert.equal(view.helpers[0].status, 'done')
  assert.equal(view.helpers[0].report, 'green')
  assert.equal(services.helpers.get(created.id).childId, 'child_1')
  assert.throws(() => services.helpers.require('helper_nope'), (error) => error.code === 'helper-not-found')
})

test('services: dispatched tasks and batches are projected into the state', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const chat = services.chats.findDm(alice.id)
  await services.tasks.createMany([
    {
      id: 'task_1', kind: 'bot', botId: alice.id, text: 'do work', title: 'work', status: 'queued',
      requestId: 'r1', batchId: 'batch_1', ownerBotId: alice.id, originChatId: chat.id, createdAt: 1,
    },
    {
      id: 'task_2', kind: 'discussion', groupId: 'grp_x', text: 'discuss', title: 'talk', status: 'done',
      requestId: 'r1', batchId: 'batch_1', ownerBotId: alice.id, originChatId: chat.id, result: 'agreed', createdAt: 2,
    },
  ])
  await services.tasks.createBatch({ id: 'batch_1', ownerBotId: alice.id, requestId: 'r1', fingerprint: 'f', taskIds: ['task_1', 'task_2'], status: 'running', createdAt: 1 })
  const view = await services.stateView()
  assert.equal(view.tasks.length, 2)
  assert.equal(view.tasks.find(task => task.id === 'task_1').status, 'queued')
  assert.equal(view.tasks.find(task => task.id === 'task_2').result, 'agreed')
  assert.equal(services.tasks.batch('batch_1').requestId, 'r1')
  assert.equal(services.tasks.batchByRequest(alice.id, 'r1').id, 'batch_1')
  assert.equal(services.tasks.batchByRequest('other', 'r1'), undefined)
  await services.tasks.update('task_1', { status: 'done', result: 'done!' })
  assert.equal(services.tasks.get('task_1').result, 'done!')
})

test('services: the notice language follows the ledger settings', async (t) => {
  const { services, store } = make(t)
  assert.equal(services.language(), 'zh')
  store.db.settings.language = 'en'
  assert.equal(services.language(), 'en')
})

test('services: schedules are projected into the client shape inside stateView', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const daily = await services.schedules.create({ botId: alice.id, title: 'standup', prompt: 'summarize', timing: { kind: 'daily', time: '09:30' } })
  const every = await services.schedules.create({ botId: alice.id, prompt: 'poll', timing: { kind: 'every', minutes: 15 } })
  const once = await services.schedules.create({ botId: alice.id, prompt: 'later', timing: { kind: 'after', minutes: 5 } })
  const view = await services.stateView()
  assert.equal(view.schedules.length, 3)
  const dailyView = view.schedules.find(entry => entry.id === daily.id)
  assert.deepEqual(dailyView.timing, { kind: 'daily', time: '09:30' })
  assert.equal(dailyView.enabled, true)
  assert.equal(dailyView.botId, alice.id)
  assert.equal(view.schedules.find(entry => entry.id === every.id).timing.kind, 'every')
  assert.equal(view.schedules.find(entry => entry.id === every.id).timing.minutes, 15)
  assert.deepEqual(view.schedules.find(entry => entry.id === once.id).timing, { kind: 'once', minutes: 5 })
  const panelOnce = await services.schedules.create({ botId: alice.id, prompt: 'panel once', timing: { kind: 'once', minutes: 1 } })
  assert.deepEqual(services.scheduleView(services.schedules.get(panelOnce.id)).timing, { kind: 'once', minutes: 1 })
  assert.equal(services.scheduleView({ id: 'x', botId: alice.id, title: 't', prompt: 'p', timing: { kind: 'at', at: '2026-11-07T09:00:00Z' }, createdAt: 1 }).timing.kind, 'at')
})

test('services: clearing a chat drops its messages and cursors', async (t) => {
  const { services } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const chat = services.chats.findDm(alice.id)
  await services.messages.append(chat.id, { role: 'user', text: 'hello' })
  await services.chats.setSession(chat.id, alice.id, { sessionId: 's', lastSeenSeq: 3, memoryStamp: 'x' })
  const cleared = await services.chats.clear(chat.id)
  assert.equal(cleared.lastSeq, 0)
  assert.equal(services.messages.list(chat.id).length, 0)
  assert.equal(services.stampOf(chat.id, alice.id).lastSeenSeq, 0)
  assert.equal(services.stampOf(chat.id, alice.id).memoryStamp, null)
  assert.equal(services.chats.sessionOf(chat.id, alice.id).sessionId, 's')
})
