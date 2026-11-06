/**
 * The model-facing Bot tools.
 *
 * Registered as bare ToolDefinition objects through `ctx.tools.register`, because
 * a plugin installed into a profile cannot import `@deepseek-ai/dsh-tools`: the
 * harness packages live inside the application archive and are not resolvable
 * from a linked plugin. The registry accepts the definition shape directly.
 *
 * Every tool acts on the same services the panel drives, and every caller is
 * identified by `exec.agent.id` — the session id — so there is no caller id in
 * any schema and no way to act as another Bot. The `when` condition keeps the
 * whole surface invisible outside Bot sessions.
 *
 * @module @lisongjianustc/dsh-bot/host/tools
 */
import { BotError, describeError } from './errors.js'
import { clip } from './util.js'

/** Registered tool names, in registration order. */
export const TOOL_NAMES = [
  'bot_list_team',
  'bot_create',
  'bot_update',
  'bot_delete',
  'bot_message',
  'bot_post_group',
  'bot_remember',
  'bot_recall',
  'bot_forget',
  'bot_create_schedule',
  'bot_list_schedules',
  'bot_delete_schedule',
  'bot_start_helper',
  'bot_list_helpers',
  'bot_stop_helper',
]

/** The output definition every tool shares: one JSON text block. */
const JSON_OUTPUT = {
  schema: { type: 'object' },
  render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }]
  },
}

/** Build the tool definition every tool is made of. */
function defineTool({ name, description, parameters, execute }) {
  return {
    name,
    description,
    parameters,
    output: JSON_OUTPUT,
    async execute(args, exec) {
      try {
        return await execute(args ?? {}, exec)
      } catch (error) {
        if (error instanceof BotError) return { ok: false, code: error.code, message: error.message }
        return { ok: false, code: 'internal', message: describeError(error) }
      }
    },
  }
}

/** A JSON-schema object with the given properties, all optional by default. */
function schema(properties, required = []) {
  return {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: false,
  }
}

const STRING = (description) => ({ type: 'string', description })
const BOOLEAN = (description) => ({ type: 'boolean', description })

/**
 * Register the Bot tools.
 * @param {{ ctx: object, services: object, dispatcher: object, runtime: object }} input - wiring.
 * @returns {() => void} the disposer.
 */
