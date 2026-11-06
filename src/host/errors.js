/**
 * The Host half's typed refusals.
 *
 * A refusal this plugin decided carries a stable machine code and one bounded
 * sentence; the routes turn it into `{ ok:false, code, message }`, the tools turn
 * it into a value the model can correct, and nothing else crosses the boundary.
 * Anything not decided here is a fault and stays an exception.
 *
 * @module @lisongjianustc/dsh-bot/host/errors
 */

/**
 * A refusal with a stable code.
 */
export class BotError extends Error {
  /**
   * @param {string} code - stable machine code.
   * @param {string} message - one bounded sentence for the caller.
   * @param {{ cause?: unknown }} [options] - optional underlying failure.
   */
  constructor(code, message, options = {}) {
    super(message, options)
    this.name = 'BotError'
    this.code = code
  }
}

/**
 * Whether a value is this plugin's refusal.
 * @param {unknown} value - candidate.
 * @returns {value is BotError} true for a BotError.
 */
export function isBotError(value) {
  return value instanceof BotError
}

/** HTTP status per code: user-fixable input problems are 4xx, environment problems 5xx. */
const STATUS_BY_CODE = {
  'invalid-request': 400,
  'body-too-large': 413,
  'json-required': 415,
  'method-not-allowed': 405,
  forbidden: 403,
  'bot-not-found': 404,
  'chat-not-found': 404,
  'group-not-found': 404,
  'session-busy': 409,
  'schedule-not-found': 404,
  'memory-not-found': 404,
  'memory-conflict': 409,
  'model-unavailable': 422,
  'workspace-unavailable': 503,
  'schedule-unavailable': 503,
  'session-create-failed': 502,
  'ledger-unavailable': 503,
  'session-unavailable': 503,
  internal: 500,
}

/**
 * The HTTP status of one refusal code.
 * @param {string} code - stable code.
 * @returns {number} the status.
 */
export function statusForCode(code) {
  return STATUS_BY_CODE[code] ?? 500
}

/**
 * Describe a caught value for a log line or an error field.
 * @param {unknown} error - the caught value.
 * @returns {string} a bounded description.
 */
export function describeError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * A stable tool-result value for one refusal: the model reads a code, never a
 * stack trace.
 * @param {unknown} error - the caught value.
 * @returns {{ ok: false, code: string, message: string }} the value.
 */
export function refusalValue(error) {
  if (isBotError(error)) return { ok: false, code: error.code, message: error.message }
  throw error
}
