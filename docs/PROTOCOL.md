# dsh-bot 协议与协作契约（v1）

本文件是 Host 半（`src/host/**`、`src/index.js`）与 Client 半（`src/client/**`）之间唯一的接口契约。两边各自只按本文件实现，不互相读对方源码。

## 0. 产品决策（已定）

- **A 融合版**：每个 Bot 背后是一个真实 DSH 会话（普通 root 会话，挂专用 workspace `dsh-bot`），用户可随时 `openSession` 回原生聊天。
- 中心页面板：`sidebar.panellist` 一行 + `main` keyed 面板（id 都是 `dsh-bot`）。
- 目标：群聊 / 记忆 / 定时 / 后台任务 / 用量 全套；按 dsh-market 规范发布。
- Bot 会话可见（专用 workspace 分组），**不隐藏**。后台 helper 才用隐藏子会话（M4）。

## 1. 包与构建

- 包名 `@lisongjianustc/dsh-bot`；Host 入口 `src/index.js`（ESM，直接可加载，无需构建）。
- Client 入口：`src/client/**` 为 CommonJS 风格源码（`module.exports` / `require('./x.js')`，`require('react')` 走宿主模块表），由 `scripts/build-client.mjs` 拼成 `lib/client.js`（`window.__ModuleLoader__.load({id, factory})` 包装）。构建后再安装/重装。
- 运行时 import 只允许：`@deepseek-ai/dsh-tools`（`defineTool`）、`node:*`；Client 只允许 `react` 与包内相对 require。宿主模块表没有的东西一律不要 import（`fetch` 由页面全局提供）。

## 2. HTTP 路由（Host 半注册，Client 用文档相对路径 fetch）

前缀：Host 注册根绝对 `/dsh-bot/api/...`；Client 请求写 `dsh-bot/api/...`（页面 `<base href="./">`，去掉前导 `/`）。
全部 JSON；失败统一 `{ ok:false, code:string, message:string }` + 合适状态码；成功 `{ ok:true, ... }`。

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `dsh-bot/api/state` | — | `{ ok, state }`（StateView，见 §3） |
| POST | `dsh-bot/api/bot` | `{ action:'create'|'update'|'delete', bot? , botId? }` | `{ ok, state }` |
| POST | `dsh-bot/api/group` | `{ action:'create'|'update'|'delete', group?, groupId? }`（update 支持 `noteEntries:[]` 清空群备注） | `{ ok, state }` |
| POST | `dsh-bot/api/chat` | `{ action:'send'|'cancel'|'retry'|'read'|'clear'|'create', chatId?, botId?, groupId?, text?, clientMessageId? }` | `{ ok, state, chat? }`（read 只回 `{ok,chat}`） |
| GET | `dsh-bot/api/messages?chatId=&before=&limit=` | — | `{ ok, messages:Message[], hasMore:boolean }` |
| GET | `dsh-bot/api/usage?days=7` | — | `{ ok, usage:UsageView }` |
| POST | `dsh-bot/api/memory` | `{ action:'list'|'remember'|'forget', scope, text?, key?, id?, pinned?, targetBotId? }` | `{ ok, entries? }` |
| POST | `dsh-bot/api/schedule` | `{ action:'create'|'update'|'list'|'delete'|'run', scheduleId?, botId?, title?, prompt?, timing? }` | `{ ok, state, schedules? }` |
| GET | `dsh-bot/api/events?since=<seq>` | SSE | 见 §4 |
| POST | `dsh-bot/api/config` | `{ patch:{ userName?, language? } }` | `{ ok, state }` |

会话错误码（`code`）：`invalid-request`、`bot-not-found`、`chat-not-found`、`group-not-found`、`session-busy`、`model-unavailable`、`ledger-unavailable`、`internal`。

## 3. 数据形状（JSON，Host 为准）

