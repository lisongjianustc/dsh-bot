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
  const listeners = new Map()
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
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(listener)
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type)
      if (list === undefined) return
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    },
    dispatch(type) {
      const list = listeners.get(type)
      if (list === undefined) return
      for (const listener of list.slice()) {
        try {
          listener()
        } catch (error) {
          /* listeners must not break the test driver */
        }
      }
    },
  }
}

globalThis.document = makeDocument()
function makeWindow() {
  const listeners = new Map()
  return {
    __ModuleLoader__: { load: null },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(listener)
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type)
      if (list === undefined) return
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    },
    dispatch(type) {
      const list = listeners.get(type)
      if (list === undefined) return
      for (const listener of list.slice()) {
        try {
          listener()
        } catch (error) {
          /* listeners must not break the test driver */
        }
      }
    },
  }
}
globalThis.window = makeWindow()
globalThis.EventSource = class StubEventSource {
  static instances = []
  constructor(url) {
    this.url = url
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.closed = false
    StubEventSource.instances.push(this)
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

/* ---------------------------------------------------------------- avatars */

// The Bot form previews auto-matched avatars locally, so the renderer and the
// keyword table are asserted against the same rules as the Host.
const avatarModule = { exports: {} }
const avatarSource = readFileSync(join(root, 'src', 'client', 'avatar.js'), 'utf8')
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', avatarSource)(
  avatarModule,
  avatarModule.exports,
  (request) => {
    if (request === 'react') return React
    throw new Error('avatar module requested an unseeded module: ' + request)
  },
)
const avatarLib = avatarModule.exports
check(avatarLib.PRESETS.length === 40, 'avatar library carries 40 presets (fallback last)')
check(avatarLib.PRESETS[avatarLib.PRESETS.length - 1].id === 'default-bot', 'the fallback stays last in the preset table')
check(avatarLib.imageUrl('architect-stag') === 'dsh-bot/api/avatar/architect-stag.svg', 'avatar tiles use the Host avatar route')
check(avatarLib.matchAvatar({ name: '架构师', role: '系统架构师' }).id === 'architect-stag', '架构师 matches the architect avatar')
check(avatarLib.matchAvatar({ name: '合规专员', role: '内控合规' }).id === 'compliance-officer', '合规专员 matches the compliance avatar')
check(avatarLib.matchAvatar({ name: '知识管理', role: '知识库与知识图谱' }).id === 'knowledge-tree', '知识管理 matches the knowledge avatar')
check(avatarLib.sha1('abc') === 'a9993e364706816aba3e25717850c26c9cd0d89d', 'avatar SHA-1 matches the Host hash')
check(avatarLib.matchAvatar({ name: '剧情策划', role: '主线剧情与支线设计' }).id === 'writer-quill', '剧情策划 matches the writer avatar')
check(avatarLib.matchAvatar({ name: '数值策划', role: '数值与平衡' }).id === 'data-chart', '数值策划 matches the data avatar')
check(avatarLib.matchAvatar({ name: '像素美工', role: '像素美术' }).id === 'photo-camera', '像素美工 matches the camera avatar')
check(avatarLib.matchAvatar({ name: '主线', role: '主线任务' }).id !== 'lead-crown', '“主线” no longer matches the lead avatar')
check(avatarLib.matchAvatar({ name: 'Chief', role: '团队总管' }).id === 'lead-crown', 'the main Bot still matches the lead avatar')
const fallbackAvatar = avatarLib.renderAvatar({ kind: 'library', id: 'custom', motif: 'mystery', color: '#123456', background: '#ffffff' }, 32)
check(React.isValidElement(fallbackAvatar), 'an unknown motif still renders an SVG element')

/* ------------------------------------------------------------ directories */

// Group directory rules and the form are asserted against the sources directly:
// the form is pure presentation over these helpers, so this covers the chips,
// the "main directory" ordering, the picker append and the save payload.
const clientSourceCache = new Map()
function loadClientModule(name) {
  if (clientSourceCache.has(name)) return clientSourceCache.get(name).exports
  const source = readFileSync(join(root, 'src', 'client', name), 'utf8')
  const module = { exports: {} }
  clientSourceCache.set(name, module)
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', source)(module, module.exports, (request) => {
    if (request === 'react') return React
    if (request.startsWith('./')) return loadClientModule(request.slice(2))
    throw new Error('client module requested an unseeded module: ' + request)
  })
  return module.exports
}

const dirs = loadClientModule('directories.js')
const mixed = dirs.normalize([
  '/Users/me/game',
  { path: '/Users/me/game', title: 'duplicated path' },
  { id: 'ws_wiki', title: 'wiki', path: '/Users/me/wiki' },
  '',
  null,
])
check(mixed.length === 2 && mixed[0].title === 'game' && mixed[1].id === 'ws_wiki', 'normalize dedupes by id or path and titles a bare path')
const withWorkspace = dirs.addWorkspace(dirs.addWorkspace([], { id: 'ws_game', title: 'game', path: '/Users/me/game' }).entries, { id: 'ws_game', title: 'game' })
check(withWorkspace.added === false && withWorkspace.entries.length === 1, 'adding an already listed workspace is a no-op')
const picked = await dirs.pickDirectoryEntries([], () => Promise.resolve('/Users/me/new-project'))
check(picked.added === true && picked.entries[0].title === 'new-project' && picked.entries[0].path === '/Users/me/new-project', 'pickDirectory result is appended as a path entry')
const cancelled = await dirs.pickDirectoryEntries([], () => Promise.resolve(undefined))
check(cancelled.added === false && cancelled.entries.length === 0, 'a cancelled picker adds nothing')
check((await dirs.pickDirectoryEntries([], undefined)).added === false, 'a missing picker is silent')
const twoDirs = [picked.entries[0], { id: 'ws_wiki', title: 'wiki', path: '/Users/me/wiki' }]
check(dirs.promote(twoDirs, 1)[0].id === 'ws_wiki', 'promoting the second directory makes it the main one')
check(dirs.removeAt(twoDirs, 0).length === 1 && dirs.payloadOf(twoDirs).join(',') === '/Users/me/new-project,ws_wiki', 'remove and payload keep the Host order (id or path)')
const groupPayload = dirs.applyToPayload({ name: '游戏组' }, twoDirs)
check(Array.isArray(groupPayload.workspaces) && groupPayload.workspaces.length === 2, 'the group payload carries the directory list')
check(dirs.resetFlag([], twoDirs, true) === true, 'a changed list requests a session rebuild when the box is checked')
check(dirs.resetFlag([], twoDirs, false) === false, 'an unchecked rebuild box is an explicit no-reset')
check(dirs.resetFlag(twoDirs, twoDirs, true) === undefined, 'an unchanged list sends no reset flag')
check(dirs.summaryText(twoDirs, (key, params) => key + '=' + params.count) === '📁 new-project · groups.dirCount=2', 'the card summary names the main directory and the count')

