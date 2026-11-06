# dsh-bot 交付说明（M1 里程碑）

> 日期：2026-11-06 · 环境：DSH 0.2.2-rc.1 / desktop profile / GUI http://127.0.0.1:59493（重启后）
> 形态：A 融合版（每个 Bot = 真实 DSH 会话，挂专用 workspace，可回原生聊天）· 中心页面板 · Bot 会话可见 · 目标按 dsh-market 发布

## 1. 已完成并验证

### 1.1 安装/加载
- `plugin_manager install_bundle`（target=`dsh-bot/`）→ `application: applied`；profile 为 **link 安装**（`@lisongjianustc/dsh-bot 0.1.0 <- dsh-bot`），`patchReload: live`。
- 侧栏出现「机器人」入口；`main` 面板渲染三栏工作台（Bot/会话列表 · 聊天 · 设置抽屉）。
- Client bundle：`node scripts/build-client.mjs` → 10 modules → `lib/client.js`（约 281 KB，`window.__ModuleLoader__` 包装，`node --check` 通过）。

### 1.2 真实回合（已实测）
- 创建 Chief Bot → 私聊发「你好，介绍一下你自己」→ **真实 Agent 回合**跑完（约 4s），消息流式落账本，`session-d227ebe7-…` 创建，`usage.jsonl` 有记录。
- 模型钉死：给 Bot 设 `deepseek-official/deepseek-v4-pro + high` 后，下一轮会话日志 `request/header` 证明真实走了该路由，且**部署默认模型未被污染**（前后一致）。
- 权限钉死：`permission/preset` 事件链正确（create 默认 workspace-write → Bot 设为 danger-full-access）。

### 1.3 群聊（已实测）
- 3 个 Bot 的「研发群」讨论：Chief(hop1) → @Alice/@Bob → Alice(hop2) → Bob(hop3) → @Alice/@Chief → Alice(hop4) → **hop 上限 4 触发 system notice** → Alice **收敛回合(hop5)** 收口。
- @提及、接力、handover、group note（5 条 noteEntries）、每成员独立 session 全部工作。

### 1.4 记忆（已实测）
- `POST /api/memory {remember, scope:'team'}` 后下一轮 Bot 会话的 `user/message` 开头即 `<dsh-bot-memory>`，包含该条目（含 pinned）；预算/敏感信息/revision 逻辑有单测。

### 1.5 定时任务（已实测）
- `POST /api/schedule {timing:{kind:'once',minutes:1}}` → 原生 `schedule-768d7102-…`（`after_seconds:60`，target=该 Bot 会话）；**60 秒后真实触发**：`source:{kind:'schedule'}` user message → 自动跑 turn → 回复落成 DM 消息。
- 删除路径已修（`schedule.edit({action:'delete'})`），失败保留本地记录可重试。

### 1.6 测试
- Host 单测：`node --test test/*.test.js` → **85 pass / 0 fail**（账本/记忆/提及/群调度/运行时/工具/路由集成）。
- Client smoke：`node scripts/smoke-client.mjs` → 80+ 项（注册/渲染/markdown+XSS/真实 Host 形状）。

### 1.7 重启后复验（2026-11-06 17:0x，新 GUI 端口 59493，全新进程）
- `node scripts/verify-live.mjs http://127.0.0.1:59493` → **7/7 PASS**：`/state`、models 可选降级、`/messages`、`/usage`、`/memory list`、`/schedule list`、SSE 首帧 state。
- 账本保持：3 Bot（Chief/Alice/Bob）、4 chat（3 私聊 + 研发群）、群备注、1 条定时记录（投影已修正为 `once`）。
- GUI：侧栏「机器人」→ 工作台三栏正常；Markdown 粗体/有序列表/行内 code 渲染正确；发送消息 → 真实回合完成；工具行显示 `bot_list_team`（**已知 bug：完成态仍显示"运行中"，待 Host 修**）；设置抽屉 6 tab 正常（用量 13 回合 / 2845 字符）；「打开原生会话」跳转 DSH 原生会话成功；群备注展示正常。
- 截图：`docs/screenshots/{workspace-panel,chat-markdown,settings-group}.png`。
- 结论：旧代残留 / 挂起 turn / M0 探针侧栏行均随重启清除；新代码通过 `ctx.effect` 管理路由与工具注册，profile 热重载不再撞 duplicate。

