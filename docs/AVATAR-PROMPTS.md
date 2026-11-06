# Bot 头像库设计提示词（ChatGPT / GPT-Image）

> 用途：为 dsh-bot 的机器人团队设计一套**风格统一、可长期扩展**的头像库（每人一格，后续新 Bot 可按同一模板追加）。
> 适用：ChatGPT 图片生成（GPT-Image / DALL·E 均可；建议用能"参考图保持风格"的模式）。
> 配套：`dsh-bot/docs/screenshots/` 里有当前界面；Bot 详情现在用"颜色 + 首字母"头像，图像头像的资源规格见本文 §8/§9。

---

## 0. 先定三件事（决定提示词写法）

1. **风格**：推荐 **A. 黏土 3D**（与 DSH 的柔和界面最搭、辨识度最高）；备选 B. 扁平矢量 / C. 像素。
2. **角色数**：先做 **12 个**（覆盖常见团队角色），后续按同一模板追加。
3. **交付规格**：**1:1 方形**，导出 1024×1024 PNG → 实际入库 256×256（2x 用 512），**透明背景**，头部+肩部居中，无文字/logo。

---

## 1. 风格锚点（每次生成都带同一段，保证一致性）

**Style Anchor A（黏土 3D，推荐）**

```text
Style anchor: a cute soft 3D clay render of a small robot mascot, matte plasticine material,
rounded friendly shapes, large expressive eyes, soft studio lighting from the upper left,
gentle rim light, subtle ambient occlusion, pastel color palette, centered head-and-shoulders
bust portrait, transparent background, clean silhouette, high detail, no text, no logo,
no realistic humans, no background scene.
```

**Style Anchor B（扁平矢量）**

```text
Style anchor: flat vector mascot avatar, bold rounded shapes, 2px soft outlines, limited palette,
subtle paper-grain texture, centered head-and-shoulders bust, transparent background,
minimal and friendly, no text, no logo, no gradients heavier than two stops.
```

**Style Anchor C（像素）**

```text
Style anchor: 32px-grid pixel-art mascot avatar upscaled cleanly, limited 12-color palette,
crisp 1px highlights, centered bust portrait, transparent background, no anti-aliased blur,
no text, no logo.
```

> 选定后用同一个锚点跑完整套；中途不要换措辞。

---

## 2. 第一步：生成「风格基准图」（一次性 12 宫格）

在 ChatGPT 里新开对话，先发这段（把 `<<STYLE ANCHOR>>` 替换为 §1 的英文锚点）：

```text
You are designing a mascot avatar library for a team-of-robots product.

<<STYLE ANCHOR>>

Task: create ONE image — a 3 columns × 4 rows contact sheet (12 cells, equal square cells,
thin neutral gaps) on a fully transparent background. Each cell holds exactly one robot
mascot bust, same species and same rendering style, differentiated only by:
- accent color (one per cell),
- one signature head accessory / motif (e.g. antenna shape, visor, headphones, cap, monocle, ear cups, badge),

Cell roles in reading order:
1 Chief (team lead), 2 Researcher, 3 Engineer, 4 Designer, 5 Writer, 6 Reviewer,
7 Operations, 8 Data Analyst, 9 Legal, 10 Support, 11 Finance, 12 Scheduler.

Rules:
- every mascot faces the viewer, same head size and same eye style,
- same lighting direction, same clay material, same line weight,
- no text, no letters, no logos, no props that break the square cell,
- keep each mascot fully inside its cell with even margins,
- transparent background everywhere (no checkerboard painted in, no floor shadows beyond a soft contact shadow).
```

> 这张基准图是"风格合同"：之后每个单角色都让它参考这张图。

---

## 3. 第二步：单角色生成模板（12 次，一次一个）

每次都把**基准图作为参考图**一起发，使用同一模板：

```text
Using the attached style-sheet image as the exact style reference (same robot species,
same clay material, same lighting, same eye style, same line weight), generate ONE
single-character avatar.

Character: <<ROLE NAME>> (<<ROLE DESCRIPTION>>)
Accent color: <<HEX / COLOR NAME>>
Signature motif: <<MOTIF>>
Expression: <<friendly / focused / curious / calm>>
Framing: centered head-and-shoulders bust, square 1:1, generous even margins,
character occupies ~80% of the frame height.
Background: fully transparent PNG.
Do not change the style, proportions, or material from the reference. No text, no logo.
Output 1024×1024.
```

---

## 4. 12 个角色的填表（直接套 §3 模板）

| # | 角色 | 描述 | 强调色 | 标志性元素 / motif | 表情 |
|---|---|---|---|---|---|
| 1 | Chief | 团队总管 | 宝蓝 `#3b6df6` | 小皇冠形天线 + 胸前徽章 | 自信、微笑 |
| 2 | Researcher | 研究员 | 青绿 `#12b3a6` | 单片眼镜（发蓝光）+ 头顶小书 | 好奇 |
| 3 | Engineer | 工程师 | 橙 `#f08a24` | 护目镜推到额头 + 扳手耳饰 | 专注 |
| 4 | Designer | 设计师 | 洋红 `#e05a9b` | 画家贝雷帽 + 调色板肩章 | 轻松 |
| 5 | Writer | 写手 | 紫 `#7b5cf0` | 羽毛笔形天线 + 稿纸纹理围巾 | 温和 |
| 6 | Reviewer | 审查员 | 红 `#e34b4b` | 放大镜眼罩 + 勾叉胸章 | 严肃但友善 |
| 7 | Operations | 运营 | 黄绿 `#8bc34a` | 耳机 + 进度环肩甲 | 干练 |
| 8 | Data Analyst | 数据分析 | 靛蓝 `#4361ee` | 三格数据屏眼罩 + 折线天线 | 冷静 |
| 9 | Legal | 法务 | 灰蓝 `#5c6b8a` | 小领结 + 卷轴肩饰 | 沉稳 |
| 10 | Support | 客服 | 珊瑚 `#ff8a65` | 微笑面罩 + 耳麦 | 亲切 |
| 11 | Finance | 财务 | 金 `#d9a521` | 硬币形单眼 + 计算器胸章 | 严谨 |
| 12 | Scheduler | 调度 | 天蓝 `#4aa3df` | 钟表形天线 + 日历耳饰 | 精神 |