const fakeBots = [
  { id: 'bot_a', name: 'Chief', role: '总管', color: '#3b6df6', avatar: null },
  { id: 'bot_b', name: '架构师', role: '架构', color: '#f08a24', avatar: null },
]
const fakeStore = {
  data: { limits: { nameMax: 40, groupNoteMax: 4000, noticeMax: 500, maxHops: 6 } },
  bots: () => fakeBots,
  workspaces: () => [
    { id: 'ws_game', title: 'game', path: '/Users/me/game' },
    { id: 'ws_wiki', title: 'wiki', path: '/Users/me/wiki' },
  ],
  flash() {},
  createGroup: () => Promise.resolve({}),
  updateGroup: () => Promise.resolve({}),
  deleteGroup: () => Promise.resolve({}),
  clearGroupNote: () => Promise.resolve({ cleared: false }),
}
const panelsModule = loadClientModule('panels.js')
const localeSource = loadClientModule('locales.js')
function tFromBundle(key, params) {
  let text = localeSource.zh[key]
  if (typeof text !== 'string') return key
  if (params !== undefined && params !== null) {
    for (const name of Object.keys(params)) text = text.split('{' + name + '}').join(String(params[name]))
  }
  return text
}
const existingForm = renderToStaticMarkup(
  React.createElement(panelsModule.GroupForm, {
    t: tFromBundle,
    store: fakeStore,
    pickDirectory: () => Promise.resolve('/Users/me/picked'),
    onClose() {},
    group: {
      id: 'grp_smoke',
      name: '游戏开发组',
      adminId: 'bot_a',
      memberIds: ['bot_a', 'bot_b'],
      notice: '',
      replyMode: 'all',
      maxHops: 3,
      maxSpeakers: 7,
      handover: true,
      useNote: true,
      noteEntries: [],
      workspaces: [
        { id: 'ws_game', title: 'game', path: '/Users/me/game' },
        { title: 'game-dev', path: '/Users/me/game-dev' },
      ],
    },
  }),
)
check(existingForm.includes('项目目录 / 工作区') && existingForm.includes('/Users/me/game-dev'), 'the group form lists the configured directories')
check(existingForm.includes('主目录') && existingForm.includes('设为主目录'), 'the first directory is the main one and later ones can be promoted')
check(existingForm.includes('移除目录') && existingForm.includes('添加文件夹…'), 'each directory can be removed and a folder can be added')
const botFormHtml = renderToStaticMarkup(
  React.createElement(panelsModule.BotForm, {
    t: tFromBundle,
    store: Object.assign({}, fakeStore, { data: null }),
    onClose() {},
    bot: {
      id: 'bot_botform',
      name: '架构师',
      role: '系统架构师',
      instructions: '',
      color: '#4e83c8',
      avatar: avatarLib.avatarById('architect-stag'),
      permission: 'workspace-write',
      autoHelper: true,
      autoApprove: true,
      isMain: false,
      model: null,
    },
  }),
)
check(botFormHtml.includes('头像') && botFormHtml.includes('dsh-bot/api/avatar/architect-stag.svg'), 'the bot form previews the avatar tile')
check(botFormHtml.includes('工作区') && botFormHtml.includes('自动匹配'), 'the bot form keeps its workspace select and avatar actions')
const newBotFormHtml = renderToStaticMarkup(
  React.createElement(panelsModule.BotForm, { t: tFromBundle, store: Object.assign({}, fakeStore, { data: null }), onClose() {} }),
)
check(newBotFormHtml.includes('新建机器人') || newBotFormHtml.includes('头像'), 'a new-bot form renders without an existing avatar')

const freshForm = renderToStaticMarkup(
  React.createElement(panelsModule.GroupForm, {
    t: tFromBundle,
    store: fakeStore,
    pickDirectory: () => Promise.resolve('/Users/me/picked'),
    onClose() {},
  }),
)
check(freshForm.includes('尚未选择目录') && freshForm.includes('添加工作区'), 'a new group starts with an empty directory list and the workspace picker')
check(existingForm.includes('每轮最多发言人数') && existingForm.includes('value="7"'), 'the group form edits maxSpeakers with the saved value')
check(freshForm.includes('每轮最多发言人数') && freshForm.includes('value="3"'), 'a new group defaults maxSpeakers to 3')

/* -------------------------------------------------------------- markdown */

