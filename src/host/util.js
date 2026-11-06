/**
 * Small shared helpers for the Host half: identifiers, hashes, text clipping and
 * the prompt-injection neutraliser.
 *
 * Pure module: no host service, no filesystem. The neutraliser is ported from the
 * MiniMax Bot relay guard (`relay-guard.mjs`) with the tag vocabulary replaced by
 * this Harness's own block tags, because a Bot reply becomes prompt text for the
 * next Bot and must never be able to forge a block marker.
 *
 * @module @lisongjianustc/dsh-bot/host/util
 */
import { createHash, randomUUID } from 'node:crypto'

/**
 * A stable random identity: `<prefix>_<12 lowercase hex>`.
 * @param {string} prefix - the entity kind, e.g. `bot`.
 * @returns {string} the identity.
 */
export function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/**
 * A fresh opaque identity for a DSH session.
 * @returns {string} a UUID string usable as a SessionId.
 */
export function newSessionId() {
  return randomUUID()
}

/**
 * SHA-1 hex digest of the exact text.
 * @param {string} text - input text.
 * @returns {string} 40 hex characters.
 */
export function sha1(text) {
  return createHash('sha1').update(String(text)).digest('hex')
}

/**
 * SHA-256 hex digest of the exact text.
 * @param {string} text - input text.
 * @returns {string} 64 hex characters.
 */
export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex')
}

/**
 * Clip text to a maximum length, leaving shorter text untouched.
 * @param {string} text - input text.
 * @param {number} max - maximum code-unit length.
 * @returns {string} the clipped text.
 */
export function clip(text, max) {
  const value = String(text ?? '')
  if (!Number.isFinite(max) || max <= 0 || value.length <= max) return value
  return value.slice(0, max)
}

/** Protocol marks this plugin writes into prompts. */
const MARK_PATTERN = new RegExp(
  '<\\s*\\/?\\s*dsh-bot-[a-z0-9-]+(?:[ \\t]+[A-Za-z0-9_:.=/"\'()\\-]*)?\\s*>'
  + '|<\\s*\\/?\\s*dsh-bot-[a-z0-9-]+',
  'gi',
)

/**
 * Block tags the Harness itself writes into prompts. A Bot copying one into a
 * reply would hand the next Bot text that reads like a notice the Harness sent.
 */
export const HOST_TAGS = [
  'system-reminder',
  'unlisted-tools',
  'agent-context',
  'async-audit',
  'environment-details',
  'task-completion-reminder',
  'background-task-finished',
]

const HOST_TAG_PATTERN = new RegExp(
  `<\\s*\\/?\\s*(?:${HOST_TAGS.join('|')})(?:[ \\t]+[A-Za-z0-9_:.=/"'()\\-]*)?\\s*>`
  + `|<\\s*\\/?\\s*(?:${HOST_TAGS.join('|')})`,
  'gi',
)

const STRIP_PATTERN = new RegExp(`${MARK_PATTERN.source}|${HOST_TAG_PATTERN.source}`, 'gi')

/** A dash that looks like the hyphen of a protocol mark. */
const LOOKALIKE_DASH = /[‐-―]/
/** A full-width ASCII character, which reads as its ASCII form. */
const FULLWIDTH_ASCII = /[！-～]/
/** A character that takes no space, so a mark split by one still reads as that mark. */
const INVISIBLE = /[\p{Cf}\p{Mn}]/u

function foldChar(char) {
  if (FULLWIDTH_ASCII.test(char)) return String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  return LOOKALIKE_DASH.test(char) ? '-' : char
}

function foldMarks(text) {
  let folded = ''
  const origin = []
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (INVISIBLE.test(char)) continue
    folded += foldChar(char)
    origin.push(i)
  }
  return { folded, origin }
}

/**
 * Remove this plugin's protocol marks and the Harness's block tags from a text.
 * Only the tags go; the words around them are left as they were.
 * @param {string} text - untrusted text.
 * @returns {string} the neutralised text.
 */
export function neutralizeMarks(text) {
  const value = String(text ?? '')
  const { folded, origin } = foldMarks(value)
  let out = ''
  let last = 0
  for (const match of folded.matchAll(STRIP_PATTERN)) {
    const start = origin[match.index]
    const end = origin[match.index + match[0].length - 1] + 1
    out += value.slice(last, start) + ' '
    last = end
  }
  return out + value.slice(last)
}

/**
 * Text that is safe to place inside a prompt block of our own: marks neutralised,
 * a clipped length, and no runs of blank lines.
 * @param {string} text - untrusted text.
 * @param {number} [max] - optional code-unit cap.
 * @returns {string} the cleaned text.
 */
export function clean(text, max = 0) {
  const neutral = neutralizeMarks(String(text ?? ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  const limited = max > 0 ? clip(neutral, max) : neutral
  return limited.trim()
}

/**
 * Collapse blank lines and trim, as MiniMax's `clean()` does for prompt lines.
 * @param {string} text - input text.
 * @returns {string} the collapsed text.
 */
export function collapse(text) {
  return String(text ?? '')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * A positive finite number or the fallback.
 * @param {unknown} value - candidate.
 * @param {number} fallback - value used when the candidate is unusable.
 * @returns {number} the usable number.
 */
export function toPositive(value, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/**
 * Whether a value is a plain object.
 * @param {unknown} value - candidate.
 * @returns {boolean} true for a non-array object.
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the single-line day stamp (`YYYY-MM-DD`) of a timestamp in local time.
 * @param {number} ts - epoch milliseconds.
 * @returns {string} the day stamp.
 */
export function dayStamp(ts) {
  const date = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Sleep for a bounded number of milliseconds.
 * @param {number} ms - duration.
 * @returns {Promise<void>} resolves after the delay.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
