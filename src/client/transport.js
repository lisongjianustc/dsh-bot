/**
 * Browser transport of the dsh-bot workspace: a thin fetch layer over the
 * frozen HTTP contract in `docs/PROTOCOL.md`, plus the SSE subscriber.
 *
 * Every failure becomes a `DshBotApiError` carrying a stable class (and, for
 * Host refusals, the Host's own `code`), so a component can render actionable
 * copy instead of a raw fetch/JSON message. Requests address the routes
 * DOCUMENT-RELATIVE: the page is served with `<base href="./">`, the Host
 * registers the prefix root-absolute, so the client drops the leading slash.
 */

'use strict'

/** API prefix, document-relative (see PROTOCOL §2). */
var API_PREFIX = 'dsh-bot/api'

/** Ceiling for one request. */
var REQUEST_TIMEOUT_MS = 15000

/** First reconnect delay after a dropped event stream. */
var RECONNECT_MS = 1000
/** After this many consecutive failures the stream backs off to this delay. */
var RECONNECT_SLOW_MS = 5000
/** Failures before the delay steps up from {@link RECONNECT_MS}. */
var RECONNECT_FAST_ATTEMPTS = 6

/** Build the document-relative URL of one route. */
function apiUrl(path, query) {
  var clean = String(path === undefined || path === null ? '' : path).replace(/^\/+/, '')
  var url = clean === '' ? API_PREFIX : API_PREFIX + '/' + clean
  if (query !== undefined && query !== null) {
    var parts = []
    for (var key in query) {
      if (!Object.prototype.hasOwnProperty.call(query, key)) continue
      var value = query[key]
      if (value === undefined || value === null || value === '') continue
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
    }
    if (parts.length > 0) url += '?' + parts.join('&')
  }
  return url
}

/**
 * Host / transport failure with a stable class.
 *
 * `failure` is the branch key the UI reads; `code` is the Host's own protocol
 * code when the Host refused the request; `detail` is the Host sentence or the
 * HTTP status, kept for the `{detail}` parameter of the locale copy.
 */
function DshBotApiError(failure, detail, status, code) {
  Error.call(this, detail || failure)
  this.name = 'DshBotApiError'
  this.failure = failure
  this.detail = detail === undefined ? '' : String(detail)
  this.status = status
  this.code = code
}
DshBotApiError.prototype = Object.create(Error.prototype)
DshBotApiError.prototype.constructor = DshBotApiError

/** Map one Host protocol code to the copy key it reads as. */
var HOST_CODE_KEYS = {
  'invalid-request': 'error.invalid-request',
  'bot-not-found': 'error.bot-not-found',
  'chat-not-found': 'error.chat-not-found',
  'group-not-found': 'error.group-not-found',
  'session-busy': 'error.session-busy',
  'model-unavailable': 'error.model-unavailable',
  'ledger-unavailable': 'error.ledger-unavailable',
  'memory-not-found': 'error.memory-not-found',
  'memory-conflict': 'error.memory-conflict',
  'schedule-not-found': 'error.schedule-not-found',
  'schedule-unavailable': 'error.schedule-unavailable',
  'session-unavailable': 'error.session-unavailable',
  'workspace-unavailable': 'error.workspace-unavailable',
  'session-create-failed': 'error.session-create-failed',
  'body-too-large': 'error.body-too-large',
  'internal': 'error.internal',
}

/** Read the Host code off one error body. */
function hostCode(body) {
  if (body === null || typeof body !== 'object') return undefined
  var code = body.code
  return typeof code === 'string' && code !== '' ? code : undefined
}

/** Read the Host message off one error body. */
function hostMessage(body) {
  if (body === null || typeof body !== 'object') return ''
  var message = body.message
  return typeof message === 'string' ? message : ''
}

/** One HTTP round trip; resolves the parsed JSON body. */
function sendRequest(method, path, query, body, timeoutMs) {
  var controller = typeof AbortController === 'function' ? new AbortController() : undefined
  var budget = timeoutMs === undefined ? REQUEST_TIMEOUT_MS : timeoutMs
  var timer
  if (controller !== undefined && budget > 0) {
    timer = setTimeout(function () {
      try {
        controller.abort()
      } catch (error) {
        /* already aborted */
      }
    }, budget)
  }
  var headers = { accept: 'application/json' }
  var init = { method: method, headers: headers, credentials: 'same-origin' }
  if (controller !== undefined) init.signal = controller.signal
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  return fetch(apiUrl(path, query), init).then(
    function (response) {
      return response.text().then(function (text) {
        var parsed
        var parseFailed = false
        if (text !== '' && text !== undefined && text !== null) {
          try {
            parsed = JSON.parse(text)
          } catch (error) {
            parseFailed = true
          }
        }
        if (timer !== undefined) clearTimeout(timer)
        if (!response.ok) {
          var code = hostCode(parsed)
          var detail = hostMessage(parsed) || String(response.status)
          if (code !== undefined) throw new DshBotApiError('rejected', detail, response.status, code)
          if (response.status === 401) throw new DshBotApiError('unauthorized', detail, response.status)
          if (response.status === 403) throw new DshBotApiError('forbidden', detail, response.status)
          if (response.status === 404) throw new DshBotApiError('not-mounted', detail, response.status)
          throw new DshBotApiError('rejected', detail, response.status)
        }
        if (parseFailed || parsed === undefined) {
          throw new DshBotApiError('unexpected', String(response.status), response.status)
        }
        if (parsed !== null && typeof parsed === 'object' && parsed.ok === false) {
          var refusedCode = hostCode(parsed)
          throw new DshBotApiError('rejected', hostMessage(parsed), response.status, refusedCode)
        }
        return parsed
      })
    },
    function (error) {
      if (timer !== undefined) clearTimeout(timer)
      if (error instanceof DshBotApiError) throw error
      var aborted = error !== null && error !== undefined && error.name === 'AbortError'
      if (aborted) throw new DshBotApiError('timeout', 'timeout')
      throw new DshBotApiError('unreachable', error === undefined ? '' : String(error && error.message ? error.message : error))
    },
  )
}

