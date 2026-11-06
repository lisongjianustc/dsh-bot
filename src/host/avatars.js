/**
 * The built-in avatar library and its automatic matching.
 *
 * Host side only: this module decides WHICH avatar a Bot gets — a
 * `{kind:'library', id, motif, color, background}` spec — never how it is drawn.
 * The SVG renderer lives in the client half, from the same table
 * (`docs/AVATAR-LIBRARY.md`).
 *
 * Matching, in the order the spec fixes it:
 * 1. score every preset by keyword hits over `name + role + instructions`
 *    (Chinese keywords are substring hits, English keywords are word-boundary
 *    hits);
 * 2. the highest score wins; ties keep table order (the table is the priority);
 * 3. with no hit at all a main Bot gets `lead-crown`;
 * 4. otherwise a stable hash of `name + role` picks a non-fallback preset, so an
 *    unknown role still lands somewhere consistent;
 * 5. an empty identity falls back to `default-bot`;
 * 6. an explicit user choice always wins, and `null` means "match me again".
 *
 * @module @lisongjianustc/dsh-bot/host/avatars
 */
import { BotError } from './errors.js'
import { sha1 } from './util.js'

/**
 * The 24 presets, in matching-priority order.
 * @type {{ id: string, motif: string, color: string, background: string, intent: string, zh: string[], en: string[] }[]}
 */
