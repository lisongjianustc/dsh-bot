import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BotError } from '../src/host/errors.js'
import { FS_TEXT_MAX_BYTES, createFsBrowser } from '../src/host/fs-browser.js'
import { createServices } from '../src/host/services.js'
import { createStore } from '../src/host/store.js'

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function make(t) {
  const storeDir = tempDir(t, 'dsh-bot-fs-home-')
  const workspaceDir = tempDir(t, 'dsh-bot-fs-ws-')
  const projectDir = tempDir(t, 'dsh-bot-fs-proj-')
  const groupDir = tempDir(t, 'dsh-bot-fs-group-')
  const outsideDir = tempDir(t, 'dsh-bot-fs-out-')

  const session = { header: { cwd: projectDir } }
  const workspace = { id: 'ws-1', title: 'Workspace', path: workspaceDir }
  const ctx = {
    logger: { warn() {}, error() {} },
    sessions: {
      get(sessionId) {
        return sessionId === 'session-1' ? session : undefined
      },
    },
    get(key) {
      if (key !== 'workspaceRegistry') return undefined
      return {
        list: () => [workspace],
        get: (id) => (id === 'ws-1' ? workspace : undefined),
        async resolveByPath() {
          return workspace
        },
        async create() {
          return workspace
        },
      }
    },
  }
  const store = createStore(ctx, { dir: storeDir })
  const services = createServices({ ctx, store })
  const browser = createFsBrowser({ ctx, services, store })
  t.after(() => store.close())

  const bot = await services.bots.create({ name: 'Alice', workspaceId: 'ws-1' })
  const chat = services.chats.findDm(bot.id)
  await services.chats.setSession(chat.id, bot.id, { sessionId: 'session-1' })
  const group = await services.groups.create({ name: 'Group', memberIds: [bot.id], workspaces: [groupDir] })
  const groupChat = services.chats.findGroupChat(group.id)

  return {
    storeDir,
    workspaceDir,
    projectDir,
    groupDir,
    outsideDir,
    services,
    browser,
    chat,
    groupChat,
    canonical: (path) => realpathSync(path),
  }
}

