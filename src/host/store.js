/**
 * The Host-authoritative bot store: one JSON document for the ledger, one
 * append-only JSONL per chat for messages, and one append-only JSONL for usage.
 *
 * Four rules decide this file:
 * - atomic writes only: a fsynced temporary file plus rename, so a crash leaves
 *   the previous document intact rather than a truncated one;
 * - one writer: every write is chained through one promise, so two callers never
 *   interleave inside one file;
 * - append-only message logs: a message update appends a new snapshot and the
 *   reader folds by id, so a crash can only lose the very last line;
 * - fail closed: an unreadable state document is reported and never reset,
 *   quarantined or overwritten — a user's Bots are not this plugin's to discard.
 *
 * @module @lisongjianustc/dsh-bot/host/store
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { BotError } from './errors.js'

/** The plugin-owned directory name under the DSH home. */
export const BOT_HOME_DIRECTORY = 'dsh-bot'
/** The workspace directory Bots share, inside the plugin directory. */
export const BOT_WORKSPACE_DIRECTORY = 'workspace'
/** The ledger document's schema version. */
export const STATE_VERSION = 1
/** How many characters one state file may reach before a write is refused. */
export const STATE_MAX_BYTES = 16 * 1024 * 1024

/**
 * Resolve the DSH home directory: the environment override wins, the platform
 * home fallback follows.
 * @param {NodeJS.ProcessEnv} [env] - environment to read `DSH_HOME` from.
 * @param {string} [home] - platform home directory fallback (test seam).
 * @returns {string} the absolute DSH home path.
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const raw = env.DSH_HOME
  if (raw !== undefined && String(raw).trim() !== '') {
    const trimmed = String(raw).trim()
    const expanded = trimmed.startsWith('~') ? join(home, trimmed.slice(2)) : trimmed
    return expanded.startsWith('/') || /^[A-Za-z]:[\\/]/.test(expanded) ? expanded : join(process.cwd(), expanded)
  }
  return join(home, '.dsh')
}

/**
 * The plugin-owned storage directory: `$DSH_HOME/dsh-bot`.
 * @param {NodeJS.ProcessEnv} [env] - environment to read.
 * @param {string} [home] - platform home fallback (test seam).
 * @returns {string} the absolute plugin directory.
 */
export function botHomeDirectory(env = process.env, home = homedir()) {
  return join(resolveDshHome(env, home), BOT_HOME_DIRECTORY)
}

/**
 * The shared Bot workspace path: `$DSH_HOME/dsh-bot/workspace`.
 * @param {string} homeDir - the plugin directory.
 * @returns {string} the workspace path.
 */
export function botWorkspaceDirectory(homeDir) {
  return join(homeDir, BOT_WORKSPACE_DIRECTORY)
}

/**
 * The default display name of the human user.
 * @returns {string} the login name, or `owner`.
 */
export function defaultUserName() {
  try {
    const name = userInfo().username
    if (typeof name === 'string' && name.trim() !== '') return name.trim()
  } catch {
    /* a host without user info still gets a ledger */
  }
  return process.env.USER || process.env.USERNAME || 'owner'
}

/**
 * The empty ledger document.
 * @param {string} [userName] - display name of the human.
 * @returns {object} a fresh state document.
 */
export function defaultState(userName = defaultUserName()) {
  return {
    version: STATE_VERSION,
    rev: 1,
    self: { id: 'owner', name: userName },
    bots: [],
    groups: [],
    chats: [],
    /** chatId -> botId -> { sessionId, stamp, memoryStamp, lastSeenSeq } */
    sessions: {},
    settings: { userName, language: 'zh' },
    /** scope key (`team` or a Bot id) -> entries */
    memory: { team: [], bots: {} },
    /** local schedule id -> { id, botId, title, prompt, timing, nativeId, createdAt } */
    schedules: {},
    /** helperId -> background-helper record */
    helpers: [],
    /** attachmentId -> uploaded-file record */
    attachments: {},
    /** taskId -> dispatched-task record */
    tasks: [],
    /** pending auto-memory candidates (never injected into prompts) */
    memoryCandidates: [],
    /** batchId -> dispatch batch receipt metadata */
    taskBatches: {},
  }
}

/** Write one JSON document atomically: tmp file, fsync, rename, fsync directory. */
function writeJsonAtomic(path, value) {
  const body = JSON.stringify(value, null, 2)
  if (Buffer.byteLength(body, 'utf8') > STATE_MAX_BYTES) {
    throw new BotError('ledger-unavailable', `the bot ledger would exceed ${STATE_MAX_BYTES} bytes and was not written`)
  }
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  let fd
  try {
    fd = openSync(tmp, 'w')
    writeSync(fd, body, null, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmp, path)
    // The rename itself is durable only once the directory entry is synced.
    const dir = openSync(join(path, '..'), 'r')
    try {
      fsyncSync(dir)
    } finally {
      closeSync(dir)
    }
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* the original failure is the one worth reporting */
      }
    }
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* best effort: a leftover tmp file never affects a read */
    }
    throw error
  }
}

