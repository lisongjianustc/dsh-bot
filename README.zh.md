# dsh-bot

DeepSeek Harness（DSH）Web GUI 与桌面端的 **MiniMax Bot 式常驻 Agent 团队**插件。

创建有名字的 Bot、和它们私聊、把它们拉进群协作；给它们团队共享或私有的记忆；设定时任务；查看用量账本。**每条 Bot 回复都是一次真实的 DSH Agent 会话**，你随时可以打开原生聊天查看工具调用、审批与队列。

## 功能

- **Bot 就是真实会话**：每个 Bot 跑在普通 DSH 会话里，统一挂在专用 `dsh-bot` workspace 分组；从工作台或侧栏点开即是完整原生聊天（工具卡/审批/队列/搜索全部继承）。
- **私聊**：每发一条消息就是一次真实 Agent 回合，流式渲染。
- **Bot 自己管群**：主 Bot 可以建群/改群/删群，指定成员与群主，并能向任意群（无需入群）发起讨论（`bot_create_group` / `bot_update_group` / `bot_delete_group` / `bot_post_group`）。
- **群聊**：`@名字` 指定成员；群主/全体两种回复模式；`[PASS]` 跳过；接力跳数上限 + 收敛回合；可选 handover 传递上一跳结论；group note 跨清空聊天保留。
- **记忆**：每 Bot 一份 + 团队共享一份；每 turn 按 6000 字预算选择注入；revision 冲突检查 + journal。
- **后台任务**：隐藏子会话执行，不阻塞聊天；报告回投到会话后由 Bot 用自己的话验收（`bot_start_helper` / `bot_list_helpers` / `bot_stop_helper`）。
- **自动批准**：Bot 会话自己应答审批请求（`autoApprove`，默认开），后台回合不会挂起；关掉后每次审批都交给人。
- **定时任务**：每日 / 每 N 分钟 / 一次性，由 Host 的 schedule 服务投递到 Bot 会话。
- **用量**：每 Bot 的回合数、字数、工具数、耗时，24h/7/30/90 天。
- **设置页**：机器人、群组、记忆、定时、用量五个面板；中英文界面。

## 安装

已发布到插件市场的包通过 DSH 插件管理器安装（设置 → 插件 → 从包安装，或 Workshop 卡片）：

```sh
dsh plugin add @lisongjianustc/dsh-bot
```

本地开发：用 `plugin_manager`（`action: install_bundle`）安装工作区目录；改完 `src/client/**` 后运行 `node scripts/build-client.mjs` 重新生成浏览器端产物。

## 要求

- DSH `>= 0.2.2-rc.1`
- 带 Web 扩展的桌面端或 Web GUI（本包声明了 `dsh.client`）

## 目录

```
src/index.js        Host 半入口（Cordis 插件：路由、工具、提示词段、运行时）
src/host/*.js       账本、Bot 运行时、调度器、提示词、工具、路由、SSE hub
src/client/*.js     浏览器半源码（CommonJS 风格，构建成 lib/client.js）
scripts/build-client.mjs  把 src/client/*.js 拼成 __ModuleLoader__ bundle
docs/PROTOCOL.md    Host↔Client 冻结契约
```

## 隐私

所有 Bot 数据存在本机 `$DSH_HOME/dsh-bot/` 下；本插件不向任何服务器上传数据。

## 许可证

MIT