## 2. 已修的关键问题

| # | 问题 | 修法 |
|---|---|---|
| 1 | 路由/工具注册未绑定 ctx.effect → profile reload 时新行激活撞旧注册，`application: failed` | `src/index.js` 把 `registerTools` / `registerRoutes` 包进 `ctx.effect`（重载先释放再注册） |
| 2 | `prompt` 缺 AbortSignal 崩溃 | 全部调用点传 `AbortSignal` |
| 3 | 一个 turn 多条 `assistant/message` 被拆成多条消息 | runtime 按 `turn/step` 归并 |
| 4 | schedule `once` 状态投影成 daily | `scheduleView` 兼容 once/after/every/interval |
| 5 | 单条原生 schedule 删除用不存在的 API → 泄漏 | 改用 `schedule.edit({action:'delete'})` |
| 6 | Markdown 不渲染（`**bold**` 原样） | client 新增零依赖 `markdown.js`（React 元素输出，XSS 安全） |
| 7 | 一键创建/首屏加载偶发卡住 | 写请求 35s 超时 + 看门狗 + state.lastSeq 对账 + 读失败重试按钮 |
| 8 | 页面 SSE 常驻占连接 | 改为「打开面板才启动」 |

### 1.8 M2/M3 复验（2026-11-06 17:1x · 新代码热加载后）

**Host 半（111/111 单测）**
- 审批 answerer 实测：Bot `Wanda` 设 `permission:'workspace-write'` + `autoApprove:true`，让它写工作区外 `/tmp/wanda-approval.txt` 并在沙箱拒绝后带 `sandbox_permissions` 重试 → **不再 150s 挂起**，两条 `bash` 工具均为 `ok`，文件真实写入，消息 `done`。
- tool part 修复实测：新回合 `tool/result` 用 `data.message.toolCallId` 匹配，`bot_list_team` 等工具行终态为 `ok`（历史旧消息仍保留 running，属修复前数据）。
- 后台 helper 全链路实测：Chief 调 `bot_start_helper` → 立即回执「已受理」→ `state.helpers` 出现 `helper_ae499d…`（status `done`，childId 指向隐藏子会话）→ 原 chat 收到 `[后台任务「…」· done]` relay → **Chief 自动起验收回合**核对报告（并纠正了子任务里一处 `ERANGE`→`ERESOLVE` 笔误）。
- 新契约实测：`schedule action:'update'`（标题/触发替换、nativeId 更新）；`group update {noteEntries:[]}` 清空群备注；`bots[].autoApprove` 读写。
- 修掉 daily 定时时区格式坑：Host 要求 `HH:mm:ss`，面板/模型说 `HH:mm` → `nativeTimingOf` 现在补 `:00`。

**Client 半（301,341 bytes，113 项 smoke）**
- markdown/流式/工具行（running→未确认防御）/打开原生会话/三栏布局/群备注/定时 native 状态/机器人表单（头像+8 色+自动批准）/用量 7/30/90 均在真实 GUI 验收通过。

**测试数据清理**：删除测试 Bot（Wanda）、临时群（清理测试群）、测试定时任务；保留 Chief/Alice/Bob 与研发群。

### 1.9 最终验收（2026-11-06 17:2x）

- `node scripts/build-client.mjs` → `10 modules -> lib/client.js (301341 bytes)`；`node --check` OK。
- `node scripts/smoke-client.mjs` → 全部通过（6 effects registered）。
- `node scripts/verify-live.mjs http://127.0.0.1:59493` → **7/7 PASS**（schedules count 0，测试数据已清理）。
- `node --test test/*.test.js` → **111/111 pass**。
- Host API 契约补测：`schedule action:'update'`（标题/触发替换 + nativeId 更新）、`group update {noteEntries:[]}` 清空备注、`bots[].autoApprove` 读写、daily 时间 `HH:mm` → 原生 `HH:mm:ss` 归一化，全部实测通过。
- 注意：本机装了 `sidebar-panel-fold` 面板折叠插件，当「机器人」不是最近使用面板时会收进侧栏「更多」菜单（截图确认仍在）；这是该折叠插件的行为，不是本插件丢失。查找入口：更多 → 机器人。
- 测试数据清理：Wanda Bot、清理测试群、测试定时任务已删除；保留 Chief / Alice / Bob 与研发群。被删 Bot 的原生 DSH 会话仍留在 `dsh-bot` workspace（可手动归档），这是 M1 已知限制。

