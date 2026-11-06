/**
 * Background helpers: the MiniMax `start_helper` equivalent on DSH subagents.
 *
 * A Bot starts a helper with a self-contained brief; the helper runs in a
 * hidden child session through `ctx.subagents.startActivation`, so it never
 * appears in the sidebar and cannot open human interaction of its own. When it
 * settles, its report is posted back into the origin chat as a relay message and
 * the Bot is asked to verify it in its own words — the result never appears to
 * the user as if the Bot itself had done the work.
 *
 * Everything is optional at mount: a deployment without `ctx.subagents` answers
 * the tools with the stable `helper-unavailable` code instead of failing.
 *
 * @module @lisongjianustc/dsh-bot/host/helpers
 */
import { BotError, describeError } from './errors.js'
import { composeTurnText } from './prompt.js'
import { clip, clean } from './util.js'

/** The longest report that is posted back into the origin chat. */
export const HELPER_REPORT_MAX = 8000
/** How long the verification turn waits for a busy origin chat before giving up. */
export const HELPER_VERIFY_WAIT_MS = 10 * 60 * 1000

/** The helper's own brief: a hidden, tool-light, report-only child. */
function helperBrief({ bot, title, task, language }) {
  if (language === 'en') {
    return [
      `<dsh-bot-helper>`,
      `You are a background helper for the Bot "${clean(bot.name, 60)}". The user cannot see this session and you cannot ask anyone anything.`,
      `Task title: ${clean(title, 80)}`,
      `Task:`,
      clean(task, 20000),
      '',
      'Produce ONE concise, verifiable report: the conclusion first, then the evidence or the exact failure. Keep it under 600 words. Do not call team tools, do not ask the user questions, do not address the user directly.',
      '</dsh-bot-helper>',
    ].join('\n')
  }
  return [
    `<dsh-bot-helper>`,
    `你是 Bot「${clean(bot.name, 60)}」的后台 helper。用户看不到这个会话，你也不能向任何人提问。`,
    `任务标题：${clean(title, 80)}`,
    '任务：',
    clean(task, 20000),
    '',
    '只输出一份简洁、可核实的报告：先给结论，再给证据或确切的失败原因；不超过 600 字。不要调用团队工具，不要向用户提问，不要直接对用户说话。',
    '</dsh-bot-helper>',
  ].join('\n')
}

