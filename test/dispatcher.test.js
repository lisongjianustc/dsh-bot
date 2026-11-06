import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDispatcher } from '../src/host/dispatcher.js'
import { createServices } from '../src/host/services.js'
import { createStore } from '../src/host/store.js'

/** A runtime whose turns are scripted, so the relay rules are what is tested. */
function fakeRuntime() {
  const sent = []
  const replies = []
  return {
    sent,
    replies,
    async send({ chat, bot, text, kind }) {
      sent.push({ chatId: chat.id, botId: bot.id, text, kind })
      const next = replies.shift()
      if (next === undefined) return { status: 'pass', text: '[PASS]', toolCount: 0, chatId: chat.id, botId: bot.id }
      return { status: 'done', text: '', toolCount: 0, chatId: chat.id, botId: bot.id, ...next }
    },
    async cancel() {
      return true
    },
    publish() {},
    ensureSession: async () => 'session-fake',
  }
}

function make(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-dispatch-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ctx = {
    logger: { warn() {}, error() {} },
    get() {
      return undefined
    },
  }
  const store = createStore(ctx, { dir })
  const services = createServices({ ctx, store })
  const runtime = fakeRuntime()
  const dispatcher = createDispatcher({ ctx, services, runtime })
  t.after(async () => {
    dispatcher.dispose()
    await store.close()
  })
  return { services, runtime, dispatcher }
}

async function seedTeam(services, dispatcher, options = {}) {
  const alice = await services.bots.create({ name: 'Alice', role: 'admin', isMain: true })
  const bob = await services.bots.create({ name: 'Bob' })
  const carol = await services.bots.create({ name: 'Carol' })
  const group = await services.groups.create({
    name: 'Team',
    memberIds: [alice.id, bob.id, carol.id],
    adminId: alice.id,
    replyMode: options.replyMode ?? 'admin',
    maxHops: options.maxHops ?? 0,
    handover: options.handover === true,
    useNote: options.useNote === true,
  })
  const chat = services.chats.findGroupChat(group.id)
  const send = async (text) => {
    const message = await services.messages.append(chat.id, { role: 'user', text, status: 'done', parts: [{ type: 'text', text }] })
    await dispatcher.handle(chat, message)
    await dispatcher.idle(chat.id)
    return message
  }
  return { alice, bob, carol, group, chat, send }
}

test('dispatcher: private chat drives exactly one turn of that bot', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const chat = services.chats.findDm(alice.id)
  runtime.replies.push({ text: 'hello there' })
  const message = await services.messages.append(chat.id, { role: 'user', text: 'hi', parts: [{ type: 'text', text: 'hi' }] })
  await dispatcher.handle(chat, message)
  await dispatcher.idle(chat.id)
  assert.equal(runtime.sent.length, 1)
  assert.equal(runtime.sent[0].botId, alice.id)
  assert.equal(runtime.sent[0].text, 'hi')
  // With memory in scope the next prompt carries the memory block.
  await services.memory.remember({ scope: 'self', text: 'the user likes short answers', botId: alice.id })
  runtime.replies.push({ text: 'noted' })
  const next = await services.messages.append(chat.id, { role: 'user', text: 'again', parts: [{ type: 'text', text: 'again' }] })
  await dispatcher.handle(chat, next)
  await dispatcher.idle(chat.id)
  assert.match(runtime.sent[1].text, /dsh-bot-memory/)
  // ...and the second turn does not repeat an unchanged memory block.
  runtime.replies.push({ text: 'still noted' })
  const third = await services.messages.append(chat.id, { role: 'user', text: 'and again', parts: [{ type: 'text', text: 'and again' }] })
  await dispatcher.handle(chat, third)
  await dispatcher.idle(chat.id)
  assert.equal(runtime.sent[2].text, 'and again')
})

test('dispatcher: a group message mentions first, then relays along mentions', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const team = await seedTeam(services, dispatcher, { maxHops: 0 })
  runtime.replies.push({ text: 'Alice picks it up' }, { text: 'Bob adds @Carol' })
  await team.send('@Alice please look')
  // Alice spoke; Bob was not mentioned by the user and replyMode is admin, so the round ends.
  assert.equal(runtime.sent.length, 1)
  assert.equal(runtime.sent[0].botId, team.alice.id)
})

test('dispatcher: a reply that mentions another member appends it to the queue', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const team = await seedTeam(services, dispatcher, { maxHops: 0 })
  runtime.replies.push({ text: 'Alice asks @Bob to verify' }, { text: 'Bob agrees' })
  await team.send('@Alice start')
  assert.equal(runtime.sent.length, 2)
  assert.equal(runtime.sent[0].botId, team.alice.id)
  assert.equal(runtime.sent[1].botId, team.bob.id)
})

test('dispatcher: [PASS] skips a member and the queue moves on', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const team = await seedTeam(services, dispatcher, { replyMode: 'all' })
  runtime.replies.push(
    { text: '[PASS]', status: 'pass' },
    { text: 'Bob has the answer' },
  )
  await team.send('hello team')
  // Queue is Alice, Bob, Carol: Alice passes, Bob answers, and Carol still gets
  // her queued turn (the unscripted reply is a PASS).
  assert.equal(runtime.sent.length, 3)
  assert.deepEqual(runtime.sent.map(entry => entry.botId), [team.alice.id, team.bob.id, team.carol.id])
})

