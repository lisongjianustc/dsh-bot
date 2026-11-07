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
import { mentionsIn } from './mention.js'
import { clip, newId } from './util.js'

/** The longest text one candidate keeps (the memory entry limit). */
export const CANDIDATE_TEXT_MAX = 1200
/** A sentence must look like this to be considered at all. */
export const MEMORY_TRIGGER_RE = /记住|以后|约定|统一|默认|不要|必须|偏好|决定|团队|大家|规则|规范|你们|以后都/
/**
 * A user sentence matching this is written straight into memory. The Bot-directed
 * phrasings ("你以后回答…") are strong too: they are a direct standing order to
 * one Bot, not a vague team preference.
 */
export const MEMORY_STRONG_RE = /(请)?记住|以后都|以后一律|约定|不要再|别再|必须|统一|默认|你以后|请你以后|以后回答|以后回复|以后尽量/
/** A Bot line matching this is an explicit conclusion worth proposing. */
export const MEMORY_CONCLUSION_RE = /^(结论|决定|约定)\s*[:：]|以后都|已决定/
/** The words that point a memory at team scope rather than one Bot. */
export const TEAM_SCOPE_RE = /团队|大家|统一|约定|我们|全体/
/** The words that point a memory at the Bot that is speaking. */
export const BOT_SCOPE_RE = /你以后|请你以后|以后回答|以后回复|以后尽量|你的规则|你的职责/
/**
 * Operational instructions about THIS reply are not memory. "不要调用工具",
 * "用一句话说明", "只回复…" say how to answer now, not what to remember, and they
 * would otherwise be captured as a standing rule.
 */
export const PROGRAMMATIC_RE = /(不要|别|不用|请勿)(调用|使用|用)?工具|用一句话|一句话(说明|回答|总结)|只(回复|回答|说|输出)|请回复|请回答|告诉我|回答我|回复我|简短回答|不要解释|不要展开|不要等待|别等/

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

/** Whether a sentence is an operational instruction about this answer. */
export function isProgrammaticSentence(sentence) {
  return PROGRAMMATIC_RE.test(String(sentence ?? ''))
}

/** Decide the scope one Bot conclusion belongs to. */
function conclusionScope(sentence, bot) {
  if (/我以后|我会|我的职责|我负责/.test(sentence)) return { scope: 'bot', botId: bot?.id }
  void TEAM_SCOPE_RE
  return { scope: 'team' }
}

/**
 * Extract the memory drafts of one USER message.
 *
 * A group message is attributed by EXPLICIT mention only: exactly one mentioned
 * member owns the memory; several mentions or none make it a single team
 * memory. Nothing is generalized from phrases like "你负责" — that was what
 * produced one identical candidate per speaker. Programmatic sentences ("用一句
 * 话说明…") are ignored entirely.
 * @param {{ userText?: string, bot?: object, group?: object, members?: {id: string, name: string}[] }} input - the message.
 * @returns {object[]} the drafts.
 */
export function extractUserCandidates({ userText = '', bot, group, members = [] } = {}) {
  const drafts = []
  const seen = new Set()
  const scopeFor = (sentence) => {
    if (group !== undefined && group !== null) {
      const mentioned = mentionsIn(sentence, members)
      if (mentioned.length === 1) return { scope: 'bot', botId: mentioned[0] }
      return { scope: 'team' }
    }
    const botName = String(bot?.name ?? '')
    if ((botName !== '' && sentence.includes(botName)) || BOT_SCOPE_RE.test(sentence)) {
      return { scope: 'bot', botId: bot?.id }
    }
    return { scope: 'team' }
  }
  for (const sentence of splitSentences(userText)) {
    if (isProgrammaticSentence(sentence)) continue
    if (!MEMORY_TRIGGER_RE.test(sentence)) continue
    const scope = scopeFor(sentence)
    const key = `${scope.scope}:${scope.botId ?? ''}:${normalizeMemoryText(sentence)}`
    if (seen.has(key)) continue
    seen.add(key)
    drafts.push({
      text: clip(sentence, CANDIDATE_TEXT_MAX),
      scope: scope.scope,
      ...(scope.botId === undefined ? {} : { botId: scope.botId }),
      reason: 'user-instruction',
      strong: MEMORY_STRONG_RE.test(sentence),
      confidence: 0.9,
    })
  }
  return drafts
}