### 1.10 群管理工具补齐（v0.2.1，2026-11-06 21:0x）

**问题**：Chief 只有 `bot_create/update/delete`（管 Bot），没有群管理工具，无法按任务自动组建群聊。
**对照 MiniMax Bot（21 个工具）补齐**：

| 操作 | main Bot | 群 admin（非 main） | 普通成员 | 非成员 |
|---|---|---|---|---|
| `bot_create_group` | ✅（caller 自动入群，admin 默认 caller） | ❌ | ❌ | ❌ |
| `bot_update_group` | ✅（含改 admin/换成员） | ✅ 名称/公告/reply_mode/hop/handover/note；改 admin ❌ | ❌ | ❌ |
| `bot_delete_group` | ✅（级联删群 chat/消息） | ❌ | ❌ | ❌ |
| `bot_post_group` | ✅ **任意群，无需入群** | ✅ 自己的群 | ✅ 自己的群 | ❌ |

- `members` 支持 bot id / 名字 / `@名字`，大小写不敏感、去重；admin 自动补进成员，替换成员不会让群变成无主。
- 工具面 15 → **18**；全部裸 ToolDefinition、仅 `node:*` import、工具名一次定死。
- 单测 **113 pass**（新增群工具权限矩阵、名字解析、post_group 三条权限分支）。

**真实 Host 验收**：
- Chief 一句话建群 → `发布小组`（Chief admin + Alice/Bob，公告、maxHops=3、reply_mode=admin 全部落实，返回 `grp_96cfb77edfb7`）；Chief 还主动纠正了它上一轮"建不了群"的旧回答。
- `bot_post_group` 跨群权限：建一个 Chief 不在的「外部协作群」（admin=Alice），让 Chief 发讨论 → 工具 `ok`，relay 进入该群，Alice 回复进度。验证后临时群已删除。

**与 MiniMax Bot 21 工具的差距（剩余 3 个）**：`dispatch_tasks`（批量派单，1..32 条，带 request_id 幂等）、`get_tasks`（按 task/batch 查询，支持 wait_ms 与结果分页）、`cancel_tasks`（取消任务/批次及依赖）。这三个属于"任务调度器 + 依赖图 + 回执幂等"能力，建议作为下一阶段（M4）实现，其余 18 个已对齐。

### 1.12 v0.3.0：对齐 MiniMax Bot 全量工具 + 附件/工作区/头像库/任务（2026-11-06 21:3x）

**工具面 21/21**：`bot_dispatch_tasks` / `bot_get_tasks` / `bot_cancel_tasks` 补齐（立即回执、后台执行、`request_id`+fingerprint 幂等、结果 relay 幂等、取消级联、重启 running→unknown）。全部 `bot_*` 裸 ToolDefinition，一次定死。

**附件输入（对齐 DSH 对话框）**
- `POST /api/upload`（≤25MiB、sha1 内容寻址去重、原子写）+ `GET /api/media`（inline/attachment、nosniff、路径限定 uploads）；
- `chat send attachments:[]`（≤8）→ 消息 `parts` 前插 `image`/`file`，并生成给 Bot 的绝对路径清单（DM 与群快照）。
- 真实验收：上传 PNG/TXT → 消息 image/file parts；Chief 读到 `note.txt` 内容并给出 `/Users/…/.dsh/dsh-bot/uploads/4394773f5e97-note.txt`；`/media` 返回正确 content-type。客户端：composer「+」→ 图片/文件、粘贴、拖拽、chips、25MB/8 个上限、发送时乐观渲染；历史 image/file 卡片（点击打开/下载）；有效 PNG 上传下载 SHA-256 一致。

