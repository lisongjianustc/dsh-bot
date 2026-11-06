/**
 * Dispatched tasks: the MiniMax `dispatch_tasks` / `get_tasks` /
 * `cancel_tasks` surface rebuilt on this plugin's own chat orchestration.
 *
 * `bot_dispatch_tasks` is an admission, not a result: it validates a batch,
 * records it as `queued`, returns a receipt, and drives the work in the
 * background. Each task reuses the dispatcher that a Bot itself would use:
 * `messageBot` for a Bot target and `postGroup` for a discussion target.
 *
 * The state machine is `queued -> running -> done | failed | cancelled`, plus
 * `unknown` for a task the Host was running when it died (never replayed). A
 * batch is a receipt: its tasks share one `requestId`, and dispatching the same
 * request id with the same fingerprint returns that receipt instead of running
 * the work twice.
 *
 * Results are written into the task and posted back into the origin chat as one
 * relay message per task, with the deterministic id `msg_task_<taskId>`, so a
 * retried settle can never post the same result twice.
 *
 * @module @lisongjianustc/dsh-bot/host/tasks
 */
import { BotError, describeError } from './errors.js'
import { clip, newId, sha256, sleep } from './util.js'

/** How many tasks one dispatch may carry. */
export const TASKS_PER_BATCH = 32
/** The longest one task message may be. */
export const TASK_MESSAGE_MAX = 20000
/** The longest result a task keeps. */
export const TASK_RESULT_MAX = 8000
/** How long `bot_get_tasks` may wait for a change. */
export const TASK_WAIT_MAX = 20000
/** How many tasks run at once. */
export const TASK_CONCURRENCY = 2
/** How often a waiting get re-reads the ledger. */
const WAIT_POLL_MS = 100

/** A caller-supplied idempotency key. */
export const REQUEST_ID_RE = /^[\w.-]{1,128}$/

/** The request fingerprint of one batch: same work, same bytes. */
export function fingerprintOf(ownerBotId, entries) {
  return sha256(JSON.stringify({
    owner: String(ownerBotId ?? ''),
    tasks: entries.map(entry => ({ to: String(entry.to ?? ''), message: String(entry.message ?? ''), title: String(entry.title ?? '') })),
  }))
}

/**
 * Resolve one `to` reference into a Bot task or a discussion task.
 * @param {object} services - the business services.
 * @param {string} to - a Bot id/name, a group id/name, or `group:<ref>` / `#<ref>`.
 * @returns {{ kind: 'bot'|'discussion', botId?: string, groupId?: string }} the target.
 */
export function resolveTarget(services, to) {
  const raw = String(to ?? '').trim()
  if (raw === '') throw new BotError('invalid-request', 'a task needs a target ("to")')
  let groupRef
  if (raw.startsWith('group:')) groupRef = raw.slice('group:'.length)
  else if (raw.startsWith('#')) groupRef = raw.slice(1)
  if (groupRef !== undefined) {
    const group = services.groups.get(groupRef)
    if (group === undefined) throw new BotError('group-not-found', `no group matches "${groupRef}"`)
    return { kind: 'discussion', groupId: group.id }
  }
  const bot = services.bots.get(raw)
  if (bot !== undefined) return { kind: 'bot', botId: bot.id }
  // A bare group name is accepted only when no Bot owns that name.
  const group = services.groups.get(raw)
  if (group !== undefined) return { kind: 'discussion', groupId: group.id }
  throw new BotError('bot-not-found', `no bot or group matches "${raw}"`)
}

/**
 * Create the task engine.
 * @param {{ ctx: object, services: object, dispatcher: object }} input - wiring.
 * @returns {object} the engine.
 */
