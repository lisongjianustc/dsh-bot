/**
 * Group-relay rules, ported from the MiniMax Bot engine and kept pure so every
 * rule can be tested without a Host or a model:
 *
 * - `@`-mention parsing that treats CJK/full-width text as spaceless script, so
 *   `请@某人` is a mention while `mail@alice.com` is not (`engine.mjs:1199-1223`);
 * - the speak queue: mentions first, otherwise the group's reply mode
 *   (`engine.mjs:1230-1238`);
 * - `[PASS]` (`engine.mjs:107`);
 * - the hop limit, the convergence turn and the handover summary
 *   (`relay-guard.mjs`);
 * - the bounded group note (`group-note.mjs`).
 *
 * The bilingual prompt sentences live in prompt.js; this module only decides who
 * speaks and what text rides along.
 *
 * @module @lisongjianustc/dsh-bot/host/mention
 */
import { neutralizeMarks } from './util.js'

/** The one-line `[PASS]`: a Bot that has nothing to add skips its turn. */
export const PASS_RE = /^\s*\[?PASS\]?\s*[.。]?\s*$/i

/** The largest hop limit a group may hold. 0 means "no limit". */
export const HOP_LIMIT_MAX = 20
/** The largest per-round speaker cap a group may hold. 0 means "no limit". */
export const GROUP_SPEAKERS_MAX = 20
/** The speaker cap a group uses when it does not configure one. */
export const GROUP_SPEAKERS_DEFAULT = 3

/** Longest summary handed over to the next hop. */
export const HANDOVER_MAX = 600
/** How much of the previous reply's tail is kept when the group keeps no note. */
export const HANDOVER_TAIL = 400

/** Opens the block that carries the previous hop's conclusion. */
export const HANDOVER_MARK = '<dsh-bot-handover>'
/** Closes the block that carries the previous hop's conclusion. */
export const HANDOVER_END = '</dsh-bot-handover>'
/** Marks the prompt that asks the current speaker to wrap the round up. */
export const CONVERGE_MARK = '<dsh-bot-relay-converge>'
/** Opens the block that carries the group's note. */
export const GROUP_NOTE_MARK = '<dsh-bot-group-summary>'
/** Closes the block that carries the group's note. */
export const GROUP_NOTE_END = '</dsh-bot-group-summary>'
/** Opens the block that carries a Bot's standing context. */
export const CONTEXT_BLOCK_MARK = '<dsh-bot-context>'
/** Closes the block that carries a Bot's standing context. */
export const CONTEXT_BLOCK_END = '</dsh-bot-context>'

/** How many entries the note keeps. The newest ones win. */
export const NOTE_MAX_ENTRIES = 6
/** How many characters the whole note may take. */
export const NOTE_MAX_CHARS = 1200
/** How many characters one entry may take. */
export const NOTE_ENTRY_MAX = 240
/** How many characters the name of a speaker may take. */
export const NOTE_SPEAKER_MAX = 60

/** How many messages one group snapshot may carry. */
export const GROUP_CONTEXT_MESSAGES = 30
/** How long one message may be inside a group snapshot. */
export const GROUP_LINE_MAX = 4000

/** A word character of any script: it ends a name, so "Alicex" is not "Alice". */
const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u
/**
 * Chinese, Japanese kana, Korean, Thai, Lao, Khmer and Myanmar write a word right
 * up against `@` without a space, and a full-width IME produces the same shape;
 * a character of those scripts does not belong to an email address.
 */
const SPACELESS_CHAR = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Thai}\p{Script_Extensions=Lao}\p{Script_Extensions=Khmer}\p{Script_Extensions=Myanmar}\uFF00-\uFFEF]/u

/**
 * Whether one character is a word character.
 * @param {string} value - a single character.
 * @returns {boolean} true for a letter, number, mark or underscore.
 */
export function isWordChar(value) {
  return Boolean(value) && WORD_CHAR.test(value)
}

/**
 * Whether one character is written without spaces around it.
 * @param {string} value - a single character.
 * @returns {boolean} true for CJK/kana/Hangul/SE-Asian and full-width forms.
 */
export function isSpacelessChar(value) {
  return Boolean(value) && SPACELESS_CHAR.test(value)
}

/**
 * Whether one character, directly before `@`, belongs to an email address.
 * @param {string} value - the character before `@`.
 * @returns {boolean} true when the `@` is part of an address, not a mention.
 */
