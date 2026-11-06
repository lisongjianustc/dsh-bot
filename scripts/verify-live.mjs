#!/usr/bin/env node
/**
 * Live smoke test against a running DSH Host.
 *
 * Usage:
 *   node scripts/verify-live.mjs [http://127.0.0.1:49952]
 *
 * Checks the endpoints the workbench page needs and prints one line per check.
 * Exit code 1 when a required endpoint fails.
 */
const base = (process.argv[2] ?? 'http://127.0.0.1:49952').replace(/\/$/, '')
const api = `${base}/dsh-bot/api`

const checks = []
const record = (name, ok, detail) => checks.push({ name, ok, detail })

const getJson = async (path) => {
  const response = await fetch(`${api}${path}`)
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

const postJson = async (path, payload) => {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

// 1. state — the page's first read; also proves the Host handled a disposal race.
const state = await getJson('/state')
record('GET /state', state.status === 200 && state.body?.ok === true, `${state.status} ${state.body?.code ?? ''}`)
const view = state.body?.state ?? {}

// 2. models are optional data on state: either present or absent, never a 500.
record('state.models optional', state.status === 200, JSON.stringify(view.models?.providers?.length ?? 'absent'))

// 3. message history for the first chat.
const chat = view.chats?.[0]
if (chat === undefined) {
  record('GET /messages', true, 'no chat yet (fresh ledger)')
} else {
  const messages = await getJson(`/messages?chatId=${encodeURIComponent(chat.id)}&limit=5`)
  record('GET /messages', messages.status === 200 && messages.body?.ok === true, `${messages.status} count=${messages.body?.messages?.length ?? '?'}`)
}

// 4. usage ledger.
const usage = await getJson('/usage?days=7')
record('GET /usage', usage.status === 200 && usage.body?.ok === true, `${usage.status}`)

// 5. memory (team scope).
const memory = await postJson('/memory', { action: 'list', scope: 'team' })
record('POST /memory list', memory.status === 200 && memory.body?.ok === true, `${memory.status}`)

// 6. schedules projection.
const schedules = await postJson('/schedule', { action: 'list' })
record('POST /schedule list', schedules.status === 200 && schedules.body?.ok === true, `${schedules.status} count=${schedules.body?.schedules?.length ?? '?'}`)

// 7. SSE first frame is a full state — the page resyncs from it.
let sseOk = false
let sseDetail = 'no frame in 5s'
try {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  const response = await fetch(`${api}/events`, { signal: controller.signal })
  const reader = response.body.getReader()
  const { value } = await reader.read()
  clearTimeout(timer)
  controller.abort()
  const text = bufferText(value)
  sseOk = /"type"\s*:\s*"state"/.test(text)
  sseDetail = text.slice(0, 60).replace(/\s+/g, ' ')
} catch (error) {
  sseDetail = error instanceof Error ? error.message : String(error)
}
record('GET /events SSE', sseOk, sseDetail)

let failed = 0
for (const check of checks) {
  if (!check.ok) failed += 1
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}  ${check.detail}`)
}
console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exit(failed === 0 ? 0 : 1)

function bufferText(value) {
  if (value === undefined) return ''
  return new TextDecoder().decode(value)
}
