import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createAutoMemory,
  extractCandidates,
  extractUserCandidates,
  isProgrammaticSentence,
  isSameMemory,
  normalizeMemoryText,
  splitSentences,
} from '../src/host/auto-memory.js'
import { createServices } from '../src/host/services.js'
import { createStore } from '../src/host/store.js'

function make(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-automem-'))
  const ctx = { logger: { warn() {}, error() {} }, get() { return undefined } }
  const store = createStore(ctx, { dir })
  const services = createServices({ ctx, store })
  const engine = createAutoMemory({ ctx, services, store })
  t.after(async () => {
    engine.dispose()
    await store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { services, engine, store }
}

async function seed(services) {
  const alice = await services.bots.create({ name: 'Alice', role: '研究员' })
  const chat = services.chats.findDm(alice.id)
  return { alice, chat }
}

test('auto memory: a strong instruction is written straight into team memory', async (t) => {
  const { services, engine } = make(t)
  const { alice, chat } = await seed(services)
  const result = await engine.consider({
    chat,
    bot: alice,
    userText: '请记住：团队统一用中文写文档。',
    botText: '好的。',
    messageId: 'msg_1',
  })
  assert.equal(result.accepted.length, 1)
  const team = services.memory.list({ scope: 'team' })
  assert.equal(team.length, 1)
  assert.equal(team[0].auto, true)
  assert.equal(team[0].source, 'auto')
  assert.match(team[0].text, /中文写文档/)
  assert.equal(services.memoryCandidates.list().length, 0)
})

test('auto memory: "you from now on" goes to the Bot it names', async (t) => {
  const { services, engine } = make(t)
  const { alice, chat } = await seed(services)
  await engine.consider({
    chat,
    bot: alice,
    userText: 'Alice，请记住以后都先跑测试再提交。',
    botText: '明白。',
  })
  assert.equal(services.memory.list({ scope: 'team' }).length, 0)
  const own = services.memory.list({ scope: 'bot', targetBotId: alice.id, botId: alice.id })
  assert.equal(own.length, 1)
  assert.equal(own[0].auto, true)
})

test('auto memory: a Bot-directed "你以后…" order is written automatically to that Bot', async (t) => {
  const { services, engine } = make(t)
  const { alice, chat } = await seed(services)
  // Named Bot + "你以后回答" upgrades from candidate to an automatic bot write.
  await engine.consider({ chat, bot: alice, userText: 'Alice，你以后回答先给结论。' })
  const own = services.memory.list({ scope: 'bot', targetBotId: alice.id, botId: alice.id })
  assert.equal(own.length, 1)
  assert.equal(own[0].auto, true)
  assert.match(own[0].text, /先给结论/)
  assert.equal(services.memoryCandidates.list().length, 0)
  // "请你以后…" without the Bot name still targets the speaking Bot.
  await engine.consider({ chat, bot: alice, userText: '请你以后回复尽量简短。' })
  assert.equal(services.memory.list({ scope: 'bot', targetBotId: alice.id, botId: alice.id }).length, 2)
  // A generic "以后可能…" sentence stays a candidate (conservative matching).
  await engine.consider({ chat, bot: alice, userText: '以后可能会加一个新成员。' })
  assert.equal(services.memory.list({ scope: 'bot', targetBotId: alice.id, botId: alice.id }).length, 2)
  assert.equal(services.memoryCandidates.list().length, 1)
  // A team preference stays a candidate as before.
  await engine.consider({ chat, bot: alice, userText: '我偏好表格形式的总结。' })
  assert.equal(services.memoryCandidates.list().length, 2)
  assert.equal(services.memory.list({ scope: 'team' }).length, 0)
})

test('auto memory: an ordinary preference becomes a candidate, never memory', async (t) => {
  const { services, engine } = make(t)
  const { alice, chat } = await seed(services)
  const result = await engine.consider({
    chat,
    bot: alice,
    userText: '我比较偏好简洁的回答，不要太长。',
    botText: '收到。',
    messageId: 'msg_2',
  })
  assert.equal(result.accepted.length, 0)
  assert.equal(result.queued.length, 1)
  assert.equal(services.memory.list({ scope: 'team' }).length, 0)
  const candidates = services.memoryCandidates.list()
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].candidateId, undefined)
  assert.equal(candidates[0].scope, 'team')
  assert.equal(candidates[0].reason, 'user-instruction')
  assert.equal(candidates[0].source.chatId, chat.id)
  assert.equal(candidates[0].source.messageId, 'msg_2')
  assert.equal(typeof candidates[0].confidence, 'number')
})

