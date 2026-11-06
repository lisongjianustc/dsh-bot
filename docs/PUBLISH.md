# 发布到 dsh-market（awesome-dsh-plugin）

> 依据：`research/minimax-bot/m0-findings.md` §6（实测规范）· dsh-market 数据源：`https://awesome-dsh-plugin.com/plugins.json`
> 注意：`dshmarket` 是市场应用本身，**不要往它提条目**；要提 PR 的是 GitHub `awesome-dsh-plugin/awesome-dsh-plugin`。

## 0. 两个前置条件（缺一会被拒）

1. **仓库**：GitHub 上有一个公开仓库（例如 `lisongjian/dsh-bot`），创建满 **1 天**，加 topic **`dsh-plugin`**，且项目仍在维护。
2. **npm 包**：`package.json` 必须声明 **`dsh.bundle`**（只有 `dsh.client` 会被拒，这是最常见的拒绝原因），并有根 `cordis.patch.yml`。本包已满足。

## 1. 发布 npm 包

```bash
cd dsh-bot
npm publish --access public     # 包名 @lisongjianustc/dsh-bot
```

`package.json` 已包含：`name`、`version`、`description`、`license`、`repository`、`keywords`（含 `dsh-plugin`）、`dsh.engines.dsh`、`dsh.bundle.patch`、`dsh.client`、`exports['./client']`、`exports['./locale/*.json']`、`icon`、`/icon`、`files`。

发布前自检：
```bash
npm pack --dry-run          # 文件清单必须含 src/ lib/ cordis.patch.yml icon.svg locale/ docs/
node scripts/build-client.mjs   # lib/client.js 必须是最新构建
```

## 2. 提 market PR

在 `awesome-dsh-plugin/awesome-dsh-plugin` 仓库新增一个文件：

`data/plugins/lisongjian__dsh-bot.yml`

内容模板（按 contributing.md 的字段；`description.en` 必填）：

```yaml
name: dsh-bot
repo: lisongjian/dsh-bot
npm: "@lisongjianustc/dsh-bot"
description:
  en: "MiniMax-Bot-style always-on agent team for DSH: named Bots backed by real DSH sessions, private and group chats, shared memory, scheduled tasks and usage."
  zh: "DSH 的常驻机器人团队：每个 Bot 背后是真实 DSH 会话，支持私聊/群聊、共享记忆、定时任务与用量统计。"
tags: [agents, bots, chat, scheduling]
```

规则要点（实测）：
- 每个 PR **最多 3 条**；更新只改自己那条，不手工改生成的两个 README；
- 必须通过 `awesome-lint` 与站点构建（双语、分隔符、日期、截图要求见 contributing.md）；
- 描述必须属实（维护者读代码核对数字/API 名）；
- 不收纯聚合包；聚合包依赖必须指原作者。

## 3. 发布后验证

1. 等站点构建（`https://awesome-dsh-plugin.com/plugins.json` 出现本包）。
2. 在 DSH 的 Workshop → plugins 搜索 `dsh-bot`，一键安装。
3. 全新 profile 验证：安装 → 侧栏入口 → 创建 Chief → 发消息 → 群聊 → 定时任务。

## 4. 版本策略

- `dsh.engines.dsh: ">=0.2.2-rc.1"`：低于该版本缺少 `agentAccess`/`surface` 等契约，不兼容。
- Client bundle 必须随每次发布重新构建（宿主只认已构建产物）。
- 修改已装插件实现后，升级走 npm 新版本 + 重启 Desktop（模块代际限制）。
