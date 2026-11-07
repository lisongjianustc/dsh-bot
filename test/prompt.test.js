import assert from 'node:assert/strict'
import test from 'node:test'
import { briefFor, renderGroupSnapshot } from '../src/host/prompt.js'

function makeInput(language) {
  const bot = { id: 'bot_a', name: 'Alice', role: '工程师', instructions: 'build things', isMain: false }
  const group = {
    id: 'grp_1',
    name: 'Game',
    adminId: 'bot_a',
    memberIds: ['bot_a', 'bot_b'],
    notice: 'ship it',
    replyMode: 'admin',
    maxHops: 2,
    handover: false,
    useNote: false,
    workspaces: [
      { id: 'ws-a', title: 'Alpha', path: '/tmp/alpha' },
      { title: 'Art', path: '/tmp/art' },
    ],
  }
  return {
    bot,
    bots: [bot, { id: 'bot_b', name: 'Bob', role: '工程师', isMain: false }],
    groups: [group],
    group,
    settings: { language },
    note: [],
  }
}

test('prompt: a group brief lists its project directories with the main one marked', () => {
  const zh = briefFor(makeInput('zh'))
  assert.match(zh, /## 项目目录/)
  assert.match(zh, /- Alpha: \/tmp\/alpha（主目录）/)
  assert.match(zh, /- Art: \/tmp\/art/)
  assert.match(zh, /第一个是主目录/)
  const en = briefFor(makeInput('en'))
  assert.match(en, /## Project directories/)
  assert.match(en, /- Alpha: \/tmp\/alpha \(main\)/)
  assert.match(en, /The first one is the main directory/)
})

test('prompt: the group brief states the speaking order and the stand-by rule', () => {
  const zh = briefFor(makeInput('zh'))
  assert.match(zh, /本轮发言路由/)
  assert.match(zh, /待命/)
  assert.match(zh, /进度、问题、决策和派活优先发在这个群里/)
  const en = briefFor(makeInput('en'))
  assert.match(en, /Speaking order/)
  assert.match(en, /stands by|stand by/)
  assert.match(en, /Project progress, questions, decisions and assignments belong in this group/)
  // A private chat points project work at the group instead.
  const input = makeInput('zh')
  delete input.group
  const dm = briefFor(input)
  assert.match(dm, /优先发到项目群/)
  assert.match(dm, /私聊只用于一对一/)
})

test('prompt: a group turn names the round speakers and the stand-by members', () => {
  const input = makeInput('zh')
  const rendered = renderGroupSnapshot({
    group: input.group,
    bot: { id: 'bot_a', name: 'Alice' },
    messages: [{ id: 'm1', seq: 1, role: 'user', status: 'done', text: 'hello' }],
    lastSeenSeq: 0,
    botName: (id) => input.bots.find(member => member.id === id),
    speakers: ['Alice', 'Bob'],
    standby: 2,
  })
  assert.match(rendered.text, /本轮发言：Alice、Bob；其余 2 名成员待命/)
  const en = renderGroupSnapshot({
    group: input.group,
    bot: { id: 'bot_a', name: 'Alice' },
    messages: [],
    lastSeenSeq: 0,
    botName: () => undefined,
    language: 'en',
    speakers: ['Alice', 'Bob'],
    standby: 1,
  })
  assert.match(en.text, /Speaking this round: Alice, Bob; 1 member\(s\) stand by/)
})

test('prompt: a group without directories has no project section', () => {
  const input = makeInput('zh')
  input.group.workspaces = []
  const brief = briefFor(input)
  assert.doesNotMatch(brief, /项目目录/)
  assert.doesNotMatch(brief, /Project directories/)
})