export function isAddressChar(value) {
  return isWordChar(value) && !isSpacelessChar(value)
}

/**
 * Every member mentioned in a text, in order of first mention.
 *
 * Matching is case-insensitive and longest-name-first. A name must end at a
 * non-word character, so `@alicex` does not mention `alice`, and a character of
 * a spaceless script before `@` does not swallow the mention.
 * @param {string} text - the text to scan.
 * @param {{ id: string, name: string }[]} members - candidate members.
 * @param {string} [excludeId] - the speaker's own id, which is never returned.
 * @returns {string[]} mentioned member ids.
 */
export function mentionsIn(text, members, excludeId) {
  const lower = String(text ?? '').toLowerCase()
  const named = (Array.isArray(members) ? members : [])
    .filter(member => member && typeof member.name === 'string' && member.name !== '')
    .map(member => ({ id: String(member.id), name: member.name.toLowerCase() }))
    .sort((a, b) => b.name.length - a.name.length)
  const found = []
  for (let index = lower.indexOf('@'); index >= 0; index = lower.indexOf('@', index + 1)) {
    if (isAddressChar(lower[index - 1])) continue
    const member = named.find(({ name }) => lower.startsWith(name, index + 1) && !isWordChar(lower[index + 1 + name.length]))
    if (!member) continue
    if (member.id !== excludeId && !found.includes(member.id)) found.push(member.id)
    index += member.name.length
  }
  return found
}

/**
 * Whether a Bot reply is `[PASS]`.
 * @param {string} text - the reply text.
 * @returns {boolean} true when the reply means "skip me".
 */
export function isPass(text) {
  return PASS_RE.test(String(text ?? ''))
}

/**
 * The effective hop limit of a group. 0 means no limit; anything unusable also
 * reads as "no limit", so a hand-edited state file can never silence a group.
 * @param {object} group - the group record.
 * @returns {number} 0..20.
 */
export function hopLimit(group) {
  const value = group?.maxHops
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0
    return Math.min(Math.floor(value), HOP_LIMIT_MAX)
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const raw = Number(value.trim())
    return raw > 0 ? Math.min(raw, HOP_LIMIT_MAX) : 0
  }
  return 0
}

/**
 * The effective per-round speaker cap: 0 means no limit, and an unusable value
 * falls back to the default so a hand-edited ledger cannot silence a group.
 * @param {object} group - the group record.
 * @returns {number} 0..20.
 */
export function groupSpeakers(group) {
  const value = group?.maxSpeakers
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return value === 0 ? 0 : GROUP_SPEAKERS_DEFAULT
    return Math.min(Math.floor(value), GROUP_SPEAKERS_MAX)
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const raw = Number(value.trim())
    return raw > 0 ? Math.min(raw, GROUP_SPEAKERS_MAX) : 0
  }
  return GROUP_SPEAKERS_DEFAULT
}

/**
 * Who speaks on a new group message.
 *
 * A mention is an explicit floor: only the mentioned members speak, in mention
 * order (relay @-mentions may still extend the chain under the hop limit). With
 * no mention the reply mode decides — the admin alone, or the first
 * `maxSpeakers` members in roster order (0 = everyone; otherwise nobody sits out
 * silently: the prompt says who is standing by).
 * @param {object} group - the group record.
 * @param {{ id: string, name: string }[]} bots - every Bot in the roster.
 * @param {string} text - the incoming user text.
 * @returns {string[]} Bot ids, in speaking order.
 */
export function groupQueue(group, bots, text) {
  const members = (group?.memberIds ?? [])
    .map(id => bots.find(bot => bot.id === id))
    .filter(Boolean)
  const mentioned = mentionsIn(text, members)
  if (mentioned.length) return mentioned
  const admin = members.find(bot => bot.id === group.adminId)
  if (group?.replyMode !== 'all') {
    if (admin) return [admin.id]
    return members.slice(0, 1).map(bot => bot.id)
  }
  const cap = groupSpeakers(group)
  const ordered = members.map(bot => bot.id)
  return cap === 0 ? ordered : ordered.slice(0, cap)
}

/**
 * The decision lines of one group reply: the sentences a group note should keep
 * even when the rest of the answer is chatty.
 * @param {string} text - the reply.
 * @returns {string[]} the decision sentences, in order.
 */
