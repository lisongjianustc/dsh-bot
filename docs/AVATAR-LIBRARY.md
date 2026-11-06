# Bot 头像库规格（v1）

目标：**内置头像库 + 自动匹配**。Bot 不需要人工挑头像；创建/更新时按「名字 + 角色 + 指令」的关键词从库里匹配最合适的头像；新增未知角色时也能落到一个不违和的兜底头像。用户仍可手动换一个（循环/网格选择）。

渲染方式：**程序化 SVG**（不依赖外部图片文件，随主题/缩放清晰），每个头像 = 一个「motif（标志元素）」+ 一组调色板。Host 决定 `bot.avatar = { kind:'library', id, motif, color, background }`；Client 用内置 SVG 渲染器按 motif 画头像（同一张表，两边各自实现，以本文件为准）。

## 1. 数据结构

```ts
BotAvatar = {
  kind: 'library',
  id: string,          // 预设 id，如 'lead-crown'
  motif: string,       // 见 §2 motif 枚举
  color: string,       // 主色，如 '#3b6df6'
  background: string,  // 背景色（同色系浅色），如 '#eaf0ff'
}
```

`state.bots[].avatar` 为 `null`（旧数据/未匹配）或上述对象。`bot.avatar` 更新时可传 `{kind:'library', id}` 或 `id` 字符串（Host 归一化）；`bot.avatar: null` + `auto` 策略 → Host 自动匹配。

## 2. Motif 枚举（Client 渲染器必须支持）

`crown, flask, wrench, palette, quill, magnifier, megaphone, chart, scale, headset, coin, clock, compass, camera, note, shield, globe, book, bug, gear, leaf, bolt, star, heart, default`

渲染要求：256×256 viewBox、圆角方形浅色背景、居中的机器人头（圆角头 + 两只眼睛 + 天线），motif 作为头顶/耳侧的小配件（≤ 头宽的 45%），颜色取自 `color`/`background`，无文字。暗色主题下背景用 `background` 原色即可（都取浅色系，保证对比）。

## 3. 预设表（24 个；Host 与 Client 共用 id/motif/color/background）

| id | 角色意图 | motif | color | background | 匹配关键词（zh / en） |
|---|---|---|---|---|---|
| lead-crown | 总管/主 Bot | crown | #3b6df6 | #eaf0ff | 总管,主,团队,负责,管理 / lead,chief,main,manager,head |
| research-flask | 研究/调研 | flask | #12b3a6 | #e3f7f4 | 研究,调研,分析,学术,文献 / research,research,study,academic |
| engineer-wrench | 工程/开发 | wrench | #f08a24 | #fdf0e2 | 工程,开发,代码,技术 / engineer,developer,coding,dev,backend,frontend |
| design-palette | 设计/视觉 | palette | #e05a9b | #fbe9f2 | 设计,视觉,交互,UI,UX / design,visual,ux,ui |
| writer-quill | 写作/文案 | quill | #7b5cf0 | #efeaff | 写作,文案,编辑,稿 / writer,copywriter,editor,content |
| review-magnifier | 审查/质检/测试 | magnifier | #e34b4b | #fdeaea | 审查,质检,评审,测试 / review,qa,audit,test,check |
| ops-megaphone | 运营/增长/市场 | megaphone | #8bc34a | #f0f7e8 | 运营,增长,市场,推广 / operations,growth,marketing,ops |
| data-chart | 数据/指标 | chart | #4361ee | #e8ecff | 数据,指标,统计,报表 / data,analytics,metric,report |
| legal-scale | 法务/合规 | scale | #5c6b8a | #eceff4 | 法务,合规,合同,隐私 / legal,compliance,contract,privacy |
| support-headset | 客服/支持 | headset | #ff8a65 | #ffeee8 | 客服,支持,答疑 / support,helpdesk,customer,service |
| finance-coin | 财务/成本 | coin | #d9a521 | #fbf3dd | 财务,成本,预算,账 / finance,budget,cost,accounting |
| schedule-clock | 调度/协调/计划 | clock | #4aa3df | #e6f4fb | 调度,协调,计划,排期 / schedule,planner,coordinator,pm |
| product-compass | 产品/需求 | compass | #6c63d8 | #eeecfb | 产品,需求,路线图 / product,roadmap,requirements |
| photo-camera | 摄影/图像 | camera | #2f9e8f | #e6f6f3 | 摄影,图像,拍摄 / photo,image,camera,picture |
| music-note | 音乐/音频 | note | #c94f7c | #fae9ef | 音乐,音频,配音 / music,audio,sound,voice |
| security-shield | 安全/风控 | shield | #475569 | #e8edf2 | 安全,风控,审计,防护 / security,risk,guard,protection |
| i18n-globe | 翻译/本地化 | globe | #0ea5e9 | #e5f6fe | 翻译,本地化,多语言 / translate,i18n,localization,language |
| edu-book | 教育/培训 | book | #a16207 | #f7f0dd | 教育,培训,教学 / education,teacher,training,learn |
| test-bug | 测试/质量 | bug | #dc2626 | #fdecec | 测试,用例,缺陷,质量 / test,qa,bug,quality |
| devops-gear | 运维/基础设施 | gear | #0891b2 | #e4f5f9 | 运维,部署,基础,集群 / devops,sre,infra,deploy,ops |
| eco-leaf | 环保/可持续 | leaf | #16a34a | #e9f7ee | 环保,可持续,绿色 / eco,sustainability,green,climate |
| energy-bolt | 性能/加速 | bolt | #eab308 | #fcf7e1 | 性能,加速,优化 / performance,speed,optimize,latency |
| star-star | 创意/灵感 | star | #d946ef | #fbeaf9 | 创意,灵感,头脑风暴 / creative,idea,brainstorm,innovation |
| heart-heart | 关怀/HR/社区 | heart | #ec4899 | #fce9f2 | 关怀,HR,社区,文化 / care,hr,community,culture |
| default-bot | 兜底 | default | #64748b | #eef2f6 | （无匹配时按名字哈希取一个非兜底预设；完全无角色时用本项） |

## 4. 自动匹配算法（Host）

1. 取 `name + role + instructions` 拼成文本，转小写。
2. 评分：**中文关键词长度 → 该长度关键词的出现次数 → 中文总命中次数 → 英文命中次数 → 表序**。中文与英文长度不可直接比较（`narrative` 9 字符会压过 `开发`），英文只在平局时参与；中文单字关键词不参与。
3. 命中为 0 时：用 `sha1(bot.name + bot.role)` 取模在除 `default-bot` 外的预设里选一个（保证同名同角色稳定，不同角色分散）。
4. `isMain === true` 且无明确命中 → 优先 `lead-crown`。
5. 用户显式传 `avatar.id` 时以用户为准；传 `avatar:null` 且 `autoAvatar !== false` 时重新自动匹配。
6. 新增预设只要扩展本表；匹配对未知角色自动走哈希兜底，不会失败。

## 5. 手动切换（Client）

- Bot 详情里显示当前头像 + 「换一个」按钮：在 24 格里循环/网格选择，保存 `bot.avatar = {kind:'library', id}`。
- 新角色创建表单默认显示"自动匹配预览"（按当前名字/角色实时调用 Host 的预览不会被允许 → 客户端本地用同一张关键词表做预览，保存后 Host 以同表计算，保证一致）。

## 6. 与旧数据的兼容

- `avatar` 为空 → 列表/气泡渲染时 Host 已补默认（state 里返回匹配结果），客户端无需处理 null。
- 旧 `skin` 字段保留但只影响气泡名色；头像优先于首字母。
