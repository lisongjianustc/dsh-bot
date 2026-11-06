/**
 * Memory rules, ported from MiniMax Bot's `memory.mjs` / `memory-context.mjs`
 * and kept pure: no disk, no Host service, so every rule is testable.
 *
 * Three rules decide this module:
 * - a hard storage budget per scope (1200 chars per entry, 100000 per scope,
 *   1000 entries), counted on the body text only;
 * - a selection budget for one prompt (6000 characters of serialized entries),
 *   pinned first, then relevance, then recency, whole entries only;
 * - secrets are refused before they are written, because memory travels into
 *   every Bot's prompt.
 *
 * @module @lisongjianustc/dsh-bot/host/memory
 */
import { neutralizeMarks, sha256 } from './util.js'

/** The longest one memory entry may be. */
export const ENTRY_MAX = 1200
/** The storage budget of one scope. */
export const STORAGE_MAX = 100000
/** How many entries one scope may hold. */
export const MAX_ENTRIES = 1000
/** The shared prompt budget for one turn's memory block. */
export const MEMORY_CONTEXT_MAX = 6000

/** A stable topic key: lowercase, dots and dashes allowed. */
export const TOPIC_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Storage budget of one scope, counted on body characters. */
export function storageBudget(entries) {
  const list = Array.isArray(entries) ? entries : []
  const used = list.reduce((total, entry) => total + String(entry?.text ?? '').length, 0)
  return {
    used,
    limit: STORAGE_MAX,
    remaining: Math.max(0, STORAGE_MAX - used),
    entryMax: ENTRY_MAX,
    entryCount: list.length,
    entryLimit: MAX_ENTRIES,
    unit: 'characters',
  }
}

/**
 * The revision of one entry, derived on read so a hand-edited file needs no
 * migration. Changing the text, the key or the pinned flag changes the revision.
 * @param {object} entry - the entry.
 * @returns {string} 64 hex characters.
 */
export function entryRevision(entry) {
  return sha256(JSON.stringify([String(entry?.text ?? ''), String(entry?.key ?? ''), Boolean(entry?.pinned)]))
}

/** Secret shapes a memory entry must never keep. */
const SECRET_PATTERNS = [
  /\b(sk|pk|rk|ak)-[A-Za-z0-9_-]{12,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b[A-Fa-f0-9]{32,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}/,
  /(password|passwd|密码|口令|api[_ -]?key|secret|token|私钥)\s*[:：=是为]\s*\S+/i,
  /\b\d{17}[\dXx]\b/,
]

/**
 * Why a candidate memory text is refused, or undefined when it is acceptable.
 * @param {string} text - the candidate text.
 * @returns {string | undefined} a stable reason code, or undefined.
 */
export function secretReason(text) {
  const value = String(text ?? '')
  for (const pattern of SECRET_PATTERNS) if (pattern.test(value)) return 'secret'
  return undefined
}

/**
 * Validate one memory write against the entry and scope budgets.
 * @param {object} input - the write.
 * @param {string} input.text - the candidate text.
 * @param {string} [input.key] - the topic key.
 * @param {object[]} [input.entries] - the scope's current entries.
 * @param {string} [input.replaceId] - an entry this write replaces.
 * @returns {{ ok: true } | { ok: false, code: string, message: string }} the decision.
 */
export function validateMemoryWrite({ text, key, entries, replaceId }) {
  const body = String(text ?? '').trim()
  if (body === '') return { ok: false, code: 'invalid-request', message: 'memory text is blank' }
  const secret = secretReason(body)
  if (secret !== undefined) return { ok: false, code: 'invalid-request', message: 'memory text looks like a secret and is refused' }
  const list = Array.isArray(entries) ? entries : []
  const replacing = replaceId === undefined ? undefined : list.find(entry => entry.id === replaceId)
  if (replaceId !== undefined && replacing === undefined) {
    return { ok: false, code: 'invalid-request', message: 'no memory entry has the id ' + replaceId }
  }
  const previousLength = replacing === undefined ? 0 : String(replacing.text ?? '').length
  // Shrinking a historically over-long entry is allowed; only a growing one is refused.
  if (body.length > ENTRY_MAX && body.length > previousLength) {
    return { ok: false, code: 'invalid-request', message: `one memory entry holds at most ${ENTRY_MAX} characters` }
  }
  if (key !== undefined && !TOPIC_KEY_RE.test(String(key))) {
    return { ok: false, code: 'invalid-request', message: 'a memory key is lowercase letters, digits, dots and dashes, at most 64 characters' }
  }
  const others = list.filter(entry => entry.id !== replaceId)
  if (others.length >= MAX_ENTRIES) {
    return { ok: false, code: 'invalid-request', message: `one scope holds at most ${MAX_ENTRIES} entries` }
  }
  const used = others.reduce((total, entry) => total + String(entry.text ?? '').length, 0)
  if (used + body.length > STORAGE_MAX) {
    return { ok: false, code: 'invalid-request', message: `one scope holds at most ${STORAGE_MAX} characters of memory` }
  }
  return { ok: true }
}

/** NFKC-normalised query terms plus Han bigrams, so a Chinese query still matches. */
function queryTerms(query) {
  const words = String(query ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
  const terms = new Set(words)
  for (const word of words) {
    for (const run of word.match(/\p{Script=Han}+/gu) ?? []) {
      const chars = [...run]
      if (chars.length === 1) terms.add(run)
      for (let index = 0; index + 1 < chars.length; index += 1) terms.add(chars[index] + chars[index + 1])
    }
  }
  return [...terms]
}

/** Relevance of one entry: body hits plus three times the topic-key hits. */
function relevance(entry, terms) {
  const text = String(entry?.text ?? '').normalize('NFKC').toLowerCase()
  const key = String(entry?.key ?? '').normalize('NFKC').toLowerCase()
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0) + (key.includes(term) ? 3 : 0), 0)
}