/** Extract the conclusion drafts of one Bot reply. */
export function extractBotCandidates({ botText = '', bot } = {}) {
  const drafts = []
  for (const sentence of splitSentences(botText)) {
    if (!MEMORY_CONCLUSION_RE.test(sentence)) continue
    const scope = conclusionScope(sentence, bot)
    drafts.push({
      text: clip(sentence, CANDIDATE_TEXT_MAX),
      scope: scope.scope,
      ...(scope.botId === undefined ? {} : { botId: scope.botId }),
      reason: 'bot-conclusion',
      strong: false,
      confidence: 0.6,
    })
  }
  return drafts
}

/**
 * Extract candidate drafts from one private-chat turn (user text + Bot text).
 * Pure: no store, no host.
 * @param {{ userText?: string, botText?: string, bot?: object, chatId?: string, messageId?: string }} input - the turn texts.
 * @returns {object[]} the drafts.
 */
export function extractCandidates({ userText = '', botText = '', bot } = {}) {
  const drafts = [
    ...extractUserCandidates({ userText, bot }),
    ...extractBotCandidates({ botText, bot }),
  ]
  const unique = []
  for (const draft of drafts) {
    if (unique.some(existing => existing.scope === draft.scope && (existing.botId ?? '') === (draft.botId ?? '') && isSameMemory(existing.text, draft.text))) continue
    unique.push(draft)
  }
  return unique
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

  /**
   * Whether a scope already holds this text, as memory or as a pending candidate.
   * The candidate check is deliberately GLOBAL: the same sentence queued for one
   * Bot must not be queued again for every other speaker.
   */
  const isDuplicate = (scope, botId, text) => {
    if (entriesOf(scope, botId).some(entry => isSameMemory(entry.text, text))) return true
    return services.memoryCandidates.list().some(candidate => isSameMemory(candidate.text, text))
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

  /** Write or queue one batch of drafts against the same turn. */
  const persistDrafts = async (drafts, { chat, messageId, byBot }) => {
    const accepted = []
    const queued = []
    for (const draft of drafts) {
      const botId = draft.scope === 'bot' ? (draft.botId ?? byBot?.id) : undefined
      const author = draft.scope === 'bot' ? (services.bots.get(botId)?.name ?? byBot?.name) : byBot?.name
      if (isDuplicate(draft.scope, botId, draft.text)) continue
      if (draft.strong === true && services.autoMemoryEnabled()) {
        try {
          await services.memory.remember({
            scope: draft.scope,
            text: draft.text,
            ...(draft.scope === 'bot' ? { botId, targetBotId: botId } : { botId: byBot?.id }),
            ...(author === undefined ? {} : { by: author }),
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
   * Consider one finished private-chat turn (user text and Bot text).
   * @param {{ chat: object, bot: object, userText?: string, botText?: string, messageId?: string }} input - the turn.
   * @returns {Promise<{ accepted: string[], queued: string[] }>} what happened.
   */
  const consider = async ({ chat, bot, userText = '', botText = '', messageId }) => {
    if (bot === undefined || chat === undefined) return { accepted: [], queued: [] }
    const drafts = extractCandidates({ userText, botText, bot })
    return await persistDrafts(drafts, { chat, messageId, byBot: bot })
  }

  /**
   * Consider the USER message of a group round, exactly once.
   *
   * The dispatcher calls this at the start of a round, before any member turn.
   * Individual member turns therefore never re-extract the same user text, which
   * is what produced one identical candidate per speaker.
   * @param {{ chat: object, group: object, userText: string, messageId?: string }} input - the round.
   * @returns {Promise<{ accepted: string[], queued: string[] }>} what happened.
   */
  const considerUser = async ({ chat, group, userText = '', messageId }) => {
    if (chat === undefined || group === undefined) return { accepted: [], queued: [] }
    const members = (group.memberIds ?? [])
      .map(id => services.bots.get(id))
      .filter(Boolean)
      .map(bot => ({ id: bot.id, name: bot.name }))
    const drafts = extractUserCandidates({ userText, group, members })
    const admin = services.bots.get(group.adminId)
    return await persistDrafts(drafts, { chat, messageId, byBot: admin })
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
    considerUser,
    accept,
    reject,
    list: () => services.memoryCandidates.list(),
    /** The engine holds no timers; disposal exists for symmetry with the runtime. */
    dispose() {},
  }
}
