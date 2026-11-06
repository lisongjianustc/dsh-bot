import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TOOL_ARGS_MAX,
  TOOL_RESULT_MAX,
  TOOL_SUMMARY_MAX,
  createTurnAccumulator,
  mapTurnEndReason,
  toolCallSummary,
  toolResultText,
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

test('tool details: a bash call keeps its command summary and raw arguments', () => {
  assert.equal(toolCallSummary('bash', '{"command":"cd /tmp && ls -la"}'), 'ls -la')
  assert.equal(toolCallSummary('bash', '{"command":"pwd"}'), 'pwd')
  assert.equal(toolCallSummary('bash', 'not json at all'), '')
  const accumulator = createTurnAccumulator({ botId: 'bot_a' })
  accumulator.addToolCall('call_bash', 'bash', '{"command":"cd /repo && npm test"}')
  assert.deepEqual(accumulator.parts[0], {
    type: 'tool',
    name: 'bash',
    status: 'running',
    summary: 'npm test',
    args: '{"command":"cd /repo && npm test"}',
  })
  accumulator.finishTool('call_bash', { ok: true, result: toolResultText([{ type: 'text', text: 'ok\n' }, { type: 'text', text: 'done' }]) })
  assert.equal(accumulator.parts[0].result, 'ok\n\ndone')
  assert.equal(accumulator.parts[0].status, 'ok')
})

test('tool details: read/write/edit summarize by path, web tools by url/query', () => {
  assert.equal(toolCallSummary('read', '{"path":"/tmp/a.txt"}'), '/tmp/a.txt')
  assert.equal(toolCallSummary('write', '{"file_path":"/tmp/b.txt"}'), '/tmp/b.txt')
  assert.equal(toolCallSummary('edit', '{"path":"src/main.js","old":"a","new":"b"}'), 'src/main.js')
  assert.equal(toolCallSummary('apply_patch', '{"file_path":"/tmp/c.txt"}'), '/tmp/c.txt')
  assert.equal(toolCallSummary('web_fetch', '{"url":"https://example.com/x"}'), 'https://example.com/x')
  assert.equal(toolCallSummary('web_search', '{"query":"dsh bot"}'), 'dsh bot')
  assert.equal(toolCallSummary('bot_list_team', '{}'), '')
  const accumulator = createTurnAccumulator({ botId: 'bot_a' })
  accumulator.addToolCall('call_read', 'read', '{"path":"/tmp/a.txt"}')
  assert.equal(accumulator.parts[0].summary, '/tmp/a.txt')
})

test('tool details: arguments and results are bounded, a missing result adds no field', () => {
  const longArgs = JSON.stringify({ command: 'x'.repeat(5000) })
  assert.equal(toolCallSummary('bash', longArgs).length, TOOL_SUMMARY_MAX)
  const accumulator = createTurnAccumulator({ botId: 'bot_a' })
  accumulator.addToolCall('call_1', 'bash', longArgs)
  assert.equal(accumulator.parts[0].args.length, TOOL_ARGS_MAX)
  accumulator.finishTool('call_1', { ok: true, result: 'r'.repeat(10000) })
  assert.equal(accumulator.parts[0].result.length, TOOL_RESULT_MAX)
  accumulator.addToolCall('call_2', 'read', '{"path":"/tmp/x"}')
  accumulator.finishTool('call_2', { ok: false, error: 'boom' })
  assert.equal(Object.hasOwn(accumulator.parts[1], 'result'), false)
  assert.equal(accumulator.parts[1].error, 'boom')
  // A call with no known summary and no arguments keeps only the base fields.
  accumulator.addToolCall('call_3', 'bot_list_team')
  assert.deepEqual(accumulator.parts[2], { type: 'tool', name: 'bot_list_team', status: 'running' })
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
