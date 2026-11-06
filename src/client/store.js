/**
 * Module-level state of the dsh-bot workspace.
 *
 * The shell unmounts the `main` panel whenever another panel is selected, so
 * nothing that must survive a panel switch may live in a React component: the
 * snapshot, the per-chat message caches, the streaming buffers, the selection
 * and the settings-drawer tab all live here. Components subscribe with
 * `subscribe(listener)` and read the fields directly; `version` bumps on every
 * change so `useSyncExternalStore` has a stable snapshot value.
 *
 * The store also owns the two data channels: `GET dsh-bot/api/state` for the
 * snapshot and `dsh-bot/api/events` for the increments. When the Host routes
 * are not mounted yet it degrades to a deterministic demo snapshot and keeps
 * probing, switching to live data the moment a read succeeds.
 */

'use strict'

var transport = require('./transport.js')

/** Actions of `POST dsh-bot/api/chat` this client sends (see PROTOCOL §2). */
var CHAT_ACTION_SEND = 'send'
var CHAT_ACTION_CANCEL = 'cancel'

/** How many messages one history page asks for. */
var PAGE_SIZE = 60
/** How many messages "load earlier" asks for. */
var OLDER_PAGE_SIZE = 40

/** Toast lifetime. */
var TOAST_MS = 2600

/**
 * Structural writes get a longer budget than reads: the Host answers only after
 * broadcasting a fresh snapshot, which can be slow on a cold ledger or model
 * catalog. A create that is merely slow must not be aborted at the read budget.
 */
var STRUCTURAL_TIMEOUT_MS = 35000

/** How often the silence watchdog inspects the event stream. */
var WATCHDOG_INTERVAL_MS = 15000
/** How long the stream may stay silent (no data frame at all) before a reconnect. */
var STREAM_IDLE_MS = 45000

/** 12 hex chars, mirroring the Host id style. */
function rid() {
  var out = ''
  while (out.length < 12) out += Math.floor(Math.random() * 16).toString(16)
  return out
}

/** Random protocol-shaped id. */
function makeId(prefix) {
  return prefix + '_' + rid()
}

/** Coerce anything to an array. */
function listOf(value) {
  return Array.isArray(value) ? value : []
}

/** Coerce anything to a number, or a fallback. */
function numberOr(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback
}

/** Message ordering: persisted seq first, unsent local echoes last. */
function compareMessages(a, b) {
  var as = typeof a.seq === 'number' ? a.seq : 0
  var bs = typeof b.seq === 'number' ? b.seq : 0
  if (as > 0 && bs > 0 && as !== bs) return as - bs
  if (as > 0 && bs <= 0) return -1
  if (as <= 0 && bs > 0) return 1
  return numberOr(a.ts, 0) - numberOr(b.ts, 0)
}

/** One message's text content, trimmed, or ''. */
function messageText(message) {
  if (message === null || message === undefined) return ''
  if (typeof message.text === 'string') return message.text
  var parts = listOf(message.parts)
  var out = ''
  for (var i = 0; i < parts.length; i += 1) {
    if (parts[i] !== null && typeof parts[i] === 'object' && parts[i].type === 'text' && typeof parts[i].text === 'string') {
      out += parts[i].text
    }
  }
  return out
}

/* ----------------------------------------------------------------------- */
/* Demo snapshot                                                          */
/* ----------------------------------------------------------------------- */

var DEMO_COLORS = ['#4f7cff', '#e8913d', '#2fb5a8', '#c96bce', '#e05d6f', '#7a8cf0', '#3fa66a']

/** Build the deterministic demo snapshot used before the Host is reachable. */
function buildDemoState() {
  var now = Date.now()
  var chief = {
    id: 'bot_5f3a91c2d7e4',
    name: 'Chief',
    role: '团队总管',
    instructions: '你是团队的总管，负责拆解目标、分派任务并在群聊里做最后的收敛。回答简洁、先给结论。',
    skin: 'chief',
    color: DEMO_COLORS[0],
    avatar: { kind: 'library', id: 'lead-crown', motif: 'crown', color: '#3b6df6', background: '#eaf0ff' },
    avatarAuto: true,
    isMain: true,
    model: null,
    permission: 'workspace-write',
    autoHelper: true,
    createdAt: now - 86400000 * 12,
    updatedAt: now - 3600000,
    rev: 3,
  }
  var architect = {
    id: 'bot_8b21e6a4c9d0',
    name: '架构师',
    role: '系统架构评审',
    instructions: '你负责架构评审：先画清楚边界，再指出风险，最后给出最小可行方案。',
    skin: 'architect',
    color: DEMO_COLORS[1],
    avatar: { kind: 'library', id: 'engineer-wrench', motif: 'wrench', color: '#f08a24', background: '#fdf0e2' },
    avatarAuto: true,
    workspaceId: 'ws_demo_product',
    isMain: false,
    model: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
    permission: 'read-only',
    autoHelper: false,
    createdAt: now - 86400000 * 8,
    updatedAt: now - 7200000,
    rev: 2,
  }
  var writer = {
    id: 'bot_1c7d4f9a2b35',
    name: '写手',
    role: '文案与文档',
    instructions: '你负责把技术内容写成清楚、克制、有信息量的中文文档。',
    skin: 'writer',
    color: DEMO_COLORS[2],
    avatar: { kind: 'library', id: 'writer-quill', motif: 'quill', color: '#7b5cf0', background: '#efeaff' },
    avatarAuto: true,
    isMain: false,
    model: null,
    permission: 'workspace-write',
    autoHelper: false,
    createdAt: now - 86400000 * 5,
    updatedAt: now - 10800000,
    rev: 1,
  }
  var group = {
    id: 'grp_4a2e9c7b1d6f',
    name: '产品小队',
    adminId: chief.id,
    memberIds: [chief.id, architect.id, writer.id],
    notice: '我们正在把 Bot 工作台接进 DSH Web：先跑通私聊，再做群聊接力。',
    replyMode: 'all',
    maxHops: 3,
    handover: true,
    useNote: true,
    noteEntries: [
      { at: now - 5400000, speaker: 'Chief', text: '本周目标：M1 私聊闭环，M2 群聊接力。' },
      { at: now - 3600000, speaker: '架构师', text: '数据契约以 PROTOCOL.md 为准，客户端不要发明字段。' },
    ],
    createdAt: now - 86400000 * 4,
    updatedAt: now - 3600000,
    workspaces: [
      { id: 'ws_demo_product', title: '产品项目', path: '~/Project/product' },
      { title: 'game-dev', path: '~/Project/game-dev' },
    ],
  }
  var conv = [
    {
      id: 'chat_b7a1c9d3e5f2',
      kind: 'dm',
      botId: chief.id,
      title: 'Chief',
      sessionId: 'sess_demo_chief',
      lastSeq: 4,
      updatedAt: now - 120000,
      unread: 0,
      pinned: true,
      running: false,
    },
    {
      id: 'chat_2e6c8a4f0b1d',
      kind: 'dm',
      botId: architect.id,
      title: '架构师',
      sessionId: 'sess_demo_arch',
      lastSeq: 2,
      updatedAt: now - 7200000,
      unread: 1,
      pinned: false,
      running: false,
    },
    {
      id: 'chat_9d3f5b7a1c2e',
      kind: 'dm',
      botId: writer.id,
      title: '写手',
      sessionId: '',
      lastSeq: 0,
      updatedAt: now - 10800000,
      unread: 0,
      pinned: false,
      running: false,
    },
    {
      id: 'chat_6f0b2d4a8c3e',
      kind: 'group',
      groupId: group.id,
      title: group.name,
      sessionId: '',
      lastSeq: 5,
      updatedAt: now - 3600000,
      unread: 2,
      pinned: false,
      running: false,
    },
  ]
  return {
    self: { id: 'owner', name: '我' },
    bots: [chief, architect, writer],
    groups: [group],
    chats: conv,
    running: [],
    settings: { userName: '我', language: 'zh', autoMemory: true },
    models: {
      providers: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoningEffort: ['high', 'max'] },
          ],
        },
        {
          id: 'openai',
          name: 'OpenAI',
          models: [{ id: 'gpt-5', name: 'GPT-5' }],
        },
      ],
      default: { provider: 'deepseek', model: 'deepseek-chat' },
    },
    limits: { maxHops: 6, memoryEntryMax: 6000, memoryStorageMax: 64000, groupNoteMax: 4000 },
    workspaces: [
      { id: 'ws_demo_default', title: '默认 dsh-bot 工作区', path: '~/.dsh/dsh-bot/workspace' },
      { id: 'ws_demo_product', title: '产品项目', path: '~/Project/product' },
    ],
    tasks: [
      {
        id: 'task_demo1',
        kind: 'bot',
        botId: 'bot_8b21e6a4c9d0',
        text: '评审 dsh-bot 的客户端结构',
        title: '评审客户端结构',
        status: 'running',
        createdAt: Date.now() - 300000,
        startedAt: Date.now() - 240000,
      },
      {
        id: 'task_demo2',
        kind: 'discussion',
        groupId: 'grp_4a2e9c7b1d6f',
        text: '讨论群聊接力策略',
        title: '讨论群聊接力',
        status: 'queued',
        batchId: 'batch_demo',
        createdAt: Date.now() - 120000,
      },
      {
        id: 'task_demo3',
        kind: 'bot',
        botId: 'bot_5f3a91c2d7e4',
        text: '整理今天的计划',
        title: '整理今日计划',
        status: 'done',
        result: '先给结论：今天只做三件事…',
        createdAt: Date.now() - 3600000,
        startedAt: Date.now() - 3500000,
        endedAt: Date.now() - 3000000,
      },
      {
        id: 'task_demo4',
        kind: 'bot',
        botId: 'bot_1c7d4f9a2b35',
        text: '写一段产品介绍',
        title: '产品介绍初稿',
        status: 'failed',
        error: 'model-unavailable: 所选模型不可用',
        createdAt: Date.now() - 7200000,
        endedAt: Date.now() - 7100000,
      },
    ],
    helpers: [
      {
        id: 'helper_demo1',
        botId: 'bot_8b21e6a4c9d0',
        chatId: 'chat_6f0b2d4a8c3e',
        title: '调研群聊接力',
        task: '阅读群聊接力相关源码并总结',
        status: 'running',
        createdAt: Date.now() - 200000,
        startedAt: Date.now() - 190000,
      },
    ],
    usage: null,
  }
}

