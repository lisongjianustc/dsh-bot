import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTurnAccumulator,
  mapTurnEndReason,
} from '../src/host/runtime.js'

test('turn merge: several assistant messages become text parts of one bot message', () => {
  const accumulator = createTurnAccumulator({ botId: 'bot_a' })
  accumulator.addDelta('live only')
  accumulator.commitAssistant([{ type: 'text', text: 'first step' }], { inputTokens: 10, outputTokens: 3 })
  accumulator.commitAssistant([{ type: 'text', text: 'second step' }], { inputTokens: 4, outputTokens: 2 })
  assert.deepEqual(accumulator.parts, [
    { type: 'text', text: 'first step' },
    { type: 'text', text: 'second step' },
  ])
  assert.equal(accumulator.text(), 'first step\n\nsecond step')
  assert.equal(accumulator.live, '')
  assert.equal(accumulator.usage.inputTokens, 14)
  assert.equal(accumulator.usage.outputTokens, 5)
  assert.equal(accumulator.modelCalls, 2)
})

test('turn merge: tool calls and results settle the matching part', () => {
  const accumulator = createTurnAccumulator({ botId: 'bot_a' })
  accumulator.commitAssistant([{ type: 'text', text: 'let me check' }])
  accumulator.addToolCall('call_1', 'bash')
  accumulator.addToolCall('call_2', 'read')
  assert.equal(accumulator.toolCount, 2)
  assert.equal(accumulator.finishTool('call_2', { ok: true }), true)
  assert.equal(accumulator.finishTool('call_1', { ok: false, error: 'permission denied' }), true)
  assert.deepEqual(accumulator.parts, [
    { type: 'text', text: 'let me check' },
    { type: 'tool', name: 'bash', status: 'failed', error: 'permission denied' },
    { type: 'tool', name: 'read', status: 'ok' },
  ])
  assert.equal(accumulator.finishTool('call_missing', { ok: true }), false)
})

test('turn merge: reasoning and tool-call blocks contribute no text part', () => {
  const accumulator = createTurnAccumulator({ botId: 'bot_a' })
  accumulator.commitAssistant([
    { type: 'reasoning', text: 'thinking' },
    { type: 'tool-call', id: 'call_1', name: 'bash', arguments: '{}' },
  ])
  assert.deepEqual(accumulator.parts, [])
  assert.equal(accumulator.text(), '')
})

test('turn merge: a live delta is replaced by the committed text', () => {
  const accumulator = createTurnAccumulator({ botId: 'bot_a' })
  accumulator.addDelta('Hel')
  accumulator.addDelta('lo')
  assert.equal(accumulator.live, 'Hello')
  accumulator.commitAssistant([{ type: 'text', text: 'Hello there' }])
  assert.equal(accumulator.live, '')
  assert.equal(accumulator.text(), 'Hello there')
})

test('turn merge: a tool part still running at turn end is settled as failed', () => {
  const accumulator = createTurnAccumulator({ botId: 'bot_a' })
  accumulator.addToolCall('call_done', 'bash')
  accumulator.addToolCall('call_orphan', 'bot_list_team')
  accumulator.finishTool('call_done', { ok: true })
  const settled = accumulator.failRunningTools('the turn ended before this tool reported a result')
  assert.equal(settled, 1)
  assert.deepEqual(accumulator.parts, [
    { type: 'tool', name: 'bash', status: 'ok' },
    { type: 'tool', name: 'bot_list_team', status: 'failed', error: 'the turn ended before this tool reported a result' },
  ])
  // Idempotent: a second sweep has nothing left to settle.
  assert.equal(accumulator.failRunningTools('again'), 0)
})

test('turn end mapping: statuses the workbench renders', () => {
  assert.deepEqual(mapTurnEndReason({ kind: 'completed' }, 'normal answer', 1), { status: 'done' })
  assert.deepEqual(mapTurnEndReason({ kind: 'completed' }, '[PASS]', 0), { status: 'pass' })
  // A turn that used a tool is never a PASS, even if its last words look like one.
  assert.deepEqual(mapTurnEndReason({ kind: 'completed' }, '[PASS]', 2), { status: 'done' })
  assert.deepEqual(mapTurnEndReason({ kind: 'aborted' }, 'x', 0), { status: 'aborted' })
  const error = mapTurnEndReason({ kind: 'error', error: { message: 'rate limited' } }, '', 0)
  assert.equal(error.status, 'error')
  assert.match(error.error, /rate limited/)
  assert.deepEqual(mapTurnEndReason({ kind: 'max-tokens' }, 'partial', 0), { status: 'done' })
  assert.equal(mapTurnEndReason({ kind: 'interrupted' }, '', 0).status, 'error')
  assert.equal(mapTurnEndReason({ kind: 'blocked' }, '', 0).status, 'error')
  assert.equal(mapTurnEndReason({ kind: 'forked' }, '', 0).status, 'aborted')
})