```ts
StateView = {
  self: { id:'owner', name:string },
  bots: Bot[], groups: Group[], chats: Chat[],
  running: { chatId:string, botId:string, turnId:string, startedAt:number }[],
  settings: { userName:string, language:'zh'|'en' },
  models?: { providers: { id:string, name:string, models:{id:string,name:string,reasoningEffort?:string[]}[] }[], default?:{provider:string,model:string} },
  limits: { maxHops:number, memoryEntryMax:number, memoryStorageMax:number, groupNoteMax:number },
  schedules: ScheduleView[],
  helpers: HelperView[],
}

HelperView = {
  id, botId, chatId, title, task, status:'queued'|'running'|'done'|'failed'|'stopped'|'interrupted',
  childId?, report?, error?, createdAt, startedAt?, endedAt?, parentTurnId?,
}

ScheduleView = {
  id, botId, title, prompt,
  timing: { kind:'daily', time?:string } | { kind:'every', minutes?:number }
        | { kind:'once', minutes?:number } | { kind:'at', at?:string },
  enabled:boolean, nativeId?:string, createdAt:number,
}
MemoryEntry = { id, scope:'team'|'bot'|'self', text, key?, pinned:boolean, addedAt:number, revision:string, source?, by? }

Bot = {
  id, name, role, instructions, skin, color, avatar?, isMain:boolean,
  model: { provider:string, model:string, reasoningEffort?:string } | null,
  permission: 'read-only'|'workspace-write'|'danger-full-access',
  autoHelper:boolean, autoApprove:boolean, createdAt:number, updatedAt:number, rev:number,
}
Group = {
  id, name, adminId, memberIds:string[], notice, replyMode:'admin'|'all',
  maxHops:number, handover:boolean, useNote:boolean,
  noteEntries:{ at:number, speaker:string, text:string }[], createdAt, updatedAt,
}
Chat = {
  id, kind:'dm'|'group', botId?:string, groupId?:string, title:string,
  sessionId?:string, lastSeq:number, updatedAt:number, unread:number,
  pinned:boolean, running?:boolean,
}
Message = {
  id, chatId, seq:number, ts:number, role:'user'|'bot'|'relay'|'system',
  botId?:string, text:string, status:'pending'|'streaming'|'done'|'error'|'pass'|'aborted'|'held',
  parts: ({type:'text',text:string} | {type:'tool',name:string,status:'running'|'ok'|'failed',error?:string} | {type:'event',text:string})[],
  turnId?:string, sessionId?:string, error?:string, clientMessageId?:string,
}
UsageView = { days:number, total:{turns:number,chars:number}, byDay:{day:string,turns:number,chars:number}[], byBot:{botId:string,name:string,turns:number,chars:number}[] }
```

ID 规则：`bot_<12hex>`、`grp_<12hex>`、`chat_<12hex>`、`msg_<12hex>`、`note_<12hex>`。seq 是 per-chat 递增整数。

## 4. SSE 事件（`text/event-stream`）

连接后首帧 `data: {"type":"state","state":StateView}`，随后增量帧（每帧一行 `data: <json>\n\n`；每 20s 一行 `: ping`）：

| type | 载荷 | 语义 |
|---|---|---|
| `state` | `state` | 全量状态（重连/结构变化时） |
| `chat` | `chat` | 单个 chat 更新（unread/running/title/lastSeq） |
| `message` | `message` | 新增/更新一条消息（按 id upsert） |
| `delta` | `{ chatId, messageId, text }` | 流式文本增量（客户端追加） |
| `turn` | `{ chatId, botId, status:'started'|'finished'|'error', turnId?, error? }` | 回合生命周期 |
| `memory` | `{ scope }` | 记忆变化（客户端重拉） |

客户端流程：打开页面 → fetch state → 拉每个打开 chat 的 messages → 连 SSE（`since=lastEventSeq`，Host 可忽略 since 直接发全量 state）→ 断线 1s 后重连并重拉 state。

## 5. Client 结构（`src/client/`）