function seedWorkspace(harness) {
  mkdirSync(join(harness.workspaceDir, 'sub'), { recursive: true })
  writeFileSync(join(harness.workspaceDir, 'sub', 'inner.txt'), 'inside')
  writeFileSync(join(harness.workspaceDir, 'a.txt'), 'alpha')
  writeFileSync(join(harness.workspaceDir, 'b.txt'), 'beta')
  writeFileSync(join(harness.workspaceDir, 'big.txt'), 'x'.repeat(FS_TEXT_MAX_BYTES + 1))
  writeFileSync(join(harness.workspaceDir, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(join(harness.workspaceDir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))
  writeFileSync(join(harness.outsideDir, 'secret.txt'), 'secret')
  symlinkSync(join(harness.outsideDir, 'secret.txt'), join(harness.workspaceDir, 'escape.txt'))
}

test('fs roots: a private chat exposes the bot workspace, the session cwd and the plugin workspace', async (t) => {
  const harness = await make(t)
  const roots = harness.browser.rootsFor(harness.chat.id)
  assert.deepEqual(roots.map(root => root.path), [
    harness.canonical(harness.workspaceDir),
    harness.canonical(harness.projectDir),
    harness.canonical(join(harness.storeDir, 'workspace')),
  ])
  assert.equal(roots[0].title, 'workspace')
  // A group exposes its project directories only.
  const groupRoots = harness.browser.rootsFor(harness.groupChat.id)
  assert.deepEqual(groupRoots.map(root => root.path), [harness.canonical(harness.groupDir)])
  assert.throws(() => harness.browser.rootsFor('chat_nope'), (error) => error.code === 'chat-not-found')
})

test('fs list: directories first, names sorted, absolute and relative paths', async (t) => {
  const harness = await make(t)
  seedWorkspace(harness)
  const listed = harness.browser.list({ chatId: harness.chat.id, path: harness.workspaceDir })
  assert.equal(listed.path, harness.canonical(harness.workspaceDir))
  assert.deepEqual(listed.entries.map(entry => entry.name), ['sub', 'a.txt', 'b.txt', 'big.txt', 'bin.dat', 'pic.png'])
  assert.equal(listed.entries[0].type, 'dir')
  assert.equal(listed.entries[1].type, 'file')
  assert.equal(listed.entries.find(entry => entry.name === 'a.txt').size, 5)
  // The escaping symlink is filtered out of the listing.
  assert.equal(listed.entries.some(entry => entry.name === 'escape.txt'), false)
  // A relative path resolves against the chat's primary root.
  const relative = harness.browser.list({ chatId: harness.chat.id, path: 'sub' })
  assert.deepEqual(relative.entries.map(entry => entry.name), ['inner.txt'])
  // An empty path lists the primary root.
  const primary = harness.browser.list({ chatId: harness.chat.id, path: '' })
  assert.equal(primary.path, harness.canonical(harness.workspaceDir))
})

test('fs read: text is returned, binary and oversized files are refused', async (t) => {
  const harness = await make(t)
  seedWorkspace(harness)
  const file = harness.browser.read({ chatId: harness.chat.id, path: join(harness.workspaceDir, 'a.txt') })
  assert.equal(file.text, 'alpha')
  assert.equal(file.mime, 'text/plain')
  assert.equal(file.size, 5)
  assert.equal(file.path, harness.canonical(join(harness.workspaceDir, 'a.txt')))
  assert.throws(
    () => harness.browser.read({ chatId: harness.chat.id, path: 'bin.dat' }),
    (error) => error instanceof BotError && error.code === 'unsupported',
  )
  assert.throws(
    () => harness.browser.read({ chatId: harness.chat.id, path: 'big.txt' }),
    (error) => error.code === 'body-too-large',
  )
  assert.throws(
    () => harness.browser.read({ chatId: harness.chat.id, path: 'nope.txt' }),
    (error) => error.code === 'not-found',
  )
})

test('fs security: paths outside the roots and escaping symlinks are forbidden', async (t) => {
  const harness = await make(t)
  seedWorkspace(harness)
  assert.throws(
    () => harness.browser.read({ chatId: harness.chat.id, path: '/etc/passwd' }),
    (error) => error.code === 'forbidden',
  )
  assert.throws(
    () => harness.browser.list({ chatId: harness.chat.id, path: harness.outsideDir }),
    (error) => error.code === 'forbidden',
  )
  // A symlink inside a root that points outside it is refused after realpath.
  assert.throws(
    () => harness.browser.read({ chatId: harness.chat.id, path: join(harness.workspaceDir, 'escape.txt') }),
    (error) => error.code === 'forbidden',
  )
  // Traversal spelling is normalized before the check.
  assert.throws(
    () => harness.browser.read({ chatId: harness.chat.id, path: '../outside' }),
    (error) => error.code === 'forbidden' || error.code === 'not-found',
  )
})

test('fs raw: file facts carry the mime type and image flag', async (t) => {
  const harness = await make(t)
  seedWorkspace(harness)
  const image = harness.browser.raw({ chatId: harness.chat.id, path: 'pic.png' })
  assert.equal(image.mime, 'image/png')
  assert.equal(image.image, true)
  assert.equal(image.size, 8)
  const text = harness.browser.raw({ chatId: harness.chat.id, path: 'a.txt' })
  assert.equal(text.mime, 'text/plain')
  assert.equal(text.image, false)
  assert.throws(() => harness.browser.raw({ chatId: harness.chat.id, path: '/etc/passwd' }), (error) => error.code === 'forbidden')
})

test('fs roots: a conversation without any live directory has nothing to browse', async (t) => {
  const harness = await make(t)
  const groupChat = { ...harness.groupChat }
  // A group whose project directory disappeared yields no roots, and browsing
  // refuses with a stable code instead of a crash.
  harness.services.groups.get(harness.groupChat.groupId).workspaces = []
  rmSync(harness.groupDir, { recursive: true, force: true })
  assert.deepEqual(harness.browser.rootsFor(groupChat.id), [])
  assert.throws(() => harness.browser.list({ chatId: groupChat.id }), (error) => error.code === 'workspace-unavailable')
})