/** The text blocks of a subagent result. */
function textOfOutput(output) {
  if (!Array.isArray(output)) return ''
  return output
    .filter(block => block && (block.type === 'text' || block.type === 'output_text') && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/** The relay line that carries a helper report back into the chat. */
function relayText({ record, status, report, language }) {
  const body = report === '' ? (language === 'en' ? '(the helper produced no report)' : '（helper 没有产出报告）') : report
  return language === 'en'
    ? `[background task "${clean(record.title, 80)}" · ${status}]\n${body}`
    : `[后台任务「${clean(record.title, 80)}」· ${status}]\n${body}`
}

/** The verification request the origin Bot receives. */
function verifyText({ record, status, report, language }) {
  return language === 'en'
    ? [
        `The background task "${clean(record.title, 80)}" finished with status ${status}.`,
        'Its report:',
        report === '' ? '(no report)' : report,
        '',
        'Verify this in your own words for the user: state the conclusion, flag anything uncertain or missing, and do not paste the whole report back.',
      ].join('\n')
    : [
        `后台任务「${clean(record.title, 80)}」已结束，状态：${status}。`,
        '它的报告：',
        report === '' ? '（没有报告）' : report,
        '',
        '请用你自己的话向用户验收：给出结论、指出不确定或缺失的地方，不要把整段报告原样贴回。',
      ].join('\n')
}

/**
 * Create the helper manager.
 * @param {{ ctx: object, services: object, runtime: object }} input - wiring.
 * @returns {object} the manager.
 */
export function createHelpers({ ctx, services, runtime }) {
  /** helperId -> { activation, controller } for running helpers. */
  const active = new Map()
  const language = () => (typeof services.language === 'function' ? services.language() : 'zh')

  const log = (level, message, error) => {
    const logger = ctx?.logger
    if (logger && typeof logger[level] === 'function') logger[level](`[dsh-bot] ${message}`, error)
    else if (level === 'warn' || level === 'error') console.warn(`[dsh-bot] ${message}`, error ?? '')
  }

  /** The subagent service, resolved per call: it may mount after this plugin. */
  const subagents = () => {
    const service = typeof ctx.get === 'function' ? ctx.get('subagents') : undefined
    return service !== undefined && service !== null && typeof service.startActivation === 'function' ? service : undefined
  }

  /** The first registered provider that can run a local child. */
  const providerOf = (service) => {
    if (service === undefined || typeof service.list !== 'function') return undefined
    try {
      const names = service.list()
      return Array.isArray(names) && names.length > 0 ? names[0] : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Start one background helper for a Bot.
   * @param {object} input - the start request.
   * @param {object} input.parentAgent - the calling Bot's live Agent.
   * @param {object} input.chat - the origin chat record.
   * @param {object} input.bot - the calling Bot.
   * @param {string} input.task - the self-contained task.
   * @param {string} [input.title] - a short task title.
   * @returns {Promise<object>} the helper record.
   */
  const start = async ({ parentAgent, chat, bot, task, title, parentTurnId }) => {
    const service = subagents()
    if (service === undefined) {
      throw new BotError('helper-unavailable', 'this deployment serves no subagent runtime, so a background helper cannot start')
    }
    const provider = providerOf(service)
    if (provider === undefined) {
      throw new BotError('helper-unavailable', 'this deployment has no subagent provider registered')
    }
    const body = String(task ?? '').trim()
    if (body === '') throw new BotError('invalid-request', 'a helper needs a task')
    if (parentAgent === undefined || parentAgent === null) {
      throw new BotError('helper-unavailable', 'the calling bot session is not live, so it cannot own a background helper')
    }
    const record = await services.helpers.create({
      botId: bot.id,
      chatId: chat.id,
      title,
      task: body,
      ...(parentTurnId === undefined ? {} : { parentTurnId }),
    })
    const controller = new AbortController()
    let activation
    try {
      activation = await service.startActivation({
        provider,
        label: `bot-helper:${clip(bot.name, 24)}:${clip(record.title, 40)}`,
        request: {
          prompt: [{ type: 'text', text: helperBrief({ bot, title: record.title, task: body, language: language() }) }],
          parent: parentAgent,
        },
        signal: controller.signal,
        delivery: 'parent',
      })
    } catch (error) {
      await services.helpers.update(record.id, {
        status: 'failed',
        error: clip(`the helper could not start: ${describeError(error)}`, 800),
        endedAt: Date.now(),
      })
      throw new BotError('helper-unavailable', `the background helper could not start: ${describeError(error)}`, { cause: error })
    }
    active.set(record.id, { activation, controller })
    await services.helpers.update(record.id, {
      status: 'running',
      childId: activation?.childId,
      startedAt: Date.now(),
    })
    Promise.resolve(activation?.result)
      .then(result => finish(record.id, result, undefined))
      .catch(error => finish(record.id, undefined, error))
    return services.helpers.get(record.id) ?? record
  }

  /** Wait for one chat's running turn to settle, so the verification can be sent. */
  const waitChatIdle = async (chatId, timeoutMs) => {
    if (runtime.activeFor === undefined || runtime.activeFor(chatId) === undefined) return true
    return await new Promise((resolve) => {
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        off()
        resolve(value)
      }
      const off = runtime.onEvent((event) => {
        if (event?.type === 'turn' && event.chatId === chatId && (event.status === 'finished' || event.status === 'error')) done(true)
      })
      const timer = setTimeout(() => done(false), timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
    })
  }

  /** Post the report back and ask the origin Bot to verify it. */
  const deliver = async (record, status, report) => {
    const chat = services.chats.get(record.chatId)
    if (chat === undefined) return
    const bot = services.bots.get(record.botId)
    if (bot === undefined) return
    const languageCode = language()
    const text = relayText({ record, status, report, language: languageCode })
    try {
      const relay = await services.messages.append(chat.id, {
        role: 'relay',
        botId: bot.id,
        text,
        status: 'done',
        parts: [{ type: 'text', text }],
      })
      runtime.publish?.({ type: 'message', message: relay })
      runtime.publish?.({ type: 'chat', chat: services.chats.view(chat) })
    } catch (error) {
      log('warn', `the report of helper ${record.id} could not be posted back`, error)
    }
    // A group already reads the relay as the next member's snapshot, so only a
    // private chat gets the extra verification turn.
    if (chat.kind !== 'dm') return
    try {
      await waitChatIdle(chat.id, HELPER_VERIFY_WAIT_MS)
      const prompt = composeTurnText({
        services,
        language: languageCode,
        bot,
        chat,
        input: verifyText({ record, status, report, language: languageCode }),
      })
      const result = await runtime.send({ chat, bot, text: prompt.text, kind: 'helper' })
      if (result.status !== 'aborted') await prompt.commit()
    } catch (error) {
      log('warn', `the verification turn for helper ${record.id} could not run`, error)
    }
  }

  /** Settle one helper exactly once. */
  const finish = async (helperId, result, error) => {
    active.delete(helperId)
    const record = services.helpers.get(helperId)
    if (record === undefined) return
    // A stopped helper is settled by stop(); a late result must not revive it.
    if (record.status === 'stopped') return
    const report = clip(textOfOutput(result?.output), HELPER_REPORT_MAX)
    const reason = result?.stopReason
    const failed = error !== undefined || (reason !== undefined && reason?.kind !== undefined && reason.kind !== 'completed')
    const status = failed ? 'failed' : 'done'
    let updated
    try {
      updated = await services.helpers.update(helperId, {
        status,
        report,
        ...(failed
          ? { error: clip(error === undefined ? (reason?.message ?? result?.diagnostic ?? 'the helper did not complete') : describeError(error), 800) }
          : {}),
        endedAt: Date.now(),
      })
    } catch (updateError) {
      log('warn', `helper ${helperId} could not be settled in the ledger`, updateError)
      return
    }
    await deliver(updated, status, report)
  }

  /**
   * Stop one running helper.
   * @param {object} record - the helper record.
   * @returns {Promise<object>} the settled record.
   */
  const stop = async (record) => {
    const entry = active.get(record.id)
    if (entry !== undefined) {
      active.delete(record.id)
      try {
        entry.controller.abort()
      } catch {
        /* already aborted */
      }
      try {
        await entry.activation?.dispose()
      } catch (error) {
        log('warn', `helper ${record.id} did not stop cleanly`, error)
      }
    }
    if (record.status === 'queued' || record.status === 'running') {
      return await services.helpers.update(record.id, {
        status: 'stopped',
        endedAt: Date.now(),
        error: record.error ?? 'stopped by the user',
      })
    }
    return record
  }

  return {
    start,
    stop,
    list: ({ botId } = {}) => services.helpers.list({ botId }),
    get: (id) => services.helpers.get(id),
    require: (id) => services.helpers.require(id),
    /** Stop every activation this plugin owns; used on unload. */
    dispose: async () => {
      for (const [helperId, entry] of [...active]) {
        active.delete(helperId)
        try {
          entry.controller.abort()
        } catch {
          /* already aborted */
        }
        try {
          await entry.activation?.dispose()
        } catch {
          /* the fiber is going away */
        }
        try {
          const record = services.helpers.get(helperId)
          if (record !== undefined && (record.status === 'running' || record.status === 'queued')) {
            await services.helpers.update(helperId, { status: 'stopped', endedAt: Date.now(), error: 'the bot runtime was unloaded' })
          }
        } catch {
          /* the ledger may already be closing */
        }
      }
    },
    get activeCount() {
      return active.size
    },
  }
}

