# 与 MiniMax Bot 的功能覆盖对照（v0.2.2 目标）

> 对照基线：MiniMax Bot v0.7.20（`research/minimax-bot/bot-source-analysis.md`、其 README 全功能清单、21 个 MCP 工具）。
> 状态标记：✅ 已对齐 · 🟡 部分对齐 · ⏳ 本次实现中 · 🔜 后续（已排期） · ➖ 平台差异（刻意不做）

## 1. 工具面（21/21）

| # | MiniMax Bot 工具 | dsh-bot 工具 | 状态 |
|---|---|---|---|
| 1 | list_team | bot_list_team | ✅ |
| 2 | message_bot | bot_message | ✅ |
| 3 | dispatch_tasks | bot_dispatch_tasks | ✅ |
| 4 | get_tasks | bot_get_tasks | ✅ |
| 5 | cancel_tasks | bot_cancel_tasks | ✅ |
| 6 | post_group | bot_post_group | ✅（main 任意群；其它仅本群；群内拒绝） |
| 7 | start_helper | bot_start_helper | ✅ |
| 8 | list_helpers | bot_list_helpers | ✅ |
| 9 | stop_helper | bot_stop_helper | ✅ |
| 10 | remember | bot_remember | ✅ |
| 11 | forget | bot_forget | ✅ |
| 12 | recall | bot_recall | ✅ |
| 13 | create_bot | bot_create | ✅ |
| 14 | update_bot | bot_update | ✅（+ workspace/avatar/autoApprove） |
| 15 | delete_bot | bot_delete | ✅ |
| 16 | create_group | bot_create_group | ✅ |
| 17 | update_group | bot_update_group | ✅ |
| 18 | delete_group | bot_delete_group | ✅ |
| 19 | create_schedule | bot_create_schedule | ✅ |
| 20 | list_schedules | bot_list_schedules | ✅ |
| 21 | delete_schedule | bot_delete_schedule | ✅ |

## 2. 产品功能

| MiniMax 能力 | dsh-bot 现状 | 状态 |
|---|---|---|
| 常驻 Bot（名字/角色/instructions/独立会话；brief 变化才注入） | 名册 + `systemPrompt.section` + 每 turn 文本 stamp 去重 | ✅ |
| Chief Bot（首次创建；唯一可增删 Bot/群） | 空态一键创建；工具权限矩阵（main 才能建/删 Bot、群） | ✅ |
| 私聊（每条回复=真实 Agent 回合） | `sessionController.create + prompt` + 事件归并 | ✅ |
| 群聊（admin 默认、@提及顺序、[PASS]、hop 上限+收敛、handover、group note） | dispatcher 全实现 + 单测 | ✅ |
| 交接/派单回执（message_bot 立即受理、结果回投） | bot_message + 新任务调度（⏳） | 🟡→⏳ |
| 后台 helper（独立隐藏会话、2 并发+队列、回投+验收回合、可停止、重启 interrupted） | helpers.js + subagents；队列/停止已做 | ✅ |
| 每 Bot 模型/思考档位 | `agent.model.select` 钉死、不污染默认 | ✅ |
| 记忆（team/self/bot 三 scope、1200/100000/1000 预算、6000 注入、revision、secret 拒写、journal） | memory.js + prompt 注入 | ✅ |
| 定时任务（daily/interval/once；服务在跑才触发；设置页可管理） | `ctx.schedule` 映射 + 面板 | ✅ |
| 用量（每 Bot 回合/字数/工具数/时长，24h/7/30/90） | 回合/字数 ✅；工具数/时长 🟡 | 🟡 |
| 外观（11 套皮肤 + 颜色 + 头像库） | 颜色 + **40 个原创 SVG 头像**（25 原有 + 15 新增），Host 自动匹配 + Client `<img>` 渲染（404 回退程序化） | ✅ |
| 任务面板（运行/待审批/完成，停止/打开会话/跳结果） | helpers + tasks 面板（真实数据验收） | ✅ |
| 设置（用户名/语言/签名风格） | 通用 tab（用户名/语言） | ✅ |
| 页面实时同步/自愈（SSE 心跳、stateRev、静默重连、可见性刷新、手动刷新） | Host 可见 ping + stateRev；Client 看门狗/焦点刷新/刷新按钮，实测创建 Bot 后自动出现 | ✅ |
| 会话置顶（任意会话，Chief 默认） | 列表置顶分组 + 头部图钉按钮 + Host 一次性迁移 | ✅ |
| 会话筛选（全部/未读/群/私聊） | 全部/私聊/群组（未读筛选 🔜） | 🟡 |
| 中英双语（界面/错误/系统通知/工具描述） | 界面+通知 zh/en；工具描述英/中文触发词 🟡 | 🟡 |
| 图片/文件输入（附件→Bot 收到本地路径） | 上传/媒体/parts/路径清单 + composer/气泡卡片，真实回合已读文件 | ✅ |
| Markdown 渲染（粗体/列表/**表格**/代码/链接） | 完整行内格式 + GFM 表格（对齐/横滚/单元格行内），XSS 安全 | ✅ |
| 图片/媒体/HTML/MD 预览（沙箱、下载、失败重试） | 仅图片/文件卡片；HTML/MD 沙箱预览 🔜 | 🟡 |
| 回复操作（reaction/copy/quote/open session） | copy/quote/open ✅；reaction 🔜 | 🟡 |
| 表情回应（本地持久、跨窗口同步） | — | 🔜 |
| 一条回复多气泡（text part / tool part 分段） | parts 渲染 | ✅ |
| 审批/问卷卡片（allow once/deny、单选/多选问卷、plan review） | 自动批准 answerer + 原生会话内审批；自绘卡片 🔜 | 🟡 |
| 重试语义（retryable=false、AGENT_OUTCOME_UNKNOWN 不重放、8s/20s backoff） | 取消/重试已做；backoff/unknown 语义 🟡 | 🟡 |
| 任务依赖 + 验证回合（dependency → waiting → review turn） | 任务调度 ✅（含 dependsOn/cancel 级联）；review turn 🔜 | 🟡 |
| 并发槽位（3 顶层 / 2 helper / 每 Bot 4 排队 / 2 task） | dispatcher 有槽位；helper 2 并发；task 并发 ⏳ | 🟡 |
| 安全护栏（标记中和、路径白名单媒体、上传清洗、头像禁路径、CSP 预览） | 标记中和/上传清洗/媒体白名单本轮；CSP 预览 🔜 | 🟡 |

