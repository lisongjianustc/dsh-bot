/**
 * The built-in avatar library: the 24 presets from `docs/AVATAR-LIBRARY.md`
 * and a programmatic SVG renderer.
 *
 * The Host decides WHICH avatar a Bot gets (`{kind:'library', id, motif,
 * color, background}`); this module only draws it from the same table. Every
 * avatar is a rounded-square light background, a centred robot head (rounded
 * head, two eyes, an antenna) and one small motif accessory, drawn with plain
 * React elements — no image files, no JSX, no external resources.
 *
 * `matchAvatar` mirrors the Host's matching rules (keyword hits over
 * `name + role + instructions`, main-Bot lead preference, stable SHA-1 hash
 * fallback) so the create form can preview exactly what the Host will store.
 */

'use strict'

var React = require('react')
var h = React.createElement

/** The main Bot's no-match preference. */
var LEAD_AVATAR_ID = 'lead-crown'
/** The fallback preset (also the one the hash never picks). */
var DEFAULT_AVATAR_ID = 'default-bot'

/**
 * The 24 presets, in matching-priority order (identical to the Host table and
 * to `docs/AVATAR-LIBRARY.md` §3).
 */
var PRESETS = [
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
  { id: 'default-bot', motif: 'default', color: '#64748b', background: '#eef2f6', intent: '兜底', zh: [], en: [] },
]

/** Lookup of preset id -> preset row. */
var PRESET_BY_ID = Object.create(null)
for (var p = 0; p < PRESETS.length; p += 1) PRESET_BY_ID[PRESETS[p].id] = PRESETS[p]

/** Every preset except the fallback (the hash fallback pool). */
var NON_DEFAULT = PRESETS.filter(function (preset) {
  return preset.id !== DEFAULT_AVATAR_ID
})

/** The public spec of one preset row. */
function specOf(preset) {
  return { kind: 'library', id: preset.id, motif: preset.motif, color: preset.color, background: preset.background }
}

/** Whether an id names a library preset. */
function isAvatarId(id) {
  return typeof id === 'string' && PRESET_BY_ID[id] !== undefined
}

/** The spec of one known preset id, or undefined. */
function avatarById(id) {
  var preset = PRESET_BY_ID[String(id === undefined || id === null ? '' : id)]
  return preset === undefined ? undefined : specOf(preset)
}

/** Normalize any avatar value (spec / id / null) into a spec, or undefined. */
function normalizeAvatarValue(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return avatarById(value)
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.id === 'string' && isAvatarId(value.id)) return avatarById(value.id)
    if (typeof value.motif === 'string' && typeof value.color === 'string' && typeof value.background === 'string') {
      return {
        kind: 'library',
        id: typeof value.id === 'string' ? value.id : 'custom',
        motif: value.motif,
        color: value.color,
        background: value.background,
      }
    }
  }
  return undefined
}

