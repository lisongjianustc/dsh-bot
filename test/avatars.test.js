import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AVATAR_PRESETS,
  DEFAULT_AVATAR_ID,
  LEAD_AVATAR_ID,
  avatarById,
  avatarForBot,
  isAvatarId,
  matchAvatar,
  normalizeAvatar,
} from '../src/host/avatars.js'
import { BotError } from '../src/host/errors.js'

test('avatars: the library is the documented presets plus the fallback', () => {
  // 24 original + 15 SVG-library additions + the default fallback row = 40.
  assert.equal(AVATAR_PRESETS.length, 40)
  const ids = new Set(AVATAR_PRESETS.map(preset => preset.id))
  assert.equal(ids.size, 40)
  // The old 25 ids all survive the extension.
  for (const id of ['lead-crown', 'research-flask', 'engineer-wrench', 'data-chart', 'writer-quill', 'default-bot']) {
    assert.ok(ids.has(id), id)
  }
  assert.ok(ids.has(DEFAULT_AVATAR_ID))
  assert.ok(ids.has(LEAD_AVATAR_ID))
  for (const preset of AVATAR_PRESETS) {
    assert.match(preset.id, /^[a-z0-9-]+$/)
    assert.match(preset.color, /^#[0-9a-f]{6}$/)
    assert.match(preset.background, /^#[0-9a-f]{6}$/)
    assert.equal(typeof preset.motif, 'string')
    assert.ok(Array.isArray(preset.zh))
    assert.ok(Array.isArray(preset.en))
  }
})

test('avatars: role keywords pick the matching preset', () => {
  assert.equal(matchAvatar({ name: 'Alice', role: '研究员' }).id, 'research-flask')
  assert.equal(matchAvatar({ name: 'Bob', role: '工程师' }).id, 'engineer-wrench')
  assert.equal(matchAvatar({ name: 'Carol', role: '视觉设计' }).id, 'design-palette')
  assert.equal(matchAvatar({ name: 'Dan', role: 'growth marketing' }).id, 'ops-megaphone')
  // The library is searched in instructions too, not only the role.
  assert.equal(matchAvatar({ name: 'Eve', role: '', instructions: '负责法务与合同' }).id, 'legal-scale')
})

test('avatars: the longest keyword outranks more short hits', () => {
  // "数据" + "数据分析" (4) beats nothing on research now that 分析 is narrowed.
  assert.equal(matchAvatar({ name: '数据猫', role: '数据分析' }).id, 'data-chart')
  assert.equal(matchAvatar({ name: '市场增长', role: '市场运营' }).id, 'ops-megaphone')
  // A genuinely research-flavoured identity still lands on the flask.
  assert.equal(matchAvatar({ name: '研究员', role: '文献调研' }).id, 'research-flask')
})

test('avatars: the SVG-library additions match their own roles', () => {
  const probes = [
    [{ name: '系统架构师', role: '架构设计' }, 'architect-stag'],
    [{ name: '战略规划', role: '战略咨询' }, 'strategy-fox'],
    [{ name: 'ESG', role: '可持续发展治理' }, 'esg-gaia'],
    [{ name: '内部审计', role: '审计底稿' }, 'audit-panda'],
    [{ name: '供应链管理', role: '采购物流' }, 'scm-cargo'],
    [{ name: '智能体编排', role: '多智能体调度' }, 'agent-sylph'],
    [{ name: '知识管理', role: '知识图谱' }, 'knowledge-tree'],
    [{ name: '流程自动化', role: 'RPA 机器人流程自动化' }, 'rpa-mecha'],
    [{ name: '趋势洞察', role: '竞争情报' }, 'insight-raven'],
    [{ name: '创新孵化', role: '创新项目管理' }, 'innovation-orb'],
  ]
  for (const [identity, expected] of probes) {
    assert.equal(matchAvatar(identity).id, expected, identity.name)
  }
})

test('avatars: narrative, numeric and art roles land on their own presets', () => {
  assert.equal(matchAvatar({
    name: '剧情策划',
    role: '世界观、主线支线与关卡叙事结构的设计者',
  }).id, 'writer-quill')
  assert.equal(matchAvatar({
    name: '数值策划',
    role: '属性、公式、成长曲线与经济平衡的设计者',
  }).id, 'data-chart')
  assert.equal(matchAvatar({
    name: '像素美工',
    role: '纯代码程序化像素美术，负责精灵与调色板',
  }).id, 'photo-camera')
  // A single Chinese character must never win: "主线" used to match lead-crown.
  assert.equal(matchAvatar({ name: 'x', role: '主线剧情' }).id, 'writer-quill')
  // "主线" has no keyword hit; this identity's hash fallback is not lead-crown,
  // so landing on lead-crown would mean the old single-character rule came back.
  assert.notEqual(matchAvatar({ name: 'y', role: '主线' }).id, 'lead-crown')
})

test('avatars: the nine cross-half probes agree with the client', () => {
  // Locked by the client smoke test; the Host must answer identically.
  const probes = [
    [{ name: 'Chief', role: '团队总管', isMain: true }, 'lead-crown'],
    [{ name: 'Alice', role: '研究员' }, 'research-flask'],
    [{ name: 'Bob', role: '工程师' }, 'engineer-wrench'],
    [{ name: '数据猫', role: '数据分析' }, 'data-chart'],
    [{ name: '市场增长', role: '市场运营' }, 'ops-megaphone'],
    [{ name: '剧情策划', role: '主线剧情与支线设计' }, 'writer-quill'],
    [{ name: '数值策划', role: '属性、公式、成长曲线与经济平衡的设计者' }, 'data-chart'],
    [{ name: '像素美工', role: '纯代码程序化像素美术，负责精灵与调色板' }, 'photo-camera'],
    // Hash fallback over the 39 non-default presets; the client must use the
    // same table and the same modulo to answer identically.
    [{ name: '未知角色', role: '随便聊聊' }, 'field-otter'],
  ]
  for (const [identity, expected] of probes) {
    assert.equal(matchAvatar(identity).id, expected, identity.name)
  }
})

test('avatars: occurrences of the longest keyword outrank one-off same-length hits', () => {
  // 剧情 appears twice (name + role), 设计 once: both two characters, so the
  // occurrence count of the longest keyword decides, not table order.
  assert.equal(matchAvatar({ name: '剧情策划', role: '主线剧情与支线设计' }).id, 'writer-quill')
  // The same rule leaves a one-off design role on the palette.
  assert.equal(matchAvatar({ name: '设计助理', role: '视觉与交互设计' }).id, 'design-palette')
})

test('avatars: a main bot with no keyword match gets the crown', () => {
  assert.equal(matchAvatar({ name: 'Q7', role: '', isMain: true }).id, LEAD_AVATAR_ID)
  // A real match still wins over the main preference.
  assert.equal(matchAvatar({ name: 'S9', role: '法务合规', isMain: true }).id, 'legal-scale')
})

test('avatars: an unknown role falls back to a stable, non-fallback preset', () => {
  const first = matchAvatar({ name: '未知角色', role: '随便聊聊' })
  const again = matchAvatar({ name: '未知角色', role: '随便聊聊' })
  assert.deepEqual(first, again)
  assert.notEqual(first.id, DEFAULT_AVATAR_ID)
  const other = matchAvatar({ name: '另一个', role: '随便聊聊' })
  assert.equal(typeof other.id, 'string')
  // A completely empty identity still gets a renderable spec.
  assert.equal(matchAvatar({}).id, DEFAULT_AVATAR_ID)
})

test('avatars: explicit choices win and unknown ids are refused', () => {
  const explicit = normalizeAvatar('writer-quill', { name: 'x' })
  assert.equal(explicit.spec.id, 'writer-quill')
  assert.equal(explicit.auto, false)
  const object = normalizeAvatar({ kind: 'library', id: 'star-star' }, { name: 'x' })
  assert.equal(object.spec.id, 'star-star')
  const bare = normalizeAvatar({ id: 'test-bug' }, { name: 'x' })
  assert.equal(bare.spec.id, 'test-bug')
  // null means "match me again".
  const auto = normalizeAvatar(null, { name: 'Alice', role: '工程师' })
  assert.equal(auto.spec.id, 'engineer-wrench')
  assert.equal(auto.auto, true)
  assert.throws(() => normalizeAvatar('nope', { name: 'x' }), (error) => error instanceof BotError && error.code === 'invalid-request')
  assert.throws(() => normalizeAvatar({ kind: 'svg' }, { name: 'x' }), (error) => error.code === 'invalid-request')
  assert.throws(() => normalizeAvatar(42, { name: 'x' }), (error) => error.code === 'invalid-request')
})

test('avatars: lookup helpers and old-record backfill', () => {
  assert.equal(isAvatarId('lead-crown'), true)
  assert.equal(isAvatarId('nope'), false)
  assert.equal(avatarById('data-chart').motif, 'chart')
  assert.equal(avatarById('nope'), undefined)
  // An old Bot without an avatar still renders one.
  const old = { name: 'Alice', role: '工程师' }
  assert.equal(avatarForBot(old).id, 'engineer-wrench')
  assert.equal(avatarForBot({ ...old, avatar: { kind: 'library', id: 'heart-heart' } }).id, 'heart-heart')
  // A stored avatar whose preset disappeared is re-matched, never left bare.
  assert.notEqual(avatarForBot({ ...old, avatar: { kind: 'library', id: 'deleted-preset' } }).id, 'deleted-preset')
})

// A subordinate instruction that mentions "主 Bot" must not outrank its own
// role: the lead preset keeps no Bot-name keyword for exactly this reason.
test('a junior role mentioning the main Bot still matches its own avatar', () => {
  const dev = matchAvatar({
    name: '开发',
    role: 'Godot 4 / GDScript 玩法与系统实现',
    instructions: '你是游戏开发组的开发（Godot Engineer），负责单机游戏的技术实现。技术栈 Godot 4.x + GDScript；边界：缺设定就问主 Bot，不要自己编一套。',
  })
  assert.equal(dev.id, 'engineer-wrench')
  const writer = matchAvatar({
    name: '文案师',
    role: '对白、旁白、任务文本与 UI 文案的写作者',
    instructions: '你是文案师，负责文字内容；缺大纲就问主 Bot。',
  })
  assert.equal(writer.id, 'writer-quill')
})
