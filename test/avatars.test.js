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
  // 24 matched presets + the default fallback row from the table.
  assert.equal(AVATAR_PRESETS.length, 25)
  const ids = new Set(AVATAR_PRESETS.map(preset => preset.id))
  assert.equal(ids.size, 25)
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