/** Escape one literal for a word-boundary regular expression. */
function escapeWord(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Score one preset against the lowercased identity text.
 *
 * A longer hit outranks more short hits (a compound term such as `数据分析`
 * must beat two unrelated two-character words), count breaks ties, and table
 * order breaks the rest — exactly the Host's rule. One-character Chinese terms
 * are skipped because they match far too much ("主" inside "主线").
 */
function countOccurrences(text, needle) {
  if (needle === '') return 0
  var count = 0
  var index = text.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

function scorePreset(preset, text) {
  if (text === '') return { zhLongest: 0, zhLongestHits: 0, zhTotal: 0, enTotal: 0 }
  // Chinese and English lengths are not comparable; specificity comes from the
  // Chinese keyword length, and an English word only breaks ties.
  var zhLongest = 0
  var zhLongestHits = 0
  var zhTotal = 0
  var enTotal = 0
  for (var i = 0; i < preset.zh.length; i += 1) {
    var zhKeyword = preset.zh[i]
    if (zhKeyword.length < 2) continue
    var zhHits = countOccurrences(text, zhKeyword.toLowerCase())
    if (zhHits <= 0) continue
    zhTotal += zhHits
    if (zhKeyword.length > zhLongest) {
      zhLongest = zhKeyword.length
      zhLongestHits = zhHits
    } else if (zhKeyword.length === zhLongest) {
      zhLongestHits += zhHits
    }
  }
  for (var j = 0; j < preset.en.length; j += 1) {
    var enKeyword = preset.en[j].toLowerCase()
    var enHits = 0
    try {
      var pattern = new RegExp('(?<![\\p{L}\\p{N}_])' + escapeWord(enKeyword) + '(?![\\p{L}\\p{N}_])', 'gu')
      var matches = text.match(pattern)
      enHits = matches === null ? 0 : matches.length
    } catch (error) {
      enHits = countOccurrences(text, enKeyword)
    }
    enTotal += enHits
  }
  return { zhLongest: zhLongest, zhLongestHits: zhLongestHits, zhTotal: zhTotal, enTotal: enTotal }
}

/* --------------------------------------------------------------- sha1 */

/** Rotate a 32-bit integer left. */
function rotl(value, shift) {
  return (value << shift) | (value >>> (32 - shift))
}

/** SHA-1 hex digest, mirroring the Host's `sha1(name + '\n' + role)` hash. */
function sha1(text) {
  var source = String(text === undefined || text === null ? '' : text)
  var bytes = []
  for (var i = 0; i < source.length; i += 1) {
    var code = source.charCodeAt(i)
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0xd800 || code >= 0xe000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else {
      i += 1
      var next = 0x10000 + (((code & 0x3ff) << 10) | (source.charCodeAt(i) & 0x3ff))
      bytes.push(0xf0 | (next >> 18), 0x80 | ((next >> 12) & 0x3f), 0x80 | ((next >> 6) & 0x3f), 0x80 | (next & 0x3f))
    }
  }
  var bitLength = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  var high = Math.floor(bitLength / 0x100000000)
  var low = bitLength >>> 0
  bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff)
  bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff)

  var h0 = 0x67452301
  var h1 = 0xefcdab89
  var h2 = 0x98badcfe
  var h3 = 0x10325476
  var h4 = 0xc3d2e1f0
  var words = new Array(80)
  for (var offset = 0; offset < bytes.length; offset += 64) {
    for (var w = 0; w < 16; w += 1) {
      words[w] =
        (bytes[offset + w * 4] << 24) |
        (bytes[offset + w * 4 + 1] << 16) |
        (bytes[offset + w * 4 + 2] << 8) |
        bytes[offset + w * 4 + 3]
    }
    for (var t = 16; t < 80; t += 1) words[t] = rotl(words[t - 3] ^ words[t - 8] ^ words[t - 14] ^ words[t - 16], 1)
    var a = h0
    var b = h1
    var c = h2
    var d = h3
    var e = h4
    for (var r = 0; r < 80; r += 1) {
      var f
      var k
      if (r < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (r < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (r < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      var temp = (rotl(a, 5) + f + e + k + words[r]) | 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }
  function hex(value) {
    var unsigned = value >>> 0
    return ('00000000' + unsigned.toString(16)).slice(-8)
  }
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4)
}

/**
 * Match an avatar from a Bot identity, mirroring the Host algorithm.
 * @param {{name?:string, role?:string, instructions?:string, isMain?:boolean}} identity
 * @returns avatar spec.
 */
function matchAvatar(identity) {
  var bot = identity === undefined || identity === null ? {} : identity
  var name = String(bot.name === undefined ? '' : bot.name)
  var role = String(bot.role === undefined ? '' : bot.role)
  var instructions = String(bot.instructions === undefined ? '' : bot.instructions)
  var text = (name + '\n' + role + '\n' + instructions).toLowerCase()
  var best
  var bestZhLongest = 0
  var bestZhLongestHits = 0
  var bestZhTotal = 0
  var bestEnTotal = 0
  for (var i = 0; i < PRESETS.length; i += 1) {
    var score = scorePreset(PRESETS[i], text)
    // Chinese keyword length, then that length's occurrences, then the total
    // Chinese hits, then English hits, then table order — the Host's rule.
    var better = score.zhLongest > bestZhLongest
      || (score.zhLongest === bestZhLongest && score.zhLongest === 0 && score.enTotal > bestEnTotal)
      || (score.zhLongest === bestZhLongest && score.zhLongest > 0 && score.zhLongestHits > bestZhLongestHits)
      || (score.zhLongest === bestZhLongest && score.zhLongest > 0 && score.zhLongestHits === bestZhLongestHits && score.zhTotal > bestZhTotal)
      || (score.zhLongest === bestZhLongest && score.zhLongestHits === bestZhLongestHits && score.zhTotal === bestZhTotal && score.enTotal > bestEnTotal)
    if (better) {
      best = PRESETS[i]
      bestZhLongest = score.zhLongest
      bestZhLongestHits = score.zhLongestHits
      bestZhTotal = score.zhTotal
      bestEnTotal = score.enTotal
    }
  }
  if (best !== undefined && (bestZhLongest > 0 || bestEnTotal > 0)) return specOf(best)
  if (bot.isMain === true) {
    var lead = PRESET_BY_ID[LEAD_AVATAR_ID]
    if (lead !== undefined) return specOf(lead)
  }
  if (text.trim() === '') return specOf(PRESET_BY_ID[DEFAULT_AVATAR_ID])
  var digest = sha1(name + '\n' + role)
  var index = parseInt(digest.slice(0, 8), 16) % NON_DEFAULT.length
  return specOf(NON_DEFAULT[index])
}

/* ------------------------------------------------------------- drawing */

/** One motif glyph drawn inside a 32x32 box. */
function motifGlyph(motif, color) {
  var stroke = {
    fill: 'none',
    stroke: color,
    strokeWidth: 2.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
  var filled = { fill: color }
  switch (motif) {
    case 'crown':
      return [h('path', Object.assign({ key: 'c', d: 'M6 22h20l-2-11-5 4-3-7-3 7-5-4z' }, stroke))]
    case 'flask':
      return [
        h('path', Object.assign({ key: 'a', d: 'M13 5h6M15 5v6L8 25a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-7-14V5' }, stroke)),
      ]
    case 'wrench':
      return [h('path', Object.assign({ key: 'w', d: 'M9 23a4 4 0 1 0 5-5l9-9 3 3-9 9a4 4 0 0 1-5 5M18 8l4-4M22 12l4-4' }, stroke))]
    case 'palette':
      return [
        h('path', Object.assign({ key: 'p', d: 'M6 18a10 10 0 1 1 20 0q0 6-6 5l-3-1q-3 0-3 3t-4 2a9 9 0 0 1-4-9z' }, stroke)),
        h('circle', Object.assign({ key: 'd1', cx: 12, cy: 14, r: 1.7 }, filled)),
        h('circle', Object.assign({ key: 'd2', cx: 18, cy: 10, r: 1.7 }, filled)),
      ]
    case 'quill':
      return [h('path', Object.assign({ key: 'q', d: 'M27 5C16 8 9 14 6 27c8-2 14-5 18-11q3-5 3-11zM12 21l6-6' }, stroke))]
    case 'magnifier':
      return [
        h('circle', Object.assign({ key: 'c', cx: 14, cy: 14, r: 7 }, stroke)),
        h('path', Object.assign({ key: 'l', d: 'M19 19l7 7' }, stroke)),
      ]
    case 'megaphone':
      return [
        h('path', Object.assign({ key: 'm', d: 'M6 14v5h5l10 6V8L11 14zM21 11l5-3v16l-5-3' }, stroke)),
      ]
    case 'chart':
      return [h('path', Object.assign({ key: 'c', d: 'M7 25V6M7 25h20M12 21v-6M17 21V9M22 21v-9' }, stroke))]
    case 'scale':
      return [
        h('path', Object.assign({ key: 's', d: 'M16 5v22M8 27h16M6 12h20M6 12l-3 6h6zM26 12l-3 6h6z' }, stroke)),
      ]
    case 'headset':
      return [
        h('path', Object.assign({ key: 'h', d: 'M6 19v-4a10 10 0 0 1 20 0v4M6 18h3v7H6zM26 18h-3v7h3zM23 25a4 4 0 0 1-4 3h-3' }, stroke)),
      ]
    case 'coin':
      return [
        h('circle', Object.assign({ key: 'c', cx: 16, cy: 16, r: 10 }, stroke)),
        h('path', Object.assign({ key: 'y', d: 'M16 9v14M12 12h6a2.5 2.5 0 0 1 0 5h-4a2.5 2.5 0 0 0 0 5h6' }, stroke)),
      ]
    case 'clock':
      return [
        h('circle', Object.assign({ key: 'c', cx: 16, cy: 16, r: 10 }, stroke)),
        h('path', Object.assign({ key: 'p', d: 'M16 9v7l5 3' }, stroke)),
      ]
    case 'compass':
      return [
        h('circle', Object.assign({ key: 'c', cx: 16, cy: 16, r: 10 }, stroke)),
        h('path', Object.assign({ key: 'n', d: 'M20 10l-3 8-7 4 3-8z' }, stroke)),
      ]
    case 'camera':
      return [
        h('path', Object.assign({ key: 'c', d: 'M5 11h5l2-3h8l2 3h5v13H5z' }, stroke)),
        h('circle', Object.assign({ key: 'l', cx: 16, cy: 17, r: 4 }, stroke)),
      ]
    case 'note':
      return [
        h('path', Object.assign({ key: 'n', d: 'M12 24V7l12-2v17' }, stroke)),
        h('circle', Object.assign({ key: 'a', cx: 9, cy: 25, r: 3 }, filled)),
        h('circle', Object.assign({ key: 'b', cx: 21, cy: 23, r: 3 }, filled)),
      ]
    case 'shield':
      return [h('path', Object.assign({ key: 's', d: 'M16 4l10 4v8c0 6-4 10-10 12C10 26 6 22 6 16V8z' }, stroke))]
    case 'globe':
      return [
        h('circle', Object.assign({ key: 'c', cx: 16, cy: 16, r: 10 }, stroke)),
        h('path', Object.assign({ key: 'm', d: 'M6 16h20M16 6c3 3 3 17 0 20M16 6c-3 3-3 17 0 20' }, stroke)),
      ]
    case 'book':
      return [h('path', Object.assign({ key: 'b', d: 'M6 7a3 3 0 0 1 3-3h17v20H9a3 3 0 0 0-3 3zM6 7v20M26 4v20' }, stroke))]
    case 'bug':
      return [
        h('circle', Object.assign({ key: 'b', cx: 16, cy: 17, r: 6 }, stroke)),
        h('path', Object.assign({ key: 'l', d: 'M10 12L7 9M22 12l3-3M10 17H5M22 17h5M10 21l-3 3M22 21l3 3M14 7l2-3 2 3' }, stroke)),
      ]
    case 'gear':
      return [
        h('circle', Object.assign({ key: 'c', cx: 16, cy: 16, r: 4 }, stroke)),
        h('path', Object.assign({ key: 'g', d: 'M16 4v5M16 23v5M4 16h5M23 16h5M8 8l3 3M21 21l3 3M24 8l-3 3M11 21l-3 3' }, stroke)),
      ]
    case 'leaf':
      return [
        h('path', Object.assign({ key: 'a', d: 'M27 5C14 5 6 12 6 22a5 5 0 0 0 5 5c10 0 16-9 16-22z' }, stroke)),
        h('path', Object.assign({ key: 'b', d: 'M6 27L20 13' }, stroke)),
      ]
    case 'bolt':
      return [h('path', Object.assign({ key: 'b', d: 'M18 3L8 18h7l-2 11 11-15h-7z' }, stroke))]
    case 'star':
      return [h('path', Object.assign({ key: 's', d: 'M16 4l3.6 7.4 8.2 1.2-6 5.8 1.5 8.2-7.3-3.9-7.3 3.9 1.5-8.2-6-5.8 8.2-1.2z' }, stroke))]
    case 'heart':
      return [
        h('path', Object.assign({ key: 'h', d: 'M16 27S5 20 5 12.5A6.5 6.5 0 0 1 16 7a6.5 6.5 0 0 1 11 5.5C27 20 16 27 16 27z' }, stroke)),
      ]
    default:
      return [
        h('circle', Object.assign({ key: 'd', cx: 16, cy: 16, r: 4 }, filled)),
        h('circle', Object.assign({ key: 'e', cx: 16, cy: 16, r: 9 }, stroke)),
      ]
  }
}

/** Draw the robot head shared by every preset. */
function robotHead(color) {
  return [
    h('line', {
      key: 'antenna',
      x1: 128,
      y1: 84,
      x2: 128,
      y2: 62,
      stroke: color,
      strokeWidth: 7,
      strokeLinecap: 'round',
    }),
    h('circle', { key: 'bulb', cx: 128, cy: 56, r: 9, fill: color }),
    h('rect', {
      key: 'head',
      x: 66,
      y: 88,
      width: 124,
      height: 102,
      rx: 40,
      fill: 'rgba(255, 255, 255, 0.94)',
      stroke: color,
      strokeWidth: 5,
    }),
    h('circle', { key: 'eye-left', cx: 105, cy: 138, r: 9, fill: color }),
    h('circle', { key: 'eye-right', cx: 151, cy: 138, r: 9, fill: color }),
    h('path', {
      key: 'mouth',
      d: 'M114 164q14 9 28 0',
      fill: 'none',
      stroke: color,
      strokeWidth: 4,
      strokeLinecap: 'round',
      opacity: 0.75,
    }),
    // Ears
    h('rect', { key: 'ear-left', x: 52, y: 122, width: 14, height: 32, rx: 7, fill: color, opacity: 0.85 }),
    h('rect', { key: 'ear-right', x: 190, y: 122, width: 14, height: 32, rx: 7, fill: color, opacity: 0.85 }),
  ]
}

/**
 * Render one avatar spec as an SVG React element.
 * Unknown motifs fall back to the default glyph; a missing/invalid spec
 * renders nothing (callers fall back to the initial-letter avatar).
 * @param spec BotAvatar-like value (spec, preset id, or null).
 * @param size rendered edge in CSS pixels.
 * @param title optional accessible label.
 */
function renderAvatar(spec, size, title) {
  var avatar = normalizeAvatarValue(spec)
  if (avatar === undefined) return null
  var edge = typeof size === 'number' && isFinite(size) ? size : 32
  var motif = avatar.motif === undefined ? 'default' : avatar.motif
  var color = typeof avatar.color === 'string' && avatar.color !== '' ? avatar.color : '#64748b'
  var background = typeof avatar.background === 'string' && avatar.background !== '' ? avatar.background : '#eef2f6'
  var children = [
    h('rect', { key: 'bg', x: 4, y: 4, width: 248, height: 248, rx: 60, fill: background }),
    h('g', { key: 'head' }, robotHead(color)),
    h(
      'g',
      { key: 'badge', transform: 'translate(150 46)' },
      h('circle', { cx: 26, cy: 26, r: 26, fill: background, stroke: color, strokeWidth: 3 }),
      h('g', { transform: 'translate(10 10)' }, motifGlyph(motif, color)),
    ),
  ]
  return h(
    'svg',
    {
      className: 'db-avatar-svg',
      viewBox: '0 0 256 256',
      width: edge,
      height: edge,
      role: title === undefined ? undefined : 'img',
      'aria-label': title,
      'aria-hidden': title === undefined ? 'true' : undefined,
      focusable: 'false',
    },
    children,
  )
}

module.exports = {
  PRESETS: PRESETS,
  DEFAULT_AVATAR_ID: DEFAULT_AVATAR_ID,
  LEAD_AVATAR_ID: LEAD_AVATAR_ID,
  isAvatarId: isAvatarId,
  avatarById: avatarById,
  normalizeAvatarValue: normalizeAvatarValue,
  matchAvatar: matchAvatar,
  sha1: sha1,
  renderAvatar: renderAvatar,
}
