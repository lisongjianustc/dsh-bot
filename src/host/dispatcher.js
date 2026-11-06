/**
 * The conversation orchestrator: why a given Bot speaks, in which order, and
 * when a group stops talking.
 *
 * Private chat: one user message drives one turn of that Bot. Group chat: the
 * same user message drives a queue of members — mentions first, otherwise the
 * group's reply mode — and every reply may mention the next speaker. The chain
 * stops on `[PASS]`, on the group's hop limit (with one convergence turn), on a
 * loop that repeats itself without tool progress, or on cancellation.
 *
 * The relay rules live in mention.js and are pure; this module is the only place
 * that spends a turn, and it serialises per chat and bounds top-level rounds.
 *
 * @module @lisongjianustc/dsh-bot/host/dispatcher
 */
import { BotError, describeError } from './errors.js'
import {
  CONVERGE_MARK,
  groupQueue,
  handoverSummary,
  hopLimit,
  isPass,
  mentionsIn,
  tailSummary,
} from './mention.js'
import { composeTurnText } from './prompt.js'
import { clip } from './util.js'

/** How many chat rounds may run at once. */
export const TOP_LEVEL_SLOTS = 3
/** How many turns one Bot may have queued (the running one included). */
export const PER_BOT_QUEUE = 4
/** How long a relay conclusion may be. */
const CONCLUSION_MAX = 600

/** The text a user-visible message carries. */
function textOfMessage(message) {
  if (typeof message?.text === 'string' && message.text !== '') return message.text
  const part = message?.parts?.find(candidate => candidate.type === 'text')
  return typeof part?.text === 'string' ? part.text : ''
}

/** One semaphore over rounds. */
function createSlots(max) {
  let active = 0
  const waiters = []
  return {
    async run(task) {
      if (active >= max) await new Promise(resolve => waiters.push(resolve))
      active += 1
      try {
        return await task()
      } finally {
        active -= 1
        const next = waiters.shift()
        if (next !== undefined) next()
      }
    },
    get active() {
      return active
    },
    get queued() {
      return waiters.length
    },
  }
}

/**
 * Create the dispatcher.
 * @param {{ ctx: object, services: object, runtime: object }} input - wiring.
 * @returns {object} the dispatcher.
 */