export function decisionSentences(text) {
  const sentences = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[。！？!?；;\n])/u)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence !== '')
  return sentences.filter(sentence => /(结论|决定|约定)\s*[:：]/u.test(sentence) || /^(结论|决定|约定)/u.test(sentence))
}

/**
 * The tail of a reply: a conclusion sits at the end of an answer.
 * @param {string} text - the reply.
 * @param {number} [max] - maximum length.
 * @returns {string} the cleaned tail.
 */
export function tailSummary(text, max = HANDOVER_TAIL) {
  const clean = neutralizeMarks(String(text ?? '')).replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (clean.length <= max) return clean
  return clean.slice(-max)
}

/**
 * The summary of the previous hop: the group note wins, else the reply tail.
 * @param {{ note?: string, reply?: string, max?: number }} input - candidate sources.
 * @returns {string} the summary, or '' when there is nothing to hand over.
 */
export function handoverSummary({ note, reply, max = HANDOVER_MAX } = {}) {
  const fromNote = neutralizeMarks(String(note ?? '')).replace(/\s+/g, ' ').trim()
  if (fromNote) return fromNote.length <= max ? fromNote : fromNote.slice(0, max)
  return tailSummary(reply, Math.min(max, HANDOVER_TAIL))
}

/**
 * The block that travels with the next hop's prompt.
 * @param {{ from?: string, text?: string }} input - who said it and what they said.
 * @returns {string} the rendered block, or '' when empty.
 */
export function renderHandover({ from, text } = {}) {
  const body = String(text ?? '').trim()
  if (!body) return ''
  const who = String(from ?? '').trim()
  return [HANDOVER_MARK, `[${who}] ${body}`, HANDOVER_END].join('\n')
}

/**
 * One entry of the group note: cleaned, one line, closing part of the reply.
 * @param {object} entry - candidate entry.
 * @returns {{ speaker: string, text: string } | undefined} the cleaned entry.
 */
function cleanNoteEntry(entry) {
  if (!entry || typeof entry !== 'object') return undefined
  const speaker = neutralizeMarks(String(entry.speaker ?? '')).replace(/\s+/g, ' ').trim()
  const text = neutralizeMarks(String(entry.text ?? '')).replace(/\s+/g, ' ').trim()
  if (!speaker || !text) return undefined
  return { speaker: speaker.slice(0, NOTE_SPEAKER_MAX), text: tailOf(text, NOTE_ENTRY_MAX) }
}

/** A Latin word character, the only kind a cut can land inside usefully. */
const LATIN_WORD = /[A-Za-z0-9_]/
/** How much of a broken word may be dropped to reach the next boundary. */
const WORD_PREFIX_MAX = 20

/**
 * The closing part of a text, cut on a word boundary when that is cheap.
 * @param {string} text - input text.
 * @param {number} [max] - maximum length.
 * @returns {string} the tail.
 */
export function tailOf(text, max = NOTE_ENTRY_MAX) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  const cut = value.length - max
  const tail = value.slice(cut)
  if (!LATIN_WORD.test(value[cut - 1] ?? '') || !LATIN_WORD.test(tail[0] ?? '')) return tail
  const fragment = /^[A-Za-z0-9_]+/.exec(tail)?.[0] ?? ''
  if (!fragment || fragment.length > WORD_PREFIX_MAX) return tail
  return tail.slice(fragment.length).replace(/^\s+/, '') || tail
}

/**
 * Keep the newest entries that still fit in the note budget.
 * @param {{ speaker: string, text: string }[]} entries - candidate entries.
 * @returns {{ speaker: string, text: string }[]} the bounded note.
 */
function boundNote(entries) {
  const kept = []
  let chars = 0
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (kept.length >= NOTE_MAX_ENTRIES) break
    const size = entry.text.length + entry.speaker.length + 3
    if (chars + size > NOTE_MAX_CHARS) break
    kept.unshift(entry)
    chars += size
  }
  return kept
}

/**
 * The cleaned, bounded note of a group.
 * @param {object} group - the group record.
 * @returns {{ speaker: string, text: string }[]} the note entries.
 */
export function noteEntries(group) {
  const list = Array.isArray(group?.noteEntries) ? group.noteEntries : []
  return boundNote(list.map(cleanNoteEntry).filter(Boolean))
}

/**
 * Add what the Bots said this round to the note.
 * @param {object} group - the group record.
 * @param {{ speaker: string, text: string }[]} round - what this round said.
 * @returns {{ speaker: string, text: string }[]} the new note.
 */