/** Demo message history keyed by chat id. */
function buildDemoMessages(state) {
  var now = Date.now()
  var chief = state.bots[0]
  var architect = state.bots[1]
  var writer = state.bots[2]
  var group = state.groups[0]
  function msg(chatId, seq, role, text, status, extra) {
    var message = {
      id: 'msg_' + rid(),
      chatId: chatId,
      seq: seq,
      ts: now - 600000 + seq * 60000,
      role: role,
      text: text,
      status: status || 'done',
      parts: [{ type: 'text', text: text }],
    }
    if (extra !== undefined) {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) message[key] = extra[key]
      }
    }
    return message
  }
  var out = {}
  out['chat_b7a1c9d3e5f2'] = [
    msg('chat_b7a1c9d3e5f2', 1, 'user', '帮我把今天的计划理一下，按优先级排。'),
    msg('chat_b7a1c9d3e5f2', 2, 'bot', '', 'done', {
      botId: chief.id,
      sessionId: 'sess_demo_chief',
      parts: [
        { type: 'tool', name: 'read_workspace', status: 'ok' },
        {
          type: 'text',
          text: '先给结论：今天只做三件事，其余全部往后推。\n\n1. 把 Bot 工作台的私聊闭环验收掉（最高优先级）\n2. 补 PROTOCOL 里缺的 /chat action 枚举\n3. 群聊接力的 mock 演示\n\n要我把第 1 项拆成更细的步骤吗？',
        },
      ],
      text: '先给结论：今天只做三件事，其余全部往后推。\n\n1. 把 Bot 工作台的私聊闭环验收掉（最高优先级）\n2. 补 PROTOCOL 里缺的 /chat action 枚举\n3. 群聊接力的 mock 演示\n\n要我把第 1 项拆成更细的步骤吗？',
    }),
    msg('chat_b7a1c9d3e5f2', 3, 'user', '好，拆一下。'),
    msg('chat_b7a1c9d3e5f2', 4, 'bot', '拆好了：\n\n① 页面挂在 sidebar.panellist + main 上，切面板不丢状态\n② state 拉取 + SSE 增量\n③ 断开时降级到演示数据并显示横幅\n\n每一步都能在 GUI 里单独验收。', 'done', {
      botId: chief.id,
      sessionId: 'sess_demo_chief',
    }),
    msg('chat_b7a1c9d3e5f2', 5, 'bot', '', 'done', {
      botId: chief.id,
      sessionId: 'sess_demo_chief',
      text: '这是一张架构草图，附一份协议笔记：',
      parts: [
        { type: 'text', text: '这是一张架构草图，附一份协议笔记：' },
        {
          type: 'image',
          attachment: { id: 'att_demo_img', name: 'architecture.png', size: 184320, mime: 'image/png', url: 'dsh-bot/api/media?id=att_demo_img' },
        },
        {
          type: 'file',
          attachment: { id: 'att_demo_file', name: 'protocol-notes.md', size: 5120, mime: 'text/markdown', url: 'dsh-bot/api/media?id=att_demo_file' },
        },
      ],
    }),
    msg('chat_b7a1c9d3e5f2', 6, 'bot', '本周分工如下：\n\n| 角色 | 名字 | 职责 | 状态 |\n| :--- | :---: | :--- | ---: |\n| 总管 | **Chief** | 派活与验收 | `done` |\n| 架构 | 架构师 | 契约与评审 | `进行中` |\n| 文案 | 写手 | 文档与公告 | 2 篇 |', 'done', {
      botId: chief.id,
      sessionId: 'sess_demo_chief',
    }),
    msg('chat_b7a1c9d3e5f2', 7, 'bot', '', 'done', {
      botId: chief.id,
      sessionId: 'sess_demo_chief',
      text: '先看一下平衡脚本 `game/balance.gd`，再对照 [设计文档](docs/design.md)。',
      parts: [
        {
          type: 'tool',
          name: 'bash',
          status: 'ok',
          summary: 'ls -la game/ && head -40 game/balance.gd',
          args: '{"command":"ls -la game/ && head -40 game/balance.gd"}',
          result: 'total 48\n-rw-r--r--  1 me  staff  2048 game/balance.gd\n-rw-r--r--  1 me  staff  1024 game/player.gd',
        },
        {
          type: 'tool',
          name: 'write',
          status: 'failed',
          summary: 'game/balance.gd',
          args: '{"path":"game/balance.gd","content":"...","mode":"overwrite"}',
          error: 'permission denied: the group workspace is read-only for this Bot',
        },
        {
          type: 'text',
          text: '先看一下平衡脚本 `game/balance.gd`，再对照 [设计文档](docs/design.md)。',
        },
      ],
    }),
  ]
  out['chat_2e6c8a4f0b1d'] = [
    msg('chat_2e6c8a4f0b1d', 1, 'user', '这个插件应该走 main 面板还是 shell.overlay？'),
    msg('chat_2e6c8a4f0b1d', 2, 'bot', '', 'error', {
      botId: architect.id,
      sessionId: 'sess_demo_arch',
      error: 'session-busy: 这个 Bot 的原生会话正被另一个回合占用',
      parts: [
        { type: 'text', text: '我先看了一下挂载点对比，结论是 main 面板。' },
        { type: 'tool', name: 'read_file', status: 'failed', error: 'ENOENT: research/minimax-bot/02-dsh-ui-capabilities.md' },
      ],
      text: '我先看了一下挂载点对比，结论是 main 面板。',
    }),
  ]
  out['chat_9d3f5b7a1c2e'] = []
  out['chat_6f0b2d4a8c3e'] = [
    msg('chat_6f0b2d4a8c3e', 1, 'user', '@架构师 群聊用 session-scoped 的右栏 tab 合适吗？'),
    msg('chat_6f0b2d4a8c3e', 2, 'bot', '不合适。工作台是 root scope 的跨会话页面，右栏 tab 的语义是“某个会话的辅助面板”。', 'done', {
      botId: architect.id,
    }),
    msg('chat_6f0b2d4a8c3e', 3, 'bot', '补充：如果以后要做“把某个 Bot 会话上浮到侧栏”，再单独用 sidebarRightTabs + sidebar.chat.conversation，那是它该干的活。', 'done', {
      botId: chief.id,
    }),
    msg('chat_6f0b2d4a8c3e', 4, 'bot', '', 'pass', { botId: writer.id, text: '[PASS]' }),
    msg('chat_6f0b2d4a8c3e', 5, 'bot', '同意，先按 main 面板做。群聊时间线需要自绘，官方一次只渲染一个 session。', 'done', {
      botId: writer.id,
    }),
  ]
  // Group chat's speaker names come from the roster, not the message body.
  if (group !== undefined) {
    for (var key in out) {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = listOf(out[key]).slice().sort(compareMessages)
      }
    }
  }
  return out
}

/** Demo memory entries. */
function buildDemoMemory(state) {
  var now = Date.now()
  return {
    team: [
      { id: 'note_team1', scope: 'team', text: '团队周报在每周五 18:00 前发出，由 Chief 汇总。', at: now - 86400000 * 3, pinned: true, auto: false, revision: 'r1' },
      { id: 'note_team2', scope: 'team', text: '所有对外文档先由写手起稿，架构师只看技术准确性。', at: now - 86400000 * 2, pinned: false, auto: true, revision: 'r2' },
    ],
    candidates: [
      {
        id: 'cand_1',
        scope: 'team',
        text: '发布前把版本号写进 CHANGELOG，并跑一遍冒烟。',
        reason: '用户在对话里明确要求长期记住这条发布约定',
        source: { chatId: 'chat_b7a1c9d3e5f2', messageId: 'msg_demo_cand' },
        confidence: 0.82,
        createdAt: now - 3600000,
      },
      {
        id: 'cand_2',
        scope: 'bot',
        botId: 'bot_5f3a91c2d7e4',
        text: 'Chief 负责每周五汇总团队周报。',
        reason: '同一约定在近几轮对话里重复出现',
        source: { chatId: 'chat_b7a1c9d3e5f2' },
        confidence: 0.64,
        createdAt: now - 7200000,
      },
    ],
    bots: {
      'bot_5f3a91c2d7e4': [
        { id: 'note_chief1', scope: 'bot', targetBotId: 'bot_5f3a91c2d7e4', text: '用户偏好先给结论、再给步骤；不喜欢寒暄。', at: now - 86400000, pinned: true },
      ],
      'bot_8b21e6a4c9d0': [
        { id: 'note_arch1', scope: 'bot', targetBotId: 'bot_8b21e6a4c9d0', text: '评审时先画边界，再列风险，最后给最小方案。', at: now - 86400000 * 2, pinned: false },
      ],
    },
  }
}

/** Demo usage view for one day window. */
function buildDemoUsage(days) {
  var count = Math.max(1, Math.min(90, days))
  var byDay = []
  var total = { turns: 0, chars: 0 }
  var names = ['Chief', '架构师', '写手']
  for (var i = count - 1; i >= 0; i -= 1) {
    var date = new Date(Date.now() - i * 86400000)
    var turnCount = (i * 7 + 5) % 13
    var chars = turnCount * (420 + ((i * 137) % 900))
    total.turns += turnCount
    total.chars += chars
    byDay.push({
      day: date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()),
      turns: turnCount,
      chars: chars,
    })
  }
  var byBot = [
    { botId: 'bot_5f3a91c2d7e4', name: 'Chief', turns: Math.max(1, Math.round(total.turns * 0.42)), chars: Math.round(total.chars * 0.44) },
    { botId: 'bot_8b21e6a4c9d0', name: '架构师', turns: Math.max(1, Math.round(total.turns * 0.33)), chars: Math.round(total.chars * 0.31) },
    { botId: 'bot_1c7d4f9a2b35', name: '写手', turns: Math.max(1, Math.round(total.turns * 0.25)), chars: Math.round(total.chars * 0.25) },
  ]
  return { days: count, total: total, byDay: byDay, byBot: byBot }
}

/** Demo schedule list. */
function buildDemoSchedules(state) {
  var now = Date.now()
  var chief = state.bots[0]
  return [
    {
      id: 'sch_3a1c5e7b9d2f',
      botId: chief === undefined ? undefined : chief.id,
      title: '每日晨报',
      prompt: '总结昨天的工作进展，并列出今天最重要的三件事。',
      timing: { kind: 'daily', time: '09:00' },
      nextRunAt: now + 3600000,
    },
  ]
}

/** Two-digit padding. */
function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

/* ----------------------------------------------------------------------- */
/* Demo replies                                                           */
/* ----------------------------------------------------------------------- */

var DEMO_REPLIES = {
  chief: [
    '收到。先给结论：这一步值得做，但要在今天之内收敛。\n\n我的建议是拆成三步：先把数据契约对齐，再让页面在演示数据下跑通，最后接真实路由联调。每一步都能单独验收。',
    '我看了一下上下文。这里有两件事要分开：一是页面能不能稳定拿到状态，二是消息流能不能增量刷新。第一件用全量 state 兜底，第二件靠 SSE 的 delta 帧。\n\n需要我现在把 SSE 的重连策略写进文档吗？',
    '这个问题我让架构师先看更合适，我只做个收敛：结论按 main 面板走，右栏 tab 留给“上浮单个会话”。',
  ],
  architect: [
    '先画边界：客户端只消费 PROTOCOL.md 里的字段，不自己发明形状。\n\n风险有两个：一是 panel 切换会卸载组件，所以状态必须外置；二是 SSE 断线后要重拉全量，否则增量会丢。最小方案是在 store 里维护 state + messages 两级缓存，重连时先 fetch state 再按需补消息。',
    '从架构上看，这个页面是 root scope 的跨会话工作台，不该绑到某个 session 上。挂到 main 面板，用 keyed 面板 id 和侧栏行对齐，是唯一被多个已装插件验证过的路径。',
  ],
  writer: [
    '我把这段整理成一段可以直接发的说明：\n\n“Bot 工作台是一个常驻的中心页面板。左边是机器人和群组，中间是合并时间线，右边是设置抽屉。每个机器人背后是一个真实的 DSH 会话，随时可以回到原生会话继续。”\n\n要我再压一版更短的用于 README 吗？',
    '文案上我建议统一叫“机器人”，不要在同一屏里混用 Bot / 智能体 / Agent 三个词。标题短，说明句里再解释它是什么。',
  ],
  generic: [
    '收到，我记下了。这条信息会进这一轮的上下文；如果希望它长期生效，可以在设置 → 记忆里加一条。',
    '可以。我先按你说的做，遇到需要你拍板的点会停下来问。',
  ],
}

/** Pick a demo reply for one bot and prompt. */
function demoReplyFor(bot, prompt) {
  var key = 'generic'
  var role = String((bot && (bot.name + ' ' + bot.role)) || '')
  if (bot !== undefined && bot.isMain) key = 'chief'
  else if (role.indexOf('架') >= 0) key = 'architect'
  else if (role.indexOf('写') >= 0 || role.indexOf('文档') >= 0) key = 'writer'
  var bucket = DEMO_REPLIES[key] || DEMO_REPLIES.generic
  var seed = 0
  for (var i = 0; i < prompt.length; i += 1) seed = (seed + prompt.charCodeAt(i)) % 997
  return bucket[seed % bucket.length]
}

