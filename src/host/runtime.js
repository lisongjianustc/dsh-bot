/**
 * The Bot runtime: every Bot reply is a real DSH Agent turn.
 *
 * Responsibilities, and nothing else:
 * - create or resume the one session a (chat, bot) pair owns, pinned to the
 *   Bot's model, permission and title;
 * - admit one prompt with `sessionController.prompt(request, signal)` — the
 *   second argument is required by the host — and wait for that turn;
 * - merge one turn's events into ONE Bot message with several parts. The Host
 *   commits one `assistant/message` per model step (so once between tool calls),
 *   and the workbench renders one message with a part per step, which is the
 *   MiniMax bubble model;
 * - stream text deltas to the page, persist at a bounded cadence, record usage
 *   and publish lifecycle frames.
 *
 * Session composition prefers `ctx.agents.create({sessionId, meta, agentOptions})`
 * because `agentOptions` pins the model for that Agent only; a deployment
 * without the agent factory falls back to `sessionController.create`, where the
 * model is pinned through `agent.model.select` (never `selectModel`, which would
 * also rewrite the deployment default). `selectModel` is the last resort, and
 * only with the deployment default saved and restored around it.
 *
 * @module @lisongjianustc/dsh-bot/host/runtime
 */
import { registerApprovalAnswerers } from './approval.js'
import { BotError, describeError } from './errors.js'
import { createHelpers } from './helpers.js'
import { PASS_RE } from './mention.js'
import { clean, clip, newId } from './util.js'

/** How often live deltas are flushed to the page. */
export const DELTA_FLUSH_MS = 120
/** How often a streaming message snapshot is persisted. */
export const STREAM_PERSIST_MS = 2000
/** Default bound on one turn before it is reported as timed out. */
export const TURN_TIMEOUT_MS = 30 * 60 * 1000

/** Extract the text blocks of an assistant message's content. */
function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block && (block.type === 'text' || block.type === 'output_text') && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * One turn's message builder: it turns the event sequence into the parts of one
 * Bot message. Pure — no Host, no disk — so the merge rules can be tested.
 * @param {{ botId: string }} input - the speaking Bot.
 * @returns {object} the accumulator.
 */
export function createTurnAccumulator({ botId }) {
  const parts = []
  const toolParts = new Map()
  let live = ''
  let chars = 0
  let modelCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  return {
    botId,
    get parts() {
      return parts
    },
    get live() {
      return live
    },
    get toolCount() {
      return toolParts.size
    },
    get modelCalls() {
      return modelCalls
    },
    get usage() {
      return { inputTokens, outputTokens }
    },
    /** Append a transient text delta; the committed message replaces it. */
    addDelta(text) {
      live += String(text ?? '')
      return live
    },
    /** Commit one `assistant/message`: its text becomes one part of the Bot message. */
    commitAssistant(content, usage) {
      modelCalls += 1
      live = ''
      const text = textOfContent(content)
      if (text !== '') {
        parts.push({ type: 'text', text })
        chars += text.length
      }
      if (usage && typeof usage === 'object') {
        inputTokens += Number(usage.inputTokens) || 0
        outputTokens += Number(usage.outputTokens) || 0
      }
      return text
    },
    /** One `tool/call` starts a tool part. */
    addToolCall(callId, name) {
      const index = parts.push({ type: 'tool', name: String(name ?? 'tool'), status: 'running' }) - 1
      toolParts.set(String(callId), index)
      return index
    },
    /** One `tool/result` settles the matching tool part. */
    finishTool(callId, { ok, error }) {
      const index = toolParts.get(String(callId))
      if (index === undefined) return false
      const previous = parts[index]
      parts[index] = {
        ...previous,
        status: ok ? 'ok' : 'failed',
        ...(ok || error === undefined ? {} : { error: clip(String(error), 500) }),
      }
      return true
    },
    /**
     * Settle every tool part still `running` when the turn ends.
     *
     * A turn can end around a tool call (aborted, failed, blocked, or a Host
     * that committed no `tool/result`), and a message must never keep a part in
     * `running` after its turn is over. The status is the contract's `failed`,
     * with a bounded reason, so the panel renders a settled tool row.
     * @param {string} reason - why the call has no result.
     * @returns {number} how many parts were settled.
     */
    failRunningTools(reason) {
      let settled = 0
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index]
        if (part.type !== 'tool' || part.status !== 'running') continue
        parts[index] = {
          ...part,
          status: 'failed',
          error: clip(String(reason ?? 'the turn ended before this tool reported a result'), 500),
        }
        settled += 1
      }
      return settled
    },
    /** One non-text event worth showing (a system notice, a convergence note). */
    addEvent(text) {
      const body = String(text ?? '')
      if (body === '') return
      parts.push({ type: 'event', text: body })
    },
    /** The message text: the text parts, in order. */
    text() {
      return parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n').trim()
    },
    /** The persisted snapshot of this turn so far. */
    snapshot() {
      return {
        parts: parts.map(part => ({ ...part })),
        text: this.text(),
        chars,
      }
    },
  }
}