/** The prompt rendering of one entry: stable JSON, one line each. */
function serializeEntry(entry) {
  return JSON.stringify({
    scope: entry.scope,
    id: entry.id,
    key: entry.key ?? '',
    revision: entry.revision ?? '',
    pinned: Boolean(entry.pinned),
    text: neutralizeMarks(String(entry.text ?? '')),
  })
}

/**
 * Select the memory entries one prompt may carry.
 *
 * Ordering: pinned first, then relevance, then newest, then declaration order.
 * A whole entry that does not fit is skipped, so a small useful entry can still
 * make it; the caller gets the omitted count.
 * @param {object[]} scopedEntries - entries with their resolved `scope`.
 * @param {{ query?: string, limit?: number }} [options] - selection options.
 * @returns {{ entries: object[], text: string, used: number, limit: number, total: number, omitted: number }} the selection.
 */
export function selectMemoryContext(scopedEntries, { query = '', limit = MEMORY_CONTEXT_MAX } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('memory context limit must be a non-negative integer')
  const list = Array.isArray(scopedEntries) ? scopedEntries : []
  const terms = queryTerms(query)
  const candidates = list
    .map((entry, index) => ({
      entry,
      index,
      score: relevance(entry, terms),
      added: Number(entry.addedAt ?? 0) || Date.parse(entry.added ?? '') || 0,
    }))
    .sort((a, b) => Number(Boolean(b.entry.pinned)) - Number(Boolean(a.entry.pinned))
      || b.score - a.score
      || b.added - a.added
      || a.index - b.index)
  const entries = []
  const lines = []
  let used = 0
  for (const { entry } of candidates) {
    const line = serializeEntry(entry)
    const size = line.length + (lines.length ? 1 : 0)
    if (used + size > limit) continue
    entries.push(entry)
    lines.push(line)
    used += size
  }
  return {
    entries,
    text: lines.join('\n'),
    used,
    limit,
    total: list.length,
    omitted: list.length - entries.length,
  }
}

/**
 * Build one memory entry from a validated write.
 * @param {object} input - the write.
 * @param {string} input.id - the identity.
 * @param {string} input.text - the stored text.
 * @param {string} [input.key] - the topic key.
 * @param {boolean} [input.pinned] - whether the entry is pinned.
 * @param {string} input.scope - `team` or a Bot id.
 * @param {string} [input.source] - how it was written.
 * @param {string} [input.by] - which Bot wrote it.
 * @param {number} input.now - epoch milliseconds.
 * @returns {object} the entry.
 */
export function makeMemoryEntry({ id, text, key, pinned, scope, source, by, now }) {
  const entry = {
    id,
    scope,
    text: String(text).trim(),
    ...(key === undefined ? {} : { key }),
    pinned: pinned === true,
    addedAt: now,
    ...(source === undefined ? {} : { source }),
    ...(by === undefined ? {} : { by }),
  }
  return { ...entry, revision: entryRevision(entry) }
}
