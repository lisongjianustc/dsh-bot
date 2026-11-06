import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BotError } from '../src/host/errors.js'
import { botHomeDirectory, createStore, defaultState, resolveDshHome } from '../src/host/store.js'

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('store: a missing ledger is created atomically and no temp file is left', (t) => {
  const dir = tempDir(t)
  const store = createStore({}, { dir })
  assert.equal(store.db.version, 1)
  assert.ok(existsSync(join(dir, 'state.json')))
  assert.ok(existsSync(join(dir, 'messages')))
  assert.ok(existsSync(join(dir, 'workspace')))
  assert.deepEqual(readdirSync(dir).filter(name => name.includes('.tmp')), [])
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')), store.db)
})

test('store: a corrupt ledger fails closed and is never rewritten', (t) => {
  const dir = tempDir(t)
  const path = join(dir, 'state.json')
  writeFileSync(path, '{"bots": [')
  assert.throws(() => createStore({}, { dir }), (error) => error instanceof BotError && error.code === 'ledger-unavailable')
  assert.equal(readFileSync(path, 'utf8'), '{"bots": [')
  writeFileSync(path, '[]')
  assert.throws(() => createStore({}, { dir }), (error) => error instanceof BotError && error.code === 'ledger-unavailable')
})

test('store: message updates append and fold by id, keeping seq stable', async (t) => {
  const dir = tempDir(t)
  const store = createStore({}, { dir })
  const first = await store.appendMessage('chat_1', { role: 'bot', status: 'streaming', text: 'he', parts: [] })
  const second = await store.appendMessage('chat_1', { role: 'user', text: 'hi' })
  assert.equal(first.seq, 1)
  assert.equal(second.seq, 2)
  const updated = await store.appendMessage('chat_1', { ...first, status: 'done', text: 'hello' })
  assert.equal(updated.seq, 1)
  assert.equal(updated.id, first.id)
  const messages = store.readMessages('chat_1')
  assert.deepEqual(messages.map(message => message.text), ['hello', 'hi'])
  // Reopening reads the same folded log.
  await store.close()
  const reopened = createStore({}, { dir })
  assert.deepEqual(reopened.readMessages('chat_1').map(message => message.text), ['hello', 'hi'])
})

test('store: a torn final line is skipped, the rest survives', async (t) => {
  const dir = tempDir(t)
  const store = createStore({}, { dir })
  await store.appendMessage('chat_1', { role: 'user', text: 'kept' })
  await store.close()
  const path = join(dir, 'messages', 'chat_1.jsonl')
  writeFileSync(path, `${readFileSync(path, 'utf8')}{"id":"msg_torn","seq":9`)
  const reopened = createStore({}, { dir })
  const messages = reopened.readMessages('chat_1')
  assert.equal(messages.length, 1)
  assert.equal(messages[0].text, 'kept')
})

test('store: pages walk backwards and report hasMore', async (t) => {
  const dir = tempDir(t)
  const store = createStore({}, { dir })
  for (let index = 1; index <= 5; index += 1) await store.appendMessage('chat_1', { role: 'user', text: `m${index}` })
  const page = store.pageMessages('chat_1', { limit: 2 })
  assert.deepEqual(page.messages.map(message => message.text), ['m4', 'm5'])
  assert.equal(page.hasMore, true)
  const older = store.pageMessages('chat_1', { limit: 2, before: page.messages[0].seq })
  assert.deepEqual(older.messages.map(message => message.text), ['m2', 'm3'])
  assert.equal(older.hasMore, true)
  const oldest = store.pageMessages('chat_1', { limit: 5, before: 2 })
  assert.deepEqual(oldest.messages.map(message => message.text), ['m1'])
  assert.equal(oldest.hasMore, false)
})

test('store: usage rows append once and deduplicate by turn id', async (t) => {
  const dir = tempDir(t)
  const store = createStore({}, { dir })
  await store.appendUsage({ ts: 10, turnId: 't1', chars: 5 })
  await store.appendUsage({ ts: 20, turnId: 't2', chars: 7 })
  assert.equal(store.readUsage(0).length, 2)
  assert.equal(store.readUsage(15).length, 1)
  assert.equal(store.hasUsage('t1'), true)
  assert.equal(store.hasUsage('t3'), false)
  // A torn usage line is skipped on read.
  await store.close()
  writeFileSync(join(dir, 'usage.jsonl'), `${readFileSync(join(dir, 'usage.jsonl'), 'utf8')}{"ts":30,`)
  const reopened = createStore({}, { dir })
  assert.equal(reopened.readUsage(0).length, 2)
})

test('store: a closed store refuses writes', async (t) => {
  const dir = tempDir(t)
  const store = createStore({}, { dir })
  await store.close()
  await assert.rejects(() => store.save(), (error) => error instanceof BotError && error.code === 'ledger-unavailable')
  await assert.rejects(() => store.appendMessage('chat_1', { role: 'user' }), (error) => error instanceof BotError)
})

test('home: DSH_HOME wins over the platform home', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '/tmp/custom' }, '/Users/example'), '/tmp/custom')
  assert.equal(resolveDshHome({ DSH_HOME: '~/custom' }, '/Users/example'), '/Users/example/custom')
  assert.equal(resolveDshHome({}, '/Users/example'), '/Users/example/.dsh')
  assert.equal(botHomeDirectory({ DSH_HOME: '/tmp/custom' }, '/Users/example'), '/tmp/custom/dsh-bot')
})

test('default state carries every top-level collection', () => {
  const state = defaultState('Ada')
  assert.equal(state.settings.userName, 'Ada')
  assert.deepEqual(state.bots, [])
  assert.deepEqual(state.groups, [])
  assert.deepEqual(state.chats, [])
  assert.deepEqual(state.sessions, {})
  assert.deepEqual(state.memory, { team: [], bots: {} })
  assert.deepEqual(state.schedules, {})
})