test('dispatcher: the hop limit converges instead of relaying on, costing one wrap-up turn', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const team = await seedTeam(services, dispatcher, { maxHops: 2, useNote: true })
  runtime.replies.push(
    { text: 'Alice hands to @Bob' },
    { text: 'Bob hands to @Carol' },
    { text: 'Bob wraps up: the decision is X' },
  )
  await team.send('@Alice kick off')
  // Alice (hop 1), Bob (hop 2) -> the queue still holds Carol, so the chain
  // converges: a system notice plus one wrap-up turn by the last speaker.
  assert.equal(runtime.sent.length, 3)
  assert.deepEqual(runtime.sent.map(entry => entry.botId), [team.alice.id, team.bob.id, team.bob.id])
  assert.match(runtime.sent[2].text, /dsh-bot-relay-converge/)
  const messages = services.messages.list(team.chat.id)
  assert.ok(messages.some(message => message.role === 'system' && /接力达到上限/.test(message.text)))
  const note = services.groupNote(services.groups.get(team.group.id))
  assert.equal(note.at(-1).speaker, 'Bob')
})

test('dispatcher: handover text rides along with the next hop', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const team = await seedTeam(services, dispatcher, { handover: true })
  runtime.replies.push({ text: 'Alice concludes: use plan A, @Bob build it' }, { text: 'Bob builds on it' })
  await team.send('@Alice decide')
  assert.equal(runtime.sent.length, 2)
  assert.match(runtime.sent[1].text, /<dsh-bot-handover>/)
  assert.match(runtime.sent[1].text, /use plan A/)
})

test('dispatcher: a failed member hands the round back to the admin', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const team = await seedTeam(services, dispatcher)
  runtime.replies.push({ status: 'error', text: '', error: 'model failed' }, { text: 'Alice steps in' })
  await team.send('@Bob try this')
  assert.equal(runtime.sent.length, 2)
  assert.equal(runtime.sent[0].botId, team.bob.id)
  assert.equal(runtime.sent[1].botId, team.alice.id)
})

test('dispatcher: cancel stops the queue between hops', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const team = await seedTeam(services, dispatcher, { maxHops: 0 })
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const originalSend = runtime.send.bind(runtime)
  runtime.send = async (input) => {
    const result = await originalSend(input)
    await gate
    return result
  }
  runtime.replies.push({ text: 'Alice asks @Bob' }, { text: 'Bob answers' })
  const message = await services.messages.append(team.chat.id, { role: 'user', text: '@Alice go', parts: [{ type: 'text', text: '@Alice go' }] })
  await dispatcher.handle(team.chat, message)
  await new Promise(resolve => setTimeout(resolve, 20))
  await dispatcher.cancel(team.chat.id)
  release()
  await dispatcher.idle(team.chat.id)
  assert.equal(runtime.sent.length, 1)
})

test('dispatcher: message_bot drives the target bot and returns its answer', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  runtime.replies.push({ text: 'Bob checked it: fine' })
  const answer = await dispatcher.messageBot({ callerBotId: alice.id, to: 'Bob', text: 'check the build' })
  assert.equal(answer.ok, true)
  assert.equal(answer.from, 'Bob')
  assert.match(answer.text, /fine/)
  const bobChat = services.chats.findDm(bob.id)
  const relay = services.messages.list(bobChat.id).find(message => message.role === 'relay')
  assert.equal(relay.botId, alice.id)
  assert.equal(relay.text, 'check the build')
})

test('dispatcher: postGroup follows the main-bot cross-group rule', async (t) => {
  const { services, runtime, dispatcher } = make(t)
  const alice = await services.bots.create({ name: 'Alice' }) // main
  const bob = await services.bots.create({ name: 'Bob' })
  const carol = await services.bots.create({ name: 'Carol' })
  const group = await services.groups.create({ name: 'Inner', memberIds: [bob.id], adminId: bob.id })
  // The main Bot may open a discussion in a group it does not belong to.
  runtime.replies.push({ text: 'Bob replies to the chief' })
  const round = await dispatcher.postGroup({ callerBotId: alice.id, group: group.id, text: 'discuss this' })
  assert.ok(round)
  assert.equal(runtime.sent.length, 1)
  assert.equal(runtime.sent[0].botId, bob.id)
  // A member Bot may post to its own group...
  runtime.replies.push({ text: 'Bob again' })
  await dispatcher.postGroup({ callerBotId: bob.id, group: 'Inner', text: 'follow up' })
  assert.equal(runtime.sent.length, 2)
  // ...but a non-member Bot may not, and the main-only exception does not leak.
  await assert.rejects(
    () => dispatcher.postGroup({ callerBotId: carol.id, group: 'Inner', text: 'let me in' }),
    (error) => error.code === 'invalid-request',
  )
  assert.equal(runtime.sent.length, 2)
})

test('dispatcher: a bot cannot message itself', async (t) => {
  const { services, dispatcher } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  await assert.rejects(
    () => dispatcher.messageBot({ callerBotId: alice.id, to: alice.id, text: 'hi' }),
    (error) => error.code === 'invalid-request',
  )
})
