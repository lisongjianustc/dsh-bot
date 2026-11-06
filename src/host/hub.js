/**
 * The single real-time channel from the Host half to the workbench page.
 *
 * One hub server-side; every `/dsh-bot/api/events` response is attached here.
 * Frames are `data: <json>\n\n`; a `: ping` comment every 20 seconds keeps
 * proxies and browsers from closing an idle stream. A client that fails to take
 * a frame is detached rather than retried, because a half-broken response must
 * never stall the Bot runtime.
 *
 * @module @lisongjianustc/dsh-bot/host/hub
 */

/** How often an idle stream is kept alive. */
export const HEARTBEAT_MS = 20000

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
  'referrer-policy': 'no-referrer',
}

/**
 * Create the broadcaster.
 * @returns {object} the hub.
 */
export function createHub() {
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set()
  let heartbeat
  let disposed = false

  const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`

  const ensureHeartbeat = () => {
    if (heartbeat !== undefined || disposed) return
    heartbeat = setInterval(() => {
      for (const res of clients) {
        try {
          res.write(': ping\n\n')
        } catch {
          detach(res)
        }
      }
    }, HEARTBEAT_MS)
    // An idle keep-alive must never hold the process open.
    if (typeof heartbeat.unref === 'function') heartbeat.unref()
  }

  const detach = (res) => {
    clients.delete(res)
    if (clients.size === 0 && heartbeat !== undefined) {
      clearInterval(heartbeat)
      heartbeat = undefined
    }
  }

  const publish = (payload) => {
    if (disposed) return
    const body = frame(payload)
    for (const res of clients) {
      try {
        res.write(body)
      } catch {
        detach(res)
      }
    }
  }

  return {
    /**
     * Attach one response as an SSE client.
     * @param {import('node:http').ServerResponse} res - the response.
     * @param {object} [initial] - one frame written before the client is registered.
     * @returns {() => void} the detach function.
     */
    attach(res, initial) {
      if (disposed) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, code: 'internal', message: 'the bot hub is closed' }))
        return () => {}
      }
      res.writeHead(200, SSE_HEADERS)
      if (initial !== undefined) res.write(frame(initial))
      clients.add(res)
      ensureHeartbeat()
      const close = () => detach(res)
      res.on('close', close)
      res.on('error', close)
      return () => {
        res.off('close', close)
        res.off('error', close)
        detach(res)
      }
    },
    /** Broadcast one frame to every attached client. */
    publish,
    /** How many clients are attached (tests and diagnostics). */
    get size() {
      return clients.size
    },
    dispose() {
      disposed = true
      if (heartbeat !== undefined) {
        clearInterval(heartbeat)
        heartbeat = undefined
      }
      for (const res of clients) {
        try {
          res.end()
        } catch {
          /* the client is already gone */
        }
      }
      clients.clear()
    },
  }
}