## 2b. 本轮新增能力验收（Host 已通过）

| 能力 | 实测 |
|---|---|
| 头像自动匹配 | 数据猫/数据分析 → `data-chart`；市场增长/市场运营 → `ops-megaphone`；旧 Bot 自动补齐（Chief lead-crown / Alice research-flask / Bob engineer-wrench）；未知角色哈希兜底、显式覆盖、改角色自动重算 |
| 每 Bot 工作区 | `state.workspaces` 19 个工作区；Bot 选 `DeepSeekHarnessPlugin` 后首条消息的会话落在该 workspace 目录（`~/.dsh/sessions/--Users-lisongjian-Project-DeepSeekHarness--/session-6fa3e655…`） |
| 附件输入 | 上传 PNG/TXT → 消息 `image`/`file` parts；Bot 收到绝对路径并成功 `read` 文本内容；媒体路由 `GET /media` 返回正确 content-type |
| 任务调度 | Chief 调 `bot_dispatch_tasks`（2 任务，request_id=smoke-1）→ 立即回执 → `bot_get_tasks` ×2 → 两条 relay 回投 + 汇总；state.tasks 两条 done |
| 工具面 | 21/21 模型工具（`bot_*`）全部注册并可被 Bot 调用 |

## 2c. 仍待补齐（v0.4 backlog，按优先级）

1. **每个 Bot 多会话**：目前一个 Bot 只有一条私聊（MiniMax 支持一个 Bot 多个会话/历史）；需要 chat 与 bot 解耦、每 chat 独立 session。
2. **reactions / 表情回应**（本地持久、跨窗口同步、不触发模型）。
3. **HTML/Markdown 媒体预览沙箱**（CSP、下载/失败重试）；当前只有图片/文件卡片。
4. **任务依赖验证回合**：`dependsOn` 与取消级联已实现；"waiting_for_tasks → 汇总 review turn" 尚未实现。
5. **审批/问卷自绘卡片**：自动批准 answerer 已兜底；人工审批需打开原生会话（工作台内卡片未做）。
6. **用量明细**：回合数/字数已统计；工具数/时长/模型调用次数待补。
7. **未读筛选 / 每聊 unread** 与 **工具描述 i18n**（当前中文触发词 + 英文描述）。
8. **批次任务取消的 HTTP 路由**（模型工具已有；面板对 batch 禁用取消）。
9. **图片头像上传/自定义头像库**（当前为程序化内置库；`docs/AVATAR-PROMPTS.md` 已给出可用的图像提示词，供以后上传）。
10. **delivery_uncertain / unknown 的完整语义**（已覆盖重启 running→unknown，其余状态码/409 未完全对齐）。

## 3. 可靠性/数据语义

| MiniMax 语义 | dsh-bot | 状态 |
|---|---|---|
| state.json 原子写 + 每 chat 消息文件 + usage.jsonl | 同构 | ✅ |
| request_id 幂等 + fingerprint 冲突 | ⏳（task-10） | ⏳ |
| unknown 永不重放、delivery_uncertain 409 | 🟡（restart→unknown 在任务中实现） | 🟡 |
| 崩溃恢复（streaming→interrupted、usage 补 aborted） | services.recover 已做 | ✅ |
| 每 Bot 独立 session（跨重启持久） | sessionPersistence | ✅ |
| 消息 seq 游标/分页/SSE | ✅ | ✅ |

## 4. 刻意不做（平台差异，➖）

- 独立 Node 进程 / Host 分配端口 / 每 run 凭证 / managed MCP 托管 → DSH 插件在 Host 进程内，用 `webServer` 路由 + 裸 ToolDefinition 代替。
- `surface.window` 常驻窗口 → DSH `main` 面板 + `sidebar.panellist`。
- `agent.open(sessionId)` → `ctx.uiWorkspace.openSession`。
- 11 张 PNG 皮肤 → 内置程序化头像库（24 预设，可扩展且支持自动匹配；后续可加图片头像上传）。

## 5. 验收顺序（本轮完成后）

1. 工具面 21/21（真实 Host 让 Chief 调 `bot_dispatch_tasks` → `bot_get_tasks` → `bot_cancel_tasks`）；
2. 附件：上传图片/文件 → 消息气泡显示 → Bot 收到绝对路径并成功读取（`read` / `read_image`）；
3. 工作区：Bot 选一个已有 DSH workspace → 新会话 cwd 在该工作区；
4. 头像：新建未知角色 Bot → 自动匹配到合理头像；手动换一个/网格选择；
5. 全部回归：113+ 单测、smoke、`verify-live.mjs`、GUI 截图。