export function createTasks({ ctx, services, dispatcher }) {
  const log = (level, message, error) => {
    const logger = ctx?.logger
    if (logger && typeof logger[level] === 'function') logger[level](`[dsh-bot] ${message}`, error)
    else if (level === 'warn' || level === 'error') console.warn(`[dsh-bot] ${message}`, error ?? '')
  }

  /** taskIds waiting for a slot, oldest first. */
  const queue = []
  /** taskIds currently executing. */
  const running = new Set()
  /** taskId -> true when a cancel arrived while it was running. */
  const cancelRequested = new Set()
  let disposed = false
  let pumping = false

  const batchOf = (batchId) => services.tasks.batch(batchId)
  const tasksOfBatch = (batchId) => services.tasks.list().filter(task => task.batchId === batchId)

  /** Derive one batch's status from its tasks. */
  const refreshBatch = async (batchId) => {
    const batch = batchOf(batchId)
    if (batch === undefined) return
    const rows = tasksOfBatch(batchId)
    let status = 'done'
    if (rows.length === 0) status = 'queued'
    else if (rows.some(task => task.status === 'running')) status = 'running'
    else if (rows.some(task => task.status === 'queued')) status = 'running'
    else if (rows.every(task => task.status === 'cancelled')) status = 'cancelled'
    else if (rows.some(task => task.status === 'failed' || task.status === 'unknown')) status = 'failed'
    else status = 'done'
    if (batch.status !== status) await services.tasks.updateBatch(batchId, { status, updatedAt: Date.now() })
  }

  /** The relay line that carries one task's result into the origin chat. */
  const relayText = (task) => {
    const zh = (typeof services.language === 'function' ? services.language() : 'zh') === 'zh'
    const head = zh ? `[任务「${task.title || clip(task.text, 40)}」· ${task.status}]` : `[task "${task.title || clip(task.text, 40)}" · ${task.status}]`
    const body = task.error !== undefined ? task.error : (task.result ?? '')
    return `${head}\n${body}`
  }

  /** Post one settled task's result back, idempotently. */
  const postResult = async (task) => {
    const chat = services.chats.get(task.originChatId)
    if (chat === undefined) return
    const messageId = `msg_task_${task.id}`
    const existing = services.messages.list(chat.id).find(message => message.id === messageId)
    if (existing !== undefined) {
      if (task.messageId !== messageId) await services.tasks.update(task.id, { messageId })
      return
    }
    const text = relayText(task)
    try {
      const message = await services.messages.append(chat.id, {
        id: messageId,
        role: 'relay',
        ...(task.botId === undefined ? {} : { botId: task.botId }),
        text,
        status: 'done',
        parts: [{ type: 'text', text }],
        ...(task.batchId === undefined ? {} : { taskBatchId: task.batchId }),
      })
      await services.tasks.update(task.id, { messageId })
      log('info', `task ${task.id} posted its result as ${message.id}`)
    } catch (error) {
      log('warn', `the result of task ${task.id} could not be posted back`, error)
    }
  }

  /** Execute one task through the dispatcher the Bot itself would use. */
  const execute = async (task) => {
    if (task.kind === 'discussion') {
      const round = await dispatcher.postGroup({ callerBotId: task.ownerBotId, group: task.groupId, text: task.text })
      const lines = (round?.noteRound ?? []).map(entry => `[${entry.speaker}] ${entry.text}`)
      return lines.length > 0 ? lines.join('\n') : clip(String(round?.text ?? ''), TASK_RESULT_MAX)
    }
    const answer = await dispatcher.messageBot({ callerBotId: task.ownerBotId, to: task.botId, text: task.text })
    return String(answer?.text ?? '')
  }

  /** Settle one finished execution exactly once. */
  const settle = async (task, status, payload) => {
    const current = services.tasks.get(task.id)
    if (current === undefined) return
    // A task cancelled while running stays cancelled: its late output is dropped.
    const finalStatus = cancelRequested.has(task.id) ? 'cancelled' : status
    cancelRequested.delete(task.id)
    await services.tasks.update(task.id, {
      status: finalStatus,
      ...(finalStatus === 'done' ? { result: clip(String(payload ?? ''), TASK_RESULT_MAX) } : {}),
      ...(finalStatus === 'failed' ? { error: clip(String(payload ?? ''), 800) } : {}),
      endedAt: Date.now(),
    })
    if (finalStatus !== 'cancelled') {
      const updated = services.tasks.get(task.id)
      if (updated !== undefined) await postResult(updated)
    }
    await refreshBatch(task.batchId)
  }

  /** Run one queued task and settle it. */
  const runTask = async (taskId) => {
    const task = services.tasks.get(taskId)
    if (task === undefined || task.status !== 'queued') return
    running.add(taskId)
    await services.tasks.update(taskId, { status: 'running', startedAt: Date.now() })
    await refreshBatch(task.batchId)
    try {
      const result = await execute(task)
      await settle(task, 'done', result)
    } catch (error) {
      await settle(task, 'failed', describeError(error))
    } finally {
      running.delete(taskId)
    }
  }

  /** Keep up to TASK_CONCURRENCY tasks running, oldest first. */
  const pump = () => {
    if (disposed || pumping) return
    pumping = true
    try {
      while (!disposed && running.size < TASK_CONCURRENCY && queue.length > 0) {
        const taskId = queue.shift()
        const task = services.tasks.get(taskId)
        if (task === undefined || task.status !== 'queued') continue
        running.add(taskId)
        void runTask(taskId).finally(() => {
          running.delete(taskId)
          queueMicrotask(() => {
            pumping = false
            pump()
          })
        })
      }
    } finally {
      pumping = false
    }
  }

  const enqueue = (taskId) => {
    if (!queue.includes(taskId)) queue.push(taskId)
    pump()
  }

  /**
   * Admit one batch of tasks.
   * @param {object} input - the dispatch request.
   * @param {object} input.ownerBot - the calling Bot.
   * @param {object} input.originChat - the chat the receipt returns to.
   * @param {{to: string, message: string, title?: string}[]} input.entries - the tasks.
   * @param {string} [input.requestId] - the idempotency key.
   * @returns {Promise<object>} the receipt.
   */
  const dispatch = async ({ ownerBot, originChat, entries, requestId }) => {
    if (disposed) throw new BotError('session-unavailable', 'the task engine is shutting down')
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > TASKS_PER_BATCH) {
      throw new BotError('invalid-request', `a dispatch carries 1 to ${TASKS_PER_BATCH} tasks`)
    }
    const normalized = entries.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new BotError('invalid-request', `task ${index + 1} is not an object`)
      }
      const message = String(entry.message ?? '').trim()
      if (message === '') throw new BotError('invalid-request', `task ${index + 1} has no message`)
      if (message.length > TASK_MESSAGE_MAX) {
        throw new BotError('invalid-request', `task ${index + 1} exceeds ${TASK_MESSAGE_MAX} characters`)
      }
      return { to: String(entry.to ?? '').trim(), message, title: clip(String(entry.title ?? '').trim(), 80) }
    })
    if (requestId !== undefined && !REQUEST_ID_RE.test(String(requestId))) {
      throw new BotError('invalid-request', 'request_id is 1..128 letters, digits, dots, dashes or underscores')
    }
    const fingerprint = fingerprintOf(ownerBot.id, normalized)
    if (requestId !== undefined) {
      const existing = services.tasks.batchByRequest(ownerBot.id, String(requestId))
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) {
          throw new BotError('request-conflict', `request_id "${requestId}" was already used for different tasks`)
        }
        // Same request, same work: answer the original receipt, run nothing new.
        const rows = tasksOfBatch(existing.id).map(task => ({ id: task.id, status: task.status, kind: task.kind }))
        return {
          ok: true,
          batchId: existing.id,
          requestId: existing.requestId,
          tasks: rows,
          duplicate: true,
        }
      }
    }
    const resolved = normalized.map(entry => ({
      ...entry,
      target: resolveTarget(services, entry.to),
    }))
    const batchId = newId('batch')
    const finalRequestId = String(requestId ?? finalId())
    const now = Date.now()
    const records = resolved.map((entry) => ({
      id: newId('task'),
      kind: entry.target.kind,
      ...(entry.target.botId === undefined ? {} : { botId: entry.target.botId }),
      ...(entry.target.groupId === undefined ? {} : { groupId: entry.target.groupId }),
      text: entry.message,
      title: entry.title || clip(entry.message, 40),
      status: 'queued',
      requestId: finalRequestId,
      batchId,
      ownerBotId: ownerBot.id,
      originChatId: originChat.id,
      dependsOn: [],
      createdAt: now,
    }))
    await services.tasks.createMany(records)
    await services.tasks.createBatch({
      id: batchId,
      ownerBotId: ownerBot.id,
      requestId: finalRequestId,
      fingerprint,
      originChatId: originChat.id,
      taskIds: records.map(record => record.id),
      status: 'queued',
      createdAt: now,
    })
    for (const record of records) enqueue(record.id)
    return {
      ok: true,
      batchId,
      requestId: finalRequestId,
      tasks: records.map(record => ({ id: record.id, status: 'queued', kind: record.kind })),
    }
  }

  /** An auto request id, stable in shape so a retried receipt stays readable. */
  const finalId = () => `req_${newId('x').slice(2)}`

  /** The tasks one get/cancel selector names, scoped to the caller. */
  const select = ({ ownerBotId, taskId, batchId, requestId }) => {
    if (taskId === undefined && batchId === undefined && requestId === undefined) {
      throw new BotError('invalid-request', 'name a task_id, a batch_id or a request_id')
    }
    let rows = services.tasks.list().filter(task => task.ownerBotId === ownerBotId)
    if (taskId !== undefined) {
      const task = rows.find(candidate => candidate.id === taskId)
      if (task === undefined) throw new BotError('invalid-request', `no task matches "${taskId}"`)
      return [task]
    }
    if (batchId !== undefined) {
      const batch = batchOf(batchId)
      if (batch === undefined || batch.ownerBotId !== ownerBotId) throw new BotError('invalid-request', `no batch matches "${batchId}"`)
      return rows.filter(task => task.batchId === batchId)
    }
    const batch = services.tasks.batchByRequest(ownerBotId, String(requestId))
    if (batch === undefined) throw new BotError('invalid-request', `no batch matches request_id "${requestId}"`)
    return rows.filter(task => task.batchId === batch.id)
  }

  /** One task with its result page. */
  const pageTask = (task, resultOffset) => {
    const view = services.tasks.taskView(task)
    const result = view.result ?? ''
    if (result === '') return { ...view, result: '', resultOffset: 0, resultComplete: true }
    const offset = Math.max(0, Math.min(Number(resultOffset) || 0, result.length))
    const page = result.slice(offset, offset + TASK_RESULT_MAX)
    return {
      ...view,
      result: page,
      resultOffset: offset,
      nextResultOffset: offset + page.length < result.length ? offset + page.length : null,
      resultComplete: offset + page.length >= result.length,
    }
  }

  /**
   * Read tasks/batches, optionally waiting for a status change.
   * @param {object} input - the query.
   * @returns {Promise<object>} the current state.
   */
  const get = async ({ ownerBotId, taskId, batchId, requestId, waitMs, resultOffset }) => {
    const rows = select({ ownerBotId, taskId, batchId, requestId })
    const wait = Math.max(0, Math.min(TASK_WAIT_MAX, Number(waitMs) || 0))
    if (wait > 0) {
      const signature = () => rows.map(task => `${task.id}:${task.status}`).join('|')
      const started = signature()
      const deadline = Date.now() + wait
      while (Date.now() < deadline) {
        await sleep(Math.min(WAIT_POLL_MS, Math.max(1, deadline - Date.now())))
        const current = select({ ownerBotId, taskId, batchId, requestId })
        if (current.map(task => `${task.id}:${task.status}`).join('|') !== started) {
          rows.length = 0
          rows.push(...current)
          break
        }
      }
    }
    const batches = [...new Set(rows.map(task => task.batchId).filter(Boolean))]
      .map(id => batchOf(id))
      .filter(Boolean)
      .map(batch => ({
        id: batch.id,
        requestId: batch.requestId,
        status: batch.status,
        createdAt: batch.createdAt,
        taskIds: [...(batch.taskIds ?? [])],
      }))
    return {
      ok: true,
      tasks: rows.map(task => pageTask(task, resultOffset)),
      batches,
    }
  }

  /**
   * Cancel the tasks a selector names. Queued tasks are cancelled at once;
   * a running task is marked so its late output is dropped.
   * @param {object} input - the cancel request.
   * @returns {Promise<object>} what happened.
   */
  const cancel = async ({ ownerBotId, taskId, batchId }) => {
    const rows = select({ ownerBotId, taskId, batchId })
    const cancelled = []
    const ignored = []
    const visit = (task) => {
      if (task.status === 'queued') {
        cancelRequested.add(task.id)
        void services.tasks.update(task.id, { status: 'cancelled', endedAt: Date.now(), error: 'cancelled by the caller' }).then(() => refreshBatch(task.batchId))
        cancelled.push(task.id)
      } else if (task.status === 'running') {
        cancelRequested.add(task.id)
        cancelled.push(task.id)
      } else {
        ignored.push(task.id)
      }
      // Dependencies of a cancelled task are cancelled with it.
      for (const dependencyId of task.dependsOn ?? []) {
        const dependency = services.tasks.get(dependencyId)
        if (dependency !== undefined && dependency.ownerBotId === ownerBotId && !cancelled.includes(dependency.id)) visit(dependency)
      }
    }
    rows.forEach(visit)
    for (const id of new Set(rows.map(task => task.batchId).filter(Boolean))) await refreshBatch(id)
    return { ok: true, cancelled, ignored }
  }

  // Restart recovery: a task the Host was running is unknown and never replayed;
  // a queued task resumes because its input is durable.
  const recover = async () => {
    const now = Date.now()
    for (const task of services.tasks.list()) {
      if (task.status === 'running') {
        await services.tasks.update(task.id, {
          status: 'unknown',
          error: 'the host restarted while this task was running; it was not replayed',
          endedAt: now,
        })
      }
    }
    for (const batch of services.tasks.batches()) await refreshBatch(batch.id)
    const queued = services.tasks.list().filter(task => task.status === 'queued')
    for (const task of queued) enqueue(task.id)
  }
  queueMicrotask(() => { void recover().catch(error => log('warn', 'the task engine recovery did not finish', error)) })

  return {
    dispatch,
    get,
    cancel,
    /** Test seam: how many tasks are executing right now. */
    get runningCount() {
      return running.size
    },
    /** Test seam: how many tasks are queued right now. */
    get queuedCount() {
      return queue.length
    },
    dispose() {
      disposed = true
      queue.length = 0
    },
  }
}