export function appendNote(group, round) {
  const existing = noteEntries(group)
  const fresh = (Array.isArray(round) ? round : []).map(cleanNoteEntry).filter(Boolean)
  const key = (text) => neutralizeMarks(String(text ?? '')).replace(/\s+/g, '').toLowerCase()
  const kept = [...existing]
  // Dedupe: an entry already said (or already contained in a longer entry) is
  // not repeated, which is what makes the automatic decision log idempotent.
  const contains = (text) => {
    const needle = key(text)
    if (needle === '') return true
    return kept.some(entry => key(entry.text).includes(needle))
  }
  for (const entry of fresh) {
    if (contains(entry.text)) continue
    kept.push(entry)
  }
  return boundNote(kept)
}

/**
 * The note block that enters every member's standing brief.
 * @param {object} group - the group record.
 * @returns {string} the rendered block, or '' when the group keeps no note.
 */
export function renderNote(group) {
  if (group?.useNote !== true) return ''
  const entries = noteEntries(group)
  if (!entries.length) return ''
  return [
    GROUP_NOTE_MARK,
    ...entries.map(entry => `[${entry.speaker}] ${entry.text}`),
    GROUP_NOTE_END,
  ].join('\n')
}

/**
 * The bounded group snapshot one member sees: messages after its own cursor,
 * never its own, and never a hole another member is still filling.
 * @param {object} input - the snapshot input.
 * @param {object[]} input.messages - the chat's messages, ascending by seq.
 * @param {number} input.lastSeenSeq - this member's cursor.
 * @param {string} input.botId - the speaking member.
 * @param {(botId: string) => { name?: string } | undefined} input.botName - roster lookup.
 * @param {number} [input.limit] - how many messages to keep.
 * @returns {{ lines: string[], cursor: number, pending: boolean }} the snapshot.
 */
export function selectGroupMessages({ messages, lastSeenSeq, botId, botName, limit = GROUP_CONTEXT_MESSAGES }) {
  const cursor = Number.isFinite(lastSeenSeq) && lastSeenSeq > 0 ? lastSeenSeq : 0
  const list = Array.isArray(messages) ? messages : []
  const readable = list.filter((message) => {
    if (!message || message.botId === botId) return false
    if (typeof message.seq !== 'number' || message.seq <= cursor) return false
    if (message.role === 'user') return message.status !== 'held' && message.status !== 'aborted' && message.status !== 'error'
    if (message.role === 'relay') return true
    if (message.role === 'bot') return message.status === 'done' || message.status === 'pass'
    return false
  })
  const recent = readable.slice(-Math.max(1, limit))
  const lines = recent.map((message) => {
    const who = message.role === 'user'
      ? 'user'
      : message.role === 'relay'
        ? (message.botName ?? 'relay')
        : (botName(message.botId)?.name ?? 'bot')
    let text = message.role === 'bot' || message.role === 'relay'
      ? message.text
      : (message.parts?.find(part => part.type === 'text')?.text ?? message.text)
    const manifest = message.role === 'user' && typeof message.attachmentManifest === 'string' ? message.attachmentManifest : ''
    if (manifest !== '') text = `${text ?? ''}\n${manifest}`
    return `[${neutralizeMarks(String(who)).slice(0, 60)}] ${neutralizeMarks(String(text ?? '')).slice(0, GROUP_LINE_MAX)}`
  })
  const lastIncluded = recent.at(-1)?.seq ?? cursor
  const hole = list.find(message => typeof message.seq === 'number' && message.seq > cursor && (
    (message.role === 'bot' && message.botId !== botId && message.status === 'streaming')
    || (message.role === 'user' && (message.status === 'pending' || message.status === 'held' || message.status === 'streaming'))
  ))
  return {
    lines,
    cursor: hole ? Math.min(lastIncluded, hole.seq - 1) : lastIncluded,
    pending: hole !== undefined,
  }
}

/**
 * The memory query of a group snapshot: the newest user or relay text, else the
 * newest line.
 * @param {object[]} messages - the readable messages, ascending.
 * @returns {string} the query text.
 */
export function groupMemoryQuery(messages) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (message?.role === 'user' || message?.role === 'relay') {
      const text = message.parts?.find(part => part.type === 'text')?.text ?? message.text
      if (text) return text
    }
  }
  return list.at(-1)?.text ?? ''
}
