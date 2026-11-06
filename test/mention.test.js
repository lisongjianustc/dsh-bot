import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendNote,
  groupQueue,
  groupMemoryQuery,
  handoverSummary,
  hopLimit,
  isAddressChar,
  isPass,
  mentionsIn,
  noteEntries,
  renderHandover,
  renderNote,
  selectGroupMessages,
  tailOf,
} from '../src/host/mention.js'

const members = [
  { id: 'bot_alice', name: 'Alice' },
  { id: 'bot_bob', name: 'Bob' },
  { id: 'bot_designer', name: '设计师' },
  { id: 'bot_sifu', name: '设计师傅' },
  { id: 'bot_full', name: 'ＯＫ' },
]

test('mention: plain ASCII mentions are ordered by first mention', () => {
  assert.deepEqual(mentionsIn('@Bob please ask @Alice', members), ['bot_bob', 'bot_alice'])
})

test('mention: a name must end at a non-word character', () => {
  assert.deepEqual(mentionsIn('@Alicex is not Alice', members), [])
  assert.deepEqual(mentionsIn('hi @Alice!', members), ['bot_alice'])
})

test('mention: email addresses do not trigger', () => {
  assert.deepEqual(mentionsIn('mail@alice.com', members), [])
  assert.deepEqual(mentionsIn('josé@alice', members), [])
  assert.deepEqual(mentionsIn('Привет@alice', members), [])
})

test('mention: CJK text directly before @ does not swallow the mention', () => {
  assert.deepEqual(mentionsIn('请@设计师 看一下', members), ['bot_designer'])
  assert.deepEqual(mentionsIn('麻烦@Bob', members), ['bot_bob'])
})

test('mention: longest name wins, so @设计师傅 is not @设计师', () => {
  assert.deepEqual(mentionsIn('@设计师傅 你好', members), ['bot_sifu'])
  assert.deepEqual(mentionsIn('@设计师傅x', members), [])
})

test('mention: full-width names work and are case-insensitive', () => {
  assert.deepEqual(mentionsIn('ＯＫ@ＯＫ 上', members), ['bot_full'])
})

test('mention: the speaker never mentions itself, and duplicates collapse', () => {
  assert.deepEqual(mentionsIn('@Alice @Alice', members, 'bot_alice'), [])
  assert.deepEqual(mentionsIn('@Alice @Bob @Alice', members), ['bot_alice', 'bot_bob'])
})

test('mention: address characters are exactly word characters that are not spaceless', () => {
  assert.equal(isAddressChar('a'), true)
  assert.equal(isAddressChar('请'), false)
  assert.equal(isAddressChar('Ｏ'), false)
  assert.equal(isAddressChar('!'), false)
})

test('[PASS] accepts the documented spellings only', () => {
  for (const text of ['[PASS]', ' PASS ', 'pass', '[pass].', 'PASS。']) {
    assert.equal(isPass(text), true, text)
  }
  for (const text of ['PASS please', 'I will pass', '[PASS] done', 'passing']) {
    assert.equal(isPass(text), false, text)
  }
})

test('group queue: mentions first, else reply mode', () => {
  const group = { adminId: 'bot_alice', memberIds: ['bot_alice', 'bot_bob'], replyMode: 'admin' }
  assert.deepEqual(groupQueue(group, members, 'hello'), ['bot_alice'])
  assert.deepEqual(groupQueue(group, members, '@Bob 来看'), ['bot_bob'])
  assert.deepEqual(groupQueue({ ...group, replyMode: 'all' }, members, 'hello'), ['bot_alice', 'bot_bob'])
})

test('group queue: an admin who left the member list falls back to a member', () => {
  const group = { adminId: 'bot_gone', memberIds: ['bot_bob'], replyMode: 'admin' }
  assert.deepEqual(groupQueue(group, members, 'hello'), ['bot_bob'])
  assert.deepEqual(groupQueue({ adminId: 'bot_gone', memberIds: [], replyMode: 'admin' }, members, 'hello'), [])
})

test('hop limit: 0 means unlimited, values are clamped, junk means unlimited', () => {
  assert.equal(hopLimit({ maxHops: 0 }), 0)
  assert.equal(hopLimit({ maxHops: 5 }), 5)
  assert.equal(hopLimit({ maxHops: 99 }), 20)
  assert.equal(hopLimit({ maxHops: '3' }), 3)
  assert.equal(hopLimit({ maxHops: 'abc' }), 0)
  assert.equal(hopLimit({ maxHops: -1 }), 0)
  assert.equal(hopLimit({}), 0)
})

