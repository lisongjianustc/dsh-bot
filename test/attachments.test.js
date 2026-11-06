import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MAX_MESSAGE_ATTACHMENTS, MAX_UPLOAD_BYTES, createAttachments, inferMime, safeName } from '../src/host/attachments.js'
import { BotError } from '../src/host/errors.js'
import { createStore } from '../src/host/store.js'

function make(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-attach-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ctx = { logger: { warn() {}, error() {} }, get() { return undefined } }
  const store = createStore(ctx, { dir })
  const attachments = createAttachments({ store })
  t.after(() => store.close())
  return { dir, store, attachments }
}

test('attachments: an upload is stored under its content hash and viewed as a url', async (t) => {
  const { store, attachments } = make(t)
  const bytes = Buffer.from('hello attachment')
  const { attachment, created } = await attachments.put(bytes, { name: 'note.txt' })
  assert.equal(created, true)
  assert.match(attachment.id, /^[0-9a-f]{12}$/)
  assert.equal(attachment.name, 'note.txt')
  assert.equal(attachment.size, bytes.length)
  assert.equal(attachment.mime, 'text/plain')
  assert.equal(attachment.url, `dsh-bot/api/media?id=${attachment.id}`)
  const files = readdirSync(store.uploadsDir)
  assert.equal(files.length, 1)
  assert.equal(files[0], `${attachment.id}-note.txt`)
  assert.ok(existsSync(join(store.uploadsDir, files[0])))
})

test('attachments: the same bytes are one attachment, different bytes are two', async (t) => {
  const { store, attachments } = make(t)
  const first = await attachments.put(Buffer.from('same'), { name: 'a.txt' })
  const again = await attachments.put(Buffer.from('same'), { name: 'b.txt' })
  assert.equal(again.created, false)
  assert.equal(again.attachment.id, first.attachment.id)
  assert.equal(Object.keys(store.db.attachments).length, 1)
  const other = await attachments.put(Buffer.from('different'), { name: 'c.txt' })
  assert.notEqual(other.attachment.id, first.attachment.id)
  assert.equal(Object.keys(store.db.attachments).length, 2)
})

test('attachments: names are sanitized and the mime is inferred', async (t) => {
  const { attachments } = make(t)
  assert.equal(safeName('../../etc/passwd'), 'passwd')
  assert.equal(safeName('..hidden'), 'hidden')
  assert.equal(safeName('a/b\\c.png'), 'c.png')
  assert.equal(safeName('   '), 'file')
  assert.equal(inferMime('x.png', 'application/octet-stream'), 'image/png')
  assert.equal(inferMime('x.pdf', ''), 'application/pdf')
  assert.equal(inferMime('x.bin', 'application/octet-stream'), 'application/octet-stream')
  assert.equal(inferMime('x.png', 'image/jpeg; charset=binary'), 'image/jpeg')
  const { attachment } = await attachments.put(Buffer.from('png bytes'), { name: '../../evil.png' })
  assert.equal(attachment.name, 'evil.png')
  assert.equal(attachment.mime, 'image/png')
})

test('attachments: an empty or oversized upload is refused', async (t) => {
  const { attachments } = make(t)
  await assert.rejects(() => attachments.put(Buffer.alloc(0), { name: 'x' }), (error) => error instanceof BotError && error.code === 'invalid-request')
  await assert.rejects(
    () => attachments.put(Buffer.alloc(MAX_UPLOAD_BYTES + 1), { name: 'big.bin' }),
    (error) => error instanceof BotError && error.code === 'body-too-large',
  )
  await assert.rejects(() => attachments.put('not bytes', { name: 'x' }), (error) => error.code === 'invalid-request')
})

test('attachments: the manifest carries the absolute path, and paths stay inside uploads', async (t) => {
  const { store, attachments } = make(t)
  const { attachment } = await attachments.put(Buffer.from('data'), { name: 'report.txt' })
  const manifest = attachments.manifestFor([attachment.id])
  assert.match(manifest, /^\[attachments\]/)
  assert.match(manifest, /report\.txt/)
  assert.match(manifest, /text\/plain/)
  assert.ok(manifest.includes(store.uploadsDir))
  const path = attachments.pathOf(attachment.id)
  assert.ok(path.startsWith(store.uploadsDir))
  // A forged ledger entry that points elsewhere is refused, not read.
  const forged = join(store.homeDir, 'state.json')
  store.db.attachments.forged = { id: 'forged', name: 'x', size: 1, mime: 'text/plain', sha1: 'x', path: forged, createdAt: 1 }
  assert.throws(() => attachments.resolveSafePath(store.db.attachments.forged), (error) => error.code === 'invalid-request')
  // A vanished file is also a named refusal.
  writeFileSync(join(store.uploadsDir, 'gone.txt'), 'x')
  store.db.attachments.gone = { id: 'gone', name: 'x', size: 1, mime: 'text/plain', sha1: 'x', path: join(store.uploadsDir, 'gone.txt'), createdAt: 1 }
  rmSync(join(store.uploadsDir, 'gone.txt'))
  assert.throws(() => attachments.resolveSafePath(store.db.attachments.gone), (error) => error.code === 'invalid-request')
})

test('attachments: a message carries at most eight and turns into message parts', async (t) => {
  const { attachments } = make(t)
  const views = []
  for (let index = 0; index < MAX_MESSAGE_ATTACHMENTS; index += 1) {
    const { attachment } = await attachments.put(Buffer.from(`file ${index}`), { name: `f${index}.txt` })
    views.push(attachment)
  }
  assert.equal(attachments.viewsOf(views.map(view => view.id)).length, 8)
  assert.throws(
    () => attachments.viewsOf([...views.map(view => view.id), 'one-too-many']),
    (error) => error.code === 'invalid-request',
  )
  assert.throws(() => attachments.viewsOf(['missing']), (error) => error.code === 'invalid-request')
  const parts = attachments.partsOf(views)
  assert.equal(parts.length, 8)
  assert.deepEqual(parts[0], { type: 'file', attachment: views[0] })
  const image = await attachments.put(Buffer.from('image'), { name: 'p.png' })
  assert.deepEqual(attachments.partsOf([image.attachment])[0], { type: 'image', attachment: image.attachment })
})