**每 Bot 工作区 + 权限**
- 新字段 `bot.workspaceId`（StateView 增加 `workspaces[]`，真机 20 个）；只影响之后新建会话；未知 workspace → `workspace-unavailable`。
- 验收：Bot 选 `DeepSeekHarnessPlugin` 后首条消息的会话落在 `~/.dsh/sessions/--Users-lisongjian-Project-DeepSeekHarness--/session-6fa3e655…`。权限沿用每 Bot 三档。
- 客户端：Bot 表单工作区下拉 + 变更提示；权限/模型/思考档位/自动批准/后台助手同屏。

**头像库（自动匹配，不局限角色）**
- `src/host/avatars.js`：24 预设 + default 兜底；评分「最长关键词 → 命中数 → 表序」；未知角色按 `sha1(name+role)` 稳定取非兜底预设；`isMain` 无命中优先皇冠；显式指定优先；旧 Bot 自动补 spec 并落盘。
- 验收：`数据猫/数据分析 → data-chart`、`市场增长/市场运营 → ops-megaphone`；历史 Chief→lead-crown、Alice→research-flask、Bob→engineer-wrench 全部自动补齐。
- 客户端 `src/client/avatar.js`：24 预设程序化 SVG（头/眼/天线/耳 + motif 徽章），与 Host 关键词表逐字段同步、9 组身份匹配结果 100% 一致；「换一个」/25 宫格/「自动匹配」；列表/气泡/群成员/表单统一渲染。

**任务面板**：设置抽屉新增「任务」tab（真实数据：2 个 batch 任务 + 1 个后台助手，分组/目标/结果展开/batch 标签）；聊天上方运行条。

**验收数字**：Host 单测 **143/143**；Client build `11 modules -> lib/client.js (372,135 bytes)`、smoke **137 项全过**；真实 Host `verify-live.mjs` **7/7**。
**截图**：`docs/screenshots/{chat-attachments-tools,composer-attachments,settings-bots-avatars,settings-tasks}.png`。

### 1.13 v0.3.1：对话置顶（HOST 147 / CLIENT 151）

- **Host**：`services.chats.setPinned` + `POST /chat {action:'pin',chatId,pinned}`（校验 boolean、hub `chat` 帧 + broadcastState、返回 `{ok,state,chat}`）；`ensureDm` 主 Bot 默认 `pinned:true`；一次性迁移 `pinMigrated`（迁移后手动取消不会被重启覆盖）。
- **Client**：列表「置顶」分组（跨私聊/群聊统一置顶区，图钉 + 品牌色竖条 + 浅底）；聊天头部图钉按钮（置顶/取消，乐观更新+失败回滚+toast）；SSE `chat` 帧同步。
- **验收**：真实 Host 迁移后 Chief `pinned=true`；API pin/unpin Alice 正常；GUI 截图 `docs/screenshots/pinned-chats.png`（置顶区 Chief + 图钉，头部「置顶」标记）。测试 147/147、smoke 151、`verify-live` 7/7。

### 1.14 v0.3.2：页面实时自愈 + 头像匹配口径统一

**用户反馈**：Chief 成功创建 6 Bot + 游戏开发组（Host 已正确落盘），但已打开的 Bot 页面不显示，刷新后才出现。

**根因与修复**：
- Host：SSE 心跳从不可见的注释 `: ping` 改为可见数据帧 `{"type":"ping","at":…}`（20s）；`StateView` 增加单调 `stateRev`/`updatedAt`；`GET /api/state` 返回 `{ok,stateRev,state}`。
- Client：静默看门狗（>45s 无任何 data 帧则强制重连，重连首帧即全量 state）；`visibilitychange→visible` 与 `window.focus` 自动 `refreshState()`；左侧新增手动「刷新」按钮；`stateRev` 防乱序（旧 revision 丢弃并 1s 后重拉）。
- 验收：页面保持打开时通过 API 新建 Bot，**6 秒内自动出现在列表中**（截图实测），无需刷新。