test('group snapshot: excludes the speaker, keeps only readable messages, stops at a hole', () => {
  const messages = [
    { id: 'm1', seq: 1, role: 'user', status: 'done', text: 'hello' },
    { id: 'm2', seq: 2, role: 'bot', botId: 'bot_alice', status: 'done', text: 'hi' },
    { id: 'm3', seq: 3, role: 'bot', botId: 'bot_bob', status: 'streaming', text: 'pe' },
    { id: 'm4', seq: 4, role: 'user', status: 'done', text: 'still there?' },
  ]
  const snapshot = selectGroupMessages({
    messages,
    lastSeenSeq: 0,
    botId: 'bot_alice',
    botName: (id) => members.find(member => member.id === id),
  })
  // m3 is still streaming: the snapshot must not advance its cursor past the
  // hole, even though a newer user message exists (MiniMax `engine.mjs:1199-1408`).
  assert.deepEqual(snapshot.lines, ['[user] hello', '[user] still there?'])
  assert.equal(snapshot.cursor, 2)
  assert.equal(snapshot.pending, true)
  // Once the streaming reply completes (m3 is gone in place of a done row), the
  // cursor can advance past the newer user message and the completed reply.
  const second = selectGroupMessages({
    messages: [messages[0], messages[1], messages[3], { id: 'm5', seq: 5, role: 'bot', botId: 'bot_bob', status: 'done', text: 'done' }],
    lastSeenSeq: 2,
    botId: 'bot_alice',
    botName: (id) => members.find(member => member.id === id),
  })
  assert.deepEqual(second.lines, ['[user] still there?', '[Bob] done'])
  assert.equal(second.cursor, 5)
  assert.equal(second.pending, false)
})

test('group snapshot: caps at thirty messages and clips each line', () => {
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index + 1}`,
    seq: index + 1,
    role: 'user',
    status: 'done',
    text: `line ${index + 1}`,
  }))
  const snapshot = selectGroupMessages({
    messages,
    lastSeenSeq: 0,
    botId: 'bot_alice',
    botName: () => undefined,
  })
  assert.equal(snapshot.lines.length, 30)
  assert.match(snapshot.lines[0], /line 11/)
  assert.match(snapshot.lines.at(-1), /line 40/)
})

test('group memory query uses the newest user or relay text', () => {
  assert.equal(groupMemoryQuery([
    { role: 'user', text: 'first' },
    { role: 'bot', text: 'reply' },
    { role: 'user', text: 'second' },
  ]), 'second')
  assert.equal(groupMemoryQuery([]), '')
})

test('hand-over summary prefers the note and clips the reply tail', () => {
  assert.equal(handoverSummary({ note: 'the conclusion', reply: 'ignored' }), 'the conclusion')
  const tail = handoverSummary({ reply: '词'.repeat(500) })
  assert.equal(tail.length, 400)
  assert.equal(handoverSummary({ reply: '' }), '')
  assert.match(renderHandover({ from: 'Alice', text: 'done' }), /^<dsh-bot-handover>\n\[Alice\] done\n<\/dsh-bot-handover>$/)
  assert.equal(renderHandover({}), '')
})

test('group note: newest entries win under the entry, count and char budgets', () => {
  const round = Array.from({ length: 10 }, (_, index) => ({ speaker: `Bot${index}`, text: `x`.repeat(300) }))
  const group = { useNote: true, noteEntries: [] }
  const kept = appendNote(group, round)
  assert.ok(kept.length <= 6)
  assert.ok(kept.length >= 1)
  assert.equal(kept.at(-1).speaker, 'Bot9')
  const bounded = noteEntries({ noteEntries: kept })
  assert.deepEqual(bounded, kept)
  assert.equal(renderNote({ useNote: false, noteEntries: kept }), '')
  assert.match(renderNote({ useNote: true, noteEntries: kept }), /^<dsh-bot-group-summary>/)
})

test('group note: a cut on a Latin word boundary drops the broken fragment', () => {
  const text = `word ${'a'.repeat(300)}`
  const tail = tailOf(text, 200)
  assert.ok(tail.length <= 200)
})
