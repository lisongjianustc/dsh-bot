/**
 * The automatic memory engine: heuristics that turn what a conversation said
 * into memory a Bot can use next time, without spending a model call.
 *
 * Two outcomes per extracted sentence:
 * - a STRONG instruction ("记住…", "以后都…", "约定…") is written straight into
 *   memory when the auto-memory switch is on (`source:'auto'`, `auto:true`);
 * - everything else — ordinary preferences, and conclusions from Bot replies —
 *   becomes a CANDIDATE. Candidates are a review queue: they are never injected
 *   into a prompt until the user accepts one.
 *
 * Extraction rules are deliberately narrow: only the user's instruction-like
 * sentences and a Bot's explicit conclusion lines (`结论：`, `决定：`, `以后都`)
 * are considered, and only scopes this conversation can justify (team, or the
 * Bot that owns the sentence).
 *
 * @module @lisongjianustc/dsh-bot/host/auto-memory
 */
import { BotError } from './errors.js'
import { clip, newId } from './util.js'

/** The longest text one candidate keeps (the memory entry limit). */
export const CANDIDATE_TEXT_MAX = 1200
/** A sentence must look like this to be considered at all. */
export const MEMORY_TRIGGER_RE = /记住|以后|约定|统一|默认|不要|必须|偏好|决定|团队|大家|规则|规范|你们|以后都/
/** A user sentence matching this is written straight into memory. */
export const MEMORY_STRONG_RE = /(请)?记住|以后都|以后一律|约定|不要再|别再|必须|统一|默认/
/** A Bot line matching this is an explicit conclusion worth proposing. */
export const MEMORY_CONCLUSION_RE = /^(结论|决定|约定)\s*[:：]|以后都|已决定/
/** The words that point a memory at team scope rather than one Bot. */
export const TEAM_SCOPE_RE = /团队|大家|统一|约定|我们|全体/
/** The words that point a memory at the Bot that is speaking. */
export const BOT_SCOPE_RE = /你以后|你的规则|你的职责|你负责/

/** Split a text into trimmed sentences without dropping their terms. */
export function splitSentences(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[。！？!?；;\n])/u)
    .map(sentence => sentence.replace(/^[\s\-*•\d.、)）]+/u, '').trim())
    .filter(sentence => sentence !== '')
}

/** Normalize a memory text for comparison (case, spacing, punctuation). */
export function normalizeMemoryText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
    .replace(/[。！？!?；;，,、.:：]+$/u, '')
    .trim()
}

/** Whether two memory texts say the same thing (equal or one contains the other). */
export function isSameMemory(a, b) {
  const left = normalizeMemoryText(a)
  const right = normalizeMemoryText(b)
  if (left === '' || right === '') return false
  return left === right || left.includes(right) || right.includes(left)
}

/** Decide the scope one extracted sentence belongs to. */
function scopeOf(sentence, bot, fromBot) {
  const botName = String(bot?.name ?? '')
  const namesBot = botName !== '' && sentence.includes(botName)
  if (namesBot || BOT_SCOPE_RE.test(sentence)) return { scope: 'bot', botId: bot?.id }
  if (TEAM_SCOPE_RE.test(sentence)) return { scope: 'team' }
  if (fromBot && /我以后|我会|我的职责|我负责/.test(sentence)) return { scope: 'bot', botId: bot?.id }
  return { scope: 'team' }
}

/**
 * Extract candidate drafts from one finished turn. Pure: no store, no host.
 * @param {{ userText?: string, botText?: string, bot?: object, chatId?: string, messageId?: string }} input - the turn texts.
 * @returns {object[]} the drafts.
 */
export function extractCandidates({ userText = '', botText = '', bot, chatId, messageId } = {}) {
  const drafts = []
  const add = (text, scope, reason, strong, confidence) => {
    const body = clip(String(text ?? '').trim(), CANDIDATE_TEXT_MAX)
    if (body === '') return
    if (drafts.some(draft => isSameMemory(draft.text, body) && draft.scope === scope.scope)) return
    drafts.push({
      text: body,
      scope: scope.scope,
      ...(scope.botId === undefined ? {} : { botId: scope.botId }),
      reason,
      strong,
      confidence,
    })
  }
  for (const sentence of splitSentences(userText)) {
    if (!MEMORY_TRIGGER_RE.test(sentence)) continue
    add(sentence, scopeOf(sentence, bot, false), 'user-instruction', MEMORY_STRONG_RE.test(sentence), 0.9)
  }
  for (const sentence of splitSentences(botText)) {
    if (!MEMORY_CONCLUSION_RE.test(sentence)) continue
    add(sentence, scopeOf(sentence, bot, true), 'bot-conclusion', false, 0.6)
  }
  return drafts
}

