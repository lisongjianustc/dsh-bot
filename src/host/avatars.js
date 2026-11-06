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
  { id: 'lead-crown', motif: 'crown', color: '#3b6df6', background: '#eaf0ff', intent: '总管/主 Bot', zh: ['总管', '主', '团队', '负责', '管理'], en: ['lead', 'chief', 'main', 'manager', 'head'] },
  { id: 'research-flask', motif: 'flask', color: '#12b3a6', background: '#e3f7f4', intent: '研究/调研', zh: ['研究', '调研', '学术', '文献', '实验'], en: ['research', 'study', 'academic'] },
  { id: 'engineer-wrench', motif: 'wrench', color: '#f08a24', background: '#fdf0e2', intent: '工程/开发', zh: ['工程', '开发', '代码', '技术'], en: ['engineer', 'developer', 'coding', 'dev', 'backend', 'frontend'] },
  { id: 'design-palette', motif: 'palette', color: '#e05a9b', background: '#fbe9f2', intent: '设计/视觉', zh: ['设计', '视觉', '交互'], en: ['design', 'visual', 'ux', 'ui'] },
  { id: 'writer-quill', motif: 'quill', color: '#7b5cf0', background: '#efeaff', intent: '写作/文案', zh: ['写作', '文案', '编辑', '稿'], en: ['writer', 'copywriter', 'editor', 'content'] },
  { id: 'review-magnifier', motif: 'magnifier', color: '#e34b4b', background: '#fdeaea', intent: '审查/质检/测试', zh: ['审查', '质检', '评审', '测试'], en: ['review', 'qa', 'audit', 'test', 'check'] },
  { id: 'ops-megaphone', motif: 'megaphone', color: '#8bc34a', background: '#f0f7e8', intent: '运营/增长/市场', zh: ['运营', '增长', '市场', '推广'], en: ['operations', 'growth', 'marketing', 'ops'] },
  { id: 'data-chart', motif: 'chart', color: '#4361ee', background: '#e8ecff', intent: '数据/指标', zh: ['数据分析', '数据报表', '数据指标', '数据', '指标', '统计', '报表'], en: ['data', 'analytics', 'metric', 'report'] },
  { id: 'legal-scale', motif: 'scale', color: '#5c6b8a', background: '#eceff4', intent: '法务/合规', zh: ['法务', '合规', '合同', '隐私'], en: ['legal', 'compliance', 'contract', 'privacy'] },
  { id: 'support-headset', motif: 'headset', color: '#ff8a65', background: '#ffeee8', intent: '客服/支持', zh: ['客服', '支持', '答疑'], en: ['support', 'helpdesk', 'customer', 'service'] },
  { id: 'finance-coin', motif: 'coin', color: '#d9a521', background: '#fbf3dd', intent: '财务/成本', zh: ['财务', '成本', '预算', '账'], en: ['finance', 'budget', 'cost', 'accounting'] },
  { id: 'schedule-clock', motif: 'clock', color: '#4aa3df', background: '#e6f4fb', intent: '调度/协调/计划', zh: ['调度', '协调', '计划', '排期'], en: ['schedule', 'planner', 'coordinator', 'pm'] },
  { id: 'product-compass', motif: 'compass', color: '#6c63d8', background: '#eeecfb', intent: '产品/需求', zh: ['产品', '需求', '路线图'], en: ['product', 'roadmap', 'requirements'] },
  { id: 'photo-camera', motif: 'camera', color: '#2f9e8f', background: '#e6f6f3', intent: '摄影/图像', zh: ['摄影', '图像', '拍摄'], en: ['photo', 'image', 'camera', 'picture'] },
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

/**
 * Score one preset against the lowercased identity text.
 *
 * A longer hit outranks more short hits: `数据分析` (4 chars) beats a single
 * `数据` (2) plus a single `分析` (2) elsewhere, which is what makes a
 * "数据猫 · 数据分析" Bot a data Bot rather than a research Bot. Count breaks the
 * remaining ties, and table order breaks those.
 * @param {object} preset - the table row.
 * @param {string} text - lowercased name + role + instructions.
 * @returns {{ longest: number, hits: number }} the longest hit and the hit count.
 */
function scorePreset(preset, text) {
  if (text === '') return { longest: 0, hits: 0 }
  let longest = 0
  let hits = 0
  const hit = (keyword) => {
    hits += 1
    if (keyword.length > longest) longest = keyword.length
  }
  for (const keyword of preset.zh) if (text.includes(keyword.toLowerCase())) hit(keyword)
  for (const keyword of preset.en) {
    const lowered = keyword.toLowerCase()
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeWord(lowered)}(?![\\p{L}\\p{N}_])`, 'u')
    if (pattern.test(text)) hit(lowered)
  }
  return { longest, hits }
}

/**
 * Pick the avatar a Bot should have.
 * @param {{ name?: string, role?: string, instructions?: string, isMain?: boolean }} identity - the Bot.
 * @returns {{ kind: 'library', id: string, motif: string, color: string, background: string }} the spec.
 */
export function matchAvatar({ name = '', role = '', instructions = '', isMain = false } = {}) {
  const text = `${name}\n${role}\n${instructions}`.toLowerCase()
  let best = undefined
  let bestLongest = 0
  let bestHits = 0
  for (const preset of AVATAR_PRESETS) {
    const { longest, hits } = scorePreset(preset, text)
    // Longest keyword first, then the number of hits, then table order.
    if (longest > bestLongest || (longest === bestLongest && hits > bestHits)) {
      best = preset
      bestLongest = longest
      bestHits = hits
    }
  }
  if (best !== undefined && bestLongest > 0) return specOf(best)
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