export const AVATAR_PRESETS = [
  { id: 'lead-crown', motif: 'crown', color: '#3b6df6', background: '#eaf0ff', intent: '总管/主 Bot', zh: ['总管', '团队', '负责', '管理'], en: ['lead', 'chief', 'main', 'manager', 'head'] },
  { id: 'research-flask', motif: 'flask', color: '#12b3a6', background: '#e3f7f4', intent: '研究/调研', zh: ['研究', '调研', '学术', '文献', '实验'], en: ['research', 'study', 'academic'] },
  { id: 'engineer-wrench', motif: 'wrench', color: '#f08a24', background: '#fdf0e2', intent: '工程/开发', zh: ['工程', '开发', '代码', '技术'], en: ['engineer', 'developer', 'coding', 'dev', 'backend', 'frontend'] },
  { id: 'design-palette', motif: 'palette', color: '#e05a9b', background: '#fbe9f2', intent: '设计/视觉', zh: ['ui设计', 'ux设计', '设计', '视觉', '交互'], en: ['design', 'visual', 'ux', 'ui'] },
  { id: 'writer-quill', motif: 'quill', color: '#7b5cf0', background: '#efeaff', intent: '写作/文案', zh: ['剧情', '叙事', '故事', '剧本', '对白', '旁白', '写作', '文案', '编辑'], en: ['writer', 'copywriter', 'editor', 'content', 'narrative', 'story'] },
  { id: 'review-magnifier', motif: 'magnifier', color: '#e34b4b', background: '#fdeaea', intent: '审查/质检/测试', zh: ['审查', '质检', '评审', '测试'], en: ['review', 'qa', 'audit', 'test', 'check'] },
  { id: 'ops-megaphone', motif: 'megaphone', color: '#8bc34a', background: '#f0f7e8', intent: '运营/增长/市场', zh: ['运营', '增长', '市场', '推广'], en: ['operations', 'growth', 'marketing', 'ops'] },
  { id: 'data-chart', motif: 'chart', color: '#4361ee', background: '#e8ecff', intent: '数据/指标', zh: ['数据分析', '数据报表', '数据指标', '成长曲线', '数值', '公式', '平衡', '经济', '概率', '数据', '指标', '统计', '报表'], en: ['data', 'analytics', 'metric', 'report', 'numbers', 'balance'] },
  { id: 'legal-scale', motif: 'scale', color: '#5c6b8a', background: '#eceff4', intent: '法务/合规', zh: ['法务', '合规', '合同', '隐私'], en: ['legal', 'compliance', 'contract', 'privacy'] },
  { id: 'support-headset', motif: 'headset', color: '#ff8a65', background: '#ffeee8', intent: '客服/支持', zh: ['客服', '支持', '答疑'], en: ['support', 'helpdesk', 'customer', 'service'] },
  { id: 'finance-coin', motif: 'coin', color: '#d9a521', background: '#fbf3dd', intent: '财务/成本', zh: ['财务', '成本', '预算'], en: ['finance', 'budget', 'cost', 'accounting'] },
  { id: 'schedule-clock', motif: 'clock', color: '#4aa3df', background: '#e6f4fb', intent: '调度/协调/计划', zh: ['调度', '协调', '计划', '排期'], en: ['schedule', 'planner', 'coordinator', 'pm'] },
  { id: 'product-compass', motif: 'compass', color: '#6c63d8', background: '#eeecfb', intent: '产品/需求', zh: ['产品', '需求', '路线图'], en: ['product', 'roadmap', 'requirements'] },
  { id: 'photo-camera', motif: 'camera', color: '#2f9e8f', background: '#e6f6f3', intent: '摄影/图像', zh: ['像素', '美术', '精灵', '调色板', '摄影', '图像', '拍摄'], en: ['photo', 'image', 'camera', 'picture', 'pixel', 'art', 'sprite'] },
  { id: 'music-note', motif: 'note', color: '#c94f7c', background: '#fae9ef', intent: '音乐/音频', zh: ['音乐', '音频', '配音'], en: ['music', 'audio', 'sound', 'voice'] },
  { id: 'security-shield', motif: 'shield', color: '#475569', background: '#e8edf2', intent: '安全/风控', zh: ['安全', '风控', '审计', '防护'], en: ['security', 'risk', 'guard', 'protection'] },
  { id: 'i18n-globe', motif: 'globe', color: '#0ea5e9', background: '#e5f6fe', intent: '翻译/本地化', zh: ['翻译', '本地化', '多语言'], en: ['translate', 'i18n', 'localization', 'language'] },
  { id: 'edu-book', motif: 'book', color: '#a16207', background: '#f7f0dd', intent: '教育/培训', zh: ['教育', '培训', '教学'], en: ['education', 'teacher', 'training', 'learn'] },
  { id: 'test-bug', motif: 'bug', color: '#dc2626', background: '#fdecec', intent: '测试/质量', zh: ['测试', '用例', '缺陷', '质量'], en: ['test', 'qa', 'bug', 'quality'] },
  { id: 'devops-gear', motif: 'gear', color: '#0891b2', background: '#e4f5f9', intent: '运维/基础设施', zh: ['运维', '部署', '基础', '集群'], en: ['devops', 'sre', 'infra', 'deploy', 'ops'] },
  { id: 'eco-leaf', motif: 'leaf', color: '#16a34a', background: '#e9f7ee', intent: '环保/可持续', zh: ['环保', '可持续', '绿色'], en: ['eco', 'sustainability', 'green', 'climate'] },
  { id: 'energy-bolt', motif: 'bolt', color: '#eab308', background: '#fcf7e1', intent: '性能/加速', zh: ['性能', '加速', '优化'], en: ['performance', 'speed', 'optimize', 'latency'] },
  { id: 'star-star', motif: 'star', color: '#d946ef', background: '#fbeaf9', intent: '创意/灵感', zh: ['创意', '灵感', '头脑风暴'], en: ['creative', 'idea', 'brainstorm', 'innovation'] },
  { id: 'heart-heart', motif: 'heart', color: '#ec4899', background: '#fce9f2', intent: '关怀/HR/社区', zh: ['关怀', 'HR', '社区', '文化'], en: ['care', 'hr', 'community', 'culture'] },
  // --- the 15 additions from the SVG library v2.1 (docs/AVATAR-LIBRARY.md) ---
  { id: 'architect-stag', motif: 'default', color: '#4e83c8', background: '#e8f2ff', intent: '系统架构师', zh: ['架构', '系统设计', '技术架构'], en: ['architect', 'architecture', 'system design'] },
  { id: 'field-otter', motif: 'default', color: '#d18a44', background: '#fbf0e2', intent: '现场运营', zh: ['现场运营', '一线协调', '现场管理'], en: ['field operations', 'on-site', 'field ops'] },
  { id: 'risk-eagle', motif: 'default', color: '#4868a6', background: '#e9effa', intent: '风险管理', zh: ['风险管理', '风险识别', '风险评估'], en: ['risk management', 'risk assessment', 'risk analysis'] },
  { id: 'compliance-officer', motif: 'default', color: '#d26f8f', background: '#fcecf2', intent: '内控合规', zh: ['内控合规', '制度合规', '合规审查'], en: ['compliance officer', 'internal control', 'regulatory'] },
  { id: 'audit-panda', motif: 'default', color: '#a67b5b', background: '#f5eee7', intent: '审计稽核', zh: ['财务稽核', '内部审计', '审计底稿'], en: ['internal audit', 'auditor', 'auditing'] },
  { id: 'legaltech-dragon', motif: 'default', color: '#518ed8', background: '#e8f5ff', intent: '法务科技', zh: ['法律科技', '合同智能审查', '法务科技'], en: ['legaltech', 'legal technology', 'contract ai'] },
  { id: 'knowledge-tree', motif: 'default', color: '#45a580', background: '#e7f7ee', intent: '知识管理', zh: ['知识管理', '知识库', '知识图谱'], en: ['knowledge management', 'knowledge base', 'knowledge graph'] },
  { id: 'rpa-mecha', motif: 'default', color: '#e4a04d', background: '#fcf2e2', intent: '流程自动化', zh: ['流程自动化', '机器人流程自动化', '自动化脚本'], en: ['rpa', 'robotic process automation', 'workflow automation'] },
  { id: 'agent-sylph', motif: 'default', color: '#9171d9', background: '#f2ecff', intent: '智能体编排', zh: ['智能体编排', '多智能体', '智能体调度'], en: ['agent orchestration', 'multi-agent', 'ai agent'] },
  { id: 'scm-cargo', motif: 'default', color: '#278db4', background: '#e5f7fc', intent: '供应链管理', zh: ['供应链', '采购物流', '库存管理'], en: ['supply chain', 'logistics supply', 'inventory management'] },
  { id: 'esg-gaia', motif: 'default', color: '#4aaf72', background: '#e7f9ec', intent: 'ESG与可持续', zh: ['esg', '可持续发展治理', '环境社会治理'], en: ['esg', 'sustainability governance'] },
  { id: 'strategy-fox', motif: 'default', color: '#985b72', background: '#f8edf2', intent: '战略规划', zh: ['战略规划', '战略咨询', '战略研究'], en: ['strategic planning', 'strategy consultant', 'strategy'] },
  { id: 'innovation-orb', motif: 'default', color: '#da9a29', background: '#fff5d9', intent: '创新孵化', zh: ['创新孵化', '创新项目', '创新管理'], en: ['innovation lab', 'innovation management', 'ideation'] },
  { id: 'insight-raven', motif: 'default', color: '#5974a7', background: '#eaf0fb', intent: '趋势洞察', zh: ['趋势洞察', '行业洞察', '竞争情报'], en: ['insights', 'competitive intelligence', 'trend analysis'] },
  { id: 'future-traveler', motif: 'default', color: '#537cde', background: '#ebf1ff', intent: '未来探索', zh: ['未来研究', '未来趋势', '前瞻研究'], en: ['futures studies', 'futurist', 'foresight'] },
  { id: 'default-bot', motif: 'default', color: '#64748b', background: '#eef2f6', intent: '兜底', zh: [], en: [] },
]