/**
 * Create the engine over one ledger.
 * @param {{ ctx: object, services: object, store: object }} input - wiring.
 * @returns {object} the engine.
 */
export function createAutoMemory({ ctx, services, store }) {
  void ctx
  void store
  const log = (level, message, error) => {
    const logger = ctx?.logger
    if (logger && typeof logger[level] === 'function') logger[level](`[dsh-bot] ${message}`, error)
    else if (level === 'warn' || level === 'error') console.warn(`[dsh-bot] ${message}`, error ?? '')
  }

  /** The accepted memory entries of one candidate scope. */
  const entriesOf = (scope, botId) => {
    if (scope === 'team') return services.memory.list({ scope: 'team' })
    return services.memory.list({ scope: 'bot', botId, targetBotId: botId })
  }

  /** Whether the scope already holds this text (memory or pending candidate). */
  const isDuplicate = (scope, botId, text) => {
    if (entriesOf(scope, botId).some(entry => isSameMemory(entry.text, text))) return true
    return services.memoryCandidates.list()
      .filter(candidate => candidate.scope === scope && (scope === 'team' || candidate.botId === botId))
      .some(candidate => isSameMemory(candidate.text, text))
  }

  /** Queue one draft as a candidate (never injected until accepted). */
  const queueCandidate = async (draft, { chatId, messageId }) => {
    const candidate = {
      id: newId('cand'),
      scope: draft.scope,
      ...(draft.scope === 'bot' ? { botId: draft.botId } : {}),
      text: draft.text,
      reason: draft.reason,
      source: { chatId, ...(messageId === undefined ? {} : { messageId }) },
      confidence: draft.confidence,
      createdAt: Date.now(),
    }
    return await services.memoryCandidates.add(candidate)
  }

  /**
   * Consider one finished turn.
   * @param {{ chat: object, bot: object, userText?: string, botText?: string, messageId?: string }} input - the turn.
   * @returns {Promise<{ accepted: string[], queued: string[] }>} what happened.
   */
  const consider = async ({ chat, bot, userText = '', botText = '', messageId }) => {
    const accepted = []
    const queued = []
    if (bot === undefined || chat === undefined) return { accepted, queued }
    const drafts = extractCandidates({ userText, botText, bot, chatId: chat.id, messageId })
    for (const draft of drafts) {
      const botId = draft.scope === 'bot' ? (draft.botId ?? bot.id) : undefined
      if (isDuplicate(draft.scope, botId, draft.text)) continue
      if (draft.strong === true && services.autoMemoryEnabled()) {
        try {
          await services.memory.remember({
            scope: draft.scope,
            text: draft.text,
            ...(draft.scope === 'bot' ? { botId, targetBotId: botId } : { botId: bot.id }),
            by: bot.name,
            source: 'auto',
            auto: true,
          })
          accepted.push(draft.text)
          continue
        } catch (error) {
          log('warn', 'an automatic memory write was refused; it becomes a candidate instead', error)
        }
      }
      const candidate = await queueCandidate(draft, { chatId: chat.id, messageId })
      queued.push(candidate.id)
    }
    return { accepted, queued }
  }

  /**
   * Accept one candidate into real memory.
   * @param {{ candidateId: string, text?: string, by?: string }} input - the acceptance.
   * @returns {Promise<object>} the accepted entry and the remaining candidates.
   */
  const accept = async ({ candidateId, text, by }) => {
    const candidate = services.memoryCandidates.require(candidateId)
    const body = clip(String(text ?? candidate.text), CANDIDATE_TEXT_MAX)
    let result
    try {
      result = await services.memory.remember({
        scope: candidate.scope,
        text: body,
        ...(candidate.scope === 'bot' ? { botId: candidate.botId, targetBotId: candidate.botId } : {}),
        source: 'candidate',
        by: by ?? 'user',
      })
    } catch (error) {
      if (error instanceof BotError) throw error
      throw new BotError('internal', `the candidate could not be accepted: ${String(error?.message ?? error)}`, { cause: error })
    }
    await services.memoryCandidates.remove(candidate.id)
    return { entry: result.entry, entries: result.entries, candidates: services.memoryCandidates.list() }
  }

  /** Reject one candidate: it is simply dropped. */
  const reject = async ({ candidateId }) => {
    const removed = await services.memoryCandidates.remove(candidateId)
    if (removed === undefined) throw new BotError('invalid-request', `no memory candidate matches "${String(candidateId ?? '')}"`)
    return { removed, candidates: services.memoryCandidates.list() }
  }

  return {
    consider,
    accept,
    reject,
    list: () => services.memoryCandidates.list(),
    /** The engine holds no timers; disposal exists for symmetry with the runtime. */
    dispose() {},
  }
}
