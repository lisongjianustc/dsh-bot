# DSH Bot · Many Faces v2.1｜多形态头像扩展包

本扩展包基于 dsh-bot 的原有 **Many Faces v2** 体系，**保留原版 25 个 ID 不变**，新增 **15 种全新人物 / 动物 / 幻想实体 / 机械造物**；共计 40 个角色，80 个原生矢量 SVG。

## 本次新增角色

| 新增 ID | 角色 | 形象 |
| --- | --- | --- |
| `architect-stag` | Architect / 系统架构师 | Stag architect with blueprints |
| `field-otter` | Field Ops / 现场运营 | Otter coordinator with a radio |
| `risk-eagle` | Risk / 风险管理 | Eagle risk guardian with a warning shield |
| `compliance-officer` | Compliance / 内控合规 | Human compliance officer and scroll |
| `audit-panda` | Auditor / 审计稽核 | Panda auditor with ledger and monocle |
| `legaltech-dragon` | LegalTech / 法务科技 | Azure eastern dragon with justice symbol |
| `knowledge-tree` | Knowledge / 知识管理 | Living tree librarian with glowing books |
| `rpa-mecha` | RPA / 流程自动化 | Copper-and-cream industrial automation mech |
| `agent-sylph` | AI Agent / 智能体编排 | Digital sylph coordinating agent orbs |
| `scm-cargo` | Supply Chain / 供应链管理 | Smiling cargo ship with stacked containers |
| `esg-gaia` | ESG / ESG与可持续 | Forest guardian carrying a glowing earth |
| `strategy-fox` | Strategy / 战略规划 | Fox chess strategist in ceremonial cloak |
| `innovation-orb` | Innovation / 创新孵化 | Lightbulb sprite with orbiting ideas |
| `insight-raven` | Insight / 趋势洞察 | Raven astronomer with brass telescope |
| `future-traveler` | Futures / 未来探索 | Cape-wearing young horizon explorer |

## 文件组织

- `additions/tile/*.svg`：**仅新增**的 15 张浅色底板 SVG。
- `additions/transparent/*.svg`：**仅新增**的 15 张透明版 SVG。
- `avatars/tile/*.svg`：**完整合并**的 40 张底板 SVG。
- `avatars/transparent/*.svg`：**完整合并**的 40 张透明版 SVG。
- `preview/new-15-atlas.png`：新增角色预览；`preview/all-40-atlas.png`：40 个角色总览。
- `index.html`：可切换主题、仅新增/全部的离线浏览器画廊。
- `manifest.json`：40 个原有及新角色 ID、名称、颜色、文件路径；`avatar-presets-additions.json`：新增的 15 条 Host/Client 注册建议。
- `source/generate_additions.py`：可修改的矢量 SVG 生成源码；`source/base_generate_avatars.py`：V2 基础库生成源码。

## 对 dsh-bot 仓库的兼容性（重要）

仓库的 `src/host/avatars.js` 与 `src/client/avatar.js` 都保留了已定义的原 25 个预设。**这批新增 ID 不能仅靠复制 SVG 自动被当前 Host 识别。** 要正式让这 15 个角色参与自动匹配/头像选择，请：

1. 将 `avatar-presets-additions.json` 中 15 条预设追加到前后端的头像预设表，并保持 id、颜色和匹配规则一致。建议把旧 `default-bot` 行放在新增预设后，保留其兜底地位。新图形的外观并不依赖旧 `motif`；注册时可暂用 `default` 作为兼容元数据。
2. 让新增 SVG 进入插件客户端**可实际访问**的静态资源路径，或构建成 JS/React 内联素材；现有 `scripts/build-client.mjs` 只收集 JS，不自动带上 SVG。还需调整 npm `files` / 分发规则。
3. 将 `src/client/avatar.js` 的 `renderAvatar` 接到按白名单 ID 的 SVG 渲染器，并保留旧的程序化渲染作为 fallback。Bot 模型工具/API 对 `avatar.id` 的约束仍由 Host 控制。
4. 运行 `node --test test/*.test.js`、`node scripts/build-client.mjs`、`node scripts/smoke-client.mjs`，检查创建、自动匹配、手动选头像、聊天列表、群聊及深色主题。

**未擅自修改 GitHub 仓库**。新增预设是供接入时参考的建议，不代表当前系统已启用。

## SVG 技术规格

- 256 × 256 `viewBox`，保留 32px 小尺寸头像辨识度；单图独立、可无损缩放。
- 全部使用 SVG `path`、`circle`、`ellipse`、`polygon`、`rect`、`linearGradient`；**不含 PNG、base64 位图、外链、字体或 `<image>`**。
- 背景版含柔和圆角底板；透明版无底板，真正透明。
- 角色形象与 V2 保持柔和渐变、圆润深色描边、居中半身或特征轮廓、可亲近的神情。
- 视觉素材为本次设计原创，可随用户的 MIT 项目使用与修改。

## 重新生成

在拥有 `cairosvg`、`Pillow` 的 Python 环境中执行：

```bash
python source/generate_additions.py
```

它会重新生成整个 40 款角色库、预览图、清单及压缩包。