/** The fallback preset, also the one the hash never picks. */
export const DEFAULT_AVATAR_ID = 'default-bot'
/** The main Bot's no-match preference. */
export const LEAD_AVATAR_ID = 'lead-crown'

const PRESET_BY_ID = new Map(AVATAR_PRESETS.map(preset => [preset.id, preset]))
const NON_DEFAULT = AVATAR_PRESETS.filter(preset => preset.id !== DEFAULT_AVATAR_ID)

/**
 * Project one preset into the public avatar spec.
 * @param {object} preset - the table row.
 * @returns {{ kind: 'library', id: string, motif: string, color: string, background: string }} the spec.
 */
function specOf(preset) {
  return { kind: 'library', id: preset.id, motif: preset.motif, color: preset.color, background: preset.background }
}

/**
 * Whether an id names a preset in the library.
 * @param {unknown} id - candidate id.
 * @returns {boolean} true for a known preset.
 */
export function isAvatarId(id) {
  return typeof id === 'string' && PRESET_BY_ID.has(id)
}

/**
 * The spec of one known preset id, or undefined.
 * @param {unknown} id - candidate id.
 * @returns {object | undefined} the spec.
 */
export function avatarById(id) {
  const preset = PRESET_BY_ID.get(String(id ?? ''))
  return preset === undefined ? undefined : specOf(preset)
}