test('auto memory: a Bot conclusion is proposed, never auto-accepted', async (t) => {
  const { services, engine } = make(t)
  const { alice, chat } = await seed(services)
  const result = await engine.consider({
    chat,
    bot: alice,
    userText: '这次怎么处理？',
    botText: '结论：以后都用 pnpm 而不是 npm。',
  })
  assert.equal(result.accepted.length, 0)
  assert.equal(result.queued.length, 1)
  const candidate = services.memoryCandidates.list()[0]
  assert.equal(candidate.reason, 'bot-conclusion')
})

test('auto memory: the switch off turns strong writes into candidates', async (t) => {
  const { services, engine } = make(t)
  const { alice, chat } = await seed(services)
  await services.setAutoMemory(false)
  const result = await engine.consider({ chat, bot: alice, userText: '请记住：团队默认周一发版。' })
  assert.equal(result.accepted.length, 0)
  assert.equal(result.queued.length, 1)
  assert.equal(services.memory.list({ scope: 'team' }).length, 0)
  // Turning it back on lets the next strong instruction write again.
  await services.setAutoMemory(true)
  const again = await engine.consider({ chat, bot: alice, userText: '请记住：团队默认周二评审。' })
  assert.equal(again.accepted.length, 1)
})

test('auto memory: duplicates against memory and against the queue are skipped', async (t) => {
  const { services, engine } = make(t)
  const { alice, chat } = await seed(services)
  await services.memory.remember({ scope: 'team', text: '我比较偏好简洁的回答', botId: alice.id })
  const first = await engine.consider({ chat, bot: alice, userText: '我比较偏好简洁的回答。' })
  assert.equal(first.queued.length, 0)
  const second = await engine.consider({ chat, bot: alice, userText: '请记住：团队统一用英文写提交信息。' })
  assert.equal(second.accepted.length, 1)
  const third = await engine.consider({ chat, bot: alice, userText: '请记住：团队统一用英文写提交信息。' })
  assert.equal(third.accepted.length, 0)
})

test('auto memory: operational instructions are never remembered', () => {
  for (const sentence of ['不要调用工具。', '用一句话说明你负责什么。', '只回复「收到」。', '告诉我结果。', '不要解释，简短回答。']) {
    assert.equal(isProgrammaticSentence(sentence), true, sentence)
  }
  assert.equal(isProgrammaticSentence('以后统一用中文回答。'), false)
  for (const sentence of ['只说结论，不要等待回复。', '请勿使用工具。', '别用工具，直接回答。']) {
    assert.equal(isProgrammaticSentence(sentence), true, sentence)
  }
  const drafts = extractUserCandidates({
    userText: '@Bob 用一句话说明你负责什么，不要调用工具。',
    group: { id: 'grp_1', memberIds: ['bot_bob'] },
    members: [{ id: 'bot_bob', name: 'Bob' }],
  })
  assert.deepEqual(drafts, [])
  // The operational sentence is dropped, the preference in the same message is kept.
  const mixed = extractUserCandidates({
    userText: '以后统一用中文回答。不要调用工具。',
    group: { id: 'grp_1', memberIds: ['bot_bob'] },
    members: [{ id: 'bot_bob', name: 'Bob' }],
  })
  assert.equal(mixed.length, 1)
  assert.match(mixed[0].text, /统一用中文/)
})

test('auto memory: a group user message is attributed by explicit mention only', () => {
  const members = [
    { id: 'bot_alice', name: 'Alice' },
    { id: 'bot_bob', name: 'Bob' },
    { id: 'bot_carol', name: 'Carol' },
  ]
  const group = { id: 'grp_1', memberIds: members.map(member => member.id) }
  // One explicit mention owns the memory.
  const one = extractUserCandidates({ userText: '@Bob 以后负责调研。', group, members })
  assert.equal(one.length, 1)
  assert.equal(one[0].scope, 'bot')
  assert.equal(one[0].botId, 'bot_bob')
  // Several mentions are not fanned out per Bot: one team memory instead.
  const many = extractUserCandidates({ userText: '@Alice @Bob 以后统一用中文。', group, members })
  assert.equal(many.length, 1)
  assert.equal(many[0].scope, 'team')
  // No mention: one team memory, and "你负责" never becomes a Bot order.
  const plain = extractUserCandidates({ userText: '以后你负责调研。', group, members })
  assert.equal(plain.length, 1)
  assert.equal(plain[0].scope, 'team')
  assert.equal(plain[0].botId, undefined)
})