---

## 5. 第三步：批量一致性与变体（表情 / 角度 / 追加新角色）

**统一性优先**：一次只生成一个角色；12 个都完成后，再让 ChatGPT 做一张总览检查：

```text
Here are 12 separate avatar images. Do not redraw them. Create a 4×3 contact sheet
that places them in the given order on a transparent background, same cell size,
same margins. Keep every avatar pixel-identical to its source image.
```

**追加新角色**（例如"市场"）时，把 12 张中的任意 2 张 + 模板一起发：

```text
Match the exact style, material, lighting and eye rendering of the attached two avatars.
Generate ONE new mascot for role: Marketing, accent color teal, motif: megaphone-shaped antenna,
same framing and transparent background. No text.
```

**表情/半身变体**（用于 hover 或大图）：

```text
Using the attached avatar as the exact character reference, produce 3 expressions of the SAME
character in the same style and framing: neutral, happy, thinking. Transparent background,
one image per expression, square 1:1.
```

---

## 6. 负面提示（每次都可附上）

```text
Negative: text, letters, numbers, watermark, logo, realistic human skin, extra limbs,
asymmetric eyes, inconsistent line weight, painted checkerboard background, floor,
cast shadow bigger than a soft contact shadow, cropped antenna, busy background,
photo realism, low contrast, blurry edges, jpeg artifacts.
```

---

## 7. 导出与裁切规格

1. 让 ChatGPT 输出 **1024×1024 PNG（透明背景）**；若它给了拼图，用任意工具裁成单格（每格必须正方形）。
2. 统一缩放：**512×512（@2x）与 256×256（1x）**，透明背景保留，边缘不留白边。
3. 命名：`avatar-<role>-<variant>.png`，例如 `avatar-chief-default.png`。
4. 放仓库：`dsh-bot/docs/avatars/`（设计源文件）与未来插件资源目录（见 §9）。
5. 压缩：PNG 用 `pngquant --quality=80-95`（可选），256 版建议 < 60 KB。

## 8. 验收清单（肉眼逐条过）

- [ ] 12 张**同一物种、同一材质、同一光向、同一眼型**；
- [ ] 强调色可区分，且在浅色/深色界面都不脏；
- [ ] 透明背景没有白边/黑边/棋盘格；
- [ ] 头部占比一致（约 80% 高度），方形居中；
- [ ] 无文字/水印/logo；无明显手部/多肢；
- [ ] 缩小到 32×32 仍能辨出角色（可做 favicon/小头像测试）；
- [ ] 扩图时新角色能与旧 12 张并排而不违和。

## 9. 接入 dsh-bot（当前与后续）

- 当前：Bot 详情用 **颜色 + 首字母** 头像（8 色板），`bot.avatar` 字段已在数据模型里预留。
- 后续（M4）：插件的 Bot 详情会增加「头像库 / 上传」，规格即本文件：**256×256 PNG、透明背景、方形、≤256 KB**；头像按内容哈希存 `$DSH_HOME/dsh-bot/avatars/`，入库后所有会话/群聊同步显示。
- 所以现在生成的 12 张图可以直接作为 M4 的资源库（包括 `avatar-chief.png` 这类稳定命名）。

## 10. 一键复制区（最小可用组合）

**开场白（生成基准图）**

```text
You are designing a mascot avatar library for a team-of-robots product. Style anchor:
a cute soft 3D clay render of a small robot mascot, matte plasticine material, rounded
friendly shapes, large expressive eyes, soft studio lighting from the upper left, gentle
rim light, subtle ambient occlusion, pastel palette, centered head-and-shoulders bust,
transparent background, clean silhouette, no text, no logo, no realistic humans.
Create ONE 3×4 contact sheet (12 equal square cells, thin neutral gaps) on a fully
transparent background, one robot bust per cell, same species/style/lighting/eye style,
differentiated only by accent color and one head accessory. Roles in reading order:
Chief, Researcher, Engineer, Designer, Writer, Reviewer, Operations, Data Analyst,
Legal, Support, Finance, Scheduler. No text or logos; each bust inside its cell.
```

**单角色（把 <> 换成 §4 的值）**

```text
Using the attached style sheet as the exact style reference, generate ONE avatar:
<ROLE> (<DESCRIPTION>), accent color <HEX>, signature motif <MOTIF>, expression <EXPRESSION>.
Same robot species, clay material, lighting, eye style and line weight as the reference.
Centered head-and-shoulders bust, square 1:1, character ~80% of frame height, fully
transparent background, 1024×1024. No text, no logo.
```