export function createDispatcher({ ctx, services, runtime }) {
  const rounds = createSlots(TOP_LEVEL_SLOTS)
  /** chatId -> tail promise of that chat's serial chain. */
  const chains = new Map()
  /** chatId -> cancellation generation. */
  const generations = new Map()
  /** botId -> queued/active count. */
  const botLoad = new Map()
  /** chatId -> { cancelled: boolean } for group loops. */
  const groupLoops = new Map()
  let disposed = false

  const noticeLanguage = () => (typeof services.language === 'function' ? services.language() : 'zh')

  const log = (level, message, error) => {
    const logger = ctx?.logger
    if (logger && typeof logger[level] === 'function') logger[level](`[dsh-bot] ${message}`, error)
    else if (level === 'warn' || level === 'error') console.warn(`[dsh-bot] ${message}`, error ?? '')
  }

  const bumpBotLoad = (botId, delta) => {
    const next = (botLoad.get(botId) ?? 0) + delta
    if (next <= 0) botLoad.delete(botId)
    else botLoad.set(botId, next)
    return next
  }

  /** Enqueue one chat round behind the previous one, dropping cancelled work. */
  const enqueue = (chatId, task) => {
    const generation = generations.get(chatId) ?? 0
    const previous = chains.get(chatId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (disposed) return
        if ((generations.get(chatId) ?? 0) !== generation) return
        await task()
      })
      .catch((error) => {
        log('warn', `a chat round failed: ${describeError(error)}`, error)
      })
    chains.set(chatId, next)
    void next.finally(() => {
      if (chains.get(chatId) === next) chains.delete(chatId)
    })
    return next
  }

  /** The members of one group, as the mention parser wants them. */
  const membersOf = (group) => (group?.memberIds ?? [])
    .map(id => services.bots.get(id))
    .filter(Boolean)

  // ------------------------------------------------------------------- DM
  const driveDm = async (chat, bot, text) => {
    const prompt = composeTurnText({
      services,
      language: 'zh',
      bot,
      chat,
      input: text,
      query: text,
    })
    bumpBotLoad(bot.id, 1)
    try {
      const result = await rounds.run(() => runtime.send({ chat, bot, text: prompt.text, kind: 'chat' }))
      if (result.status !== 'aborted') await prompt.commit()
      return result
    } finally {
      bumpBotLoad(bot.id, -1)
    }
  }

  // ---------------------------------------------------------------- group
  const driveGroup = async (chat, group, sourceText) => {
    const loop = { cancelled: false }
    groupLoops.set(chat.id, loop)
    const generation = generations.get(chat.id) ?? 0
    let hops = 0
    const limit = hopLimit(group)
    let lastConclusion
    const noteRound = []
    const seen = new Set()
    let paused
    let converged
    const queue = groupQueue(group, services.bots.list(), sourceText)
    const lastResult = { status: 'pass', text: '', toolCount: 0 }
    try {
      while (queue.length > 0 && !loop.cancelled && !disposed && (generations.get(chat.id) ?? 0) === generation) {
        if (limit > 0 && hops >= limit) {
          converged = { max: limit }
          queue.length = 0
          break
        }
        const botId = queue.shift()
        const bot = services.bots.get(botId)
        const fresh = services.groups.get(group.id)
        if (bot === undefined || fresh === undefined || !fresh.memberIds.includes(botId)) continue
        const handover = fresh.handover === true && lastConclusion !== undefined
          ? { from: lastConclusion.name, text: handoverSummary({ reply: lastConclusion.text }) }
          : undefined
        const prompt = composeTurnText({
          services,
          language: 'zh',
          bot,
          chat,
          group: fresh,
          handover,
          query: '',
        })
        hops += 1
        bumpBotLoad(bot.id, 1)
        let result
        try {
          result = await rounds.run(() => runtime.send({ chat, bot, text: prompt.text, kind: 'group' }))
        } finally {
          bumpBotLoad(bot.id, -1)
        }
        Object.assign(lastResult, result)
        if (loop.cancelled) break
        if (result.status === 'error') {
          // One member failed; the chat already shows its error. The round goes on,
          // and the admin picks it up when nobody else is queued.
          if (queue.length === 0 && fresh.adminId && fresh.adminId !== bot.id && fresh.memberIds.includes(fresh.adminId)) {
            queue.push(fresh.adminId)
          }
          continue
        }
        if (result.status === 'aborted') break
        if (result.status !== 'done' && result.status !== 'pass') break
        await prompt.commit()
        if (result.status === 'pass' || isPass(result.text)) continue
        if (result.text !== '') {
          lastConclusion = { botId: bot.id, name: bot.name, text: clip(result.text, CONCLUSION_MAX), ts: Date.now() }
          noteRound.push({ speaker: bot.name, text: result.text })
        }
        const next = mentionsIn(result.text, membersOf(fresh), bot.id)
        if (limit > 0 && hops >= limit && next.length > 0) {
          converged = { max: limit }
          break
        }
        for (const id of next) if (!queue.includes(id)) queue.push(id)
        const signature = JSON.stringify([bot.id, result.text, next])
        if (next.length > 0 && (result.toolCount ?? 0) === 0 && seen.has(signature)) {
          paused = 'no_progress'
          break
        }
        if ((result.toolCount ?? 0) > 0) seen.clear()
        else seen.add(signature)
      }
      if (converged !== undefined) {
        await convergeGroup(chat, group, converged, lastConclusion, noteRound)
      }
      const noted = await services.groups.recordNote(group.id, noteRound)
      if (noted !== undefined) {
        try {
          runtime.publish?.({ type: 'state', state: await services.fullStateView() })
        } catch (error) {
          log('warn', 'the group state frame could not be published', error)
        }
      }
      if (paused === 'no_progress') {
        const notice = await services.messages.system(chat.id, noticeLanguage() === 'en'
          ? 'This relay is repeating itself without progress, so the round was paused. Send a new message to start again.'
          : '这轮接力在原地重复、没有进展，已暂停。发一条新消息即可重新开始。')
        runtime.publish?.({ type: 'message', message: notice })
      }
      return { ...lastResult, hops, converged, paused, noteRound }
    } finally {
      if (groupLoops.get(chat.id) === loop) groupLoops.delete(chat.id)
      loop.cancelled = true
    }
  }

  /** The hop limit was reached: tell the group, then let the last speaker wrap up. */
  const convergeGroup = async (chat, group, info, last, noteRound) => {
    const notice = await services.messages.system(chat.id, noticeLanguage() === 'en'
      ? `This relay reached its hop limit (${info.max}), so the round converges here.`
      : `本轮接力达到上限（${info.max} 跳），因此在这里收敛。`)
    runtime.publish?.({ type: 'message', message: notice })
    if (last === undefined) return
    const bot = services.bots.get(last.botId)
    if (bot === undefined) return
    const prompt = composeTurnText({
      services,
      language: 'zh',
      bot,
      chat,
      group,
      converge: noticeLanguage() === 'en'
        ? `This relay reached its hop limit (${info.max}). Wrap up now: state the conclusion in one short message and do not mention another Bot.`
        : `本轮接力已达到上限（${info.max} 跳）。请收口：用一条简短消息给出结论，不要再 @ 其他 Bot。`,
      query: '',
    })
    bumpBotLoad(bot.id, 1)
    try {
      const result = await rounds.run(() => runtime.send({ chat, bot, text: prompt.text, kind: 'group' }))
      if (result.status === 'done' || result.status === 'pass') {
        await prompt.commit()
        if (result.text !== '') noteRound.push({ speaker: bot.name, text: result.text })
      } else if (result.status === 'error') {
        log('warn', 'the convergence turn failed; the hop-limit notice stands on its own', result.error)
      }
    } finally {
      bumpBotLoad(bot.id, -1)
    }
  }

  // ---------------------------------------------------------------- public
  /**
   * Accept one user message and drive the chat in the background.
   * @param {object} chat - the chat record.
   * @param {object} message - the just-appended user message.
   * @returns {Promise<{ accepted: boolean }>} acceptance (delivery is async).
   */
  const handle = async (chat, message) => {
    if (disposed) throw new BotError('session-unavailable', 'the bot dispatcher is shutting down')
    const text = textOfMessage(message)
    if (text.trim() === '') throw new BotError('invalid-request', 'an empty message cannot be sent')
    if (chat.kind === 'dm') {
      const bot = services.bots.require(chat.botId)
      if ((botLoad.get(bot.id) ?? 0) >= PER_BOT_QUEUE) {
        throw new BotError('session-busy', `bot "${bot.name}" already has ${PER_BOT_QUEUE} turns queued`)
      }
      enqueue(chat.id, () => driveDm(chat, bot, text))
      return { accepted: true }
    }
    const group = services.groups.require(chat.groupId)
    if (group.memberIds.length === 0) throw new BotError('invalid-request', 'this group has no members to answer')
    enqueue(chat.id, () => driveGroup(chat, group, text))
    return { accepted: true }
  }

  /**
   * Cancel whatever runs in one chat, and drop its queued rounds.
   * @param {string} chatId - the conversation.
   * @returns {Promise<boolean>} whether anything was running.
   */
  const cancel = async (chatId) => {
    generations.set(chatId, (generations.get(chatId) ?? 0) + 1)
    const loop = groupLoops.get(chatId)
    if (loop !== undefined) loop.cancelled = true
    return await runtime.cancel(chatId)
  }

  /** Wait for one chat's serial chain to settle (tests and routes that need it). */
  const idle = async (chatId) => {
    const tail = chains.get(chatId)
    if (tail !== undefined) await tail
  }

  /**
   * `message_bot`: ask one Bot, from another Bot, and wait for its answer.
   * The answer is the tool value, so the caller does not need a second turn.
   */
  const messageBot = async ({ callerBotId, to, text }) => {
    const caller = services.bots.require(callerBotId)
    const target = services.bots.get(to)
    if (target === undefined) throw new BotError('bot-not-found', `no bot matches "${String(to ?? '')}"`)
    if (target.id === caller.id) throw new BotError('invalid-request', 'a bot cannot message itself')
    const body = String(text ?? '').trim()
    if (body === '') throw new BotError('invalid-request', 'the message is blank')
    const chat = await services.chats.ensureDm(target)
    const relay = await services.messages.append(chat.id, {
      role: 'relay',
      botId: caller.id,
      text: body,
      status: 'done',
      parts: [{ type: 'text', text: body }],
    })
    runtime.publish?.({ type: 'message', message: relay })
    runtime.publish?.({ type: 'chat', chat: services.chats.view(chat) })
    if ((botLoad.get(target.id) ?? 0) >= PER_BOT_QUEUE) {
      throw new BotError('session-busy', `bot "${target.name}" already has ${PER_BOT_QUEUE} turns queued`)
    }
    const prompt = composeTurnText({ services, language: 'zh', bot: target, chat, input: body, query: body })
    bumpBotLoad(target.id, 1)
    try {
      const result = await rounds.run(() => runtime.send({ chat, bot: target, text: prompt.text, kind: 'relay' }))
      if (result.status === 'done' || result.status === 'pass') await prompt.commit()
      return {
        ok: true,
        from: target.name,
        to: caller.name,
        status: result.status,
        text: result.text,
      }
    } finally {
      bumpBotLoad(target.id, -1)
    }
  }

  /**
   * `post_group`: a Bot asks a group to discuss something and gets the round back.
   */
  const postGroup = async ({ callerBotId, group: groupRef, text }) => {
    const caller = services.bots.require(callerBotId)
    const group = services.groups.require(groupRef)
    if (!group.memberIds.includes(caller.id)) {
      throw new BotError('invalid-request', `bot "${caller.name}" is not a member of "${group.name}"`)
    }
    const body = String(text ?? '').trim()
    if (body === '') throw new BotError('invalid-request', 'the group message is blank')
    const chat = await services.chats.ensureGroup(group)
    const relay = await services.messages.append(chat.id, {
      role: 'relay',
      botId: caller.id,
      text: body,
      status: 'done',
      parts: [{ type: 'text', text: body }],
    })
    runtime.publish?.({ type: 'message', message: relay })
    runtime.publish?.({ type: 'chat', chat: services.chats.view(chat) })
    return await driveGroup(chat, group, body)
  }

  const dispose = () => {
    disposed = true
    for (const loop of groupLoops.values()) loop.cancelled = true
    groupLoops.clear()
  }

  return {
    handle,
    cancel,
    idle,
    messageBot,
    postGroup,
    dispose,
    /** Test seam: how many Bot turns are counted as queued. */
    loadOf(botId) {
      return botLoad.get(botId) ?? 0
    },
    get slotState() {
      return { active: rounds.active, queued: rounds.queued }
    },
    CONVERGE_MARK,
    tailSummary,
  }
}
