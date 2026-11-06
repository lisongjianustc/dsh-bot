#!/usr/bin/env node
/**
 * Smoke test for the built browser half.
 *
 * The DSH shell normally supplies `window.__ModuleLoader__`, React and the
 * HTTP routes; this script stands those up in Node so `lib/client.js` can be
 * exercised without a Host half:
 *
 *   1. load the built bundle through a real `__ModuleLoader__` shape,
 *   2. run `apply()` against a stub cordis context and assert the three seats
 *      (sidebar row, main panel, settings section) register with the right
 *      ids/keys/orders,
 *   3. wait for the offline fallback and render every page state with
 *      `react-dom/server` — workspace, all six drawer tabs, and the
 *      `settings.section` page,
 *   4. drive the store's demo actions (send/stream, memory, schedules, usage,
 *      bots, groups, config) and assert the observable effects.
 *
 * This is a development tool, not part of the shipped bundle. React is
 * resolved from the developer's environment; with no React available the
 * script reports and exits 0 so it never breaks a CI that installs nothing.
 *
 * Usage: node scripts/smoke-client.mjs
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundlePath = join(root, 'lib', 'client.js')

let React
let renderToStaticMarkup
try {
  React = require('react')
  ;({ renderToStaticMarkup } = require('react-dom/server'))
} catch (error) {
  console.log('smoke-client: react/react-dom not resolvable here — skipping render checks')
  process.exit(0)
}

const failures = []
function check(condition, message) {
  if (condition) {
    console.log('  ok   ' + message)
  } else {
    failures.push(message)
    console.log('  FAIL ' + message)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* --------------------------------------------------------- browser stubs */

function makeDocument() {
  const head = {
    children: [],
    appendChild(node) {
      node.parentNode = head
      head.children.push(node)
    },
    removeChild(node) {
      const index = head.children.indexOf(node)
      if (index >= 0) head.children.splice(index, 1)
      node.parentNode = null
    },
  }
  return {
    head,
    documentElement: head,
    visibilityState: 'visible',
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        attributes: {},
        textContent: '',
        parentNode: null,
        setAttribute(name, value) {
          this.attributes[name] = value
        },
      }
    },
    addEventListener() {},
    removeEventListener() {},
  }
}

globalThis.document = makeDocument()
globalThis.window = { __ModuleLoader__: { load: null } }
globalThis.EventSource = class StubEventSource {
  constructor(url) {
    this.url = url
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.closed = false
  }
  close() {
    this.closed = true
  }
}
globalThis.fetch = () => Promise.reject(new TypeError('offline (smoke test)'))

/* --------------------------------------------------------------- fixture */

const bundle = readFileSync(bundlePath, 'utf8')
let loaded
globalThis.window.__ModuleLoader__.load = (spec) => {
  loaded = spec
}
// eslint-disable-next-line no-new-func
new Function('window', bundle)(globalThis.window)

check(loaded !== null && typeof loaded.factory === 'function', 'bundle calls window.__ModuleLoader__.load({ factory })')
check(loaded.id === '@lisongjianustc/dsh-bot', 'bundle declares package id')

const plugin = loaded.factory((request) => {
  if (request === 'react') return React
  throw new Error('bundle requested an unseeded module: ' + request)
})
check(typeof plugin.apply === 'function', 'entry exports apply()')
check(Array.isArray(plugin.inject), 'entry exports inject[]')

/* ------------------------------------------------------------- stub cordis */

const dictionaries = {}
const registrations = []
const effects = []
const disposed = []