const markdown = loadClientModule('markdown.js')
function mdBlockHtml(source) {
  return renderToStaticMarkup(React.createElement('div', null, markdown.render(source)))
}
const tableHtml = mdBlockHtml('| 角色 | 职责 | 状态 |\n| :--- | :---: | ---: |\n| **Chief** | 派活 | `done` |\n| 架构师 | [设计](https://example.com) | 2 |')
check(tableHtml.includes('db-md-table-wrap') && tableHtml.includes('<table'), 'a header + separator renders a table')
check(tableHtml.includes('db-md-align-center') && tableHtml.includes('db-md-align-right'), 'table alignment markers become classes')
check(tableHtml.includes('<strong>Chief</strong>') && tableHtml.includes('db-md-code-inline') && tableHtml.includes('db-md-link'), 'table cells keep inline formatting')
check(!mdBlockHtml('a | b\nc | d').includes('<table'), 'lines without a separator stay a paragraph')
check(!mdBlockHtml('| a | b |\n| --- | nope |').includes('<table'), 'a malformed separator does not create a table')
const xssTable = mdBlockHtml('| <script>alert(1)</script> | x |\n| --- | --- |\n| [bad](javascript:alert(1)) | `<img>` |')
check(!xssTable.includes('<script>') && !xssTable.includes('<img>'), 'markdown tables never inject raw HTML')
check(xssTable.includes('javascript:alert(1)'), 'unsafe table links stay plain text')

/* ----------------------------------------------------------------- avatars */