/** Append one JSON line durably: write, fsync, close. */
function appendJsonLine(path, value) {
  const line = `${JSON.stringify(value)}\n`
  const fd = openSync(path, 'a')
  try {
    writeSync(fd, line, null, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Parse a JSON lines file, skipping a torn trailing line and unreadable rows. */
function readJsonLines(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return []
    throw error
  }
  const rows = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      /* a torn line is the one a crash can leave; the rest of the log is intact */
    }
  }
  return rows
}

/** A filesystem-safe file name for a chat id. */
function messageFileName(chatId) {
  return `${String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`
}

/**
 * Create the store over `$DSH_HOME/dsh-bot`.
 * @param {object} ctx - the plugin context (only used for logging).
 * @param {{ dir?: string, now?: () => number }} [options] - test seams.
 * @returns {object} the store.
 */
export function createStore(ctx, options = {}) {
  const homeDir = options.dir ?? botHomeDirectory()
  const now = options.now ?? (() => Date.now())
  const statePath = join(homeDir, 'state.json')
  const messagesDir = join(homeDir, 'messages')
  const usagePath = join(homeDir, 'usage.jsonl')
  const uploadsDir = join(homeDir, 'uploads')
  const workspaceDir = botWorkspaceDirectory(homeDir)

  mkdirSync(messagesDir, { recursive: true })
  mkdirSync(workspaceDir, { recursive: true })
  mkdirSync(uploadsDir, { recursive: true })

  let db
  if (existsSync(statePath)) {
    let raw
    try {
      raw = readFileSync(statePath, 'utf8')
    } catch (error) {
      throw new BotError('ledger-unavailable', `the bot ledger at ${statePath} cannot be read: ${String(error?.message ?? error)}`, { cause: error })
    }
    try {
      db = JSON.parse(raw)
    } catch (error) {
      throw new BotError('ledger-unavailable', `the bot ledger at ${statePath} is not valid JSON; it is left untouched for the user to inspect`, { cause: error })
    }
    if (typeof db !== 'object' || db === null || Array.isArray(db)) {
      throw new BotError('ledger-unavailable', `the bot ledger at ${statePath} is not a ledger document; it is left untouched`)
    }
  } else {
    db = defaultState()
    writeJsonAtomic(statePath, db)
  }

  // Fill fields a hand-edited or older document may lack, without discarding anything.
  db.bots = Array.isArray(db.bots) ? db.bots : []
  db.groups = Array.isArray(db.groups) ? db.groups : []
  db.chats = Array.isArray(db.chats) ? db.chats : []
  db.sessions = typeof db.sessions === 'object' && db.sessions !== null && !Array.isArray(db.sessions) ? db.sessions : {}
  db.settings = typeof db.settings === 'object' && db.settings !== null ? db.settings : { userName: defaultUserName(), language: 'zh' }
  db.memory = typeof db.memory === 'object' && db.memory !== null ? db.memory : { team: [], bots: {} }
  db.memory.team = Array.isArray(db.memory.team) ? db.memory.team : []
  db.memory.bots = typeof db.memory.bots === 'object' && db.memory.bots !== null && !Array.isArray(db.memory.bots) ? db.memory.bots : {}
  db.schedules = typeof db.schedules === 'object' && db.schedules !== null && !Array.isArray(db.schedules) ? db.schedules : {}
  db.helpers = Array.isArray(db.helpers) ? db.helpers : []
  db.attachments = typeof db.attachments === 'object' && db.attachments !== null && !Array.isArray(db.attachments) ? db.attachments : {}
  db.tasks = Array.isArray(db.tasks) ? db.tasks : []
  db.memoryCandidates = Array.isArray(db.memoryCandidates) ? db.memoryCandidates : []
  db.taskBatches = typeof db.taskBatches === 'object' && db.taskBatches !== null && !Array.isArray(db.taskBatches) ? db.taskBatches : {}
  db.self = typeof db.self === 'object' && db.self !== null ? db.self : { id: 'owner', name: defaultUserName() }
  db.version = Number.isFinite(db.version) ? db.version : STATE_VERSION
  db.rev = Number.isFinite(db.rev) ? db.rev : 1

  /** The single-writer chain: every write lands after the previous one. */
  let writeChain = Promise.resolve()
  let closed = false

  const enqueue = (task) => {
    const next = writeChain.then(task, task)
    writeChain = next.then(() => undefined, () => undefined)
    return next
  }

  /** Touch the ledger revision, so a reader can tell a change happened. */
  const bump = () => {
    db.rev = (Number.isFinite(db.rev) ? db.rev : 0) + 1
    db.updatedAt = now()
  }

  /** Persist the ledger document. */
  const save = () => {
    if (closed) return Promise.reject(new BotError('ledger-unavailable', 'the bot ledger is closed'))
    bump()
    return enqueue(() => writeJsonAtomic(statePath, db))
  }

  /** chatId -> folded messages, ascending by seq. */
  const messageCache = new Map()

  const loadMessages = (chatId) => {
    let cache = messageCache.get(chatId)
    if (cache !== undefined) return cache
    const rows = readJsonLines(join(messagesDir, messageFileName(chatId)))
    const byId = new Map()
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || typeof row.id !== 'string') continue
      byId.set(row.id, { ...(byId.get(row.id) ?? {}), ...row })
    }
    const messages = [...byId.values()].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0))
    cache = { messages, byId }
    messageCache.set(chatId, cache)
    return cache
  }

  /** The highest seq the log holds for a chat. */
  const maxSeq = (chatId) => {
    const { messages } = loadMessages(chatId)
    return messages.length === 0 ? 0 : Number(messages.at(-1).seq) || 0
  }

  /**
   * Append one message (or one update of it) and return the stored value.
   * The caller supplies the id; `seq` is assigned on first append only.
   */
  const appendMessage = (chatId, partial) => {
    if (closed) return Promise.reject(new BotError('ledger-unavailable', 'the bot ledger is closed'))
    return enqueue(async () => {
      const cache = loadMessages(chatId)
      const existing = partial.id === undefined ? undefined : cache.byId.get(partial.id)
      const recorded = {
        ...(existing ?? {}),
        ...partial,
        chatId,
        id: partial.id ?? `msg_${Math.random().toString(16).slice(2, 14)}`,
        seq: existing?.seq ?? maxSeq(chatId) + 1,
        ts: existing?.ts ?? partial.ts ?? now(),
      }
      appendJsonLine(join(messagesDir, messageFileName(chatId)), recorded)
      cache.byId.set(recorded.id, recorded)
      if (existing === undefined) cache.messages.push(recorded)
      else {
        const index = cache.messages.findIndex(message => message.id === recorded.id)
        if (index >= 0) cache.messages[index] = recorded
      }
      return recorded
    })
  }

  /** Read the folded messages of one chat, ascending. */
  const readMessages = (chatId) => [...loadMessages(chatId).messages]

  /** Drop one chat's message log (used when its Bot or group is deleted). */
  const dropMessages = (chatId) => {
    messageCache.delete(chatId)
    try {
      unlinkSync(join(messagesDir, messageFileName(chatId)))
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error
    }
  }

  /** One page of messages, newest-last, with a `before` seq cursor. */
  const pageMessages = (chatId, { before, limit = 200 } = {}) => {
    const all = readMessages(chatId)
    const bounded = Math.max(1, Math.min(500, Number(limit) || 200))
    const upper = before === undefined || before === null || Number.isNaN(Number(before))
      ? all.length
      : all.findIndex(message => Number(message.seq) >= Number(before))
    const end = upper < 0 ? all.length : upper
    const start = Math.max(0, end - bounded)
    return { messages: all.slice(start, end), hasMore: start > 0 }
  }

  /** Append one usage row. */
  const appendUsage = (row) => {
    if (closed) return Promise.reject(new BotError('ledger-unavailable', 'the bot ledger is closed'))
    return enqueue(async () => {
      appendJsonLine(usagePath, row)
      if (typeof row?.turnId === 'string' && row.turnId !== '') usageIds.add(row.turnId)
      return row
    })
  }

  /** Read usage rows at or after one timestamp, skipping torn lines. */
  const readUsage = (sinceTs = 0) => readJsonLines(usagePath)
    .filter(row => typeof row === 'object' && row !== null && Number(row.ts) >= Number(sinceTs))

  /** The turn ids already recorded, so a retried finalize never double-counts. */
  const usageIds = new Set()
  let usageIdsLoaded = false
  const hasUsage = (turnId) => {
    if (!usageIdsLoaded) {
      for (const row of readUsage(0)) if (typeof row.turnId === 'string') usageIds.add(row.turnId)
      usageIdsLoaded = true
    }
    return usageIds.has(turnId)
  }

  return {
    homeDir,
    workspaceDir,
    statePath,
    messagesDir,
    uploadsDir,
    usagePath,
    get db() {
      return db
    },
    save,
    appendMessage,
    readMessages,
    pageMessages,
    dropMessages,
    maxSeq,
    appendUsage,
    readUsage,
    hasUsage,
    /** Wait for every in-flight write and stop accepting new ones. */
    close: async () => {
      if (closed) return
      await writeChain.catch(() => undefined)
      closed = true
    },
    /** Test seam: whether the store still accepts writes. */
    get isClosed() {
      return closed
    },
  }
}