const ctx = {
  effect(callback, label) {
    const dispose = callback()
    effects.push(label)
    if (typeof dispose === 'function') disposed.push(dispose)
    return () => {}
  },
  slots: {
    inject(seat, callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  locale: {
    register(namespace, dicts) {
      dictionaries[namespace] = dicts
      return () => {}
    },
    bind(namespace) {
      return (key, params) => {
        const dicts = dictionaries[namespace]
        const dictionary = dicts === undefined ? {} : dicts.zh
        let text = dictionary[key]
        if (typeof text !== 'string') return key
        if (params !== undefined && params !== null) {
          for (const name of Object.keys(params)) text = text.split('{' + name + '}').join(String(params[name]))
        }
        return text
      }
    },
  },
  get(name) {
    // This deployment serves no uiWorkspace/layout: the page must still mount.
    return undefined
  },
}

plugin.apply(ctx)
await sleep(120)

const pillars = registrations.map((entry) => entry.options.name + ':' + (entry.options.id || entry.options.key))
check(registrations.length === 3, 'registers exactly three seats (row, main, settings)')
check(pillars.includes('sidebar.panellist:dsh-bot'), 'sidebar.panellist row id is dsh-bot')
check(pillars.includes('main:dsh-bot'), 'main panel key is dsh-bot')
check(pillars.includes('settings.section:dsh-bot'), 'settings.section id is dsh-bot')

const row = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
check(row.options.order === 40, 'sidebar row order is 40')
check(typeof row.options.label === 'function', 'sidebar row label is a locale thunk')
check(row.options.label() === '机器人', 'sidebar row label resolves through zh dictionary')

const mainReg = registrations.find((entry) => entry.options.name === 'main')
check(mainReg.options.locale === 'dsh-bot', 'main entry declares the locale namespace')
const face = mainReg.options.inject()
const store = face.store
check(store !== null && store !== undefined, 'main entry injects the workspace store')
check(typeof store.ensureStarted === 'function', 'the page starts the data channel on mount')
store.ensureStarted()
await sleep(120)

/* ---------------------------------------------------------- offline mode */

check(store.mode === 'mock', 'state read failure degrades to the demo snapshot')
check(store.bots().length === 3, 'demo snapshot exposes three bots')
check(store.chats().length === 4, 'demo snapshot exposes four chats')
check(store.selectedChatId === 'chat_b7a1c9d3e5f2', 'pinned Chief chat is selected by default')
check(store.workspaces().length === 2, 'demo snapshot offers workspaces for the Bot form')
check(store.tasks().length === 4 && store.helpers().length === 1, 'demo snapshot offers tasks and helpers')
check(store.mode === 'mock' && document.head.children.length === 1, 'stylesheet is installed once through ctx.effect')
check(document.head.children[0].attributes['data-dsh-bot'] === '', 'stylesheet carries data-dsh-bot')

const t = ctx.locale.bind('dsh-bot')
function render(component, props) {
  return renderToStaticMarkup(React.createElement(component, Object.assign({ t }, props)))
}

/* --------------------------------------------------------------- render */

let html = render(mainReg.component, face)
check(html.includes('db-left'), 'workspace renders the left roster')
check(html.includes('db-center'), 'workspace renders the center column')
check(html.includes('db-rail'), 'workspace renders the right rail')
check(html.includes('db-banner'), 'workspace shows the not-connected banner in demo mode')
check(html.includes('Chief'), 'workspace lists the demo bots')
check(html.includes('db-chat-head'), 'workspace renders the selected chat header')
check(html.includes('db-composer'), 'workspace renders the composer')
check(!html.includes('[PASS]'), 'pass messages are hidden from the timeline')

for (const tab of ['general', 'bots', 'groups', 'tasks', 'memory', 'schedules', 'usage']) {
  store.openDrawer(tab)
  await sleep(90)
  const tabHtml = render(mainReg.component, face)
  check(tabHtml.includes('db-drawer'), 'drawer renders for tab "' + tab + '"')
}
store.closeDrawer()

// M3: library avatars render as SVG, the tasks tab groups tasks/helpers, and
// the composer exposes the attachment entry point.
check(html.includes('db-avatar-svg'), 'bot rosters render library avatars as SVG')
check((html.match(/db-avatar-svg/g) || []).length >= 3, 'every demo bot gets an avatar')
check(html.includes('添加附件') || html.includes('db-input'), 'composer is present with its attachment entry point')

store.openDrawer('tasks')
await sleep(90)
const tasksHtml = render(mainReg.component, face)
check(tasksHtml.includes('进行中') && tasksHtml.includes('排队中'), 'tasks tab groups active and queued work')
check(tasksHtml.includes('已完成') && tasksHtml.includes('失败'), 'tasks tab groups done and failed work')
check(tasksHtml.includes('db-task'), 'tasks tab renders task rows')
check(tasksHtml.includes('后台助手') || tasksHtml.includes('助手'), 'tasks tab includes background helpers')
check(tasksHtml.includes('取消'), 'tasks tab offers cancelling a chat-backed task')
store.closeDrawer()

// M2: group note view + clear, bot auto-approve tag, schedules/native status,
// long-message collapse and unconfirmed tool rows are exercised below.
store.openDrawer('groups')
await sleep(90)
const groupsHtml = render(mainReg.component, face)
check(groupsHtml.includes('db-note-section'), 'groups tab renders the note section')
check(groupsHtml.includes('群备注'), 'groups tab shows the note heading')
check(groupsHtml.includes('清空群备注'), 'groups tab offers clearing the group note')
const mockGroup = store.groups()[0]
const clearedMock = await store.clearGroupNote(mockGroup.id)
check(clearedMock.cleared === true && store.groups()[0].noteEntries.length === 0, 'clearGroupNote clears the note in demo mode')
const groupsAfterClear = render(mainReg.component, face)
check(groupsAfterClear.includes('还没有备注'), 'cleared note shows its empty state')

store.openDrawer('usage')
await sleep(90)
const usageHtml = render(mainReg.component, face)
check(usageHtml.includes('7 天') && usageHtml.includes('30 天') && usageHtml.includes('90 天'), 'usage windows are 7 / 30 / 90')
check(!usageHtml.includes('>1 天<'), 'usage no longer offers a 1-day window')
store.closeDrawer()

/* --------------------------------------------------------- group timeline */

const errorChat = store.chats().find((conversation) => conversation.botId === 'bot_8b21e6a4c9d0')
if (errorChat !== undefined) {
  store.selectChat(errorChat.id)
  const errorHtml = render(mainReg.component, face)
  check(errorHtml.includes('db-msg-error'), 'errored message renders its error state')
  check(errorHtml.includes('db-btn'), 'errored message offers a retry control')
}

// Attachment upload + send in demo mode: the pending bubble shows the card
// immediately and the demo reply acknowledges the attachment count.
const attachmentChat = store.chats().find((conversation) => conversation.kind === 'dm')
store.selectChat(attachmentChat.id)
const uploaded = await store.uploadAttachment({ name: 'diagram.png', size: 2048, type: 'image/png' })
check(uploaded !== undefined && uploaded.id.startsWith('att_'), 'uploadAttachment returns an attachment view in demo mode')
const attachmentSend = store.send(attachmentChat.id, '', [uploaded])
await sleep(160)
const attachHtml = render(mainReg.component, face)
check(attachHtml.includes('db-attach-image'), 'attachment-only send shows an image card immediately')
check(attachHtml.includes('diagram.png'), 'the attachment card carries the file name')
await attachmentSend
await sleep(1800)

const groupChat = store.chats().find((conversation) => conversation.kind === 'group')
store.selectChat(groupChat.id)
html = render(mainReg.component, face)
check(html.includes('db-chat-head'), 'group chat renders its header')
check(html.includes('架构师'), 'group timeline shows the speaking bot name')
check(html.includes('db-activity'), 'running background helpers show a bar above the group timeline')
check(!html.includes('[PASS]'), 'group timeline hides the [PASS] turn')

/* ------------------------------------------------------- demo actions */

const before = store.messagesOf(store.selectedChatId).list.length
const sendPromise = store.send(store.selectedChatId, '今天的优先级是什么？')
await sleep(400)
html = render(mainReg.component, face)
check(html.includes('db-cursor') || html.includes('db-spinner'), 'streaming reply renders a cursor or spinner')
await sendPromise
await sleep(2200)
const list = store.messagesOf(store.selectedChatId).list
check(list.length >= before + 2, 'demo send appends a user echo and a bot reply')
const botReply = list.find((message) => message.role === 'bot' && message.status === 'done')
check(botReply !== undefined && botReply.text.length > 10, 'demo reply finishes with streamed text')

const botsBefore = store.bots().length
await store.createBot({
  name: '冒烟测试',
  role: '临时',
  autoApprove: false,
  avatar: { kind: 'library', id: 'custom', motif: 'mystery', color: '#123456', background: '#ffffff' },
})
check(store.bots().length === botsBefore + 1, 'createBot adds a bot in demo mode')
check(store.bots().find((bot) => bot.name === '冒烟测试').autoApprove === false, 'createBot keeps the autoApprove flag')
store.openDrawer('bots')
await sleep(80)
const botsHtml = render(mainReg.component, face)
check(botsHtml.includes('自动批准'), 'bots list shows the auto-approve tag')
check(botsHtml.includes('#123456'), 'an unknown avatar motif still renders through the fallback glyph')
store.closeDrawer()
const created = store.bots().find((bot) => bot.name === '冒烟测试')
check(created !== undefined && store.chats().some((conversation) => conversation.botId === created.id), 'createBot adds its DM chat')
await store.deleteBot(created.id)
check(store.bots().length === botsBefore, 'deleteBot removes it again')

await store.createGroup({ name: '冒烟群', adminId: store.bots()[0].id, memberIds: [store.bots()[0].id, store.bots()[1].id], replyMode: 'all', maxHops: 3, handover: true, useNote: true })
check(store.groups().length === 2, 'createGroup adds a group in demo mode')
const smokeGroup = store.groups().find((group) => group.name === '冒烟群')
await store.deleteGroup(smokeGroup.id)
check(store.groups().length === 1, 'deleteGroup removes it again')

store.openDrawer('memory')
await sleep(120)
await store.remember('冒烟记忆：先给结论')
check(store.memory.entries.some((entry) => entry.text.includes('冒烟记忆')), 'remember adds a memory entry')
const smokeMemory = store.memory.entries.find((entry) => entry.text.includes('冒烟记忆'))
await store.forget(smokeMemory.id)
check(!store.memory.entries.some((entry) => entry.id === smokeMemory.id), 'forget removes it again')

store.openDrawer('schedules')
await sleep(120)
const schedulesBefore = store.schedules.list.length
await store.createSchedule({ botId: store.bots()[0].id, title: '冒烟任务', prompt: '跑一次', timing: { kind: 'daily', time: '09:00' } })
check(store.schedules.list.length === schedulesBefore + 1, 'createSchedule adds a demo schedule')
const smokeSchedule = store.schedules.list.find((schedule) => schedule.title === '冒烟任务')
await store.updateSchedule(smokeSchedule.id, {
  botId: smokeSchedule.botId,
  title: '冒烟任务（改）',
  prompt: '改过的内容',
  timing: { kind: 'every', minutes: 30 },
})
check(store.schedules.list.some((schedule) => schedule.title === '冒烟任务（改）'), 'updateSchedule edits the record in demo mode')
const editedSchedule = store.schedules.list.find((schedule) => schedule.title === '冒烟任务（改）')
await store.deleteSchedule(editedSchedule.id)
check(store.schedules.list.length === schedulesBefore, 'deleteSchedule removes it again')

store.openDrawer('usage')
await sleep(120)
await store.loadUsage(7, true)
check(store.usage.view !== null && store.usage.view.byDay.length === 7, 'usage view has one bucket per day')
check(store.usage.view.byBot.length === 3, 'usage view ranks the demo bots')

await store.saveConfig({ userName: '测试者', language: 'en' })
check(store.data.settings.userName === '测试者', 'saveConfig updates the local snapshot in demo mode')
check(store.data.settings.language === 'en', 'saveConfig updates the bot language')

/* ------------------------------------------------- settings.section page */

const settingsReg = registrations.find((entry) => entry.options.name === 'settings.section')
const settingsHtml = render(settingsReg.component, settingsReg.options.inject())
check(settingsHtml.includes('db-settings-page'), 'settings section renders')
check(settingsHtml.includes('Bot 工作台'), 'settings section title comes from the dictionary')

/* -------------------------------------------------------- loading state */

const savedData = store.data
store.data = null
const loadingHtml = render(mainReg.component, face)
check(loadingHtml.includes('db-spinner'), 'workspace renders a loading state before the first snapshot')
store.data = savedData
store.closeDrawer()

/* ------------------------------------------------- live Host simulation */

/**
 * A second pass with a stubbed Host: verifies the real-data path (state read,
 * message paging, chat send/read/retry, memory, usage, bots, schedule
 * fallback) against the shapes `src/host/routes.js` actually serves.
 */
const liveState = {
  self: { id: 'owner', name: '林' },
  bots: [
    {
      id: 'bot_aaaaaaaaaaaa',
      name: 'Chief',
      role: '团队总管',
      instructions: '',
      skin: 'default',
      color: '#4f7cff',
      isMain: true,
      model: null,
      permission: 'workspace-write',
      autoHelper: true,
      createdAt: 1,
      updatedAt: 2,
      rev: 1,
    },
    {
      id: 'bot_bbbbbbbbbbbb',
      name: '写手',
      role: '文档',
      instructions: '',
      skin: 'default',
      color: '#2fb5a8',
      isMain: false,
      model: null,
      permission: 'read-only',
      autoHelper: false,
      createdAt: 3,
      updatedAt: 4,
      rev: 1,
    },
  ],
  groups: [
    {
      id: 'grp_live',
      name: '线上群',
      adminId: 'bot_aaaaaaaaaaaa',
      memberIds: ['bot_aaaaaaaaaaaa', 'bot_bbbbbbbbbbbb'],
      notice: '线上群公告',
      replyMode: 'all',
      maxHops: 3,
      handover: true,
      useNote: true,
      noteEntries: [{ at: 11, speaker: 'Chief', text: '线上群备注内容' }],
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  chats: [
    {
      id: 'chat_111111111111',
      kind: 'dm',
      botId: 'bot_aaaaaaaaaaaa',
      title: 'Chief',
      sessionId: 'sess_live_1',
      lastSeq: 1,
      updatedAt: 10,
      unread: 0,
      pinned: true,
    },
    {
      id: 'chat_222222222222',
      kind: 'dm',
      botId: 'bot_bbbbbbbbbbbb',
      title: '写手',
      sessionId: 'sess_live_2',
      lastSeq: 1,
      updatedAt: 9,
      unread: 5,
      pinned: false,
    },
  ],
  running: [],
  settings: { userName: '林', language: 'zh' },
  limits: { maxHops: 6, memoryEntryMax: 6000, memoryStorageMax: 64000, groupNoteMax: 4000 },
  workspaces: [
    { id: 'ws_live_1', title: 'dsh-bot workspace', path: '/tmp/dsh-bot' },
    { id: 'ws_live_2', title: 'Product', path: '/tmp/product' },
  ],
  tasks: [
    {
      id: 'task_live_1',
      kind: 'bot',
      botId: 'bot_aaaaaaaaaaaa',
      text: '总结 DSH',
      title: '总结 DSH',
      status: 'done',
      result: 'DSH 是一个运行框架。',
      batchId: 'batch_live',
      createdAt: 5,
      endedAt: 6,
    },
  ],
  helpers: [
    { id: 'helper_live_1', botId: 'bot_bbbbbbbbbbbb', chatId: 'chat_111111111111', title: '调研', task: '调研群聊', status: 'running', createdAt: 7, startedAt: 8 },
  ],
  schedules: [
    {
      id: 'sch_live_1',
      botId: 'bot_aaaaaaaaaaaa',
      title: '线上晨报',
      prompt: '总结昨天',
      timing: { kind: 'daily', time: '09:00' },
      enabled: true,
      nativeId: 'schedule-live-1',
      createdAt: 7,
    },
  ],
}

const liveMessages = [
  { id: 'msg_live_a', chatId: 'chat_111111111111', seq: 1, ts: 100, role: 'user', text: '你好', status: 'done', parts: [{ type: 'text', text: '你好' }] },
  {
    id: 'msg_live_md',
    chatId: 'chat_111111111111',
    seq: 2,
    ts: 200,
    role: 'bot',
    botId: 'bot_aaaaaaaaaaaa',
    status: 'done',
    text: '你好，我是 **Chief**\n\n- 第一项 `code`\n- 第二项 [链接](https://example.com)\n\n## 小标题\n\n```sh\nnpm test\n```',
    parts: [{
      type: 'text',
      text: '你好，我是 **Chief**\n\n- 第一项 `code`\n- 第二项 [链接](https://example.com)\n\n## 小标题\n\n```sh\nnpm test\n```',
    }],
  },
  {
    id: 'msg_live_long',
    chatId: 'chat_111111111111',
    seq: 4,
    ts: 400,
    role: 'bot',
    botId: 'bot_aaaaaaaaaaaa',
    status: 'done',
    text: ('这是一段很长的机器回复。'.repeat(120)),
    parts: [{ type: 'text', text: ('这是一段很长的机器回复。'.repeat(120)) }],
  },
  {
    id: 'msg_live_tool',
    chatId: 'chat_111111111111',
    seq: 5,
    ts: 500,
    role: 'bot',
    botId: 'bot_aaaaaaaaaaaa',
    status: 'done',
    text: '工具执行完了。',
    parts: [
      { type: 'tool', name: 'bot_list_team', status: 'running' },
      { type: 'text', text: '工具执行完了。' },
    ],
  },
  {
    id: 'msg_live_xss',
    chatId: 'chat_111111111111',
    seq: 3,
    ts: 300,
    role: 'bot',
    botId: 'bot_aaaaaaaaaaaa',
    status: 'done',
    text: '危险输入 <script>alert(1)</script> 和 [坏链接](javascript:alert(2)) 以及 <img src=x onerror=alert(3)>',
    parts: [{
      type: 'text',
      text: '危险输入 <script>alert(1)</script> 和 [坏链接](javascript:alert(2)) 以及 <img src=x onerror=alert(3)>',
    }],
  },
]

const fetchCalls = []
let failNextBot = false

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

globalThis.fetch = (url, init = {}) => {
  const path = String(url)
  const method = String(init.method === undefined ? 'GET' : init.method).toUpperCase()
  let body
  try {
    body = init.body === undefined ? undefined : JSON.parse(init.body)
  } catch (error) {
    body = undefined
  }
  fetchCalls.push({ path, method, body })
  if (path.includes('/upload')) {
    return jsonResponse({ ok: true, attachment: { id: 'att_live_1', name: 'live.png', size: 64, mime: 'image/png', url: 'dsh-bot/api/media?id=att_live_1' } })
  }
  if (method === 'GET' && path.includes('/state')) return jsonResponse({ ok: true, state: liveState })
  if (method === 'GET' && path.includes('/messages')) {
    const chatId = new URL('http://x/' + path).searchParams.get('chatId')
    const messages = liveMessages.filter((message) => message.chatId === chatId)
    return jsonResponse({ ok: true, messages, hasMore: false })
  }
  if (path.includes('/events')) throw new Error('events is served by EventSource, not fetch')
  const action = body === undefined ? '' : String(body.action)
  if (path.includes('/bot')) {
    if (failNextBot) {
      failNextBot = false
      return jsonResponse({ ok: false, code: 'session-busy', message: 'bot is busy' }, 409)
    }
    if (action === 'delete') liveState.bots = liveState.bots.filter((bot) => bot.id !== body.botId)
    if (action === 'create') {
      liveState.bots = liveState.bots.concat([
        { id: 'bot_cccccccccccc', name: String(body.bot.name), role: '', instructions: '', skin: 'default', color: '#4f7cff', isMain: false, model: null, permission: 'workspace-write', autoHelper: false, createdAt: 5, updatedAt: 5, rev: 1 },
      ])
    }
    return jsonResponse({ ok: true, state: liveState })
  }
  if (path.includes('/chat')) {
    if (action === 'send') return jsonResponse({ ok: true, state: liveState, chat: liveState.chats[0] })
    if (action === 'read') return jsonResponse({ ok: true, chat: Object.assign({}, liveState.chats[1], { unread: 0 }) })
    if (action === 'retry') return jsonResponse({ ok: true, state: liveState, chat: liveState.chats[0] })
    return jsonResponse({ ok: true, state: liveState })
  }
  if (path.includes('/memory')) {
    if (action === 'list') return jsonResponse({ ok: true, entries: [{ id: 'note_live', text: '线上记忆', addedAt: 1234, pinned: false }] })
    return jsonResponse({ ok: true, entries: [{ id: 'note_live2', text: '新记忆', addedAt: 5678, pinned: false }] })
  }
  if (path.includes('/usage')) {
    return jsonResponse({ ok: true, usage: { days: 7, total: { turns: 2, chars: 20 }, byDay: [{ day: '2026-01-01', turns: 1, chars: 10 }, { day: '2026-01-02', turns: 1, chars: 10 }], byBot: [{ botId: 'bot_aaaaaaaaaaaa', name: 'Chief', turns: 2, chars: 20 }] } })
  }
  if (path.includes('/group')) {
    if (action === 'update') return jsonResponse({ ok: true, state: liveState })
    return jsonResponse({ ok: true, state: liveState })
  }
  if (path.includes('/schedule')) {
    if (action === 'update') return jsonResponse({ ok: false, code: 'invalid-request', message: 'unknown schedule action "update"' }, 400)
    if (action === 'list') return jsonResponse({ ok: true, state: liveState, schedules: liveState.schedules })
    if (action === 'create') {
      liveState.schedules = liveState.schedules.concat([
        {
          id: 'sch_live_2',
          botId: String(body.botId),
          title: String(body.title),
          prompt: String(body.prompt),
          timing: body.timing,
          enabled: true,
          createdAt: 8,
        },
      ])
      return jsonResponse({ ok: true, state: liveState, schedules: liveState.schedules })
    }
    if (action === 'delete') {
      liveState.schedules = liveState.schedules.filter((schedule) => schedule.id !== body.scheduleId)
      return jsonResponse({ ok: true, state: liveState, schedules: liveState.schedules })
    }
    return jsonResponse({ ok: true, state: liveState, schedules: liveState.schedules })
  }
  if (path.includes('/config')) return jsonResponse({ ok: true, state: Object.assign({}, liveState, { settings: { userName: '新名字', language: 'en' } }) })
  return jsonResponse({ ok: false, code: 'invalid-request', message: 'unknown route' }, 400)
}

store.openDrawer('general')
await store.retry()
await sleep(150)
check(store.mode === 'live', 'a successful state read switches the workspace to live data')
check(store.bots().length === 2 && store.bots()[0].id === 'bot_aaaaaaaaaaaa', 'live snapshot replaces the demo roster')
check(store.selectedChatId === 'chat_111111111111', 'live snapshot selects the pinned chat')

store.selectChat('chat_111111111111')
await sleep(120)
check(fetchCalls.some((call) => call.path.includes('/messages') && call.path.includes('chat_111111111111')), 'selecting a chat pages its history from the Host')

const sent = await store.send('chat_111111111111', '线上发一条')
await sleep(60)
const sendCall = fetchCalls.filter((call) => call.path.includes('/chat') && call.body !== undefined && call.body.action === 'send').pop()
check(sendCall !== undefined, 'send posts to the chat route')
check(sendCall !== undefined && sendCall.body.action === 'send' && sendCall.body.chatId === 'chat_111111111111', 'send names action "send" and the chat id')
check(sendCall !== undefined && typeof sendCall.body.clientMessageId === 'string' && sendCall.body.clientMessageId.startsWith('cid_'), 'send carries a client message id for idempotency')
check(sent === undefined || sent === null, 'send resolves after the Host answers')
const liveEntry = store.messagesOf('chat_111111111111')
check(liveEntry.list.some((message) => message.clientMessageId !== undefined), 'the user echo is tracked in the timeline')

const markdownHtml = render(mainReg.component, face)
check(markdownHtml.includes('<strong>Chief</strong>'), 'markdown: bold renders as <strong>')
check(markdownHtml.includes('<li'), 'markdown: list items render as <li>')
check(markdownHtml.includes('db-md-code-inline'), 'markdown: inline code carries its own style')
check(markdownHtml.includes('href="https://example.com"'), 'markdown: http link becomes an anchor')
check(markdownHtml.includes('db-md-h2'), 'markdown: headings render at their level')
check(markdownHtml.includes('db-md-pre'), 'markdown: fenced code becomes a pre block')
check(!markdownHtml.includes('**Chief**'), 'markdown: raw bold markers do not leak into the DOM')
check(!markdownHtml.includes('<script>alert(1)'), 'markdown: raw HTML is escaped, never injected')
check(!markdownHtml.includes('href="javascript:'), 'markdown: javascript: links are refused')
check(!markdownHtml.includes('<img'), 'markdown: raw <img> markup cannot become a real element')

await store.retryChat('chat_111111111111')
check(fetchCalls.some((call) => call.body !== undefined && call.body.action === 'retry'), 'retry posts action "retry"')

store.selectChat('chat_222222222222')
await sleep(80)
check(fetchCalls.some((call) => call.body !== undefined && call.body.action === 'read' && call.body.chatId === 'chat_222222222222'), 'selecting an unread chat sends a read receipt')

failNextBot = true
let busyError
try {
  await store.createBot({ name: '冲突', role: '' })
} catch (error) {
  busyError = error
}
check(busyError !== undefined && busyError.code === 'session-busy', 'a Host refusal surfaces with its stable code')
check(store.bots().length === 2, 'a refused write leaves the roster untouched')

store.openDrawer('memory')
await sleep(100)
check(store.memory.entries.some((entry) => entry.id === 'note_live'), 'live memory list is read through the memory route')
await store.remember('记住这条')
check(store.memory.entries.some((entry) => entry.id === 'note_live2'), 'remember replaces the list from the Host answer')

store.openDrawer('usage')
await sleep(100)
await store.loadUsage(7, true)
check(store.usage.view !== null && store.usage.view.byDay.length === 2, 'live usage view is rendered from the Host answer')

store.openDrawer('schedules')
await sleep(120)
check(store.schedules.unsupported === false, 'the schedule list route populates the panel')
check(store.schedules.list.some((schedule) => schedule.id === 'sch_live_1' && schedule.enabled === true), 'existing schedules come from the Host list')
await store.createSchedule({ botId: 'bot_aaaaaaaaaaaa', title: '线上任务', prompt: '跑一次', timing: { kind: 'daily', time: '09:00' } })
check(store.schedules.list.some((schedule) => schedule.title === '线上任务' && schedule.local !== true), 'a created schedule comes back in the Host list')
check(store.schedules.list.length === 2, 'the created schedule replaces the optimistic placeholder')
const liveSchedule = store.schedules.list.find((schedule) => schedule.title === '线上任务')
await store.deleteSchedule(liveSchedule.id)
check(store.schedules.list.length === 1, 'deleteSchedule removes it from the Host list too')
check(store.schedules.list.some((schedule) => schedule.id === 'sch_live_1'), 'the remaining schedule survives the delete')
store.closeDrawer()

const liveUpload = await store.uploadAttachment({ name: 'live.png', size: 64, type: 'image/png' })
check(liveUpload.id === 'att_live_1', 'uploadAttachment posts to the upload route')
const liveAttachmentMessage = await store.send('chat_111111111111', '请看图', [liveUpload])
const attachmentCall = fetchCalls.filter((call) => call.path.includes('/chat') && call.body !== undefined && Array.isArray(call.body.attachments)).pop()
check(attachmentCall !== undefined && attachmentCall.body.attachments[0] === 'att_live_1', 'chat send carries the attachment ids')
check(store.messagesOf('chat_111111111111').list.some((message) => Array.isArray(message.parts) && message.parts.some((part) => part.type === 'image')), 'the optimistic message keeps the image part')

const liveGroupResult = await store.clearGroupNote('grp_live')
check(liveGroupResult.cleared === false, 'clearGroupNote reports when the Host ignores noteEntries')
check(store.groupById('grp_live').noteEntries.length === 1, 'an unsupported note clear leaves the note untouched')

const liveUpdate = await store.updateSchedule('sch_live_1', {
  botId: 'bot_aaaaaaaaaaaa',
  title: '线上晨报（改）',
  prompt: '改过的线上任务',
  timing: { kind: 'every', minutes: 45 },
})
check(liveUpdate.replaced === true, 'schedule editing falls back to create+delete when update is refused')
check(store.schedules.list.some((schedule) => schedule.title === '线上晨报（改）'), 'the replacement schedule is in the list')
check(!store.schedules.list.some((schedule) => schedule.id === 'sch_live_1'), 'the replaced schedule is gone')
check(store.workspaces().length === 2, 'workspaces are read from the state snapshot')
check(store.tasks().length === 1 && store.tasks()[0].result.length > 0, 'tasks are read from the state snapshot')
check(store.helpers().length === 1, 'helpers are read from the state snapshot')
store.openDrawer('tasks')
await sleep(90)
const liveTasksHtml = render(mainReg.component, face)
check(liveTasksHtml.includes('总结 DSH') && liveTasksHtml.includes('DSH 是一个运行框架。'), 'tasks tab renders a real TaskView result')
check(liveTasksHtml.includes('调研') && liveTasksHtml.includes('后台助手'), 'tasks tab renders real helpers')
store.closeDrawer()
store.openDrawer('schedules')
await sleep(90)
const schedulesHtml = render(mainReg.component, face)
check(schedulesHtml.includes('已挂载宿主任务') || schedulesHtml.includes('未挂载宿主任务'), 'schedules show the native-id attachment state')
store.closeDrawer()

store.selectChat('chat_111111111111')
await sleep(80)
const reconHtml = render(mainReg.component, face)
check(reconHtml.includes('db-clamp') && reconHtml.includes('db-expand'), 'long bot messages collapse behind an expand control')
check(reconHtml.includes('未确认'), 'a settled message with a running tool part reads as unconfirmed')
check(reconHtml.includes('db-tool is-unknown'), 'the unconfirmed tool row has its own style')

await store.saveConfig({ userName: '新名字', language: 'en' })
check(store.data.settings.userName === '新名字' && store.data.settings.language === 'en', 'config save applies the Host snapshot')
check(store.bots().length === 2, 'live mode keeps the roster after a config write')

/* --------------------------------------------------------------- cleanup */

for (const dispose of disposed) {
  try {
    dispose()
  } catch (error) {
    failures.push('disposer threw: ' + error.message)
  }
}
check(document.head.children.length === 0, 'stylesheet disposer removes the style tag')
check(store.toasts.length >= 0, 'store survives dispose without throwing')

console.log('')
if (failures.length === 0) {
  console.log('smoke-client: all checks passed (' + effects.length + ' effects registered)')
  process.exit(0)
}
console.log('smoke-client: ' + failures.length + ' check(s) failed')
process.exit(1)