**头像匹配修复（两端一致）**：
- Host 与 Client 的评分统一为「中文关键词长度 → 该长度出现次数 → 中文总命中 → 英文命中 → 表序」；中文与英文长度不可直接比较（`narrative` 9 个字符会压过 `开发`），英文仅在平局时参与。
- 去掉 lead 的 `主bot/主 bot` 关键词（下属说明里"问主 Bot"会误命中主 Bot 头像）。
- **存量自动头像重算**：挂载时对所有 `avatarAuto !== false` 的 Bot 重匹配并落盘。实测用户已建的「剧情策划→writer-quill、数值策划→data-chart、开发→engineer-wrench、像素美工→photo-camera」全部纠正；显式指定头像不变。
- 数字：Host **158/158**、smoke **174 项**、真实 Host 页面自更新验收通过。

### 1.15 v0.3.3：修复群组编辑白屏

- **现象**：设置抽屉 → 群组 → 点编辑，整个面板白屏；控制台 `ReferenceError: role is not defined at GroupForm`。
- **根因**：`GroupForm` 里残留了一段从 Bot 表单复制过来的头像预览代码（`identity`/`previewAvatar`/`cycleAvatar`，引用了 GroupForm 不存在的 `role`/`instructions`/`bot`/`avatarId`），渲染即抛错；主面板没有错误边界，于是一处崩溃整个页面空白。
- **修复**：
  1. 删除 GroupForm 中残留的 Bot 表单代码块；
  2. 新增 `ui.ErrorBoundary` 并包住 SettingsDrawer：任何单个表单再出错只显示「这个面板出错了 + 重试」，不再白屏（其他页面不受影响）；
  3. 补 zh/en 文案 `error.panelCrashed` / `action.retry`。
- **验收**：真实 GUI 点「群组 → 编辑」正常渲染编辑表单（群名/管理员/成员复选/回复模式/保存/删除）；点保存成功（API state 确认 admin/replyMode/maxHops 未变）；控制台无错误；build 386,358 bytes + smoke 全过。截图：`docs/screenshots/settings-group-edit.png`。

## 3. 安装与验收步骤

### 3.1 全新安装
1. 确保 DSH Desktop 已退出并重新打开（清理旧模块代际，见 §4）。
2. 用 `plugin_manager install_bundle` 指向本目录绝对路径，或用 npm 包安装（发布后 `dsh plugin add @lisongjianustc/dsh-bot`）。
3. GUI 侧栏点「机器人」→ 空态点「一键创建默认 Bot」→ 发第一条消息。

### 3.2 本地开发循环
```bash
cd dsh-bot
node scripts/build-client.mjs        # 改 src/client/** 后必须
node --test test/*.test.js           # Host 单测
node scripts/smoke-client.mjs        # Client smoke
```
改 **Client**：重新 build 后刷新页面（client-modules 会按 bundle mtime 更新）；若页面仍加载旧 bundle，用 Plugins 页对该 bundle 关/开一次或重启 Desktop。
改 **Host**：row 重载后生效；若出现 duplicate route / duplicate tool 错误，重启 Desktop 一次（模块代际限制，见 M0 findings §0/§10）。

## 4. 已知限制（M1 范围）

- **后台 helper / subagent 任务、审批 answerer、附件/头像上传、reactions、媒体预览**：按分期 M4 未做（工具面与数据模型已预留）。
- Bot 会话在 DSH 侧栏可见（设计如此，挂 `dsh-bot` workspace）；旧代 client row 在卸载 bundle 后可能残留到重启。
- 群聊 hop 上限的 system notice 目前英文；可按 settings.language 本地化（一行）。
- `ask` 权限 + 无人值守 = 审批挂起（实测）；因此 Bot 默认 `danger-full-access`。需要沙箱时必须配 answerer（`{global:true, prepend:true}`，要么作答要么 `next()`）。
- 重启 Desktop 会清掉挂起 turn 与旧注册；这是当前唯一"干净重来"手段。

## 5. 下一步（M2–M4）

1. M2：工作台私聊体验打磨（消息重试/编辑、群 note UI、附件）。
2. M3：后台 helper（`subagents` 隐藏子会话 + 任务条）、审批 answerer（配置开关）。
3. M4：外观/头像库/reactions/媒体预览；用量图表完善；中文 system notice。
4. 发布：按 `docs/PUBLISH.md` 提 dsh-market PR。