/** Escape one literal for a word-boundary regular expression. */
function escapeWord(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** How many times one literal occurs in a text (non-overlapping). */
function countOccurrences(text, needle) {
  if (needle === '') return 0
  let count = 0
  let index = text.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Score one preset against the lowercased identity text.
 *
 * The exact rule both halves use:
 * 1. the LONGEST matched keyword's length;
 * 2. how many times the keyword(s) of that longest length occur;
 * 3. the total occurrences of every matched keyword;
 * 4. table order.
 *
 * So a compound term (`数据分析`, 4) beats two unrelated short terms, and a
 * term a Bot repeats (`剧情` twice in "剧情策划 / 主线剧情与支线设计") beats two
 * one-off terms of the same length. One-character Chinese keywords never
 * match, because they match far too much ("主" inside "主线").
 * @param {object} preset - the table row.
 * @param {string} text - lowercased name + role + instructions.
 * @returns {{ longest: number, longestHits: number, totalHits: number }} the score.
 */
function scorePreset(preset, text) {
  if (text === '') return { zhLongest: 0, zhLongestHits: 0, zhTotal: 0, enTotal: 0 }
  // Chinese and English lengths are not comparable ("narrative" is 9 UTF-16
  // units while a meaningful Chinese keyword is two characters). Specificity
  // therefore comes from the Chinese keyword length alone; an English word is
  // always one unit and only breaks ties after the Chinese signals.
  let zhLongest = 0
  let zhLongestHits = 0
  let zhTotal = 0
  let enTotal = 0
  for (const keyword of preset.zh) {
    if (keyword.length < 2) continue
    const occurrences = countOccurrences(text, keyword.toLowerCase())
    if (occurrences <= 0) continue
    zhTotal += occurrences
    if (keyword.length > zhLongest) {
      zhLongest = keyword.length
      zhLongestHits = occurrences
    } else if (keyword.length === zhLongest) {
      zhLongestHits += occurrences
    }
  }
  for (const keyword of preset.en) {
    const lowered = keyword.toLowerCase()
    let occurrences = 0
    try {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeWord(lowered)}(?![\\p{L}\\p{N}_])`, 'gu')
      occurrences = (text.match(pattern) ?? []).length
    } catch {
      occurrences = countOccurrences(text, lowered)
    }
    enTotal += occurrences
  }
  return { zhLongest, zhLongestHits, zhTotal, enTotal }
}

/**
 * Pick the avatar a Bot should have.
 * @param {{ name?: string, role?: string, instructions?: string, isMain?: boolean }} identity - the Bot.
 * @returns {{ kind: 'library', id: string, motif: string, color: string, background: string }} the spec.
 */
export function matchAvatar({ name = '', role = '', instructions = '', isMain = false } = {}) {
  const text = `${name}\n${role}\n${instructions}`.toLowerCase()
  let best = undefined
  let bestZhLongest = 0
  let bestZhLongestHits = 0
  let bestZhTotal = 0
  let bestEnTotal = 0
  for (const preset of AVATAR_PRESETS) {
    const score = scorePreset(preset, text)
    const better = score.zhLongest > bestZhLongest
      || (score.zhLongest === bestZhLongest && score.zhLongest === 0 && score.enTotal > bestEnTotal)
      || (score.zhLongest === bestZhLongest && score.zhLongest > 0 && score.zhLongestHits > bestZhLongestHits)
      || (score.zhLongest === bestZhLongest && score.zhLongest > 0 && score.zhLongestHits === bestZhLongestHits && score.zhTotal > bestZhTotal)
      || (score.zhLongest === bestZhLongest && score.zhLongestHits === bestZhLongestHits && score.zhTotal === bestZhTotal && score.enTotal > bestEnTotal)
    if (better) {
      best = preset
      bestZhLongest = score.zhLongest
      bestZhLongestHits = score.zhLongestHits
      bestZhTotal = score.zhTotal
      bestEnTotal = score.enTotal
    }
  }
  if (best !== undefined && (bestZhLongest > 0 || bestEnTotal > 0)) return specOf(best)
  if (isMain === true) {
    const lead = PRESET_BY_ID.get(LEAD_AVATAR_ID)
    if (lead !== undefined) return specOf(lead)
  }
  if (text.trim() === '') {
    const fallback = PRESET_BY_ID.get(DEFAULT_AVATAR_ID)
    return specOf(fallback)
  }
  // Stable per identity: the same name+role always lands on the same avatar.
  const digest = sha1(`${name}\n${role}`)
  const index = Number.parseInt(digest.slice(0, 8), 16) % NON_DEFAULT.length
  return specOf(NON_DEFAULT[index])
}

/**
 * Normalize one user-supplied avatar value.
 *
 * `undefined` means "not specified"; `null` means "match me again"; a string is
 * a preset id; an object must be `{ kind:'library', id }` or a bare `{ id }`.
 * @param {unknown} input - the value from the panel or a tool.
 * @param {{name?: string, role?: string, instructions?: string, isMain?: boolean}} identity - the Bot.
 * @returns {{ spec: object | null | undefined, auto: boolean }} the spec and whether it is explicit.
 * @throws {BotError} `invalid-request` for an unknown id or shape.
 */
export function normalizeAvatar(input, identity = {}) {
  if (input === undefined) {
    return { spec: matchAvatar(identity), auto: true }
  }
  if (input === null) {
    return { spec: matchAvatar(identity), auto: true }
  }
  if (typeof input === 'string') {
    const spec = avatarById(input)
    if (spec === undefined) throw new BotError('invalid-request', `no avatar preset has the id "${input}"`)
    return { spec, auto: false }
  }
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const kind = input.kind === undefined ? 'library' : String(input.kind)
    if (kind !== 'library') throw new BotError('invalid-request', 'the only avatar kind is "library"')
    const spec = avatarById(input.id)
    if (spec === undefined) throw new BotError('invalid-request', `no avatar preset has the id "${String(input.id ?? '')}"`)
    return { spec, auto: false }
  }
  throw new BotError('invalid-request', 'an avatar is a preset id, {kind:"library", id}, or null')
}

/**
 * The avatar one stored Bot renders, filling a missing one on read.
 * @param {object} bot - the stored Bot.
 * @returns {object} the avatar spec.
 */
export function avatarForBot(bot) {
  if (bot?.avatar !== undefined && bot.avatar !== null && isAvatarId(bot.avatar.id)) {
    return specOf(PRESET_BY_ID.get(bot.avatar.id))
  }
  return matchAvatar(bot ?? {})
}

export { specOf }
