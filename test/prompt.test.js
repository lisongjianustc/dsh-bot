import assert from 'node:assert/strict'
import test from 'node:test'
import { briefFor } from '../src/host/prompt.js'

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

test('prompt: a group without directories has no project section', () => {
  const input = makeInput('zh')
  input.group.workspaces = []
  const brief = briefFor(input)
  assert.doesNotMatch(brief, /项目目录/)
  assert.doesNotMatch(brief, /Project directories/)
})