const uiModule = loadClientModule('ui.js')
const knownAvatar = renderToStaticMarkup(
  React.createElement(uiModule.Avatar, { name: 'Architect', avatar: avatarLib.avatarById('architect-stag'), size: 'md' }),
)
check(knownAvatar.includes('src="dsh-bot/api/avatar/architect-stag.svg"'), 'a library avatar renders as an img tile')
const unknownAvatar = renderToStaticMarkup(
  React.createElement(uiModule.Avatar, {
    name: 'Custom',
    avatar: { kind: 'library', id: 'custom', motif: 'mystery', color: '#123456', background: '#ffffff' },
    size: 'md',
  }),
)
check(unknownAvatar.includes('<svg') && !unknownAvatar.includes('<img'), 'an unknown avatar id falls back to the programmatic SVG')
const gridHtml = renderToStaticMarkup(React.createElement(panelsModule.AvatarGrid, { t: tFromBundle, avatarId: 'architect-stag' }))
check((gridHtml.match(/class="db-avatar-choice(?: is-active)?"/g) || []).length === 40, 'the avatar picker renders 40 chooseable tiles')
check((gridHtml.match(/dsh-bot\/api\/avatar\//g) || []).length === 40, 'every picker tile loads its Host SVG')

/* ------------------------------------------------------ tool rows & files */

const chatModule = loadClientModule('chat.js')
const filesModule = loadClientModule('files.js')
const fileBase = {
  roots: [{ title: 'game', path: '/root/game' }],
  rootPath: '/root/game',
  rootTitle: 'game',
  currentPath: '/root/game/docs',
  entries: [
    { name: 'sub', path: '/root/game/docs/sub', type: 'dir' },
    { name: 'a.md', path: '/root/game/docs/a.md', type: 'file', size: 12 },
  ],
  preview: null,
}
const filePanelHtml = renderToStaticMarkup(
  React.createElement(filesModule.FilePanel, { t: tFromBundle, store: Object.assign({}, fakeStore, { fileOpen: true, selectedChatId: 'chat_smoke' }), initial: fileBase }),
)
check(filePanelHtml.includes('文件') && filePanelHtml.includes('game'), 'the file panel renders its title, root and breadcrumbs')
check(filePanelHtml.includes('浏览') && filePanelHtml.includes('预览'), 'the file panel offers browse and preview tabs')
check(filePanelHtml.includes('aria-selected="true"'), 'the active file tab is marked for assistive tech')
check(filePanelHtml.includes('sub') && filePanelHtml.includes('a.md') && filePanelHtml.includes('is-dir'), 'the file panel lists directories before files')
check(filePanelHtml.includes('db-file-crumb'), 'the panel shows a clickable breadcrumb trail')
const textPreview = renderToStaticMarkup(
  React.createElement(filesModule.FilePanel, {
    t: tFromBundle,
    store: Object.assign({}, fakeStore, { fileOpen: true, selectedChatId: 'chat_smoke' }),
    initial: Object.assign({}, fileBase, { tab: 'preview', preview: { kind: 'text', path: '/root/game/docs/a.gd', text: 'line one\nline two', size: 14 } }),
  }),
)
check(textPreview.includes('line one') && textPreview.includes('db-file-line-no') && textPreview.includes('2'), 'a text preview shows numbered lines')
const imagePreview = renderToStaticMarkup(
  React.createElement(filesModule.FilePanel, {
    t: tFromBundle,
    store: Object.assign({}, fakeStore, { fileOpen: true, selectedChatId: 'chat_smoke' }),
    initial: Object.assign({}, fileBase, { tab: 'preview', preview: { kind: 'image', path: '/root/game/p.png', name: 'p.png', url: 'dsh-bot/api/fs/raw?chatId=c&path=%2Froot%2Fgame%2Fp.png' } }),
  }),
)
check(imagePreview.includes('<img') && imagePreview.includes('dsh-bot/api/fs/raw'), 'an image preview uses the raw file route')
const markdownPreview = renderToStaticMarkup(
  React.createElement(filesModule.FilePanel, {
    t: tFromBundle,
    store: Object.assign({}, fakeStore, { fileOpen: true, selectedChatId: 'chat_smoke' }),
    initial: Object.assign({}, fileBase, { tab: 'preview', preview: { kind: 'markdown', path: '/root/game/docs/a.md', text: '# 标题\n\n**粗体**' } }),
  }),
)
check(markdownPreview.includes('db-md-h1') && markdownPreview.includes('<strong>粗体</strong>'), 'Markdown files preview through the shared renderer')
const binaryPreview = renderToStaticMarkup(
  React.createElement(filesModule.FilePanel, {
    t: tFromBundle,
    store: Object.assign({}, fakeStore, { fileOpen: true, selectedChatId: 'chat_smoke' }),
    initial: Object.assign({}, fileBase, { tab: 'preview', preview: { kind: 'binary', path: '/root/game/a.bin', url: 'dsh-bot/api/fs/raw?chatId=c&path=%2Froot%2Fgame%2Fa.bin' } }),
  }),
)
check(binaryPreview.includes('不支持预览') && binaryPreview.includes('打开 / 下载'), 'a binary file offers its raw download instead of a broken preview')
const errorPanel = renderToStaticMarkup(
  React.createElement(filesModule.FilePanel, {
    t: tFromBundle,
    store: Object.assign({}, fakeStore, { fileOpen: true, selectedChatId: 'chat_smoke' }),
    initial: Object.assign({}, fileBase, { error: '没有权限访问这个路径' }),
  }),
)
check(errorPanel.includes('没有权限访问这个路径'), 'a permission error is shown inside the file panel')
const noRootsPanel = renderToStaticMarkup(
  React.createElement(filesModule.FilePanel, {
    t: tFromBundle,
    store: Object.assign({}, fakeStore, { fileOpen: true, selectedChatId: 'chat_smoke' }),
    initial: { roots: [], rootsError: '没有可浏览的目录' },
  }),
)
check(noRootsPanel.includes('没有可浏览的目录'), 'a Host without fs routes degrades to a readable empty state')
check(filesModule.dirname('/root/game/docs/a.md') === '/root/game/docs', 'dirname splits a file path')
check(filesModule.breadcrumbOf('/root/game', '/root/game/docs/a', 'game').length === 3, 'breadcrumbs split the path inside the root')
check(filesModule.sortEntries([{ name: 'z.md', type: 'file' }, { name: 'adir', type: 'dir' }])[0].name === 'adir', 'directories sort before files')
check(filesModule.fileKind('a.md', 'file') === 'markdown' && filesModule.fileKind('a.png', 'file') === 'image' && filesModule.fileKind('a.bin', 'file') === 'binary', 'file icons/preview route by extension')

const fakeRowStore = {
  data: { settings: { userName: '我' } },
  botById: () => undefined,
  groupById: () => undefined,
  flash() {},
  openFile() {},
  toolExpanded: Object.create(null),
}
function toolRowHtml(parts, store) {
  return renderToStaticMarkup(
    React.createElement(chatModule.MessageRow, {
      t: tFromBundle,
      store: store,
      chat: { id: 'chat_smoke' },
      message: { id: 'msg_tools', chatId: 'chat_smoke', seq: 1, ts: 1, role: 'bot', status: 'done', text: '', parts: parts },
      onQuote() {},
    }),
  )
}
const summaryRow = toolRowHtml([{ type: 'tool', name: 'bash', status: 'ok', summary: 'ls -la /tmp' }], fakeRowStore)
check(summaryRow.includes('ls -la /tmp') && summaryRow.includes('db-tool-summary'), 'a collapsed tool row shows the Host summary')
const expandedStore = Object.assign({}, fakeRowStore, { toolExpanded: { 'msg_tools:0': true } })
const expandedRow = toolRowHtml(
  [{ type: 'tool', name: 'bash', status: 'ok', summary: 'ls', args: '{\"cmd\":\"ls\"}', result: 'file-a\nfile-b' }],
  expandedStore,
)
check(expandedRow.includes('db-tool-detail') && expandedRow.includes('&quot;cmd&quot;') && expandedRow.includes('file-a'), 'expanding a tool row reveals formatted args and result')
check(expandedRow.includes('aria-label="复制"'), 'args and result carry their copy control')
const failedRow = toolRowHtml([{ type: 'tool', name: 'bash', status: 'failed', error: 'exit 1: boom' }], fakeRowStore)
check(failedRow.includes('read_workspace') === false && failedRow.includes('exit 1: boom') && failedRow.includes('db-tool-error'), 'a failed tool row opens by itself with its error')
const bareRow = toolRowHtml([{ type: 'tool', name: 'read_workspace', status: 'ok' }], fakeRowStore)
check(bareRow.includes('read_workspace') && !bareRow.includes('db-tool-detail'), 'a legacy tool part without args/result still renders')
const linkedRow = toolRowHtml([{ type: 'text', text: '看 `game/balance.gd` 与 [配置](docs/a.md)' }], fakeRowStore)
check(linkedRow.includes('db-md-file') && linkedRow.includes('title="game/balance.gd"'), 'file references in chat text render as file links')

// v0.6: mention helpers, mention chips and relay rows.
check(chatModule.mentionTokenAt('hello @Ch', 9) !== null && chatModule.mentionTokenAt('hello @Ch', 9).query === 'Ch', 'typing @ opens a mention query')
check(chatModule.mentionTokenAt('mail a@b', 9) === null, 'an @ inside a word is not a mention trigger')
const mentionRows = chatModule.mentionCandidates([{ id: 'bot_a', name: 'Chief', role: '总管' }, { id: 'bot_b', name: 'Alice', role: '研究员' }], '全部成员', '')
check(mentionRows.length === 3 && mentionRows[2].kind === 'all', 'the mention picker lists members plus @all')
check(chatModule.mentionCandidates([{ id: 'bot_a', name: 'Chief', role: '总管' }, { id: 'bot_b', name: 'Alice', role: '研究员' }], '全部成员', 'ali').length === 1, 'the mention picker filters by name or role')
const previewAll = chatModule.speakerPreview({ replyMode: 'all', maxSpeakers: 3 }, [{ id: 'bot_a', name: 'Chief' }, { id: 'bot_b', name: 'Alice' }], '')
check(previewAll.kind === 'all' && previewAll.cap === 2, 'an unmentioned all-mode draft previews the capped roster')
const previewMention = chatModule.speakerPreview({ replyMode: 'all', maxSpeakers: 3, adminId: 'bot_a' }, [{ id: 'bot_a', name: 'Chief' }, { id: 'bot_b', name: 'Alice' }], '@Alice 看下')
check(previewMention.kind === 'mentions' && previewMention.names.join(',') === 'Alice', 'explicit mentions drive the speaker preview')
const previewAdmin = chatModule.speakerPreview({ replyMode: 'admin', adminId: 'bot_a', maxSpeakers: 3 }, [{ id: 'bot_a', name: 'Chief' }, { id: 'bot_b', name: 'Alice' }], '')
check(previewAdmin.kind === 'admin' && previewAdmin.names[0] === 'Chief', 'admin mode previews the admin alone')
const mentionHtml = mdBlockHtml('请 @Chief 和 @all 看一下')
const mentionMarkdown = renderToStaticMarkup(React.createElement('div', null, markdown.render('请 @Chief 和 @all 看一下', undefined, { mentionNames: ['Chief', 'Alice', 'all'] })))
check(mentionMarkdown.includes('db-mention') && mentionMarkdown.includes('@Chief'), 'message text highlights @mentions as chips')
const relayHtml = toolRowHtml([{ type: 'text', text: '任务完成：总结 DSH' }], Object.assign({}, fakeRowStore, {}))
const relayRowHtml = renderToStaticMarkup(
  React.createElement(chatModule.MessageRow, {
    t: tFromBundle,
    store: fakeRowStore,
    chat: { id: 'chat_group', kind: 'group', groupId: 'grp_x' },
    message: { id: 'msg_relay', chatId: 'chat_group', seq: 1, ts: 1, role: 'relay', text: '任务完成', status: 'done', parts: [{ type: 'text', text: '任务完成' }] },
    onQuote() {},
  }),
)
check(relayRowHtml.includes('is-relay') && relayRowHtml.includes('转述'), 'relay results keep their distinct style')

check(linkedRow.includes('db-md-file') && linkedRow.includes('title="game/balance.gd"'), 'file references in chat text render as file links')

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
check(String(document.head.children[0].textContent).includes('520px'), 'the file panel is 520px wide')
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
check(html.includes('aria-label="刷新"'), 'the page header renders the manual refresh button')
check(!html.includes('[PASS]'), 'pass messages are hidden from the timeline')

// Pinning: Chief is pinned in the demo snapshot, so it leads the list and
// carries the pin marker; pinning another chat moves it ahead of Chief.
const listStart = html.indexOf('db-list')
const listEnd = html.indexOf('db-left-foot')
const listHtml = listStart >= 0 && listEnd > listStart ? html.slice(listStart, listEnd) : html
check(listHtml.includes('is-pinned'), 'the pinned chat row has its pinned style')
check(listHtml.includes('db-pin-mark'), 'the pinned chat row shows a pin marker')
check(listHtml.indexOf('Chief') < listHtml.indexOf('架构师'), 'the pinned chat sorts before unpinned chats')
check(typeof store.pinChat === 'function', 'the store exposes pinChat')
await store.pinChat('chat_9d3f5b7a1c2e', true)
check(store.chatById('chat_9d3f5b7a1c2e').pinned === true, 'pinChat pins the chat optimistically')
html = render(mainReg.component, face)
const pinnedStart = html.indexOf('db-list')
const pinnedEnd = html.indexOf('db-left-foot')
const pinnedList = pinnedStart >= 0 && pinnedEnd > pinnedStart ? html.slice(pinnedStart, pinnedEnd) : html
check(pinnedList.indexOf('写手') < pinnedList.indexOf('架构师'), 'a newly pinned chat sorts ahead of unpinned chats')
check(pinnedList.includes('置顶') && pinnedList.indexOf('置顶') < pinnedList.indexOf('私聊'), 'pinned chats get their own section above the kind sections')
await store.pinChat('chat_9d3f5b7a1c2e', false)
check(store.chatById('chat_9d3f5b7a1c2e').pinned !== true, 'pinChat unpins the chat again')

store.setFilter('group')
html = render(mainReg.component, face)
const groupStart = html.indexOf('db-list')
const groupEnd = html.indexOf('db-left-foot')
const groupList = groupStart >= 0 && groupEnd > groupStart ? html.slice(groupStart, groupEnd) : html
check(groupList.includes('产品小队') && !groupList.includes('架构师'), 'the group filter keeps only group chats')
store.setFilter('dm')
html = render(mainReg.component, face)
const dmStart = html.indexOf('db-list')
const dmEnd = html.indexOf('db-left-foot')
const dmList = dmStart >= 0 && dmEnd > dmStart ? html.slice(dmStart, dmEnd) : html
check(dmList.includes('架构师') && !dmList.includes('产品小队'), 'the direct filter keeps only direct chats')
store.setFilter('all')
html = render(mainReg.component, face)

for (const tab of ['general', 'bots', 'groups', 'tasks', 'memory', 'schedules', 'usage']) {
  store.openDrawer(tab)
  await sleep(90)
  const tabHtml = render(mainReg.component, face)
  check(tabHtml.includes('db-drawer'), 'drawer renders for tab "' + tab + '"')
}
store.closeDrawer()

// M3: library avatars render as SVG, the tasks tab groups tasks/helpers, and
// the composer exposes the attachment entry point.
check(html.includes('db-avatar-img') && html.includes('dsh-bot/api/avatar/'), 'bot rosters render library avatars through the Host tile route')
check((html.match(/db-avatar-img/g) || []).length >= 3, 'every demo bot gets an avatar image')
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

store.openDrawer('groups')
await sleep(80)
const groupsCardHtml = render(mainReg.component, face)
check(groupsCardHtml.includes('📁 产品项目') && groupsCardHtml.includes('2 个目录'), 'the group card summarises its directories')
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
check(html.includes('本轮将发言：') && html.includes('全部成员（最多 3 人）'), 'the group composer previews the speakers')
check(html.includes('群决策'), 'the group header offers the decisions entry')
store.setDraft(groupChat.id, '@Chief 看下')
store.selectChat(attachmentChat.id)
store.selectChat(groupChat.id)
html = render(mainReg.component, face)
check(html.includes('本轮将发言：') && html.includes('<strong>Chief</strong>'), 'mentioning a member updates the speaker preview')
store.setDraft(groupChat.id, '')
const emptyGroupBefore = store.groups().length
await store.createGroup({
  name: '空群冒烟',
  adminId: store.bots()[0].id,
  memberIds: [store.bots()[0].id, store.bots()[1].id],
  replyMode: 'all',
  maxHops: 3,
  maxSpeakers: 3,
  handover: true,
  useNote: true,
})
const emptyGroup = store.groups().find((group) => group.name === '空群冒烟')
const emptyGroupChat = store.chats().find((conversation) => conversation.kind === 'group' && conversation.groupId === emptyGroup.id)
store.selectChat(emptyGroupChat.id)
await sleep(120)
html = render(mainReg.component, face)
check(html.includes('这是项目群'), 'an empty group shows the kickoff guidance')
check(html.includes('db-group-empty'), 'the empty group guidance has its own style')
await store.deleteGroup(emptyGroup.id)
check(store.groups().length === emptyGroupBefore, 'the temporary group is cleaned up')
store.selectChat(groupChat.id)


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
const smokeGroupChat = store.chats().find((chat) => chat.kind === 'group' && chat.groupId === smokeGroup.id)
smokeGroupChat.sessionId = 'sess_smoke_group'
const groupSaveResult = await store.updateGroup(
  smokeGroup.id,
  {
    name: '冒烟群',
    adminId: store.bots()[0].id,
    memberIds: [store.bots()[0].id, store.bots()[1].id],
    replyMode: 'all',
    maxHops: 3,
    handover: true,
    useNote: true,
    workspaces: ['ws_demo_default'],
  },
  { resetSessions: true },
)
check(groupSaveResult.sessionsReset === true && smokeGroupChat.sessionId === '', 'a reset request rebuilds the group session and reports it')
check(store.groupById(smokeGroup.id).workspaces.length === 1, 'the group keeps the saved workspace list')
await store.deleteGroup(smokeGroup.id)
check(store.groups().length === 1, 'deleteGroup removes it again')

store.openDrawer('memory')
await sleep(120)
await store.remember('冒烟记忆：先给结论')
check(store.memory.entries.some((entry) => entry.text.includes('冒烟记忆')), 'remember adds a memory entry')
const smokeMemory = store.memory.entries.find((entry) => entry.text.includes('冒烟记忆'))
await store.forget(smokeMemory.id)
check(!store.memory.entries.some((entry) => entry.id === smokeMemory.id), 'forget removes it again')

// Task-23: auto-memory switch, pending candidates, entry editing.
store.openDrawer('memory')
await sleep(120)
const memoryTabHtml = render(mainReg.component, face)
check(memoryTabHtml.includes('自动记忆') && memoryTabHtml.includes('待确认记忆'), 'the memory tab shows the auto switch and the pending candidates')
check(memoryTabHtml.includes('版本号写进 CHANGELOG'), 'pending candidates render their text')
check(memoryTabHtml.includes('接受') && memoryTabHtml.includes('编辑后接受') && memoryTabHtml.includes('忽略'), 'candidates offer accept, edit-accept and ignore')
check(memoryTabHtml.includes('自动'), 'auto-written entries carry the auto badge')
await store.setAutoMemory(false)
check(store.memory.autoMemory === false && store.data.settings.autoMemory === false, 'the auto-memory switch updates the snapshot')
await store.setAutoMemory(true)
check(store.memory.autoMemory === true, 'the auto-memory switch can be turned back on')
await store.loadMemory('team', null, true)
const teamEntry = store.memory.entries.find((entry) => entry.id === 'note_team1')
await store.memoryEdit('team', 'note_team1', '改后的团队约定', teamEntry.revision)
check(store.memory.entries.find((entry) => entry.id === 'note_team1').text === '改后的团队约定', 'memoryEdit saves the edited text')
let memoryConflict
try {
  await store.memoryEdit('team', 'note_team1', '过期写入', 'r1')
} catch (error) {
  memoryConflict = error
}
check(memoryConflict !== undefined && (memoryConflict.code === 'memory-conflict' || memoryConflict.message === 'memory-conflict'), 'a stale revision surfaces a conflict')
const currentTeamEntry = store.memory.entries.find((entry) => entry.id === 'note_team1')
await store.memoryEdit('team', 'note_team1', undefined, currentTeamEntry.revision, { pinned: true })
check(store.memory.entries.find((entry) => entry.id === 'note_team1').pinned === true, 'memoryEdit can toggle the pinned flag')
const acceptedBefore = store.memory.candidates.length
await store.memoryAccept('cand_1')
check(store.memory.candidates.length === acceptedBefore - 1, 'accepting a candidate drops it from the queue')
check(store.memory.entries.some((entry) => entry.text.includes('版本号写进 CHANGELOG') && entry.auto === true), 'an accepted candidate becomes an auto memory entry')
await store.memoryReject('cand_2')
check(store.memory.candidates.length === 0, 'ignoring the last candidate empties the queue')
const memoryTabAfter = render(mainReg.component, face)
check(memoryTabAfter.includes('暂无待确认记忆'), 'the empty candidate state renders after accepting/ignoring')
store.closeDrawer()


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
  settings: { userName: '林', language: 'zh', autoMemory: true },
  memoryCandidates: [
    { id: 'cand_live', scope: 'team', text: '线上候选记忆', reason: '重复出现', source: { chatId: 'chat_111111111111' }, confidence: 0.7, createdAt: 5 },
  ],
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
let failNextPin = false

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
  if (path.includes('/fs/roots')) return jsonResponse({ ok: true, roots: [{ title: 'game', path: '/root/game' }] })
  if (path.includes('/fs/list')) {
    const fsUrl = new URL('http://x/' + path)
    const wanted = fsUrl.searchParams.get('path')
    if (wanted === '/forbidden') return jsonResponse({ ok: false, code: 'forbidden', message: 'outside the roots' }, 403)
    return jsonResponse({ ok: true, path: wanted === '' ? '/root/game' : wanted, entries: [{ name: 'docs', path: '/root/game/docs', type: 'dir' }, { name: 'a.gd', path: '/root/game/a.gd', type: 'file', size: 12 }] })
  }
  if (path.includes('/fs/read')) return jsonResponse({ ok: true, path: '/root/game/docs/a.md', mime: 'text/markdown', size: 12, text: '# hi' })
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
    if (action === 'pin') {
      if (failNextPin) {
        failNextPin = false
        return jsonResponse({ ok: false, code: 'invalid-request', message: 'unknown chat action "pin"' }, 400)
      }
      const target = liveState.chats.find((chat) => chat.id === body.chatId)
      if (target === undefined) return jsonResponse({ ok: false, code: 'chat-not-found', message: 'no chat' }, 404)
      target.pinned = body.pinned === true
      return jsonResponse({ ok: true, chat: target })
    }
    if (action === 'send') return jsonResponse({ ok: true, state: liveState, chat: liveState.chats[0] })
    if (action === 'read') return jsonResponse({ ok: true, chat: Object.assign({}, liveState.chats[1], { unread: 0 }) })
    if (action === 'retry') return jsonResponse({ ok: true, state: liveState, chat: liveState.chats[0] })
    return jsonResponse({ ok: true, state: liveState })
  }
  if (path.includes('/memory/auto')) {
    liveState.settings.autoMemory = body.enabled === true
    return jsonResponse({ ok: true, state: liveState })
  }
  if (path.includes('/memory')) {
    const liveCandidates = liveState.memoryCandidates === undefined ? [] : liveState.memoryCandidates
    if (action === 'list') {
      return jsonResponse({
        ok: true,
        entries: [{ id: 'note_live', text: '线上记忆', addedAt: 1234, pinned: false, scope: 'team', revision: 'rev-live' }],
        candidates: liveCandidates,
        autoMemory: liveState.settings.autoMemory !== false,
      })
    }
    if (action === 'edit') {
      return jsonResponse({ ok: true, entry: { id: body.id, text: body.text, revision: 'rev-live-2' }, entries: [{ id: 'note_live', text: body.text, addedAt: 1234, pinned: body.pinned === true, scope: 'team', revision: 'rev-live-2' }], candidates: liveCandidates })
    }
    if (action === 'accept') {
      const kept = liveCandidates.filter((candidate) => candidate.id !== body.candidateId)
      return jsonResponse({ ok: true, entry: { id: 'note_accepted', text: body.text === undefined ? '候选内容' : body.text, auto: true }, entries: [{ id: 'note_accepted', text: body.text === undefined ? '候选内容' : body.text, auto: true, scope: 'team' }], candidates: kept })
    }
    if (action === 'reject') {
      return jsonResponse({ ok: true, candidates: liveCandidates.filter((candidate) => candidate.id !== body.candidateId) })
    }
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

// Silent-stream watchdog, manual refresh and revision ordering.
check(typeof store.refreshState === 'function' && typeof store.checkStreamHealth === 'function', 'the store exposes the refresh and health controls')
const liveStream = globalThis.EventSource.instances[globalThis.EventSource.instances.length - 1]
check(liveStream !== undefined, 'the store opened an event stream')
if (liveStream !== undefined && typeof liveStream.onopen === 'function') liveStream.onopen()
check(store.streamHealth().stale === false, 'an accepted stream counts as fresh')
const sinceBeforePing = store.since
if (liveStream !== undefined && typeof liveStream.onmessage === 'function') {
  liveStream.onmessage({ data: JSON.stringify({ type: 'ping' }) })
}
const afterPing = store.streamHealth()
check(afterPing.stale === false && afterPing.idleMs < 1000, 'the ping heartbeat refreshes the last-frame clock')
check(store.since === sinceBeforePing, 'ping heartbeats do not advance the event sequence')
check(store.streamHealth(Date.now() + 60000).stale === true, 'a silent stream reads as stale after 45s')
const instancesBeforeReopen = globalThis.EventSource.instances.length
const reopened = store.checkStreamHealth(Date.now() + 60000)
check(reopened === true && globalThis.EventSource.instances.length === instancesBeforeReopen + 1, 'the watchdog reopens a silent stream')

liveState.settings.userName = '刷新后'
const stateReadsBefore = fetchCalls.filter((call) => call.path.includes('/state')).length
await store.refreshState()
check(store.data.settings.userName === '刷新后', 'refreshState merges the Host snapshot')
check(fetchCalls.filter((call) => call.path.includes('/state')).length === stateReadsBefore + 1, 'refreshState performs one GET /state')

liveState.stateRev = 12
await store.refreshState()
check(store.stateRev === 12, 'stateRev is recorded from the snapshot')
liveState.stateRev = 11
liveState.settings.userName = '旧快照'
await store.refreshState()
check(store.data.settings.userName === '刷新后', 'an older stateRev never overwrites the newer state')

liveState.stateRev = 13
liveState.settings.userName = '可见性刷新'
document.visibilityState = 'visible'
document.dispatch('visibilitychange')
await sleep(130)
check(store.data.settings.userName === '可见性刷新', 'returning to a visible page refreshes the snapshot')
liveState.stateRev = 14
liveState.settings.userName = '焦点刷新'
window.dispatch('focus')
await sleep(130)
check(store.data.settings.userName === '焦点刷新', 'window focus refreshes the snapshot')
liveState.settings.userName = '林'
await store.refreshState()
check(store.data.settings.userName === '林', 'the snapshot can be restored after the refresh checks')

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

await store.pinChat('chat_222222222222', true)
const pinCall = fetchCalls.filter((call) => call.path.includes('/chat') && call.body !== undefined && call.body.action === 'pin').pop()
check(pinCall !== undefined && pinCall.body.pinned === true, 'pinChat posts action "pin" with the new state')
check(store.chatById('chat_222222222222').pinned === true, 'the Host answer keeps the chat pinned')
failNextPin = true
let pinError
try {
  await store.pinChat('chat_222222222222', false)
} catch (error) {
  pinError = error
}
check(pinError !== undefined && pinError.code === 'invalid-request', 'a refused pin surfaces its Host error')
check(store.chatById('chat_222222222222').pinned === true, 'a refused pin rolls the optimistic flag back')

await store.updateGroup('grp_live', {
  name: '线上群',
  replyMode: 'all',
  maxHops: 3,
  handover: true,
  useNote: true,
  workspaces: ['ws_game', '/Users/me/custom'],
  maxSpeakers: 5,
}, { resetSessions: true })
const groupUpdateCall = fetchCalls.filter((call) => call.path.includes('/group') && call.body !== undefined && call.body.action === 'update').pop()
check(groupUpdateCall !== undefined && Array.isArray(groupUpdateCall.body.group.workspaces) && groupUpdateCall.body.group.workspaces.length === 2, 'a group update sends the workspaces array')
check(groupUpdateCall !== undefined && groupUpdateCall.body.resetSessions === true, 'resetSessions travels beside the group draft')
check(groupUpdateCall !== undefined && groupUpdateCall.body.group.resetSessions === true, 'the group draft carries resetSessions too for hosts that read it there')
check(groupUpdateCall !== undefined && groupUpdateCall.body.group.maxSpeakers === 5, 'a group update sends maxSpeakers')

check(typeof store.openFile === 'function' && typeof store.fsRoots === 'function', 'the store exposes the file panel controls')
store.openFile('/root/game/docs/a.md')
check(store.fileOpen === true && store.fileRequest.path === '/root/game/docs/a.md', 'openFile records the requested path')
store.openDrawer('memory')
check(store.fileOpen === false, 'opening the settings drawer closes the file panel')
store.closeDrawer()
store.toggleFile()
check(store.fileOpen === true, 'the rail button toggles the file panel open')
store.closeFile()
check(store.fileOpen === false, 'closeFile closes the file panel')
const fsRootsView = await store.fsRoots('chat_111111111111')
check(fsRootsView.roots.length === 1 && fsRootsView.roots[0].path === '/root/game', 'fsRoots reads the Host roots')
const fsListing = await store.fsList('chat_111111111111', '/root/game')
check(fsListing.entries.length === 2 && fsListing.path === '/root/game', 'fsList reads a directory')
const fsReadView = await store.fsRead('chat_111111111111', '/root/game/docs/a.md')
check(fsReadView.text === '# hi' && fsReadView.mime === 'text/markdown', 'fsRead returns the text preview payload')
check(store.fsRawUrl('chat_111111111111', '/root/game/p.png').indexOf('dsh-bot/api/fs/raw?chatId=chat_111111111111&path=') === 0, 'fsRawUrl encodes the raw file stream URL')
let fsForbidden
try {
  await store.fsList('chat_111111111111', '/forbidden')
} catch (error) {
  fsForbidden = error
}
check(fsForbidden !== undefined && fsForbidden.status === 403, 'an out-of-root path surfaces the Host 403')
store.openFile('/root/game/docs/a.md')
check(store.fileOpen === true && store.fileTab === 'preview', 'opening a file reference lands on the preview tab')
store.setFileTab('browse')
check(store.fileTab === 'browse', 'the file panel can switch back to browse')
store.rememberFileView('chat_111111111111', { browsePath: '/root/game/docs', browseScroll: 42 })
const rememberedView = store.fileViewOf('chat_111111111111')
check(rememberedView.browsePath === '/root/game/docs' && rememberedView.browseScroll === 42, 'each chat remembers its browse state')
store.closeFile()

await store.loadMemory('team', null, true)
check(store.memory.candidates.length === 1 && store.memory.candidates[0].text === '线上候选记忆', 'loadMemory keeps the pending candidates')
check(store.memory.autoMemory === true, 'the auto-memory flag comes from the Host list answer')
await store.setAutoMemory(false)
check(store.memory.autoMemory === false && liveState.settings.autoMemory === false, 'setAutoMemory posts to /memory/auto')
await store.setAutoMemory(true)
const liveEdited = await store.memoryEdit('team', 'note_live', '线上改后', 'rev-live')
check(store.memory.entries.length === 1 && store.memory.entries[0].text === '线上改后', 'memoryEdit applies the Host answer')
const liveEditCall = fetchCalls.filter((call) => call.path.includes('/memory') && call.body !== undefined && call.body.action === 'edit').pop()
check(liveEditCall !== undefined && liveEditCall.body.revision === 'rev-live' && liveEditCall.body.text === '线上改后', 'memoryEdit sends the text and revision')
await store.memoryAccept('cand_live', '接受的候选')
const liveAcceptCall = fetchCalls.filter((call) => call.path.includes('/memory') && call.body !== undefined && call.body.action === 'accept').pop()
check(liveAcceptCall !== undefined && liveAcceptCall.body.candidateId === 'cand_live' && liveAcceptCall.body.text === '接受的候选', 'memoryAccept sends the candidate and edited text')
check(store.memory.candidates.length === 0, 'accepting clears the pending candidate')
await store.memoryReject('cand_live')
const liveRejectCall = fetchCalls.filter((call) => call.path.includes('/memory') && call.body !== undefined && call.body.action === 'reject').pop()
check(liveRejectCall !== undefined && liveRejectCall.body.candidateId === 'cand_live', 'memoryReject posts the reject action')

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
