import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { AVATAR_PRESETS } from '../src/host/avatars.js'

const here = dirname(fileURLToPath(import.meta.url))
const assetsRoot = resolve(here, '..', 'assets', 'avatars')

function svgIdsOf(variant) {
  return readdirSync(join(assetsRoot, variant))
    .filter(name => name.endsWith('.svg'))
    .map(name => name.slice(0, -'.svg'.length))
    .sort()
}

test('avatar assets: every preset has a tile and a transparent SVG, and nothing is extra', () => {
  const presetIds = AVATAR_PRESETS.map(preset => preset.id).sort()
  assert.equal(presetIds.length, 40)
  const tileIds = svgIdsOf('tile')
  const transparentIds = svgIdsOf('transparent')
  assert.deepEqual(tileIds, presetIds)
  assert.deepEqual(transparentIds, presetIds)
  // Every asset is a real, non-empty SVG document.
  for (const variant of ['tile', 'transparent']) {
    for (const id of presetIds) {
      const path = join(assetsRoot, variant, `${id}.svg`)
      const stat = statSync(path)
      assert.ok(stat.size > 100, `${variant}/${id}.svg is not empty`)
      const body = readFileSync(path, 'utf8')
      assert.match(body, /<svg[\s>]/, `${variant}/${id}.svg is an SVG document`)
    }
  }
})

test('avatar assets: the manifest describes the same 40 ids', () => {
  const manifest = JSON.parse(readFileSync(join(assetsRoot, 'manifest.json'), 'utf8'))
  const manifestIds = manifest.avatars.map(avatar => avatar.id).sort()
  assert.deepEqual(manifestIds, AVATAR_PRESETS.map(preset => preset.id).sort())
  assert.equal(manifest.version, '2.1.0')
  for (const avatar of manifest.avatars) {
    assert.match(avatar.color, /^#[0-9a-f]{6}$/)
    assert.match(avatar.background, /^#[0-9a-f]{6}$/)
  }
})

test('avatar assets: the additions file matches the appended presets', () => {
  const additions = JSON.parse(readFileSync(join(assetsRoot, 'presets-additions.json'), 'utf8'))
  assert.equal(additions.length, 15)
  const byId = new Map(AVATAR_PRESETS.map(preset => [preset.id, preset]))
  for (const addition of additions) {
    const preset = byId.get(addition.id)
    assert.ok(preset, `${addition.id} is registered`)
    assert.equal(preset.color, addition.color)
    assert.equal(preset.background, addition.background)
    assert.deepEqual(preset.zh, addition.zh)
    assert.deepEqual(preset.en, addition.en)
  }
})