/**
 * Map one `turn/end.reason` to the message status the workbench renders.
 * @param {object} reason - the turn end reason.
 * @param {string} finalText - the turn's final text.
 * @param {number} toolCount - how many tool calls the turn made.
 * @param {'zh'|'en'} [language] - the ledger language for settle explanations.
 * @returns {{ status: string, error?: string }} the message status.
 */
export function mapTurnEndReason(reason, finalText, toolCount, language = 'en') {
  const zh = language === 'zh'
  const kind = reason?.kind
  if (kind === 'completed') {
    if (toolCount === 0 && PASS_RE.test(String(finalText ?? ''))) return { status: 'pass' }
    return { status: 'done' }
  }
  if (kind === 'aborted') return { status: 'aborted' }
  if (kind === 'error') {
    return {
      status: 'error',
      error: clip(String(reason?.error?.message ?? (zh ? '模型调用失败' : 'the model call failed')), 800),
    }
  }
  if (kind === 'max-tokens') return { status: 'done' }
  if (kind === 'interrupted') {
    return { status: 'error', error: zh ? '本轮在完成前被中断' : 'the turn was interrupted before it finished' }
  }
  if (kind === 'blocked') {
    return { status: 'error', error: zh ? '本轮在回答前被拦截' : 'the turn was blocked before it could answer' }
  }
  if (kind === 'forked') return { status: 'aborted' }
  return { status: 'done' }
}

/**
 * Create the Bot runtime.
 * @param {{ ctx: object, store: object, services: object, hub: object, config?: object }} input - wiring.
 * @returns {object} the runtime.
 */