test('auto memory: a mentioned Bot gets one automatic entry for a "你以后…" order', async (t) => {
  const { services, engine } = make(t)
  const alice = await services.bots.create({ name: 'Alice' })
  const bob = await services.bots.create({ name: 'Bob' })
  const group = await services.groups.create({ name: 'G', memberIds: [alice.id, bob.id], adminId: alice.id })
  const chat = services.chats.findGroupChat(group.id)
  const result = await engine.considerUser({
    chat,
    group: services.groups.get(group.id),
    userText: '@Bob 请记住：你以后回答先给结论。',
  })
  assert.equal(result.accepted.length, 1)
  assert.equal(services.memory.list({ scope: 'bot', targetBotId: bob.id, botId: bob.id }).length, 1)
  assert.equal(services.memory.list({ scope: 'bot', targetBotId: alice.id, botId: alice.id }).length, 0)
  assert.equal(services.memoryCandidates.list().length, 0)
})

test('auto memory: the candidate queue is capped at 100, oldest dropped', async (t) => {
  const { services, engine } = make(t)
  const { alice, chat } = await seed(services)
  for (let index = 0; index < 105; index += 1) {
    await engine.consider({ chat, bot: alice, userText: `我偏好风格${index}号的回答。` })
  }
  const candidates = services.memoryCandidates.list()
  assert.equal(candidates.length, 100)
  assert.match(candidates[0].text, /风格5号/)
  assert.match(candidates.at(-1).text, /风格104号/)
})

test('auto memory: accept turns a candidate into memory and removes it from the queue', async (t) => {
  const { services, engine } = make(t)
  const { alice, chat } = await seed(services)
  await engine.consider({ chat, bot: alice, userText: '我偏好表格形式的总结。' })
  const candidate = services.memoryCandidates.list()[0]
  const accepted = await engine.accept({ candidateId: candidate.id, by: 'user' })
  assert.equal(accepted.entry.text, '我偏好表格形式的总结。')
  assert.equal(accepted.candidates.length, 0)
  assert.equal(services.memory.list({ scope: 'team' })[0].text, '我偏好表格形式的总结。')
  // A text override replaces the candidate text.
  await engine.consider({ chat, bot: alice, userText: '我偏好短标题。' })
  const second = services.memoryCandidates.list()[0]
  const overridden = await engine.accept({ candidateId: second.id, text: '我偏好更短的标题' })
  assert.equal(overridden.entry.text, '我偏好更短的标题')
  // Rejecting drops a candidate without touching memory.
  await engine.consider({ chat, bot: alice, userText: '我偏好蓝色主题。' })
  const third = services.memoryCandidates.list()[0]
  const rejected = await engine.reject({ candidateId: third.id })
  assert.equal(rejected.candidates.length, 0)
  assert.equal(services.memory.list({ scope: 'team' }).length, 2)
})

test('auto memory: extraction rules and normalization are pure and predictable', () => {
  assert.deepEqual(splitSentences('第一句。第二句！\n第三句'), ['第一句。', '第二句！', '第三句'])
  assert.equal(normalizeMemoryText('  团队统一用中文。 '), '团队统一用中文')
  assert.equal(isSameMemory('团队统一用中文', '团队统一用中文。'), true)
  assert.equal(isSameMemory('团队统一用中文', '无关内容'), false)
  const drafts = extractCandidates({
    userText: '随便聊聊。\n请记住：以后都用 TypeScript。',
    botText: '结论：先写测试。\n普通回复。',
    bot: { id: 'bot_a', name: 'Alice' },
    chatId: 'chat_1',
  })
  assert.equal(drafts.length, 2)
  assert.equal(drafts[0].strong, true)
  assert.equal(drafts[0].scope, 'team')
  assert.equal(drafts[1].reason, 'bot-conclusion')
})