export function registerTools({ ctx, services, dispatcher, runtime }) {
  const registry = ctx.tools
  if (registry === undefined || typeof registry.register !== 'function') return () => {}

  const callerOf = (exec) => {
    const sessionId = exec?.agent?.id
    const bot = services.bots.botOfSession(sessionId)
    if (bot === undefined) throw new BotError('invalid-request', 'this tool runs only inside a bot session')
    return bot
  }
  const requireMain = (bot) => {
    if (bot.isMain !== true) throw new BotError('invalid-request', 'only the main bot may do this')
    return bot
  }
  const visible = ({ agent }) => services.bots.botOfSession(agent?.id) !== undefined
  /** Helper tools follow the Bot's own `autoHelper` switch, like its brief says. */
  const HELPER_TOOL_NAMES = new Set(['bot_start_helper', 'bot_list_helpers', 'bot_stop_helper'])
  const helperVisible = (context) => {
    if (!visible(context)) return false
    const bot = services.bots.botOfSession(context.agent?.id)
    return bot === undefined || bot.autoHelper !== false
  }

  const tools = [
    defineTool({
      name: 'bot_list_team',
      description: 'List every Bot and group of this Bot team, with the caller\'s own identity. Read-only.',
      parameters: schema({}),
      execute: (_args, exec) => {
        const caller = callerOf(exec)
        return {
          ok: true,
          caller: { id: caller.id, name: caller.name, main: caller.isMain === true },
          bots: services.bots.list().map(bot => ({
            id: bot.id,
            name: bot.name,
            role: bot.role ?? '',
            main: bot.isMain === true,
            model: bot.model ?? null,
            permission: bot.permission ?? 'danger-full-access',
          })),
          groups: services.groups.list().map(group => ({
            id: group.id,
            name: group.name,
            adminId: group.adminId ?? '',
            memberIds: [...(group.memberIds ?? [])],
            replyMode: group.replyMode ?? 'admin',
            maxHops: group.maxHops ?? 0,
          })),
        }
      },
    }),
    defineTool({
      name: 'bot_create',
      description: 'Create one Bot. Main Bot only. The Bot gets its own real DSH session in the shared bot workspace. name is unique and cannot contain @ or a line break.',
      parameters: schema({
        name: STRING('display name, at most 24 characters, unique'),
        role: STRING('one-line role, at most 60 characters'),
        instructions: STRING('standing instructions, at most 4000 characters'),
        permission: { type: 'string', enum: ['read-only', 'workspace-write', 'danger-full-access'], description: 'permission preset for the bot session' },
        model: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            model: { type: 'string' },
            reasoningEffort: { type: 'string' },
          },
          required: ['provider', 'model'],
          additionalProperties: false,
          description: 'model route pinned for this bot; omit to follow the deployment default',
        },
        color: STRING('hex colour like #6b7cff'),
      }, ['name']),
      async execute(args, exec) {
        requireMain(callerOf(exec))
        const bot = await services.bots.create({
          name: args.name,
          role: args.role,
          instructions: args.instructions,
          permission: args.permission,
          model: args.model,
          color: args.color,
        })
        return { ok: true, created: bot.id, bot: { id: bot.id, name: bot.name, role: bot.role, model: bot.model, permission: bot.permission } }
      },
    }),
    defineTool({
      name: 'bot_update',
      description: 'Update one Bot\'s editable fields. Main Bot only. Omitted fields keep their value; name, role, instructions, permission and model are replaceable.',
      parameters: schema({
        bot: STRING('bot id or name'),
        name: STRING('new display name'),
        role: STRING('new role'),
        instructions: STRING('new standing instructions'),
        permission: { type: 'string', enum: ['read-only', 'workspace-write', 'danger-full-access'] },
        model: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            model: { type: 'string' },
            reasoningEffort: { type: 'string' },
          },
          required: ['provider', 'model'],
          additionalProperties: false,
        },
        color: STRING('hex colour'),
      }, ['bot']),
      async execute(args, exec) {
        requireMain(callerOf(exec))
        const bot = await services.bots.update(args.bot, args)
        return { ok: true, bot: { id: bot.id, name: bot.name, role: bot.role, model: bot.model, permission: bot.permission } }
      },
    }),
    defineTool({
      name: 'bot_delete',
      description: 'Delete one Bot with its chats, group memberships, schedules and memory. Main Bot only. Deleting the last Bot is refused.',
      parameters: schema({ bot: STRING('bot id or name') }, ['bot']),
      async execute(args, exec) {
        requireMain(callerOf(exec))
        const bot = services.bots.get(args.bot)
        if (bot === undefined) throw new BotError('bot-not-found', `no bot matches "${args.bot}"`)
        if (bot.isMain && services.bots.list().length <= 1) {
          throw new BotError('invalid-request', 'the last bot cannot be deleted')
        }
        await services.bots.remove(bot)
        return { ok: true, deleted: bot.id, name: bot.name }
      },
    }),
    defineTool({
      name: 'bot_message',
      description: 'Send one task message to another Bot and wait for its answer. The answer is returned as this tool\'s value; it also appears in that Bot\'s chat.',
      parameters: schema({
        to: STRING('target bot id or name'),
        message: STRING('what you ask that Bot to do'),
      }, ['to', 'message']),
      execute: async (args, exec) => {
        const caller = callerOf(exec)
        return await dispatcher.messageBot({ callerBotId: caller.id, to: args.to, text: args.message })
      },
    }),
    defineTool({
      name: 'bot_post_group',
      description: 'Ask a group to discuss something. Only callable from a private chat (inside a group you are already in it). The round\'s replies are returned as this tool\'s value.',
      parameters: schema({
        group: STRING('group id or name'),
        message: STRING('the discussion request'),
      }, ['group', 'message']),
      async execute(args, exec) {
        const caller = callerOf(exec)
        const found = services.chats.bySession(exec?.agent?.id)
        if (found?.chat?.kind === 'group') {
          throw new BotError('invalid-request', 'bot_post_group cannot be called from inside a group; mention a member instead')
        }
        const round = await dispatcher.postGroup({ callerBotId: caller.id, group: args.group, text: args.message })
        return {
          ok: true,
          group: args.group,
          hops: round.hops ?? 0,
          paused: round.paused ?? null,
          replies: (round.noteRound ?? []).map(entry => ({ speaker: entry.speaker, text: clip(entry.text, 2000) })),
        }
      },
    }),
    defineTool({
      name: 'bot_remember',
      description: 'Write one memory entry. scope "self" (default) is the caller\'s own memory, "team" is shared and only the main Bot may write it, "bot" writes another Bot\'s memory and only the main Bot may do that. A single entry holds at most 1200 characters; secrets are refused.',
      parameters: schema({
        text: STRING('the fact to remember'),
        scope: { type: 'string', enum: ['self', 'team', 'bot'] },
        target_bot: STRING('the other bot when scope is "bot"'),
        key: STRING('stable topic key, lowercase letters/digits/. _ -, at most 64'),
        pinned: BOOLEAN('pin the entry so it is always selected first'),
      }, ['text']),
      execute: async (args, exec) => {
        const caller = callerOf(exec)
        const scope = args.scope === 'team' ? 'team' : args.scope === 'bot' ? 'bot' : 'self'
        services.memory.assertWritable({ scope, callerBotId: caller.id })
        const result = await services.memory.remember({
          scope,
          text: args.text,
          key: args.key,
          pinned: args.pinned,
          botId: caller.id,
          targetBotId: args.target_bot,
          by: caller.name,
          source: 'tool',
        })
        return { ok: true, unchanged: result.unchanged === true, entry: result.entry }
      },
    }),
    defineTool({
      name: 'bot_recall',
      description: 'Search memory. scope "self" (default) reads the caller\'s own memory, "team" the shared memory, "bot" another Bot\'s memory (main Bot only). Returns at most 20 entries.',
      parameters: schema({
        query: STRING('what to look for'),
        scope: { type: 'string', enum: ['self', 'team', 'bot'] },
        target_bot: STRING('the other bot when scope is "bot"'),
        key: STRING('match a topic key exactly'),
      }),
      execute: (args, exec) => {
        const caller = callerOf(exec)
        const scope = args.scope === 'team' ? 'team' : args.scope === 'bot' ? 'bot' : 'self'
        if (scope === 'bot' && caller.isMain !== true) throw new BotError('invalid-request', 'only the main bot reads another bot\'s memory')
        const entries = services.memory.list({ scope, botId: caller.id, targetBotId: args.target_bot })
        const query = String(args.query ?? '').toLowerCase()
        const matched = entries.filter(entry => {
          if (args.key !== undefined && entry.key !== args.key) return false
          if (query === '') return true
          return `${entry.text}\n${entry.key ?? ''}`.toLowerCase().includes(query)
        })
        return {
          ok: true,
          count: matched.length,
          entries: matched.slice(0, 20).map(entry => ({
            id: entry.id,
            key: entry.key ?? '',
            text: clip(entry.text, 2000),
            pinned: entry.pinned === true,
            revision: entry.revision,
          })),
        }
      },
    }),
    defineTool({
      name: 'bot_forget',
      description: 'Delete one memory entry by id, by text, or by topic key.',
      parameters: schema({
        id: STRING('entry id'),
        text: STRING('exact entry text'),
        key: STRING('topic key'),
        scope: { type: 'string', enum: ['self', 'team', 'bot'] },
        target_bot: STRING('the other bot when scope is "bot"'),
      }),
      execute: async (args, exec) => {
        const caller = callerOf(exec)
        const scope = args.scope === 'team' ? 'team' : args.scope === 'bot' ? 'bot' : 'self'
        services.memory.assertWritable({ scope, callerBotId: caller.id })
        const result = await services.memory.forget({
          scope,
          id: args.id,
          text: args.text,
          key: args.key,
          botId: caller.id,
          targetBotId: args.target_bot,
        })
        return { ok: true, removed: result.removed }
      },
    }),
    defineTool({
      name: 'bot_create_schedule',
      description: 'Create a scheduled task that sends a prompt to a Bot on a schedule. The deliverable is a real host schedule bound to that Bot\'s session. main Bot may target any Bot; another Bot may target itself.',
      parameters: schema({
        prompt: STRING('what the Bot should do when the task fires'),
        title: STRING('short task name, at most 120 characters'),
        kind: { type: 'string', enum: ['daily', 'interval', 'once'], description: 'daily = every day at time; interval = every N minutes; once = N minutes from now' },
        time: STRING('HH:MM for kind daily'),
        every_minutes: { type: 'number', description: 'interval in minutes, at least 5' },
        in_minutes: { type: 'number', description: 'minutes from now for kind once, at least 1' },
        target_bot: STRING('bot id or name; defaults to the caller'),
      }, ['prompt']),
      execute: async (args, exec) => {
        const caller = callerOf(exec)
        const target = args.target_bot === undefined ? caller : services.bots.require(args.target_bot)
        if (target.id !== caller.id) requireMain(caller)
        const kind = args.kind === 'interval' ? 'interval' : args.kind === 'once' ? 'once' : 'daily'
        const timing = kind === 'daily'
          ? { kind: 'daily', time: /^\d{2}:\d{2}$/.test(String(args.time ?? '')) ? String(args.time) : '09:00' }
          : kind === 'interval'
            ? { kind: 'every', minutes: Math.max(5, Math.floor(Number(args.every_minutes) || 30)) }
            : { kind: 'after', minutes: Math.max(1, Math.floor(Number(args.in_minutes) || 10)) }
        const chat = await services.chats.ensureDm(target)
        const sessionId = await runtime.ensureSession(chat, target)
        const record = await services.schedules.create({
          botId: target.id,
          title: args.title ?? clip(String(args.prompt), 40),
          prompt: args.prompt,
          timing,
        })
        const service = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined
        if (service === undefined || typeof service.create !== 'function') {
          await services.schedules.remove(record.id)
          throw new BotError('schedule-unavailable', 'this deployment serves no schedule service')
        }
        const zone = (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          } catch {
            return 'UTC'
          }
        })()
        const nativeTiming = kind === 'daily'
          ? { kind: 'daily', daily: { time: timing.time, time_zone: zone } }
          : kind === 'interval'
            ? { kind: 'every', every_seconds: timing.minutes * 60 }
            : { kind: 'after', after_seconds: timing.minutes * 60 }
        let native
        try {
          native = await service.create({
            title: record.title,
            prompt: record.prompt,
            timing: nativeTiming,
            target: { kind: 'session', sessionId },
          }, exec?.agent?.id)
        } catch (error) {
          await services.schedules.remove(record.id)
          throw new BotError('schedule-unavailable', `the host refused the scheduled task: ${describeError(error)}`, { cause: error })
        }
        const nativeId = typeof native?.id === 'string' ? native.id : (typeof native?.scheduleId === 'string' ? native.scheduleId : undefined)
        await services.schedules.update(record.id, { nativeId, nextRunAt: native?.nextScheduledAt })
        return { ok: true, scheduleId: record.id, nativeId, timing, target: target.name }
      },
    }),
    defineTool({
      name: 'bot_list_schedules',
      description: 'List the scheduled tasks visible to the caller: its own, or every task for the main Bot.',
      parameters: schema({}),
      execute: (_args, exec) => {
        const caller = callerOf(exec)
        const records = caller.isMain === true ? services.schedules.list() : services.schedules.listForBot(caller.id)
        return {
          ok: true,
          schedules: records.map(record => ({
            id: record.id,
            botId: record.botId,
            title: record.title,
            prompt: clip(record.prompt, 500),
            timing: record.timing,
            nativeId: record.nativeId,
          })),
        }
      },
    }),
    defineTool({
      name: 'bot_delete_schedule',
      description: 'Delete one scheduled task.',
      parameters: schema({ schedule_id: STRING('schedule id from list_schedules') }, ['schedule_id']),
      execute: async (args, exec) => {
        const caller = callerOf(exec)
        const record = services.schedules.require(args.schedule_id)
        if (record.botId !== caller.id) requireMain(caller)
        await services.schedules.removeNative(record)
        await services.schedules.remove(record.id)
        return { ok: true, deleted: record.id }
      },
    }),

    defineTool({
      name: 'bot_start_helper',
      description: 'Start a background helper: a hidden child DSH session that works on one self-contained task and reports back. Returns immediately with a helper id; the report is posted into this chat later and you will be asked to verify it in your own words. Use it for long independent work instead of doing everything in this turn.',
      parameters: schema({
        task: STRING('the complete, self-contained task: context, what to produce, and any constraint'),
        title: STRING('short task name, at most 80 characters'),
      }, ['task']),
      async execute(args, exec) {
        const caller = callerOf(exec)
        const found = services.chats.bySession(exec.agent?.id)
        if (found === undefined) throw new BotError('invalid-request', 'this session has no bot chat to report into')
        const helper = await runtime.helpers.start({
          parentAgent: exec.agent,
          chat: found.chat,
          bot: caller,
          task: args.task,
          title: args.title,
        })
        return {
          ok: true,
          accepted: true,
          helper: {
            id: helper.id,
            title: helper.title,
            status: helper.status,
            childId: helper.childId,
          },
          note: 'A receipt is not a result: the report arrives later in this chat and you will be asked to verify it.',
        }
      },
    }),
    defineTool({
      name: 'bot_list_helpers',
      description: 'List the background helpers visible to the caller: its own, or every helper for the main Bot. The newest 15 are returned.',
      parameters: schema({}),
      execute: (_args, exec) => {
        const caller = callerOf(exec)
        const rows = caller.isMain === true ? runtime.helpers.list() : runtime.helpers.list({ botId: caller.id })
        return {
          ok: true,
          helpers: rows.slice(0, 15).map(helper => ({
            id: helper.id,
            botId: helper.botId,
            title: helper.title,
            status: helper.status,
            childId: helper.childId,
            report: helper.report === undefined ? undefined : clip(helper.report, 2000),
            error: helper.error,
            createdAt: helper.createdAt,
            endedAt: helper.endedAt,
          })),
        }
      },
    }),
    defineTool({
      name: 'bot_stop_helper',
      description: 'Stop one background helper. A stopped helper never posts its result back.',
      parameters: schema({ helper_id: STRING('helper id from bot_list_helpers or bot_start_helper') }, ['helper_id']),
      async execute(args, exec) {
        const caller = callerOf(exec)
        const record = services.helpers.require(args.helper_id)
        if (record.botId !== caller.id) requireMain(caller)
        const stopped = await runtime.helpers.stop(record)
        return { ok: true, helper: { id: stopped.id, title: stopped.title, status: stopped.status } }
      },
    }),
  ]

  const disposers = []
  for (const tool of tools) {
    try {
      const when = HELPER_TOOL_NAMES.has(tool.name) ? helperVisible : visible
      disposers.push(registry.register(tool, { when }))
    } catch (error) {
      // One registration failure must not cost the other tools.
      console.warn(`[dsh-bot] tool ${tool.name} could not be registered`, error)
    }
  }
  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* the registry is going away */
      }
    }
  }
}

/** A short announcement the prompt can use, listing exactly the registered names. */
export const BOT_TOOL_GUIDANCE = TOOL_NAMES.join(', ')