export function createRuntime({ ctx, store, services, hub, config = {} }) {
  void store
  const controller = ctx.sessionController
  const turnTimeoutMs = Number(config.turnTimeoutMs) > 0 ? Number(config.turnTimeoutMs) : TURN_TIMEOUT_MS
  /** sessionId -> turn state */
  const active = new Map()
  /** chatId -> turn state */
  const activeByChat = new Map()
  /** sessionId -> Promise<state> while an unowned turn's message is being created */
  const starting = new Map()
  const listeners = new Set()
  const disposers = []
  let disposed = false
  /** The background-helper manager, attached after the runtime facade exists. */
  let helpersApi

  const log = (level, message, error) => {
    const logger = ctx?.logger
    if (logger && typeof logger[level] === 'function') logger[level](`[dsh-bot] ${message}`, error)
    else if (level === 'warn' || level === 'error') console.warn(`[dsh-bot] ${message}`, error ?? '')
  }

  const emit = (payload) => {
    hub?.publish?.(payload)
    for (const listener of listeners) {
      try {
        listener(payload)
      } catch (error) {
        log('warn', 'a runtime event listener failed', error)
      }
    }
  }

  const chatView = (chatId) => {
    const chat = services.chats.get(chatId)
    return chat === undefined ? undefined : services.chats.view(chat)
  }

  const publishChat = (chatId) => {
    const chat = chatView(chatId)
    if (chat !== undefined) emit({ type: 'chat', chat })
  }

  // ----------------------------------------------------------- model pinning
  const agentOf = (sessionId) => {
    const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
    if (agents !== undefined && agents !== null && typeof agents.get === 'function') {
      try {
        return agents.get(sessionId)
      } catch {
        return undefined
      }
    }
    return undefined
  }

  const sessionOf = (sessionId) => {
    const sessions = ctx.sessions
    if (sessions !== undefined && sessions !== null && typeof sessions.get === 'function') {
      try {
        return sessions.get(sessionId)
      } catch {
        return undefined
      }
    }
    return undefined
  }

  /** Validate and pin the Bot's model on one live Agent without touching the default. */
  const pinModel = async (sessionId, bot) => {
    const pin = bot?.model
    if (!pin || !pin.provider || !pin.model) return
    const selection = {
      provider: pin.provider,
      model: pin.model,
      ...(pin.reasoningEffort === undefined ? {} : { reasoningEffort: pin.reasoningEffort }),
    }
    const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
    if (llm !== undefined && llm !== null && typeof llm.resolveCallConfig === 'function') {
      try {
        await llm.resolveCallConfig(selection)
      } catch (error) {
        throw new BotError('model-unavailable', `the bot model ${pin.provider}/${pin.model} is not available: ${describeError(error)}`, { cause: error })
      }
    }
    const agent = agentOf(sessionId)
    if (agent !== undefined && agent?.model !== undefined && typeof agent.model.select === 'function') {
      agent.model.select(selection)
      return
    }
    // Last resort: the controller records the same choice, and saving/restoring
    // the deployment default around it is what keeps the two separate.
    if (controller === undefined || typeof controller.selectModel !== 'function') {
      throw new BotError('model-unavailable', 'this deployment cannot pin a model on a bot session')
    }
    const defaultModel = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
    let saved
    try {
      saved = typeof defaultModel?.currentSelection === 'function' ? defaultModel.currentSelection() : undefined
    } catch {
      saved = undefined
    }
    try {
      await controller.selectModel({ sessionId, ...selection })
    } catch (error) {
      throw new BotError('model-unavailable', `the bot session refused the model ${pin.provider}/${pin.model}: ${describeError(error)}`, { cause: error })
    } finally {
      if (saved !== undefined && typeof defaultModel?.saveSelection === 'function') {
        try {
          await defaultModel.saveSelection(saved)
        } catch (error) {
          log('warn', 'the deployment default model could not be restored after pinning a bot model', error)
        }
      }
    }
  }

  /** Apply the Bot's title and permission to one live session. */
  const pinSession = async (sessionId, bot, chat) => {
    const session = sessionOf(sessionId)
    if (session !== undefined) {
      const title = titleFor(bot, chat)
      const record = services.chats.sessionOf(chat.id, bot.id)
      const titles = typeof ctx.get === 'function' ? ctx.get('sessionTitle') : undefined
      // A rename appends a logged title event, so it happens only when the
      // wanted title really moved (first turn, or a renamed Bot/chat).
      if (record?.title !== title && titles !== undefined && titles !== null && typeof titles.rename === 'function') {
        try {
          titles.rename(session, title)
          await services.chats.setSession(chat.id, bot.id, { title })
        } catch (error) {
          log('warn', 'the bot session title could not be set', error)
        }
      }
      const presets = typeof ctx.get === 'function' ? ctx.get('permissionPresets') : undefined
      if (presets !== undefined && presets !== null && typeof presets.set === 'function') {
        try {
          presets.set(session, bot.permission ?? 'danger-full-access')
        } catch (error) {
          log('warn', `the bot session refused the permission "${bot.permission}"`, error)
        }
      }
    }
    await pinModel(sessionId, bot)
  }

  /** The title a Bot session carries in the sidebar. */
  const titleFor = (bot, chat) => {
    if (chat?.kind === 'group') {
      const group = services.groups.get(chat.groupId)
      return `${clean(bot.name, 40)} · ${clean(group?.name ?? chat.title ?? 'group', 40)}`
    }
    return clean(bot.name, 40)
  }

  // -------------------------------------------------------------- sessions
  /** Resolve one cold session back to a live Agent through the controller. */
  const resolveAgent = async (sessionId) => {
    if (controller !== undefined && typeof controller.resolveAgent === 'function') {
      try {
        const result = await controller.resolveAgent(sessionId)
        if (result?.agent !== undefined) return result.agent
        return undefined
      } catch {
        return undefined
      }
    }
    return agentOf(sessionId)
  }

  /** Create one fresh Bot session in the shared workspace. */
  const createSession = async (chat, bot) => {
    // A group is usually created for one project, so its main directory decides
    // where new member sessions are composed. A registered workspace becomes the
    // session's workspace; a path-only directory becomes its cwd. Group
    // directories outrank the Bot's own pin for group chats.
    const group = chat?.kind === 'group' && typeof services.groups?.get === 'function'
      ? services.groups.get(chat.groupId)
      : undefined
    const primaryDirectory = Array.isArray(group?.workspaces) ? group.workspaces[0] : undefined
    if (primaryDirectory !== undefined) {
      if (controller === undefined || typeof controller.create !== 'function') {
        throw new BotError('session-create-failed', 'this deployment cannot create a bot session')
      }
      let created
      try {
        created = primaryDirectory.id !== undefined
          ? await controller.create({ workspaceId: primaryDirectory.id })
          : await controller.create({ cwd: primaryDirectory.path })
      } catch (error) {
        throw new BotError(
          'workspace-unavailable',
          `the group main directory "${primaryDirectory.title ?? primaryDirectory.path ?? primaryDirectory.id}" could not be used: ${describeError(error)}`,
          { cause: error },
        )
      }
      const sessionId = created?.sessionId
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new BotError('session-create-failed', 'the host returned no session id')
      }
      await pinSession(sessionId, bot, chat)
      return sessionId
    }
    // Otherwise a Bot may pin one DSH workspace; every other Bot shares the
    // plugin's own workspace. The pin only decides where NEW sessions are
    // created: an existing session keeps its recorded cwd.
    const pinned = typeof services.resolveWorkspace === 'function' ? services.resolveWorkspace(bot) : undefined
    const workspace = pinned ?? await services.ensureWorkspace()
    // `sessionController.create` is the ONLY creation path that composes the
    // session's Agent preset (the preset is mounted through the controller's
    // setup callback), so it is what gives a Bot the deployment's standard tool
    // set. Creating through `ctx.agents.create` directly would skip that mount
    // and leave the Bot with no tools, which is why it is only a last resort.
    if (controller !== undefined && typeof controller.create === 'function') {
      let created
      try {
        created = await controller.create({ workspaceId: workspace.id })
      } catch (error) {
        throw new BotError('session-create-failed', `the bot session could not be created: ${describeError(error)}`, { cause: error })
      }
      const sessionId = created?.sessionId
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new BotError('session-create-failed', 'the host returned no session id')
      }
      await pinSession(sessionId, bot, chat)
      return sessionId
    }
    const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
    if (agents === undefined || agents === null || typeof agents.create !== 'function') {
      throw new BotError('session-create-failed', 'this deployment cannot create a bot session')
    }
    // A deployment without the session controller still gets a usable session;
    // it just cannot inherit the preset composition.
    log('warn', 'this deployment serves no sessionController.create; a bot session is created without its preset composition')
    const sessionId = newId('session')
    const modelOptions = bot.model === null || bot.model === undefined
      ? undefined
      : {
          provider: bot.model.provider,
          model: bot.model.model,
          ...(bot.model.reasoningEffort === undefined ? {} : { reasoningEffort: bot.model.reasoningEffort }),
        }
    try {
      await agents.create({
        sessionId,
        meta: { cwd: workspace.path },
        ...(modelOptions === undefined ? {} : { agentOptions: modelOptions }),
      })
    } catch (error) {
      throw new BotError('session-create-failed', `the bot session could not be created: ${describeError(error)}`, { cause: error })
    }
    if (workspace !== undefined && typeof workspace.attachSession === 'function') {
      try {
        await workspace.attachSession(sessionId)
      } catch (error) {
        log('warn', 'the bot session was created but could not join the bot workspace', error)
      }
    }
    await pinSession(sessionId, bot, chat)
    return sessionId
  }

  /**
   * Ensure one (chat, bot) pair owns a live session, pinned to the current Bot
   * settings. A session that no longer exists is replaced, not reused.
   */
  const ensureSession = async (chat, bot) => {
    const record = services.chats.sessionOf(chat.id, bot.id)
    if (typeof record?.sessionId === 'string' && record.sessionId !== '') {
      const live = await resolveAgent(record.sessionId)
      if (live !== undefined || sessionOf(record.sessionId) !== undefined) {
        await pinSession(record.sessionId, bot, chat)
        return record.sessionId
      }
      log('warn', `bot session ${record.sessionId} is gone; a fresh one is created`)
    }
    const sessionId = await createSession(chat, bot)
    await services.chats.setSession(chat.id, bot.id, {
      sessionId,
      stamp: null,
      memoryStamp: null,
      lastSeenSeq: 0,
    })
    return sessionId
  }

  // ----------------------------------------------------------- turn state
  const makeState = async ({ sessionId, chat, bot, initiated }) => {
    const message = await services.messages.append(chat.id, {
      role: 'bot',
      botId: bot.id,
      status: 'streaming',
      text: '',
      parts: [],
      sessionId,
      turnId: newId('turn'),
    })
    const accumulator = createTurnAccumulator({ botId: bot.id })
    const state = {
      sessionId,
      chatId: chat.id,
      botId: bot.id,
      messageId: message.id,
      turnId: message.turnId,
      startedAt: Date.now(),
      accumulator,
      initiated,
      turns: new Set(),
      turnNumber: undefined,
      finished: false,
      live: '',
      deltaBuffer: '',
      deltaTimer: undefined,
      lastPersist: 0,
      persistPromise: Promise.resolve(),
      abort: new AbortController(),
      cancelRequested: false,
      error: undefined,
      resolve: undefined,
      done: undefined,
      timeoutTimer: undefined,
    }
    state.done = new Promise((resolve) => {
      state.resolve = resolve
    })
    state.timeoutTimer = setTimeout(() => {
      void finalize(state, { kind: 'interrupted' }, 'the turn did not finish within the time bound')
    }, turnTimeoutMs)
    if (typeof state.timeoutTimer.unref === 'function') state.timeoutTimer.unref()
    return state
  }

  /** Persist the streaming snapshot at a bounded cadence. */
  const persistStreaming = (state) => {
    const now = Date.now()
    if (now - state.lastPersist < STREAM_PERSIST_MS) return
    state.lastPersist = now
    const snapshot = state.accumulator.snapshot()
    state.persistPromise = state.persistPromise.then(async () => {
      // A snapshot queued before the turn ended must never overwrite the
      // finished message with a `streaming` status afterwards.
      if (state.finished) return
      try {
        const message = await services.messages.update(state.chatId, state.messageId, {
          status: 'streaming',
          text: snapshot.text,
          parts: snapshot.parts,
        })
        emit({ type: 'message', message })
      } catch (error) {
        log('warn', 'a streaming message snapshot could not be persisted', error)
      }
    })
  }

  const flushDelta = (state) => {
    if (state.deltaTimer !== undefined) {
      clearTimeout(state.deltaTimer)
      state.deltaTimer = undefined
    }
    if (state.deltaBuffer === '') return
    const text = state.deltaBuffer
    state.deltaBuffer = ''
    emit({ type: 'delta', chatId: state.chatId, messageId: state.messageId, text })
  }

  const pushDelta = (state, text) => {
    state.accumulator.addDelta(text)
    state.deltaBuffer += text
    if (state.deltaTimer === undefined) {
      state.deltaTimer = setTimeout(() => {
        state.deltaTimer = undefined
        flushDelta(state)
      }, DELTA_FLUSH_MS)
      if (typeof state.deltaTimer.unref === 'function') state.deltaTimer.unref()
    }
    persistStreaming(state)
  }

  /** Finish one turn: settle the message, the usage row and the waiters exactly once. */
  const finalize = async (state, reason, explicitError) => {
    if (state.finished) return
    state.finished = true
    if (state.timeoutTimer !== undefined) clearTimeout(state.timeoutTimer)
    flushDelta(state)
    if (active.get(state.sessionId) === state) active.delete(state.sessionId)
    if (activeByChat.get(state.chatId) === state) activeByChat.delete(state.chatId)
    // Every streaming snapshot queued before this point settles first, so the
    // final write below is the last word on the message.
    await state.persistPromise.catch(() => undefined)
    const languageCode = typeof services.language === 'function' ? services.language() : 'zh'
    const zh = languageCode === 'zh'
    const accumulator = state.accumulator
    const mapped = explicitError === undefined
      ? mapTurnEndReason(reason, accumulator.text(), accumulator.toolCount, languageCode)
      : { status: state.cancelRequested ? 'aborted' : 'error', error: explicitError }
    // A settled message never carries a `running` tool part: a turn can abort
    // around a call, and a Host without a committed `tool/result` still has to
    // show the row as settled.
    accumulator.failRunningTools(mapped.status === 'aborted'
      ? (zh ? '本轮被取消，这个工具没有返回结果' : 'the turn was cancelled before this tool reported a result')
      : (zh ? '本轮已结束，这个工具没有返回结果' : 'the turn ended before this tool reported a result'))
    const snapshot = accumulator.snapshot()
    const durationMs = Date.now() - state.startedAt
    let message
    try {
      message = await services.messages.update(state.chatId, state.messageId, {
        status: mapped.status,
        text: snapshot.text,
        parts: snapshot.parts,
        ...(mapped.error === undefined ? {} : { error: mapped.error }),
        turnId: state.turnId,
        sessionId: state.sessionId,
      })
    } catch (error) {
      log('error', 'a finished bot message could not be persisted', error)
    }
    services.running.end(state.chatId)
    if (message !== undefined) emit({ type: 'message', message })
    publishChat(state.chatId)
    const result = {
      status: mapped.status,
      text: snapshot.text,
      messageId: state.messageId,
      turnId: state.turnId,
      sessionId: state.sessionId,
      chatId: state.chatId,
      botId: state.botId,
      toolCount: accumulator.toolCount,
      ...(mapped.error === undefined ? {} : { error: mapped.error }),
    }
    emit({
      type: 'turn',
      chatId: state.chatId,
      botId: state.botId,
      status: mapped.status === 'done' || mapped.status === 'pass' ? 'finished' : (mapped.status === 'aborted' ? 'finished' : 'error'),
      turnId: state.turnId,
      ...(mapped.error === undefined ? {} : { error: mapped.error }),
    })
    const usage = accumulator.usage
    try {
      await services.usage.record({
        ts: state.startedAt,
        turnId: state.turnId,
        botId: state.botId,
        botName: services.bots.get(state.botId)?.name ?? '',
        chatId: state.chatId,
        kind: 'chat',
        status: mapped.status,
        durationMs,
        chars: snapshot.text.length,
        tools: accumulator.toolCount,
        modelCalls: accumulator.modelCalls || 1,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
    } catch (error) {
      log('warn', 'a usage row could not be recorded', error)
    }
    state.resolve(result)
  }

  /** Find or lazily create the state of a turn this runtime did not start. */
  const stateForEvent = async (sessionId) => {
    const existing = active.get(sessionId)
    if (existing !== undefined) return existing
    let pending = starting.get(sessionId)
    if (pending !== undefined) return await pending
    const found = services.chats.bySession(sessionId)
    if (found === undefined) return undefined
    const bot = services.bots.get(found.botId)
    if (bot === undefined) return undefined
    pending = (async () => {
      const state = await makeState({ sessionId, chat: found.chat, bot, initiated: false })
      active.set(sessionId, state)
      activeByChat.set(found.chat.id, state)
      services.running.start(found.chat.id, bot.id, state.turnId)
      const created = await services.messages.readMessage(found.chat.id, state.messageId)
      if (created !== undefined) emit({ type: 'message', message: created })
      publishChat(found.chat.id)
      return state
    })().finally(() => starting.delete(sessionId))
    starting.set(sessionId, pending)
    return await pending
  }

  // ---------------------------------------------------------- event wiring
  const onSessionEvent = async (session, event) => {
    if (disposed) return
    const sessionId = typeof session?.id === 'string' ? session.id : undefined
    if (sessionId === undefined || event === undefined) return
    const known = services.chats.bySession(sessionId) !== undefined
    if (active.get(sessionId) === undefined && !known) return
    try {
      if (event.type === 'turn/start') {
        const state = await stateForEvent(sessionId)
        if (state === undefined) return
        const turn = Number(event.data?.turn)
        if (Number.isFinite(turn)) {
          state.turns.add(turn)
          if (state.turnNumber === undefined) state.turnNumber = turn
        }
        return
      }
      const state = active.get(sessionId)
      if (state === undefined) return
      if (event.type === 'assistant/message') {
        const turn = Number(event.data?.turn)
        if (Number.isFinite(turn) && state.turns.size > 0 && !state.turns.has(turn)) return
        state.accumulator.commitAssistant(event.data?.message?.content, event.data?.usage)
        const snapshot = state.accumulator.snapshot()
        try {
          const message = await services.messages.update(state.chatId, state.messageId, {
            status: 'streaming',
            text: snapshot.text,
            parts: snapshot.parts,
          })
          emit({ type: 'message', message })
        } catch (error) {
          log('warn', 'an assistant message could not be persisted', error)
        }
        return
      }
      if (event.type === 'tool/call') {
        const turn = Number(event.data?.turn)
        if (Number.isFinite(turn) && state.turns.size > 0 && !state.turns.has(turn)) return
        state.accumulator.addToolCall(event.data?.callId, event.data?.name)
        const snapshot = state.accumulator.snapshot()
        try {
          const message = await services.messages.update(state.chatId, state.messageId, {
            status: 'streaming',
            text: snapshot.text,
            parts: snapshot.parts,
          })
          emit({ type: 'message', message })
        } catch (error) {
          log('warn', 'a tool call could not be persisted', error)
        }
        return
      }
      if (event.type === 'tool/result') {
        const turn = Number(event.data?.turn)
        if (Number.isFinite(turn) && state.turns.size > 0 && !state.turns.has(turn)) return
        // `tool/result` carries the call id on the committed tool message
        // (`message.toolCallId`); `data.callId` exists only on `tool/call`.
        const callId = event.data?.callId ?? event.data?.message?.toolCallId
        const failed = event.data?.error !== undefined || event.data?.message?.isError === true
        state.accumulator.finishTool(callId, {
          ok: !failed,
          error: event.data?.error?.reason ?? event.data?.error?.code,
        })
        const snapshot = state.accumulator.snapshot()
        try {
          const message = await services.messages.update(state.chatId, state.messageId, {
            status: 'streaming',
            text: snapshot.text,
            parts: snapshot.parts,
          })
          emit({ type: 'message', message })
        } catch (error) {
          log('warn', 'a tool result could not be persisted', error)
        }
        return
      }
      if (event.type === 'turn/end') {
        const turn = Number(event.data?.turn)
        if (Number.isFinite(turn) && state.turns.size > 0 && !state.turns.has(turn)) return
        await finalize(state, event.data?.reason)
      }
    } catch (error) {
      log('warn', 'a session event could not be merged', error)
    }
  }

  const onAssistantStream = async (payload) => {
    if (disposed) return
    const agent = payload?.agent
    const frame = payload?.frame
    const sessionId = typeof agent?.id === 'string' ? agent.id : undefined
    if (sessionId === undefined || frame === undefined) return
    if (frame.type !== 'chunk') return
    const chunk = frame.chunk
    if (chunk === undefined || chunk.type !== 'text-delta' || typeof chunk.text !== 'string') return
    let state = active.get(sessionId)
    if (state === undefined) {
      const known = services.chats.bySession(sessionId)
      if (known === undefined) return
      state = await stateForEvent(sessionId)
      if (state === undefined) return
    }
    if (!state.turns.has(Number(frame.turn)) && Number.isFinite(Number(frame.turn))) state.turns.add(Number(frame.turn))
    pushDelta(state, chunk.text)
  }

  disposers.push(ctx.on('session/event', (session, event) => { void onSessionEvent(session, event) }, { global: true }))
  disposers.push(ctx.on('agent/assistant-stream', (payload) => { void onAssistantStream(payload) }, { global: true }))
  // The unattended-turn answerers. They must be registered before any turn runs,
  // and with `prepend`, or the Host's own remotes forwarder would claim a Bot's
  // approval request and wait for a page that will never render it.
  disposers.push(registerApprovalAnswerers({ ctx, services }))

  // --------------------------------------------------------------- turn API
  /**
   * Run one Bot turn in one chat.
   * @param {object} input - the turn input.
   * @param {object} input.chat - the chat record.
   * @param {object} input.bot - the Bot that answers.
   * @param {string} input.text - the prompt text.
   * @param {string} [input.kind] - `chat`, `group`, `schedule` or `relay`.
   * @param {AbortSignal} [input.signal] - caller cancellation.
   * @returns {Promise<object>} the turn result.
   */
  const send = async ({ chat, bot, text, kind = 'chat', signal }) => {
    if (disposed) throw new BotError('session-unavailable', 'the bot runtime is shutting down')
    if (activeByChat.get(chat.id) !== undefined || services.running.get(chat.id) !== undefined) {
      throw new BotError('session-busy', `chat "${chat.title ?? chat.id}" already has a running turn`)
    }
    const sessionId = await ensureSession(chat, bot)
    const state = await makeState({ sessionId, chat, bot, initiated: true })
    active.set(sessionId, state)
    activeByChat.set(chat.id, state)
    services.running.start(chat.id, bot.id, state.turnId)
    emit({ type: 'turn', chatId: chat.id, botId: bot.id, status: 'started', turnId: state.turnId })
    const created = await services.messages.readMessage(chat.id, state.messageId)
    if (created !== undefined) emit({ type: 'message', message: created })
    publishChat(chat.id)
    if (signal !== undefined) {
      if (signal.aborted) {
        await finalize(state, { kind: 'aborted' }, 'the caller cancelled the turn')
        return await state.done
      }
      signal.addEventListener('abort', () => {
        state.cancelRequested = true
        void cancelState(state)
      }, { once: true })
    }
    try {
      await controller.prompt({
        requestId: `dsh-bot-${state.turnId}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      }, state.abort.signal)
    } catch (error) {
      await finalize(state, undefined, `the prompt was not accepted: ${describeError(error)}`)
      return await state.done
    }
    void kind
    return await state.done
  }

  /** Cancel one running turn by chat id. */
  const cancelState = async (state) => {
    if (state.finished) return
    state.cancelRequested = true
    try {
      state.abort.abort()
    } catch {
      /* already aborted */
    }
    try {
      if (typeof controller.cancel === 'function') controller.cancel({ sessionId: state.sessionId })
    } catch (error) {
      log('warn', 'the host refused to cancel the bot turn', error)
    }
    // The turn/end event normally settles it; a stuck driver is settled here.
    setTimeout(() => {
      if (!state.finished) void finalize(state, { kind: 'aborted' })
    }, 3000).unref?.()
  }

  const cancel = async (chatId) => {
    const state = activeByChat.get(chatId)
    if (state === undefined) return false
    await cancelState(state)
    return true
  }

  /**
   * Re-run the last failed turn of a chat.
   * @param {string} chatId - the conversation.
   * @returns {Promise<object>} the new turn result.
   */
  const retry = async (chatId) => {
    const chat = services.chats.require(chatId)
    const history = services.messages.list(chatId)
    const failed = [...history].reverse().find(message => message.role === 'bot' && (message.status === 'error' || message.status === 'aborted'))
    if (failed === undefined) throw new BotError('invalid-request', 'this chat has no failed bot reply to retry')
    const index = history.findIndex(message => message.id === failed.id)
    const asked = [...history.slice(0, index)].reverse().find(message => message.role === 'user')
    const input = asked?.text ?? asked?.parts?.find(part => part.type === 'text')?.text
    if (typeof input !== 'string' || input.trim() === '') throw new BotError('invalid-request', 'the failed reply has no user message to retry')
    const bot = chat.kind === 'dm' ? services.bots.require(chat.botId) : services.bots.require(failed.botId)
    return await send({ chat, bot, text: input })
  }

  const dispose = async () => {
    disposed = true
    try {
      await helpersApi?.dispose?.()
    } catch {
      /* the fiber is going away */
    }
    for (const disposeListener of disposers.splice(0)) {
      try {
        disposeListener()
      } catch {
        /* the fiber is going away */
      }
    }
    for (const state of [...active.values()]) {
      if (state.deltaTimer !== undefined) clearTimeout(state.deltaTimer)
      void finalize(state, { kind: 'aborted' }, 'the bot runtime was disposed')
    }
    listeners.clear()
  }

  const runtimeApi = {
    send,
    cancel,
    cancelState,
    retry,
    ensureSession,
    publish: (payload) => emit(payload),
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stampOf: (chatId, botId) => services.stampOf(chatId, botId),
    activeFor(chatId) {
      return activeByChat.get(chatId)
    },
    dispose,
    /** Exposed for the routes and diagnostics. */
    get activeCount() {
      return active.size
    },
  }

  helpersApi = createHelpers({ ctx, services, runtime: runtimeApi })
  runtimeApi.helpers = helpersApi
  return runtimeApi
}