- `index.js`：注册 locale、`sidebar.panellist` 图标行、`main` 面板、`settings.section`（可选）；创建并持有模块级 store；`ctx.effect` 清理。
- `store.js`：模块级状态（面板切换不丢）：bots/groups/chats/messages/streaming buffers/running；`subscribe(fn)`；`fetch` 封装 + SSE 重连。
- `transport.js`：`api(path, body)` 与 `connectEvents()`；失败转稳定文案。
- `page.js`：三栏布局（左 Bot/会话列表、中聊天、右设置抽屉开关）+ 空态/加载态。
- `chat.js`：时间线 + 消息气泡（bot 色/头像首字母、工具行、错误、pass 隐藏）+ composer（Enter 发送，Shift+Enter 换行）。
- `panels.js`：设置抽屉（通用/Bot 详情/群设置/记忆/定时/用量五个 tab）。
- `locales.js`：zh/en 字典（扁平 key），`ctx.locale.register('dsh-bot', {zh,en})` + `bind`。
- 样式：`styles.css` 作为 JS 字符串导出，在 `index.js` 的 `ctx.effect` 里插入 `<style data-dsh-bot>` 并清理；只用 `--dsw-alias-*` token + 少量布局值。
- 所有 React 组件用 `React.createElement`（无 JSX 构建），严格无 hook 顺序问题；组件内不写 DOM 外部（drawer/浮层用 React 渲染在页面内）。

## 6. Host 结构（`src/host/`，由 host-core 实现）

| 模块 | 导出 | 职责 |
|---|---|---|
| `store.js` | `createStore(ctx)` → `{ db, close() }` | `$DSH_HOME/dsh-bot/` 下的 JSON 状态 + 每 chat JSONL 消息 + usage JSONL；原子写；重启加载 |
| `services.js` | `createServices({ctx,store})` → `{ bots, groups, chats, messages, memory, usage, ensureWorkspace, dispose }` | 业务 CRUD 与账本；不含 DSH 会话 |
| `runtime.js` | `createRuntime({ctx,store,services})` → `{ send, cancel, retry, onEvent, dispose, stampOf }` | 创建/恢复 Bot 会话、prompt、订阅事件、turn 归并、SSE 广播 |
| `prompt.js` | `createPrompt({ctx,store,services})` → `{ sectionText(assembleContext), turnText({bot,chat,group,input}) }` | systemPrompt section（人格+名册）与每 turn 文本（群上下文/记忆/输入，stamp 去重） |
| `dispatcher.js` | `createDispatcher({runtime,services})` → `{ handle(chat,message), cancel(chatId) }` | 私聊单发；群聊队列/@提及/[PASS]/hop/收敛/handover/group note |
| `tools.js` | `registerTools({ctx,services,dispatcher})` | 模型侧工具（见 §7） |
| `routes.js` | `registerRoutes({ctx,store,services,runtime})` | §2 全部路由 + SSE 广播器 |
| `hub.js` | `createHub()` → `{ publish(ev), attach(res), dispose }` | SSE 客户端集合与广播（Host 内唯一实时通道） |

模块间只通过上述导出协作；Host 半不得 import Client 半代码。

## 7. 模型可见工具（M1 先注册最小集，M4 补齐）

`bot_list_team`、`bot_create`、`bot_update`、`bot_delete`、`bot_create_group`、`bot_update_group`、`bot_delete_group`、`bot_message`、`bot_post_group`、`bot_remember`、`bot_recall`、`bot_forget`、`bot_create_schedule`、`bot_list_schedules`、`bot_delete_schedule`、`bot_start_helper`、`bot_list_helpers`、`bot_stop_helper`。全部用**裸 ToolDefinition** 注册（`{name,description,parameters:JSONSchema,output:{schema,render},execute}`，不 import `@deepseek-ai/dsh-tools`），`execute(args, exec)` 用 `exec.agent.id` 认 caller；仅对 Bot 会话可见：`ctx.tools.register(def, { when: ({agent}) => services.bots.botOfSession(agent?.id) !== undefined })`。

## 8. M0 事实（platform probe 已确认 / 待补充）

见 `research/minimax-bot/m0-findings.md`。Host 实现按该文件的事实写；与本文件冲突时以 m0-findings 为准并同步修改本文件。