/* ----------------------------------------------------------------------- */
/* Store                                                                  */
/* ----------------------------------------------------------------------- */

/** Create the one workspace store this plugin bundle keeps. */
function createStore() {
  var store = {
    version: 0,
    mode: 'connecting',
    error: null,
    data: null,
    selectedChatId: null,
    filter: 'all',
    search: '',
    drawer: null,
    drawerTab: 'general',
    toolExpanded: Object.create(null),
    fileOpen: false,
    fileRequest: null,
    leftOpen: false,
    messages: Object.create(null),
    drafts: Object.create(null),
    quotes: Object.create(null),
    memory: {
      scope: 'team',
      botId: null,
      entries: [],
      candidates: [],
      autoMemory: true,
      loading: false,
      error: null,
      loaded: false,
    },
    schedules: { list: [], loading: false, error: null, loaded: false, unsupported: false },
    usage: { days: 7, view: null, loading: false, error: null, loaded: false },
    toasts: [],
    since: 0,
    disposed: false,
    stateRev: undefined,
    refreshing: false,
    streamReconnects: 0,
  }

  var listeners = []
  var stream = null
  var disposed = false
  var mockTimerIds = Object.create(null)
  var mockDemoMessages = Object.create(null)
  var mockDemoMemory = null
  var toastTimers = []
  var pendingReads = Object.create(null)
  var resyncTimer = null
  var frameSeen = false
  var started = false
  var lastFrameAt = 0
  var streamOpenedAt = 0
  var watchdogTimer = null
  var refreshInFlight = null
  var staleRefreshTimer = null

  /** Read the optional `stateRev` off a state body or its envelope. */
  function revisionOf(state, envelope) {
    if (envelope !== null && typeof envelope === 'object') {
      if (typeof envelope.stateRev === 'number' && isFinite(envelope.stateRev)) return envelope.stateRev
    }
    if (state !== null && typeof state === 'object') {
      if (typeof state.stateRev === 'number' && isFinite(state.stateRev)) return state.stateRev
    }
    return undefined
  }

  /**
   * Refresh the whole snapshot through `GET /state`.
   *
   * Used by the visibility/focus recovery handlers and the manual refresh
   * button. It never flips the connection banner on failure: the caller decides
   * how loud to be, and the next successful read or stream frame repairs state.
   */
  function refreshState() {
    if (disposed) return Promise.reject(new Error('disposed'))
    if (refreshInFlight !== null) return refreshInFlight
    store.refreshing = true
    notify()
    refreshInFlight = transport.get('state').then(
      function (body) {
        refreshInFlight = null
        if (disposed) {
          store.refreshing = false
          return false
        }
        store.refreshing = false
        var applied = applyState(body.state, revisionOf(body.state, body), 'get')
        if (applied) store.error = null
        notify()
        return applied
      },
      function (error) {
        refreshInFlight = null
        if (!disposed) {
          store.refreshing = false
          notify()
        }
        throw error
      },
    )
    return refreshInFlight
  }

  /** Ask for a fresh snapshot after an out-of-order SSE state frame. */
  function scheduleStaleRefresh() {
    if (disposed || staleRefreshTimer !== null) return
    staleRefreshTimer = setTimeout(function () {
      staleRefreshTimer = null
      refreshState().catch(function () {
        /* silent: the stream resync or the next read repairs the snapshot */
      })
    }, 1000)
  }

  /** Whether the event stream has been silent long enough to force a reconnect. */
  function checkStreamHealth(nowOverride) {
    if (disposed) return false
    if (store.mode === 'mock') return false
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
    if (stream === null || typeof stream.reopen !== 'function') return false
    var now = typeof nowOverride === 'number' ? nowOverride : Date.now()
    var last = lastFrameAt === 0 ? streamOpenedAt : lastFrameAt
    if (last === 0) return false
    if (now - last <= STREAM_IDLE_MS) return false
    try {
      stream.reopen()
    } catch (error) {
      return false
    }
    lastFrameAt = now
    store.streamReconnects = numberOr(store.streamReconnects, 0) + 1
    return true
  }

  /** Snapshot of the stream liveness, for the watchdog and for tests. */
  function streamHealth(nowOverride) {
    var now = typeof nowOverride === 'number' ? nowOverride : Date.now()
    var last = lastFrameAt === 0 ? streamOpenedAt : lastFrameAt
    var idle = last === 0 ? Infinity : Math.max(0, now - last)
    return {
      lastFrameAt: lastFrameAt,
      openedAt: streamOpenedAt,
      idleMs: idle,
      stale: last !== 0 && idle > STREAM_IDLE_MS,
      reconnects: numberOr(store.streamReconnects, 0),
    }
  }

  /** visibilitychange / window.focus recovery: pull the snapshot again. */
  function onPageVisible() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    refreshState().catch(function () {
      /* silent: the next read or stream frame repairs state */
    })
  }

  function onWindowFocus() {
    onPageVisible()
  }

  function startHealthMonitors() {
    if (watchdogTimer !== null) return
    watchdogTimer = setInterval(function () {
      checkStreamHealth()
    }, WATCHDOG_INTERVAL_MS)
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', onPageVisible)
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', onWindowFocus)
    }
  }

  function stopHealthMonitors() {
    if (watchdogTimer !== null) {
      clearInterval(watchdogTimer)
      watchdogTimer = null
    }
    if (staleRefreshTimer !== null) {
      clearTimeout(staleRefreshTimer)
      staleRefreshTimer = null
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', onPageVisible)
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('focus', onWindowFocus)
    }
  }

  function clearResyncTimer() {
    if (resyncTimer !== null) {
      clearTimeout(resyncTimer)
      resyncTimer = null
    }
  }

  function notify() {
    store.version += 1
    var snapshot = listeners.slice()
    for (var i = 0; i < snapshot.length; i += 1) {
      try {
        snapshot[i]()
      } catch (error) {
        /* a listener must never break the store */
      }
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {}
    listeners.push(listener)
    return function () {
      var index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    }
  }

  function flash(text, kind) {
    if (text === undefined || text === null || text === '') return
    var toast = { id: 'toast_' + rid(), text: String(text), kind: kind || 'info' }
    store.toasts.push(toast)
    if (store.toasts.length > 3) store.toasts.shift()
    var timer = setTimeout(function () {
      var index = store.toasts.indexOf(toast)
      if (index >= 0) store.toasts.splice(index, 1)
      notify()
    }, TOAST_MS)
    toastTimers.push(timer)
    notify()
  }

  /* ------------------------------------------------------------- indexes */

  function arrayOf(value) {
    return listOf(value)
  }

  function bots() {
    return store.data === null ? [] : arrayOf(store.data.bots)
  }

  function groups() {
    return store.data === null ? [] : arrayOf(store.data.groups)
  }

  function chats() {
    return store.data === null ? [] : arrayOf(store.data.chats)
  }

  function running() {
    return store.data === null ? [] : arrayOf(store.data.running)
  }

  function workspaces() {
    return store.data === null ? [] : arrayOf(store.data.workspaces)
  }

  function tasks() {
    return store.data === null ? [] : arrayOf(store.data.tasks)
  }

  function helpers() {
    return store.data === null ? [] : arrayOf(store.data.helpers)
  }

  function botById(id) {
    var all = bots()
    for (var i = 0; i < all.length; i += 1) if (all[i] !== null && all[i].id === id) return all[i]
    return undefined
  }

  function groupById(id) {
    var all = groups()
    for (var i = 0; i < all.length; i += 1) if (all[i] !== null && all[i].id === id) return all[i]
    return undefined
  }

  function chatById(id) {
    var all = chats()
    for (var i = 0; i < all.length; i += 1) if (all[i] !== null && all[i].id === id) return all[i]
    return undefined
  }

  function chatTitle(chat) {
    if (chat === null || chat === undefined) return ''
    if (typeof chat.title === 'string' && chat.title !== '') return chat.title
    if (chat.kind === 'group') {
      var group = groupById(chat.groupId)
      if (group !== undefined) return group.name
    } else {
      var bot = botById(chat.botId)
      if (bot !== undefined) return bot.name
    }
    return chat.id || ''
  }

  function runningOf(chatId) {
    var all = running()
    for (var i = 0; i < all.length; i += 1) {
      if (all[i] !== null && all[i].chatId === chatId) return all[i]
    }
    return undefined
  }

  function messagesOf(chatId) {
    var entry = store.messages[chatId]
    if (entry === undefined) {
      entry = { list: [], hasMore: false, loaded: false, loading: false, error: null }
      store.messages[chatId] = entry
    }
    return entry
  }

  /* --------------------------------------------------------- state apply */

  function normalizeState(raw) {
    var source = raw !== null && typeof raw === 'object' ? raw : {}
    var self = source.self !== null && typeof source.self === 'object' ? source.self : {}
    var settings = source.settings !== null && typeof source.settings === 'object' ? source.settings : {}
    var limits = source.limits !== null && typeof source.limits === 'object' ? source.limits : {}
    return {
      self: { id: typeof self.id === 'string' ? self.id : 'owner', name: typeof self.name === 'string' ? self.name : '' },
      bots: arrayOf(source.bots),
      groups: arrayOf(source.groups),
      chats: arrayOf(source.chats),
      running: arrayOf(source.running),
      settings: {
        userName: typeof settings.userName === 'string' ? settings.userName : '',
        language: settings.language === 'en' ? 'en' : 'zh',
        autoMemory: settings.autoMemory !== false,
      },
      models: source.models !== null && typeof source.models === 'object' ? source.models : undefined,
      limits: {
        maxHops: numberOr(limits.maxHops, 6),
        memoryEntryMax: numberOr(limits.memoryEntryMax, 6000),
        memoryStorageMax: numberOr(limits.memoryStorageMax, 64000),
        memoryContextMax: numberOr(limits.memoryContextMax, 6000),
        memoryEntriesMax: numberOr(limits.memoryEntriesMax, 1000),
        groupNoteMax: numberOr(limits.groupNoteMax, 4000),
        nameMax: numberOr(limits.nameMax, 40),
        roleMax: numberOr(limits.roleMax, 120),
        instructionsMax: numberOr(limits.instructionsMax, 4000),
        noticeMax: numberOr(limits.noticeMax, 4000),
      },
      schedules: Array.isArray(source.schedules) ? source.schedules : undefined,
      workspaces: arrayOf(source.workspaces),
      tasks: arrayOf(source.tasks),
      helpers: arrayOf(source.helpers),
    }
  }

  function defaultChatId() {
    var all = chats()
    if (all.length === 0) return null
    var pinned = []
    for (var i = 0; i < all.length; i += 1) if (all[i] !== null && all[i].pinned) pinned.push(all[i])
    var pool = pinned.length > 0 ? pinned : all.slice()
    pool.sort(function (a, b) {
      return numberOr(b === null ? 0 : b.updatedAt, 0) - numberOr(a === null ? 0 : a.updatedAt, 0)
    })
    return pool[0] === undefined ? null : pool[0].id
  }

  function ensureSelection() {
    if (store.selectedChatId === null || chatById(store.selectedChatId) === undefined) {
      store.selectedChatId = defaultChatId()
    }
    if (store.selectedChatId !== null) {
      ensureChatMessages(store.selectedChatId)
      markRead(store.selectedChatId)
    }
  }

  /**
   * Reload the open chat when the snapshot says it holds messages this client
   * has not seen: a missed SSE frame must not freeze the timeline.
   */
  function refreshSelectedIfStale() {
    var chatId = store.selectedChatId
    if (chatId === null || chatId === undefined) return
    var chat = chatById(chatId)
    if (chat === undefined) return
    var entry = store.messages[chatId]
    if (entry === undefined || entry.loaded !== true) return
    var highest = 0
    for (var i = 0; i < entry.list.length; i += 1) {
      if (entry.list[i] === null || entry.list[i] === undefined) continue
      var seq = Number(entry.list[i].seq)
      if (Number.isFinite(seq) && seq > highest) highest = seq
    }
    if (numberOr(chat.lastSeq, 0) > highest) loadMessages(chatId, false, true)
  }

  /** Drop reads that belong to the previous data source when it changes. */
  function invalidateRemoteCaches() {
    store.memory = { scope: 'team', botId: null, entries: [], loading: false, error: null, loaded: false }
    store.usage = { days: store.usage.days, view: null, loading: false, error: null, loaded: false }
    store.schedules = { list: [], loading: false, error: null, loaded: false, unsupported: false }
  }

  function applyState(next, revision, source) {
    // Skip an out-of-order snapshot: a stream frame or a racing read that is
    // older than what is already on screen must not move the page backwards.
    if (typeof revision === 'number' && isFinite(revision)) {
      if (typeof store.stateRev === 'number' && revision < store.stateRev) {
        if (source === 'sse') scheduleStaleRefresh()
        return false
      }
      store.stateRev = revision
    }
    var wasMock = store.mode === 'mock'
    if (wasMock) {
      clearMockTimers()
      invalidateRemoteCaches()
    }
    store.data = normalizeState(next)
    store.mode = 'live'
    store.error = null
    syncSchedulesFromState()
    ensureSelection()
    refreshSelectedIfStale()
    notify()
    return true
  }

  function syncSchedulesFromState() {
    if (store.data !== null && Array.isArray(store.data.schedules)) {
      store.schedules.list = store.data.schedules
      store.schedules.loaded = true
      store.schedules.unsupported = false
      store.schedules.error = null
    }
  }

  function applyDemoState() {
    var demo = buildDemoState()
    store.data = normalizeState(demo)
    store.mode = 'mock'
    store.error = null
    mockDemoMessages = buildDemoMessages(store.data)
    mockDemoMemory = buildDemoMemory(store.data)
    store.messages = Object.create(null)
    var chatList = chats()
    for (var i = 0; i < chatList.length; i += 1) {
      if (chatList[i] === null) continue
      var entry = messagesOf(chatList[i].id)
      entry.list = listOf(mockDemoMessages[chatList[i].id]).slice().sort(compareMessages)
      entry.loaded = true
      entry.hasMore = false
    }
    store.schedules.list = buildDemoSchedules(store.data)
    store.schedules.loaded = true
    store.schedules.unsupported = false
    store.memory = { scope: 'team', botId: null, entries: [], loading: false, error: null, loaded: false }
    store.usage = { days: store.usage.days, view: null, loading: false, error: null, loaded: false }
    ensureSelection()
  }

  /* ------------------------------------------------------------- loaders */

  function loadState() {
    if (disposed) return Promise.resolve()
    return transport.get('state').then(
      function (body) {
        if (disposed) return
        applyState(body.state, revisionOf(body.state, body), 'get')
      },
      function (error) {
        if (disposed) return
        store.error = error
        var failure = error === null || error === undefined ? undefined : error.failure
        // The demo snapshot is a stand-in for a Host that is not there at all.
        // A Host that answers with an error (or whose read timed out) keeps the
        // workspace honest: show the failure and a retry, not fake bots.
        var hostAbsent = failure === 'unreachable' || failure === 'not-mounted'
        if (store.mode !== 'live' && store.mode !== 'disconnected') {
          if (hostAbsent) applyDemoState()
          else store.mode = 'disconnected'
        } else if (store.mode === 'live') {
          store.mode = 'disconnected'
        }
        notify()
      },
    )
  }

  function ensureChatMessages(chatId) {
    var entry = messagesOf(chatId)
    if (entry.loaded || entry.loading) return
    loadMessages(chatId, false)
  }

  function loadMessages(chatId, older, force) {
    if (disposed || chatId === undefined || chatId === null) return Promise.resolve()
    var entry = messagesOf(chatId)
    if (entry.loading) return Promise.resolve()
    if (!older && entry.loaded && force !== true) return Promise.resolve()
    var before = older && entry.list.length > 0 ? entry.list[0].seq : undefined
    var key = chatId + (older ? ':older' : ':first')
    if (pendingReads[key] === true) return Promise.resolve()
    pendingReads[key] = true
    entry.loading = true
    entry.error = null
    notify()

    if (store.mode === 'mock') {
      return new Promise(function (resolve) {
        setTimeout(function () {
          pendingReads[key] = false
          entry.loading = false
          entry.loaded = true
          entry.hasMore = false
          notify()
          resolve()
        }, 80)
      })
    }

    // A read that never settles must not leave the timeline stuck on its
    // loading state forever: fail visibly and let the user retry.
    var watchdog = setTimeout(function () {
      if (!entry.loading) return
      pendingReads[key] = false
      entry.loading = false
      entry.error = new transport.DshBotApiError('timeout', 'timeout')
      notify()
    }, 10000)

    return transport
      .get('messages', { chatId: chatId, before: before, limit: older ? OLDER_PAGE_SIZE : PAGE_SIZE })
      .then(
        function (body) {
          clearTimeout(watchdog)
          pendingReads[key] = false
          if (disposed) return
          var incoming = arrayOf(body.messages).slice().sort(compareMessages)
          entry.list = mergeMessages(incoming, entry.list)
          entry.hasMore = body.hasMore === true
          entry.loaded = true
          entry.loading = false
          entry.error = null
          notify()
        },
        function (error) {
          clearTimeout(watchdog)
          pendingReads[key] = false
          if (disposed) return
          entry.loading = false
          entry.error = error
          notify()
        },
      )
  }

  /** Merge two message arrays: `incoming` wins by id, duplicates collapse. */
  function mergeMessages(incoming, existing) {
    var byId = Object.create(null)
    var order = []
    var clientIds = Object.create(null)
    for (var c = 0; c < incoming.length; c += 1) {
      var candidate = incoming[c]
      if (candidate !== null && typeof candidate === 'object' && typeof candidate.clientMessageId === 'string') {
        clientIds[candidate.clientMessageId] = true
      }
    }
    function add(message, overwrite) {
      if (message === null || typeof message !== 'object' || message.id === undefined) return
      if (byId[message.id] === undefined) order.push(message.id)
      if (overwrite || byId[message.id] === undefined) byId[message.id] = message
    }
    for (var i = 0; i < incoming.length; i += 1) add(incoming[i], true)
    for (var j = 0; j < existing.length; j += 1) {
      var kept = existing[j]
      // A host echo of a local pending message replaces it even though the ids
      // differ; otherwise a forced page read would show the user turn twice.
      if (kept !== null && typeof kept === 'object' && typeof kept.clientMessageId === 'string' && clientIds[kept.clientMessageId] === true) {
        continue
      }
      add(kept, false)
    }
    var out = []
    for (var k = 0; k < order.length; k += 1) out.push(byId[order[k]])
    return out.sort(compareMessages)
  }

  function findMessageIndex(entry, message) {
    var list = entry.list
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] !== null && list[i].id === message.id) return i
    }
    if (message.clientMessageId !== undefined && message.clientMessageId !== null) {
      for (var j = 0; j < list.length; j += 1) {
        if (list[j] !== null && list[j].clientMessageId === message.clientMessageId) return j
      }
    }
    return -1
  }

  function upsertMessage(message) {
    if (message === null || typeof message !== 'object' || message.chatId === undefined) return
    var entry = messagesOf(message.chatId)
    var index = findMessageIndex(entry, message)
    if (index >= 0) {
      var previous = entry.list[index]
      var merged = message
      // A streaming delta may have advanced the buffer past the frame's text;
      // keep the longer text when the frame is an echo of the same message.
      if (
        previous.status === 'streaming' &&
        message.status !== 'done' &&
        typeof previous.text === 'string' &&
        typeof message.text === 'string' &&
        previous.text.length > message.text.length
      ) {
        merged = Object.assign({}, message, { text: previous.text, parts: previous.parts })
      }
      entry.list[index] = merged
    } else {
      entry.list.push(message)
    }
    entry.list.sort(compareMessages)
  }

  function applyChat(chat) {
    if (chat === null || typeof chat !== 'object' || chat.id === undefined || store.data === null) return
    var all = store.data.chats
    for (var i = 0; i < all.length; i += 1) {
      if (all[i] !== null && all[i].id === chat.id) {
        all[i] = Object.assign({}, all[i], chat)
        return
      }
    }
    all.push(chat)
  }

  function appendDelta(frame) {
    var chatId = frame.chatId
    var messageId = frame.messageId
    var text = typeof frame.text === 'string' ? frame.text : ''
    if (chatId === undefined || text === '') return
    var entry = messagesOf(chatId)
    var message
    for (var i = 0; i < entry.list.length; i += 1) {
      if (entry.list[i] !== null && entry.list[i].id === messageId) {
        message = entry.list[i]
        break
      }
    }
    if (message === undefined) {
      var runningEntry = runningOf(chatId)
      message = {
        id: messageId === undefined ? makeId('msg') : messageId,
        chatId: chatId,
        seq: 0,
        ts: Date.now(),
        role: 'bot',
        botId: runningEntry === undefined ? undefined : runningEntry.botId,
        text: '',
        status: 'streaming',
        parts: [],
      }
      entry.list.push(message)
    }
    message.text = (typeof message.text === 'string' ? message.text : '') + text
    var parts = Array.isArray(message.parts) ? message.parts : []
    var last = parts.length > 0 ? parts[parts.length - 1] : undefined
    if (last !== undefined && last !== null && last.type === 'text' && typeof last.text === 'string') {
      last.text += text
    } else {
      parts.push({ type: 'text', text: text })
    }
    message.parts = parts
    message.status = 'streaming'
    entry.loaded = true
    entry.list.sort(compareMessages)
  }

  function applyTurn(frame) {
    if (store.data === null) return
    var chatId = frame.chatId
    var all = store.data.running
    if (frame.status === 'started') {
      removeRunning(chatId)
      all.push({
        chatId: chatId,
        botId: frame.botId,
        turnId: frame.turnId,
        startedAt: Date.now(),
      })
    } else {
      removeRunning(chatId)
      var messagesEntry = store.messages[chatId]
      if (messagesEntry !== undefined) {
        for (var i = 0; i < messagesEntry.list.length; i += 1) {
          var message = messagesEntry.list[i]
          if (message !== null && message.status === 'streaming') {
            message.status = frame.status === 'error' ? 'error' : 'done'
            if (frame.status === 'error' && frame.error !== undefined) message.error = frame.error
          }
        }
      }
    }
    var chat = chatById(chatId)
    if (chat !== undefined) chat.running = frame.status === 'started'
  }

  function removeRunning(chatId) {
    if (store.data === null) return
    var all = store.data.running
    for (var i = all.length - 1; i >= 0; i -= 1) {
      if (all[i] !== null && all[i].chatId === chatId) all.splice(i, 1)
    }
    var chat = chatById(chatId)
    if (chat !== undefined) chat.running = false
  }

  function handleFrame(frame) {
    // Any data frame proves the stream is alive, including the heartbeat.
    lastFrameAt = Date.now()
    if (frame.type === 'ping') return
    store.since += 1
    if (stream !== null && typeof stream.setSince === 'function') stream.setSince(store.since)
    switch (frame.type) {
      case 'state':
        applyState(frame.state, revisionOf(frame.state, frame), 'sse')
        return
      case 'chat':
        applyChat(frame.chat)
        if (frame.chat !== null && frame.chat !== undefined && frame.chat.id === store.selectedChatId) markRead(frame.chat.id)
        break
      case 'message':
        upsertMessage(frame.message)
        if (
          frame.message !== null &&
          frame.message !== undefined &&
          (frame.message.role === 'bot' || frame.message.role === 'relay') &&
          frame.message.chatId === store.selectedChatId
        ) {
          markRead(frame.message.chatId)
        }
        break
      case 'delta':
        appendDelta(frame)
        break
      case 'turn':
        applyTurn(frame)
        break
      case 'memory':
        if (store.drawer === 'memory') loadMemory(store.memory.scope, store.memory.botId, true)
        break
      default:
        return
    }
    notify()
  }

  /* ----------------------------------------------------------- connection */

  function start() {
    if (started) return
    disposed = false
    started = true
    loadState().then(function () {
      if (disposed) return
      stream = transport.connectEvents({
        since: store.since,
        onData: function () {
          // Every data frame, heartbeat included, proves the stream is alive.
          lastFrameAt = Date.now()
        },
        onFrame: function (frame) {
          frameSeen = true
          handleFrame(frame)
        },
        onOpen: function () {
          // The Host writes one full state frame when it accepts a stream, so a
          // connect is already a resynchronization point. Ask again only when
          // that frame never arrives (an older Host without the initial frame).
          streamOpenedAt = Date.now()
          lastFrameAt = streamOpenedAt
          frameSeen = false
          clearResyncTimer()
          resyncTimer = setTimeout(function () {
            resyncTimer = null
            if (!frameSeen && !disposed) loadState()
          }, 1500)
        },
        onError: function () {
          clearResyncTimer()
          if (store.mode === 'live') {
            store.mode = 'disconnected'
            notify()
          }
        },
      })
      startHealthMonitors()
    })
  }

  function dispose() {
    disposed = true
    started = false
    store.disposed = true
    if (stream !== null) {
      try {
        stream.close()
      } catch (error) {
        /* already closed */
      }
      stream = null
    }
    clearResyncTimer()
    stopHealthMonitors()
    clearMockTimers()
    for (var i = 0; i < toastTimers.length; i += 1) clearTimeout(toastTimers[i])
    toastTimers = []
    listeners = []
  }

  function retry() {
    if (!started) {
      start()
      return
    }
    store.mode = store.data === null ? 'connecting' : store.mode
    store.error = null
    notify()
    loadState()
  }

  /**
   * Start the data channel on first use. The Host stream costs one of the
   * browser's per-origin connections, so a user who never opens the Bot panel
   * should not pay for it: the page asks for it when it mounts.
   */
  function ensureStarted() {
    if (started) return
    start()
  }

  /* -------------------------------------------------------- mock streaming */

  function clearMockTimers() {
    for (var id in mockTimerIds) {
      if (!Object.prototype.hasOwnProperty.call(mockTimerIds, id)) continue
      clearInterval(mockTimerIds[id])
      delete mockTimerIds[id]
    }
  }

  function addDemoRunning(chatId, botId) {
    if (store.data === null) return
    removeRunning(chatId)
    store.data.running.push({ chatId: chatId, botId: botId, turnId: 'turn_' + rid(), startedAt: Date.now() })
  }

  function mockStream(chatId, botId, text, options) {
    var opts = options || {}
    var message = {
      id: makeId('msg'),
      chatId: chatId,
      seq: 0,
      ts: Date.now(),
      role: 'bot',
      botId: botId,
      text: '',
      status: 'streaming',
      parts: [],
      turnId: 'turn_' + rid(),
    }
    upsertMessage(message)
    addDemoRunning(chatId, botId)
    var toolNames = opts.toolNames || []
    for (var t = 0; t < toolNames.length; t += 1) {
      message.parts.push({ type: 'tool', name: toolNames[t], status: 'ok' })
    }
    message.parts.push({ type: 'text', text: '' })
    var shown = 0
    notify()
    return new Promise(function (resolve) {
      var timer = setInterval(function () {
        if (disposed) {
          clearInterval(timer)
          delete mockTimerIds[message.id]
          resolve()
          return
        }
        shown = Math.min(text.length, shown + 2 + Math.floor(Math.random() * 4))
        var slice = text.slice(0, shown)
        message.text = slice
        var parts = message.parts
        var last = parts[parts.length - 1]
        if (last !== undefined && last.type === 'text') last.text = slice
        if (shown >= text.length) {
          clearInterval(timer)
          delete mockTimerIds[message.id]
          message.status = 'done'
          removeRunning(chatId)
          var chat = chatById(chatId)
          if (chat !== undefined) chat.updatedAt = Date.now()
          notify()
          resolve()
          return
        }
        notify()
      }, 42)
      mockTimerIds[message.id] = timer
    })
  }

  function mockSend(chat, text, attachments) {
    var attachmentCount = Array.isArray(attachments) ? attachments.length : 0
    var localIndex = -1
    var entry = messagesOf(chat.id)
    for (var i = entry.list.length - 1; i >= 0; i -= 1) {
      if (entry.list[i].status === 'pending') {
        localIndex = i
        break
      }
    }
    setTimeout(function () {
      if (localIndex >= 0 && entry.list[localIndex] !== undefined) entry.list[localIndex].status = 'done'
      notify()
    }, 130)

    var sequence = []
    if (chat.kind === 'group') {
      var group = groupById(chat.groupId)
      var memberIds = group === undefined ? [] : listOf(group.memberIds)
      var speakers = []
      for (var m = 0; m < memberIds.length && speakers.length < 2; m += 1) {
        var member = botById(memberIds[m])
        if (member !== undefined) speakers.push(member)
      }
      if (speakers.length === 0) speakers.push(botById(chat.botId) || bots()[0])
      for (var s = 0; s < speakers.length; s += 1) {
        sequence.push({
          bot: speakers[s],
          text: demoReplyFor(speakers[s], text),
          toolNames: s === 0 ? ['read_context'] : [],
        })
      }
    } else {
      var bot = botById(chat.botId) || bots()[0]
      var reply = demoReplyFor(bot, text)
      if (attachmentCount > 0) reply = '收到你发的 ' + attachmentCount + ' 个附件，我看过了。\n\n' + reply
      sequence.push({
        bot: bot,
        text: reply,
        toolNames: bot !== undefined && bot.isMain ? ['read_workspace'] : [],
      })
    }
    var chain = Promise.resolve()
    for (var q = 0; q < sequence.length; q += 1) {
      ;(function (item) {
        chain = chain.then(function () {
          if (disposed) return undefined
          var chatNow = chatById(chat.id)
          if (chatNow === undefined) return undefined
          return mockStream(chat.id, item.bot === undefined ? undefined : item.bot.id, item.text, {
            toolNames: item.toolNames,
          })
        })
      })(sequence[q])
    }
    return chain
  }

  /* ------------------------------------------------------ read receipts */

  /** Last `read` write per chat, so a burst of frames sends one request. */
  var readSentAt = Object.create(null)

  /**
   * Clear the Host-side unread counter for one chat (Host action `read`).
   * The local counter is cleared on selection as well; this only sends it.
   */
  function markRead(chatId) {
    if (store.mode !== 'live' || chatId === undefined || chatId === null) return
    var chat = chatById(chatId)
    if (chat === undefined || !(chat.unread > 0)) return
    var last = readSentAt[chatId] === undefined ? 0 : readSentAt[chatId]
    if (Date.now() - last < 1000) return
    readSentAt[chatId] = Date.now()
    transport.post('chat', { action: 'read', chatId: chatId }).then(
      function (body) {
        if (body !== null && typeof body === 'object' && body.chat !== undefined) {
          applyChat(body.chat)
          notify()
        }
      },
      function () {
        /* a read receipt is best-effort; the next selection retries */
      },
    )
  }

  /**
   * Pin or unpin one conversation (Host action `pin`).
   *
   * The list reorders immediately and rolls back when the Host refuses, so the
   * pin control stays usable on a Host that has not shipped the action yet
   * (its refusal is a plain 400 and the toast explains it).
   */
  function pinChat(chatId, pinned) {
    var chat = chatById(chatId)
    if (chat === undefined) return Promise.reject(new Error('chat-not-found'))
    var next = pinned === undefined ? chat.pinned !== true : pinned === true
    var previous = chat.pinned === true
    if (previous === next) return Promise.resolve()
    chat.pinned = next
    notify()
    if (store.mode === 'mock') return Promise.resolve()
    return transport.post('chat', { action: 'pin', chatId: chatId, pinned: next }).then(
      function (body) {
        if (body !== null && typeof body === 'object') {
          if (body.chat !== undefined) applyChat(body.chat)
          else if (body.state !== undefined) applyState(body.state)
        }
        notify()
      },
      function (error) {
        // Roll the optimistic flag back so the list order matches the Host.
        chat.pinned = previous
        notify()
        throw error
      },
    )
  }

  /**
   * Ask the Host to run the last user turn again (Host action `retry`).
   * The reply arrives over the stream like any other turn.
   */
  function retryChat(chatId) {
    if (store.mode === 'mock') return Promise.resolve()
    return transport.post('chat', { action: 'retry', chatId: chatId }).then(function (body) {
      if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
      notify()
    })
  }

  /* ------------------------------------------------------------ selection */

  function selectChat(chatId) {
    if (chatId === store.selectedChatId) {
      ensureChatMessages(chatId)
      return
    }
    store.selectedChatId = chatId
    var chat = chatById(chatId)
    // Read the Host-side counter before clearing the local copy.
    markRead(chatId)
    if (chat !== undefined) chat.unread = 0
    store.leftOpen = false
    ensureChatMessages(chatId)
    notify()
  }

  function setFilter(value) {
    store.filter = value === 'dm' || value === 'group' ? value : 'all'
    notify()
  }

  function setSearch(value) {
    store.search = typeof value === 'string' ? value : ''
    notify()
  }

  function toggleLeft(open) {
    store.leftOpen = open === undefined ? !store.leftOpen : open === true
    notify()
  }

  /* ---------------------------------------------------------- file panel */

  /** Open the right-hand file browser, optionally at one file/directory. */
  function openFile(path) {
    store.drawer = null
    store.fileOpen = true
    store.fileRequest = { path: typeof path === 'string' ? path : '', nonce: Date.now() }
    notify()
  }

  /** Close the file browser. */
  function closeFile() {
    store.fileOpen = false
    notify()
  }

  /** Toggle the file browser (right rail folder button). */
  function toggleFile() {
    if (store.fileOpen) closeFile()
    else openFile('')
  }

  function fsRoots(chatId) {
    return transport.get('fs/roots', { chatId: chatId === undefined || chatId === null ? '' : String(chatId) })
  }

  function fsList(chatId, path) {
    return transport.get('fs/list', {
      chatId: chatId === undefined || chatId === null ? '' : String(chatId),
      path: path === undefined || path === null ? '' : String(path),
    })
  }

  function fsRead(chatId, path) {
    return transport.get('fs/read', {
      chatId: chatId === undefined || chatId === null ? '' : String(chatId),
      path: path === undefined || path === null ? '' : String(path),
    })
  }

  /** Document-relative URL of a raw file stream (images/PDF preview). */
  function fsRawUrl(chatId, path) {
    return (
      'dsh-bot/api/fs/raw?chatId=' +
      encodeURIComponent(chatId === undefined || chatId === null ? '' : String(chatId)) +
      '&path=' +
      encodeURIComponent(path === undefined || path === null ? '' : String(path))
    )
  }

  /* --------------------------------------------------------------- drawer */

  function openDrawer(tab) {
    if (typeof tab === 'string' && tab !== '') store.drawerTab = tab
    // The settings drawer and the file browser share the right edge.
    store.fileOpen = false
    store.drawer = store.drawerTab
    store.leftOpen = false
    notify()
    loadDrawerData(store.drawerTab)
  }

  function setDrawerTab(tab) {
    store.drawerTab = tab
    store.drawer = tab
    notify()
    loadDrawerData(tab)
  }

  function closeDrawer() {
    store.drawer = null
    notify()
  }

  function loadDrawerData(tab) {
    if (tab === 'memory') loadMemory(store.memory.scope, store.memory.botId, store.memory.loaded === false)
    else if (tab === 'usage') loadUsage(store.usage.days, store.usage.loaded === false)
    else if (tab === 'schedules') loadSchedules(store.schedules.loaded === false)
  }

  /* ------------------------------------------------------------- composer */

  function setDraft(chatId, text) {
    store.drafts[chatId] = text
    // Drafts are ephemeral: notify so a remount restores the text, but skip the
    // re-render churn for the common case where the textarea already owns it.
  }

  function draftOf(chatId) {
    return store.drafts[chatId] === undefined ? '' : store.drafts[chatId]
  }

  function setQuote(chatId, text) {
    if (text === undefined || text === null || text === '') delete store.quotes[chatId]
    else store.quotes[chatId] = String(text)
    notify()
  }

  function quoteOf(chatId) {
    return store.quotes[chatId] === undefined ? '' : store.quotes[chatId]
  }

  /* --------------------------------------------------------------- actions */

  /**
   * Upload one file for the composer. The demo snapshot fakes a local
   * attachment so the attach flow is usable without a Host.
   * @param file File/Blob with a name and type.
   * @returns Promise<AttachmentView>
   */
  function uploadAttachment(file) {
    if (file === undefined || file === null) return Promise.reject(new Error('invalid-request'))
    var name = String(file.name === undefined ? 'file' : file.name)
    if (store.mode === 'mock') {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({
            id: makeId('att'),
            name: name,
            size: numberOr(file.size, 0),
            mime: typeof file.type === 'string' ? file.type : 'application/octet-stream',
            url: 'dsh-bot/api/media?id=' + makeId('att'),
          })
        }, 160)
      })
    }
    return transport.uploadFile(name, file, typeof file.type === 'string' ? file.type : '')
  }

  function send(chatId, rawText, attachments) {
    var text = typeof rawText === 'string' ? rawText : ''
    var attachmentViews = Array.isArray(attachments) ? attachments : []
    if (text.trim() === '' && attachmentViews.length === 0) return Promise.resolve()
    var chat = chatById(chatId)
    if (chat === undefined) {
      return Promise.reject(new Error('chat-not-found'))
    }
    var clientMessageId = 'cid_' + rid()
    var localParts = []
    if (text !== '') localParts.push({ type: 'text', text: text })
    for (var a = 0; a < attachmentViews.length; a += 1) {
      var view = attachmentViews[a]
      var mime = String(view.mime === undefined ? '' : view.mime)
      localParts.push({ type: mime.indexOf('image/') === 0 ? 'image' : 'file', attachment: view })
    }
    var local = {
      id: makeId('msg'),
      chatId: chatId,
      seq: 0,
      ts: Date.now(),
      role: 'user',
      text: text,
      status: 'pending',
      parts: localParts,
      clientMessageId: clientMessageId,
    }
    if (attachmentViews.length > 0) local.attachments = attachmentViews
    upsertMessage(local)
    store.drafts[chatId] = ''
    delete store.quotes[chatId]
    notify()

    if (store.mode === 'mock') {
      return mockSend({ id: chat.id, kind: chat.kind, botId: chat.botId, groupId: chat.groupId }, text, attachmentViews)
    }

    var requestBody = {
      action: CHAT_ACTION_SEND,
      chatId: chatId,
      text: text,
      clientMessageId: clientMessageId,
    }
    if (attachmentViews.length > 0) {
      requestBody.attachments = attachmentViews.map(function (view) {
        return view.id
      })
    }
    return transport.post('chat', requestBody).then(
      function (body) {
        if (body !== null && typeof body === 'object') {
          if (body.state !== undefined) applyState(body.state)
          if (body.chat !== undefined) applyChat(body.chat)
          if (body.message !== undefined) upsertMessage(body.message)
        }
        // The contract answers with state + chat only; the user echo normally
        // arrives as an SSE `message` frame. If the stream is between
        // reconnects, pull the page so the pending echo cannot stick forever.
        var entry = messagesOf(chatId)
        var echo
        for (var i = 0; i < entry.list.length; i += 1) {
          if (entry.list[i] !== null && entry.list[i].clientMessageId === clientMessageId) {
            echo = entry.list[i]
            break
          }
        }
        if (echo !== undefined && echo.status === 'pending') return loadMessages(chatId, false, true)
        notify()
      },
      function (error) {
        local.status = 'error'
        local.error = error !== null && error !== undefined ? error.detail || error.message || '' : ''
        notify()
        throw error
      },
    )
  }

  function cancel(chatId) {
    if (store.mode === 'mock') {
      var entry = messagesOf(chatId)
      for (var i = 0; i < entry.list.length; i += 1) {
        var message = entry.list[i]
        if (message !== null && message.status === 'streaming') {
          message.status = 'aborted'
          if (mockTimerIds[message.id] !== undefined) {
            clearInterval(mockTimerIds[message.id])
            delete mockTimerIds[message.id]
          }
        }
      }
      removeRunning(chatId)
      notify()
      return Promise.resolve()
    }
    return transport.post('chat', { action: CHAT_ACTION_CANCEL, chatId: chatId }).then(
      function (body) {
        if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
        notify()
      },
    )
  }

  function saveConfig(patch) {
    if (store.mode === 'mock') {
      if (store.data !== null) {
        if (patch.userName !== undefined) store.data.settings.userName = String(patch.userName)
        if (patch.language !== undefined) store.data.settings.language = patch.language === 'en' ? 'en' : 'zh'
      }
      notify()
      return Promise.resolve()
    }
    return transport.post('config', { patch: patch }).then(function (body) {
      if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
      else if (store.data !== null) {
        if (patch.userName !== undefined) store.data.settings.userName = patch.userName
        if (patch.language !== undefined) store.data.settings.language = patch.language
      }
      notify()
    })
  }

  function botNamed(name) {
    var normalized = String(name === undefined ? '' : name).trim().toLowerCase()
    var all = bots()
    for (var i = 0; i < all.length; i += 1) {
      if (all[i] !== null && String(all[i].name === undefined ? '' : all[i].name).trim().toLowerCase() === normalized) return all[i]
    }
    return undefined
  }

  function createBot(draft) {
    if (store.mode === 'mock') return mockCreateBot(draft)
    var name = draft === undefined || draft === null ? '' : draft.name
    // Remember the roster so a lost response can be reconciled against a bot
    // that is genuinely NEW, not a pre-existing one with the same name.
    var knownIds = Object.create(null)
    var knownBots = bots()
    for (var k = 0; k < knownBots.length; k += 1) {
      if (knownBots[k] !== null && knownBots[k].id !== undefined) knownIds[knownBots[k].id] = true
    }
    return transport.post('bot', { action: 'create', bot: draft }, STRUCTURAL_TIMEOUT_MS).then(
      function (body) {
        if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
        notify()
      },
      function (error) {
        // The write may have committed on the Host even when the response was
        // lost or timed out. Re-read the snapshot before reporting failure, so
        // a slow create cannot leave the page stuck on "creating".
        return loadState().then(
          function () {
            var found = botNamed(name)
            if (found !== undefined && knownIds[found.id] !== true) {
              notify()
              return
            }
            throw error
          },
          function () {
            throw error
          },
        )
      },
    )
  }

  function updateBot(botId, draft) {
    if (store.mode === 'mock') {
      var bot = botById(botId)
      if (bot === undefined) return Promise.reject(new Error('bot-not-found'))
      Object.assign(bot, draft, { updatedAt: Date.now(), rev: numberOr(bot.rev, 1) + 1 })
      notify()
      return Promise.resolve()
    }
    return transport.post('bot', { action: 'update', botId: botId, bot: draft }).then(function (body) {
      if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
      notify()
    })
  }

  function deleteBot(botId) {
    if (store.mode === 'mock') {
      if (store.data !== null) {
        store.data.bots = bots().filter(function (bot) {
          return bot === null || bot.id !== botId
        })
        var removedChats = []
        store.data.chats = chats().filter(function (chat) {
          if (chat === null) return true
          if (chat.kind === 'dm' && chat.botId === botId) {
            removedChats.push(chat.id)
            return false
          }
          return true
        })
        for (var i = 0; i < removedChats.length; i += 1) delete store.messages[removedChats[i]]
        if (removedChats.indexOf(store.selectedChatId) >= 0) {
          store.selectedChatId = defaultChatId()
        }
      }
      notify()
      return Promise.resolve()
    }
    return transport.post('bot', { action: 'delete', botId: botId }).then(function (body) {
      if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
      notify()
    })
  }

  function createGroup(draft, options) {
    var resetSessions = options !== null && options !== undefined && options.resetSessions === true
    if (store.mode === 'mock') {
      if (store.data !== null) {
        var group = Object.assign(
          {
            id: makeId('grp'),
            adminId: draft.adminId,
            memberIds: listOf(draft.memberIds),
            notice: '',
            replyMode: 'all',
            maxHops: store.data.limits.maxHops,
            handover: true,
            useNote: true,
            noteEntries: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          draft,
        )
        store.data.groups.push(group)
        store.data.chats.push({
          id: makeId('chat'),
          kind: 'group',
          groupId: group.id,
          title: group.name,
          sessionId: '',
          lastSeq: 0,
          updatedAt: Date.now(),
          unread: 0,
          pinned: false,
          running: false,
        })
      }
      notify()
      return Promise.resolve()
    }
    return transport.post('group', { action: 'create', group: draft }, STRUCTURAL_TIMEOUT_MS).then(function (body) {
      if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
      notify()
    })
  }

  function updateGroup(groupId, draft, options) {
    var resetSessions = options !== null && options !== undefined && options.resetSessions === true
    if (store.mode === 'mock') {
      var group = groupById(groupId)
      if (group === undefined) return Promise.reject(new Error('group-not-found'))
      Object.assign(group, draft, { updatedAt: Date.now() })
      var sessionsReset = resetSessions === true
      if (sessionsReset) {
        var groupChats = chats()
        for (var gc = 0; gc < groupChats.length; gc += 1) {
          if (groupChats[gc] === null || groupChats[gc].kind !== 'group' || groupChats[gc].groupId !== groupId) continue
          groupChats[gc].sessionId = ''
          delete store.messages[groupChats[gc].id]
        }
      }
      notify()
      return Promise.resolve({ sessionsReset: sessionsReset })
    }
    var updateBody = { action: 'update', groupId: groupId, group: draft }
    if (options !== null && options !== undefined && typeof options.resetSessions === 'boolean') {
      // PROTOCOL puts resetSessions beside `group`; older Host builds read it off
      // the draft, so send both spellings (the extra field is ignored safely).
      updateBody.resetSessions = options.resetSessions
      updateBody.group = Object.assign({}, draft, { resetSessions: options.resetSessions })
    }
    return transport.post('group', updateBody).then(function (body) {
      if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
      notify()
      return body === null || typeof body !== 'object' ? {} : body
    })
  }

  function deleteGroup(groupId) {
    if (store.mode === 'mock') {
      if (store.data !== null) {
        store.data.groups = groups().filter(function (group) {
          return group === null || group.id !== groupId
        })
        var removed = []
        store.data.chats = chats().filter(function (chat) {
          if (chat === null) return true
          if (chat.kind === 'group' && chat.groupId === groupId) {
            removed.push(chat.id)
            return false
          }
          return true
        })
        for (var i = 0; i < removed.length; i += 1) delete store.messages[removed[i]]
        if (removed.indexOf(store.selectedChatId) >= 0) store.selectedChatId = defaultChatId()
      }
      notify()
      return Promise.resolve()
    }
    return transport.post('group', { action: 'delete', groupId: groupId }).then(function (body) {
      if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
      notify()
    })
  }

  /**
   * Clear one group's note. The frozen contract has no dedicated action; the
   * update payload carries `noteEntries: []`, which a Host that supports note
   * edits honours and an older Host ignores. The caller reads `cleared` and
   * tells the user which happened instead of pretending.
   */
  function clearGroupNote(groupId) {
    var group = groupById(groupId)
    if (group === undefined) return Promise.reject(new Error('group-not-found'))
    if (store.mode === 'mock') {
      group.noteEntries = []
      group.updatedAt = Date.now()
      notify()
      return Promise.resolve({ cleared: true })
    }
    var payload = {
      name: group.name,
      adminId: group.adminId,
      memberIds: Array.isArray(group.memberIds) ? group.memberIds.slice() : [],
      notice: group.notice === undefined ? '' : group.notice,
      replyMode: group.replyMode === 'all' ? 'all' : 'admin',
      maxHops: numberOr(group.maxHops, 0),
      handover: group.handover === true,
      useNote: group.useNote === true,
      noteEntries: [],
    }
    return transport.post('group', { action: 'update', groupId: groupId, group: payload }).then(function (body) {
      if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
      notify()
      var after = groupById(groupId)
      var cleared = after !== undefined && (!Array.isArray(after.noteEntries) || after.noteEntries.length === 0)
      return { cleared: cleared }
    })
  }

  /* --------------------------------------------------------------- memory */

  function memoryEntriesOf(scope, botId) {
    if (store.mode !== 'mock' || mockDemoMemory === null) return null
    if (scope === 'bot') return listOf(mockDemoMemory.bots[botId])
    return listOf(mockDemoMemory.team)
  }

  function loadMemory(scope, botId, force) {
    var nextScope = scope === 'bot' ? 'bot' : 'team'
    if (store.memory.scope !== nextScope || store.memory.botId !== (botId === undefined ? null : botId)) {
      store.memory.entries = []
      store.memory.loaded = false
    }
    store.memory.scope = nextScope
    store.memory.botId = botId === undefined ? null : botId
    if (store.memory.loading) return Promise.resolve()
    if (store.memory.loaded && force !== true) return Promise.resolve()
    store.memory.loading = true
    store.memory.error = null
    notify()

    if (store.mode === 'mock') {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var entries = memoryEntriesOf(nextScope, store.memory.botId)
          store.memory.entries = entries === null ? [] : entries.slice()
          store.memory.candidates = mockDemoMemory === null ? [] : listOf(mockDemoMemory.candidates).slice()
          store.memory.autoMemory = !(store.data !== null && store.data.settings.autoMemory === false)
          store.memory.loading = false
          store.memory.loaded = true
          notify()
          resolve()
        }, 60)
      })
    }

    return transport.post('memory', {
      action: 'list',
      scope: nextScope,
      targetBotId: store.memory.botId === null ? undefined : store.memory.botId,
    }).then(
      function (body) {
        if (disposed) return
        store.memory.entries = arrayOf(body === null || body === undefined ? [] : body.entries)
        store.memory.candidates = arrayOf(body === null || body === undefined ? [] : body.candidates)
        if (body !== null && typeof body === 'object' && typeof body.autoMemory === 'boolean') {
          store.memory.autoMemory = body.autoMemory
          if (store.data !== null) store.data.settings.autoMemory = body.autoMemory
        }
        store.memory.loading = false
        store.memory.loaded = true
        store.memory.error = null
        notify()
      },
      function (error) {
        if (disposed) return
        store.memory.loading = false
        store.memory.error = error
        notify()
      },
    )
  }

  /** Apply an entries/candidates envelope returned by one memory action. */
  function applyMemoryResult(scope, botId, body) {
    if (body === null || typeof body !== 'object') return
    if (Array.isArray(body.entries) && store.memory.scope === scope && store.memory.botId === botId) {
      store.memory.entries = body.entries
    }
    if (Array.isArray(body.candidates)) store.memory.candidates = body.candidates
    store.memory.loaded = true
    notify()
  }

  /**
   * Edit one memory entry (text and/or pinned), guarded by the revision the
   * panel read. A conflict surfaces as a `memory-conflict` Host error.
   */
  function memoryEdit(scope, entryId, text, revision, extra) {
    var nextScope = scope === 'bot' ? 'bot' : 'team'
    var value = typeof text === 'string' ? text : undefined
    var options = extra === undefined || extra === null ? {} : extra
    if (store.mode === 'mock') {
      var list = memoryEntriesOf(nextScope, store.memory.botId)
      if (list === null) return Promise.resolve()
      var entry = null
      for (var i = 0; i < list.length; i += 1) if (list[i] !== null && list[i].id === entryId) entry = list[i]
      if (entry === null) return Promise.reject(new Error('memory-not-found'))
      if (typeof revision === 'string' && entry.revision !== undefined && revision !== entry.revision) {
        var conflict = new Error('memory-conflict')
        conflict.code = 'memory-conflict'
        return Promise.reject(conflict)
      }
      if (value !== undefined) entry.text = value
      if (typeof options.pinned === 'boolean') entry.pinned = options.pinned
      entry.revision = 'r' + String(Date.now())
      notify()
      return Promise.resolve(entry)
    }
    var body = { action: 'edit', scope: nextScope, id: entryId }
    if (value !== undefined) body.text = value
    if (typeof revision === 'string') body.revision = revision
    if (typeof options.pinned === 'boolean') body.pinned = options.pinned
    if (store.memory.botId !== null) body.targetBotId = store.memory.botId
    return transport.post('memory', body).then(
      function (answer) {
        applyMemoryResult(nextScope, store.memory.botId, answer)
        return answer !== null && typeof answer === 'object' ? answer.entry : undefined
      },
      function (error) {
        store.memory.error = error
        notify()
        throw error
      },
    )
  }

  /** Accept one auto-memory candidate, optionally with edited text. */
  function memoryAccept(candidateId, text) {
    if (store.mode === 'mock') {
      if (mockDemoMemory === null) return Promise.resolve()
      var queue = listOf(mockDemoMemory.candidates)
      var index = -1
      for (var i = 0; i < queue.length; i += 1) if (queue[i] !== null && queue[i].id === candidateId) index = i
      if (index < 0) return Promise.reject(new Error('memory-candidate-not-found'))
      var candidate = queue[index]
      queue.splice(index, 1)
      var entryText = typeof text === 'string' && text.trim() !== '' ? text.trim() : candidate.text
      var targetScope = candidate.scope === 'bot' ? 'bot' : 'team'
      var targetList =
        targetScope === 'bot'
          ? mockDemoMemory.bots[candidate.botId === undefined ? '__none' : candidate.botId]
          : mockDemoMemory.team
      if (targetList === undefined && targetScope === 'bot') {
        mockDemoMemory.bots[candidate.botId] = []
        targetList = mockDemoMemory.bots[candidate.botId]
      }
      targetList.push({
        id: makeId('note'),
        scope: targetScope,
        targetBotId: targetScope === 'bot' ? candidate.botId : undefined,
        text: entryText,
        at: Date.now(),
        pinned: false,
        auto: true,
        revision: 'r' + String(Date.now()),
      })
      store.memory.candidates = queue.slice()
      return loadMemory(store.memory.scope, store.memory.botId, true)
    }
    var body = { action: 'accept', candidateId: candidateId }
    if (typeof text === 'string' && text.trim() !== '') body.text = text.trim()
    return transport.post('memory', body).then(
      function (answer) {
        applyMemoryResult(store.memory.scope, store.memory.botId, answer)
        return answer !== null && typeof answer === 'object' ? answer.entry : undefined
      },
      function (error) {
        store.memory.error = error
        notify()
        throw error
      },
    )
  }

  /** Ignore one auto-memory candidate. */
  function memoryReject(candidateId) {
    if (store.mode === 'mock') {
      if (mockDemoMemory === null) return Promise.resolve()
      var queue = listOf(mockDemoMemory.candidates)
      var next = []
      for (var i = 0; i < queue.length; i += 1) if (queue[i] !== null && queue[i].id !== candidateId) next.push(queue[i])
      mockDemoMemory.candidates = next
      store.memory.candidates = next.slice()
      notify()
      return Promise.resolve()
    }
    return transport.post('memory', { action: 'reject', candidateId: candidateId }).then(
      function (answer) {
        applyMemoryResult(store.memory.scope, store.memory.botId, answer)
      },
      function (error) {
        store.memory.error = error
        notify()
        throw error
      },
    )
  }

  /** Flip the auto-memory master switch (`POST /memory/auto`). */
  function setAutoMemory(enabled) {
    var next = enabled === true
    if (store.mode === 'mock') {
      store.memory.autoMemory = next
      if (store.data !== null) store.data.settings.autoMemory = next
      notify()
      return Promise.resolve(next)
    }
    return transport.post('memory/auto', { enabled: next }).then(
      function (body) {
        store.memory.autoMemory = next
        if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state, revisionOf(body.state, body), 'get')
        if (store.data !== null) store.data.settings.autoMemory = next
        notify()
        return next
      },
      function (error) {
        notify()
        throw error
      },
    )
  }

  function remember(text) {
    var value = typeof text === 'string' ? text.trim() : ''
    if (value === '') return Promise.resolve()
    if (store.mode === 'mock') {
      var entries = memoryEntriesOf(store.memory.scope, store.memory.botId)
      if (entries !== null) {
        entries.push({
          id: makeId('note'),
          scope: store.memory.scope,
          targetBotId: store.memory.scope === 'bot' ? store.memory.botId : undefined,
          text: value,
          at: Date.now(),
          pinned: false,
        })
        return loadMemory(store.memory.scope, store.memory.botId, true)
      }
      return Promise.resolve()
    }
    return transport
      .post('memory', {
        action: 'remember',
        scope: store.memory.scope,
        text: value,
        targetBotId: store.memory.botId === null ? undefined : store.memory.botId,
      })
      .then(
        function (body) {
          if (body !== null && typeof body === 'object' && Array.isArray(body.entries)) {
            store.memory.entries = body.entries
            store.memory.loaded = true
            notify()
            return
          }
          return loadMemory(store.memory.scope, store.memory.botId, true)
        },
        function (error) {
          store.memory.error = error
          notify()
          throw error
        },
      )
  }

  function forget(entryId) {
    if (store.mode === 'mock') {
      var target = memoryEntriesOf(store.memory.scope, store.memory.botId)
      if (target !== null) {
        var index = target.findIndex(function (entry) {
          return entry !== null && entry.id === entryId
        })
        if (index >= 0) target.splice(index, 1)
      }
      return loadMemory(store.memory.scope, store.memory.botId, true)
    }
    return transport
      .post('memory', {
        action: 'forget',
        scope: store.memory.scope,
        id: entryId,
        targetBotId: store.memory.botId === null ? undefined : store.memory.botId,
      })
      .then(
        function (body) {
          if (body !== null && typeof body === 'object' && Array.isArray(body.entries)) {
            store.memory.entries = body.entries
            notify()
            return
          }
          return loadMemory(store.memory.scope, store.memory.botId, true)
        },
        function (error) {
          store.memory.error = error
          notify()
          throw error
        },
      )
  }

  /* ------------------------------------------------------------ schedules */

  function loadSchedules(force) {
    if (store.schedules.loading) return Promise.resolve()
    if (store.schedules.loaded && force !== true) return Promise.resolve()
    store.schedules.loading = true
    store.schedules.error = null
    notify()

    if (store.mode === 'mock') {
      store.schedules.loading = false
      store.schedules.loaded = true
      store.schedules.unsupported = false
      if (store.schedules.list.length === 0) store.schedules.list = buildDemoSchedules(store.data)
      notify()
      return Promise.resolve()
    }

    // The frozen contract has no schedule list route; a Host that publishes the
    // list on its state snapshot is enough, and the read below is the forward
    // compatible probe for a Host that adds one.
    if (store.data !== null && Array.isArray(store.data.schedules)) {
      store.schedules.loading = false
      store.schedules.loaded = true
      store.schedules.unsupported = false
      store.schedules.list = store.data.schedules
      notify()
      return Promise.resolve()
    }
    return transport.post('schedule', { action: 'list' }).then(
      function (body) {
        if (disposed) return
        if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
        var list = body !== null && typeof body === 'object' ? body.schedules : undefined
        if (!Array.isArray(list)) list = body !== null && typeof body === 'object' ? body.entries : undefined
        store.schedules.loading = false
        store.schedules.loaded = true
        if (Array.isArray(list)) {
          store.schedules.list = list
          store.schedules.unsupported = false
        } else if (store.data === null || !Array.isArray(store.data.schedules)) {
          // No list in the answer and none on the snapshot: keep whatever this
          // session created optimistically and say so in the panel.
          store.schedules.unsupported = true
        }
        notify()
      },
      function (error) {
        if (disposed) return
        store.schedules.loading = false
        store.schedules.loaded = true
        store.schedules.unsupported = true
        store.schedules.error = error
        notify()
      },
    )
  }

  function createSchedule(payload) {
    if (store.mode === 'mock') {
      var schedule = Object.assign({ id: makeId('sch'), nextRunAt: Date.now() + 3600000 }, payload)
      store.schedules.list.push(schedule)
      notify()
      return Promise.resolve()
    }
    return transport.post('schedule', Object.assign({ action: 'create' }, payload)).then(function (body) {
      if (body !== null && typeof body === 'object') {
        if (body.state !== undefined) applyState(body.state)
        if (Array.isArray(body.schedules)) {
          store.schedules.list = body.schedules
          store.schedules.loaded = true
          store.schedules.unsupported = false
        } else if (body.schedule !== undefined && body.schedule !== null) {
          store.schedules.list = store.schedules.list.concat([body.schedule])
          store.schedules.loaded = true
        } else if (store.data === null || !Array.isArray(store.data.schedules)) {
          // No echo at all: keep the created task visible locally this session.
          store.schedules.list = store.schedules.list.concat([
            {
              id: 'local_' + rid(),
              botId: payload.botId,
              title: payload.title,
              prompt: payload.prompt,
              timing: payload.timing,
              enabled: true,
              local: true,
            },
          ])
          store.schedules.loaded = true
          store.schedules.unsupported = true
        }
      }
      notify()
    })
  }

  /**
   * Edit one schedule. The contract's action list has no `update` yet, so this
   * tries it first and falls back to "create the replacement, then delete the
   * old one" — create happens before delete so a failed write never loses the
   * original. Returns `{ replaced: boolean }` so the form can say what happened.
   */
  function updateSchedule(scheduleId, payload) {
    if (store.mode === 'mock') {
      for (var i = 0; i < store.schedules.list.length; i += 1) {
        var record = store.schedules.list[i]
        if (record !== null && record !== undefined && record.id === scheduleId) {
          store.schedules.list[i] = Object.assign({}, record, payload, { updatedAt: Date.now() })
        }
      }
      notify()
      return Promise.resolve({ replaced: false })
    }
    return transport.post('schedule', Object.assign({ action: 'update', scheduleId: scheduleId }, payload)).then(
      function (body) {
        if (body !== null && typeof body === 'object') {
          if (body.state !== undefined) applyState(body.state)
          if (Array.isArray(body.schedules)) store.schedules.list = body.schedules
        }
        notify()
        return { replaced: false }
      },
      function () {
        return transport.post('schedule', Object.assign({ action: 'create' }, payload)).then(function (created) {
          if (created !== null && typeof created === 'object') {
            if (created.state !== undefined) applyState(created.state)
            if (Array.isArray(created.schedules)) store.schedules.list = created.schedules
          }
          return transport.post('schedule', { action: 'delete', scheduleId: scheduleId }).then(function (removed) {
            if (removed !== null && typeof removed === 'object') {
              if (removed.state !== undefined) applyState(removed.state)
              if (Array.isArray(removed.schedules)) store.schedules.list = removed.schedules
              else {
                store.schedules.list = store.schedules.list.filter(function (schedule) {
                  return schedule === null || schedule.id !== scheduleId
                })
              }
            }
            notify()
            return { replaced: true }
          })
        })
      },
    )
  }

  function deleteSchedule(scheduleId) {
    var localRecord
    for (var i = 0; i < store.schedules.list.length; i += 1) {
      var record = store.schedules.list[i]
      if (record !== null && record !== undefined && record.id === scheduleId) localRecord = record
    }
    if (localRecord !== undefined && localRecord.local === true) {
      store.schedules.list = store.schedules.list.filter(function (schedule) {
        return schedule === null || schedule.id !== scheduleId
      })
      notify()
      return Promise.resolve()
    }
    if (store.mode === 'mock') {
      store.schedules.list = store.schedules.list.filter(function (schedule) {
        return schedule === null || schedule.id !== scheduleId
      })
      notify()
      return Promise.resolve()
    }
    return transport.post('schedule', { action: 'delete', scheduleId: scheduleId }).then(function (body) {
      if (body !== null && typeof body === 'object' && body.state !== undefined) applyState(body.state)
      if (body !== null && typeof body === 'object' && Array.isArray(body.schedules)) {
        store.schedules.list = body.schedules
      } else {
        store.schedules.list = store.schedules.list.filter(function (schedule) {
          return schedule === null || schedule.id !== scheduleId
        })
      }
      notify()
    })
  }

  function runSchedule(scheduleId) {
    if (store.mode === 'mock') return Promise.resolve()
    return transport.post('schedule', { action: 'run', scheduleId: scheduleId }).then(function (body) {
      if (body !== null && typeof body === 'object') {
        if (body.state !== undefined) applyState(body.state)
        if (Array.isArray(body.schedules)) store.schedules.list = body.schedules
      }
      notify()
    })
  }

  /* ---------------------------------------------------------------- usage */

  function loadUsage(days, force) {
    var window = typeof days === 'number' && days > 0 ? days : store.usage.days
    store.usage.days = window
    if (store.usage.loading) return Promise.resolve()
    if (store.usage.loaded && store.usage.view !== null && store.usage.view.days === window && force !== true) {
      return Promise.resolve()
    }
    store.usage.loading = true
    store.usage.error = null
    notify()

    if (store.mode === 'mock') {
      return new Promise(function (resolve) {
        setTimeout(function () {
          store.usage.view = buildDemoUsage(window)
          store.usage.loading = false
          store.usage.loaded = true
          notify()
          resolve()
        }, 80)
      })
    }

    return transport.get('usage', { days: window }).then(
      function (body) {
        if (disposed) return
        store.usage.view = body !== null && typeof body === 'object' && body.usage !== undefined ? body.usage : null
        store.usage.loading = false
        store.usage.loaded = true
        notify()
      },
      function (error) {
        if (disposed) return
        store.usage.loading = false
        store.usage.error = error
        notify()
      },
    )
  }

  /* ---------------------------------------------------------- mock writers */

  function mockCreateBot(draft) {
    if (store.data === null) {
      applyDemoState()
    }
    if (store.data !== null) {
      var bot = Object.assign(
        {
          id: makeId('bot'),
          name: 'Bot',
          role: '',
          instructions: '',
          skin: 'default',
          color: DEMO_COLORS[bots().length % DEMO_COLORS.length],
          avatar: '',
          isMain: bots().length === 0,
          model: null,
          permission: 'workspace-write',
          autoHelper: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          rev: 1,
        },
        draft,
      )
      store.data.bots.push(bot)
      var chat = {
        id: makeId('chat'),
        kind: 'dm',
        botId: bot.id,
        title: bot.name,
        sessionId: makeId('sess'),
        lastSeq: 0,
        updatedAt: Date.now(),
        unread: 0,
        pinned: false,
        running: false,
      }
      store.data.chats.push(chat)
      messagesOf(chat.id).loaded = true
      if (store.selectedChatId === null) store.selectedChatId = chat.id
    }
    notify()
    return Promise.resolve()
  }

  /* ------------------------------------------------------------- exports */

  store.subscribe = subscribe
  store.flash = flash

  store.start = start
  store.ensureStarted = ensureStarted
  store.dispose = dispose
  store.retry = retry
  store.loadState = loadState
  store.refreshState = refreshState
  store.checkStreamHealth = checkStreamHealth
  store.streamHealth = streamHealth

  store.bots = bots
  store.groups = groups
  store.chats = chats
  store.running = running
  store.workspaces = workspaces
  store.tasks = tasks
  store.helpers = helpers
  store.botById = botById
  store.groupById = groupById
  store.chatById = chatById
  store.chatTitle = chatTitle
  store.runningOf = runningOf
  store.messagesOf = messagesOf

  store.selectChat = selectChat
  store.setFilter = setFilter
  store.setSearch = setSearch
  store.toggleLeft = toggleLeft
  store.openFile = openFile
  store.closeFile = closeFile
  store.toggleFile = toggleFile
  store.fsRoots = fsRoots
  store.fsList = fsList
  store.fsRead = fsRead
  store.fsRawUrl = fsRawUrl
  store.openDrawer = openDrawer
  store.setDrawerTab = setDrawerTab
  store.closeDrawer = closeDrawer
  store.loadDrawerData = loadDrawerData

  store.loadMessages = loadMessages
  store.ensureChatMessages = ensureChatMessages
  store.setDraft = setDraft
  store.draftOf = draftOf
  store.setQuote = setQuote
  store.quoteOf = quoteOf
  store.send = send
  store.uploadAttachment = uploadAttachment
  store.cancel = cancel
  store.pinChat = pinChat
  store.retryChat = retryChat
  store.markRead = markRead

  store.saveConfig = saveConfig
  store.createBot = createBot
  store.updateBot = updateBot
  store.deleteBot = deleteBot
  store.createGroup = createGroup
  store.updateGroup = updateGroup
  store.deleteGroup = deleteGroup
  store.clearGroupNote = clearGroupNote

  store.loadMemory = loadMemory
  store.memoryEdit = memoryEdit
  store.memoryAccept = memoryAccept
  store.memoryReject = memoryReject
  store.setAutoMemory = setAutoMemory
  store.remember = remember
  store.forget = forget
  store.loadSchedules = loadSchedules
  store.createSchedule = createSchedule
  store.updateSchedule = updateSchedule
  store.deleteSchedule = deleteSchedule
  store.runSchedule = runSchedule
  store.loadUsage = loadUsage

  return store
}

module.exports = {
  createStore: createStore,
  compareMessages: compareMessages,
  messageText: messageText,
  CHAT_ACTION_SEND: CHAT_ACTION_SEND,
  CHAT_ACTION_CANCEL: CHAT_ACTION_CANCEL,
}
