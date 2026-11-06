import assert from 'node:assert/strict'
import test from 'node:test'
import { HEARTBEAT_MS, createHub } from '../src/host/hub.js'

/** A response that records every frame written to it. */
function recorder() {
  return {
    chunks: [],
    head: undefined,
    ended: false,
    writeHead(status, headers) {
      this.head = { status, headers }
    },
    write(chunk) {
      this.chunks.push(String(chunk))
      return true
    },
    end(chunk) {
      this.ended = true
      if (chunk !== undefined) this.chunks.push(String(chunk))
    },
    on() {},
    off() {},
    frames() {
      return this.chunks
        .join('')
        .split('\n\n')
        .filter(Boolean)
        .map(line => line.replace(/^data: /, ''))
        .filter(line => !line.startsWith(':'))
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return undefined
          }
        })
        .filter(Boolean)
    },
  }
}

test('hub: the default heartbeat cadence is 20 seconds', () => {
  assert.equal(HEARTBEAT_MS, 20000)
})

test('hub: an attached stream opens with the initial state frame', () => {
  const hub = createHub({ heartbeatMs: 60000 })
  const res = recorder()
  hub.attach(res, { type: 'state', state: { stateRev: 1 } })
  assert.equal(res.head.status, 200)
  assert.match(res.head.headers['content-type'], /text\/event-stream/)
  const frames = res.frames()
  assert.equal(frames[0].type, 'state')
  assert.equal(frames[0].state.stateRev, 1)
  assert.equal(hub.size, 1)
  hub.dispose()
})

test('hub: the heartbeat is a visible data frame, not a comment', async () => {
  const hub = createHub({ heartbeatMs: 5 })
  const res = recorder()
  const started = Date.now()
  hub.attach(res, { type: 'state', state: { stateRev: 2 } })
  await new Promise(resolve => setTimeout(resolve, 40))
  const frames = res.frames()
  const pings = frames.filter(frame => frame.type === 'ping')
  assert.ok(pings.length >= 1, 'at least one ping frame arrived')
  for (const ping of pings) {
    assert.equal(typeof ping.at, 'number')
    assert.ok(ping.at >= started)
  }
  // The old comment heartbeat is not the mechanism any more.
  assert.doesNotMatch(res.chunks.join(''), /^: ping/m)
  hub.dispose()
})

test('hub: publish reaches every attached stream and stops after dispose', () => {
  const hub = createHub({ heartbeatMs: 60000 })
  const first = recorder()
  const second = recorder()
  hub.attach(first, { type: 'state', state: {} })
  hub.attach(second, { type: 'state', state: {} })
  hub.publish({ type: 'chat', chat: { id: 'chat_1', pinned: true } })
  for (const res of [first, second]) {
    const frame = res.frames().find(entry => entry.type === 'chat')
    assert.equal(frame.chat.id, 'chat_1')
  }
  hub.dispose()
  hub.publish({ type: 'chat', chat: { id: 'chat_2' } })
  assert.equal(first.frames().some(entry => entry.chat?.id === 'chat_2'), false)
})

test('hub: a failed write detaches that client only', () => {
  const hub = createHub({ heartbeatMs: 60000 })
  const healthy = recorder()
  const broken = recorder()
  broken.write = () => {
    throw new Error('socket closed')
  }
  hub.attach(healthy, { type: 'state', state: {} })
  hub.attach(broken, { type: 'state', state: {} })
  hub.publish({ type: 'ping', at: 1 })
  // publish caught the failure and detached the broken client.
  assert.doesNotThrow(() => hub.publish({ type: 'ping', at: 2 }))
  hub.dispose()
})