/** GET one route. */
function get(path, query) {
  return sendRequest('GET', path, query)
}

/** POST one route with a JSON body. */
function post(path, body, timeoutMs) {
  return sendRequest('POST', path, undefined, body === undefined ? {} : body, timeoutMs)
}

/** Map a Host code to its locale key, or undefined when it has no dedicated copy. */
function codeKey(code) {
  return HOST_CODE_KEYS[code]
}

/**
 * Render one error through the bound translator.
 * @param t slot-bound translate function.
 * @param error anything thrown by this module or by a store action.
 */
function describeError(t, error) {
  if (error === undefined || error === null) return ''
  if (typeof error === 'string') return error
  if (error.failure === undefined) return error.message ? String(error.message) : t('error.unknown')
  if (error.failure === 'rejected') {
    var key = codeKey(error.code)
    if (key !== undefined) return t(key)
    return t('error.rejected', { detail: error.detail || String(error.status || '') })
  }
  if (error.failure === 'unexpected') return t('error.unexpected', { status: error.detail || '?' })
  if (error.failure === 'timeout') return t('error.timeout', { seconds: String(REQUEST_TIMEOUT_MS / 1000) })
  var direct = 'error.' + error.failure
  var text = t(direct)
  // `t` returns the key itself when a namespace lacks it; fall back to generic.
  return text === direct ? t('error.unknown') : text
}

/**
 * Subscribe to the Host event stream.
 *
 * A dropped stream closes its socket and reconnects on a timer: 1s while the
 * failures are new (the frozen contract), backing off after several, and never
 * while the document is hidden — the stream reconnects immediately when the
 * tab becomes visible again instead of hammering a sleeping Host.
 *
 * @param options.onFrame parsed frame object.
 * @param options.onOpen called on every successful (re)connect.
 * @param options.onError called when the stream drops.
 * @param options.since last applied event sequence, forwarded as `?since=`.
 */
function connectEvents(options) {
  var handlers = options || {}
  var since = handlers.since
  var disposed = false
  var socket = null
  var timer = null
  var failures = 0

  function clearTimer() {
    if (timer !== undefined && timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function socketUrl() {
    var url = apiUrl('events')
    if (since !== undefined && since !== null) url += '?since=' + encodeURIComponent(String(since))
    return url
  }

  function closeSocket() {
    if (socket === null) return
    try {
      socket.close()
    } catch (error) {
      /* already closed */
    }
    socket = null
  }

  function schedule(delay) {
    if (disposed) return
    clearTimer()
    timer = setTimeout(function () {
      timer = null
      open()
    }, delay)
  }

  function dropped() {
    failures += 1
    closeSocket()
    if (typeof handlers.onError === 'function') handlers.onError()
    var delay = failures <= RECONNECT_FAST_ATTEMPTS ? RECONNECT_MS : RECONNECT_SLOW_MS
    schedule(delay)
  }

  function open() {
    if (disposed) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Reconnect from the visibility handler instead of polling a hidden tab.
      return
    }
    clearTimer()
    var stream
    try {
      stream = new EventSource(socketUrl())
    } catch (error) {
      dropped()
      return
    }
    socket = stream
    stream.onopen = function () {
      failures = 0
      if (typeof handlers.onOpen === 'function') handlers.onOpen()
    }
    stream.onmessage = function (message) {
      var frame
      try {
        frame = JSON.parse(message.data)
      } catch (error) {
        return
      }
      if (frame === null || typeof frame !== 'object' || typeof frame.type !== 'string') return
      if (typeof handlers.onFrame === 'function') handlers.onFrame(frame)
    }
    stream.onerror = function () {
      dropped()
    }
  }

  function onVisible() {
    if (typeof document === 'undefined') return
    if (document.visibilityState !== 'visible') return
    if (disposed) return
    if (socket !== null) return
    clearTimer()
    failures = 0
    open()
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  open()

  return {
    /** Push the last applied sequence so a reconnect can resume from it. */
    setSince: function (next) {
      since = next
    },
    close: function () {
      disposed = true
      clearTimer()
      closeSocket()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    },
  }
}

module.exports = {
  API_PREFIX: API_PREFIX,
  REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
  DshBotApiError: DshBotApiError,
  apiUrl: apiUrl,
  get: get,
  post: post,
  describeError: describeError,
  connectEvents: connectEvents,
}
