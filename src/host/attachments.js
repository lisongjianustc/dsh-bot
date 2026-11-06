/**
 * Attachment storage: one content-addressed file per upload, one ledger entry
 * per attachment.
 *
 * Files live under `$DSH_HOME/dsh-bot/uploads/<sha1-prefix>-<safe name>`. The
 * same bytes uploaded twice are one file and one id, so a message that repeats
 * an attachment never grows the directory. The ledger keeps the display name,
 * mime, size and absolute path, which is what the Bot needs: the prompt carries
 * the absolute path, and the model can open it with read/bash/read_image.
 *
 * Serving is by id only, and the resolved path must stay inside the uploads
 * directory — a ledger entry can never be made to read another file.
 *
 * @module @lisongjianustc/dsh-bot/host/attachments
 */
import { closeSync, createReadStream, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import { BotError, describeError } from './errors.js'
import { clip, sha1 } from './util.js'

/** The largest upload this Host accepts, in bytes. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
/** How many attachments the ledger keeps; the oldest files stay on disk. */
export const ATTACHMENT_LEDGER_MAX = 500
/** How many attachments one message may carry. */
export const MAX_MESSAGE_ATTACHMENTS = 8
/** How long one display name may be. */
export const ATTACHMENT_NAME_MAX = 120

/** Mime types the extension map knows. */
const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/**
 * Whether a mime type is an image the panel renders inline.
 * @param {string} mime - the mime type.
 * @returns {boolean} true for image/*.
 */
export function isImageMime(mime) {
  return typeof mime === 'string' && mime.toLowerCase().startsWith('image/')
}

/**
 * Infer the mime type of an upload from its declared type and its name.
 * @param {string} name - the original file name.
 * @param {string | undefined} declared - the request's content-type.
 * @returns {string} the mime type.
 */
export function inferMime(name, declared) {
  const type = String(declared ?? '').split(';')[0].trim().toLowerCase()
  if (type !== '' && type !== 'application/octet-stream') return type
  const extension = extname(String(name ?? '')).toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

/**
 * Clean one upload's display name: no directory part, no leading dots, no
 * control characters — the name is display metadata and part of the file name.
 * @param {unknown} raw - the requested name.
 * @returns {string} the safe name.
 */
export function safeName(raw) {
  const base = basename(String(raw ?? '').replace(/\\/g, '/'))
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const clipped = clip(cleaned, ATTACHMENT_NAME_MAX)
  return clipped === '' ? 'file' : clipped
}

/**
 * Create the attachment store.
 * @param {{ store: object }} input - the store.
 * @returns {object} the attachment API.
 */
export function createAttachments({ store }) {
  const db = store.db
  const uploadsDir = store.uploadsDir

  /** The client-facing view of one stored attachment. */
  const view = (record) => ({
    id: record.id,
    name: record.name,
    size: record.size,
    mime: record.mime,
    url: `dsh-bot/api/media?id=${record.id}`,
  })

  /** Write one file atomically: tmp + fsync + rename. */
  const writeAtomic = (path, bytes) => {
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    let fd
    try {
      fd = openSync(tmp, 'w')
      writeSync(fd, bytes)
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      renameSync(tmp, path)
    } catch (error) {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          /* the original failure is the one worth reporting */
        }
      }
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        /* best effort */
      }
      throw error
    }
  }

  /** Reading the durable bytes of one file (dedupe comparison). */
  const readStored = (path) => readFileSync(path)

  /**
   * Store one upload. The same bytes always resolve to the same attachment id.
   * @param {Buffer} bytes - the raw bytes.
   * @param {{ name?: string, mime?: string }} [meta] - display name and declared mime.
   * @returns {{ attachment: object, created: boolean }} the view and whether it is new.
   */
  const put = async (bytes, meta = {}) => {
    if (!Buffer.isBuffer(bytes)) throw new BotError('invalid-request', 'an upload must be raw bytes')
    if (bytes.length === 0) throw new BotError('invalid-request', 'the uploaded file is empty')
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new BotError('body-too-large', `the uploaded file exceeds ${MAX_UPLOAD_BYTES} bytes`)
    }
    const name = safeName(meta.name)
    const mime = inferMime(name, meta.mime)
    const digest = sha1(bytes)
    let id = digest.slice(0, 12)
    // Content addressing: an id already taken by different bytes grows until free.
    for (let length = 12; db.attachments[id] !== undefined; length += 4) {
      const existing = db.attachments[id]
      if (existing.sha1 === digest) {
        return { attachment: view(existing), created: false }
      }
      if (length + 4 > digest.length) {
        // Practically impossible; fall back to the full digest as the id.
        id = digest
        break
      }
      id = digest.slice(0, length + 4)
    }
    const fileName = `${id}-${name}`
    const path = join(uploadsDir, fileName)
    if (existsSync(path)) {
      // Same file name but different bytes can only mean an earlier id collision.
      try {
        if (sha1(readStored(path)) === digest) {
          const record = { id, name, size: bytes.length, mime, sha1: digest, path, createdAt: Date.now() }
          db.attachments[id] = record
          await store.save()
          return { attachment: view(record), created: false }
        }
      } catch {
        /* fall through to a fresh write */
      }
    }
    try {
      writeAtomic(path, bytes)
    } catch (error) {
      throw new BotError('internal', `the upload could not be stored: ${describeError(error)}`, { cause: error })
    }
    const record = {
      id,
      name,
      size: bytes.length,
      mime,
      sha1: digest,
      path,
      createdAt: Date.now(),
    }
    db.attachments[id] = record
    prune()
    await store.save()
    return { attachment: view(record), created: true }
  }

  /** Keep the ledger bounded; the files themselves are content-addressed. */
  const prune = () => {
    const records = Object.values(db.attachments)
    if (records.length <= ATTACHMENT_LEDGER_MAX) return
    records
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .slice(0, records.length - ATTACHMENT_LEDGER_MAX)
      .forEach(record => { delete db.attachments[record.id] })
  }

  /** One ledger record, if the id is known. */
  const get = (id) => {
    if (typeof id !== 'string' || id === '') return undefined
    return db.attachments[id]
  }

  /** The ledger record or a stable refusal. */
  const require = (id) => {
    const record = get(id)
    if (record === undefined) throw new BotError('invalid-request', `no attachment has the id "${String(id ?? '')}"`)
    return record
  }

  /** Resolve one record's path, refusing anything outside the uploads directory. */
  const resolveSafePath = (record) => {
    const uploadsRoot = resolve(uploadsDir) + sep
    const path = resolve(String(record.path ?? ''))
    if (!path.startsWith(uploadsRoot)) {
      throw new BotError('invalid-request', 'an attachment path may only point inside the uploads directory')
    }
    if (!existsSync(path)) throw new BotError('invalid-request', `the stored file of attachment "${record.id}" is gone`)
    return path
  }

  /** The text manifest appended to a Bot prompt: absolute paths the model can open. */
  const manifestFor = (ids) => {
    const list = Array.isArray(ids) ? ids : []
    if (list.length === 0) return ''
    const lines = list.flatMap((id) => {
      const record = typeof id === 'string' ? get(id) : (id !== null && typeof id === 'object' && typeof id.id === 'string' ? get(id.id) : undefined)
      if (record === undefined) return []
      return [`- path: ${resolveSafePath(record)} ; name: ${record.name} ; mime: ${record.mime} ; size: ${record.size}`]
    })
    if (lines.length === 0) return ''
    return ['[attachments]', ...lines].join('\n')
  }

  /** The view of every id, refusing an unknown one. */
  const viewsOf = (ids) => {
    const list = Array.isArray(ids) ? ids : []
    if (list.length > MAX_MESSAGE_ATTACHMENTS) {
      throw new BotError('invalid-request', `one message carries at most ${MAX_MESSAGE_ATTACHMENTS} attachments`)
    }
    return list.map(id => view(require(id)))
  }

  /** The message parts an attachment list contributes, in order. */
  const partsOf = (views) => views.map(attachment => (isImageMime(attachment.mime)
    ? { type: 'image', attachment }
    : { type: 'file', attachment }))

  /** Stream one stored file to an HTTP response. */
  const send = (res, id) => {
    const record = require(id)
    const path = resolveSafePath(record)
    const stat = statSync(path)
    res.writeHead(200, {
      'content-type': record.mime || 'application/octet-stream',
      'content-length': String(stat.size),
      'content-disposition': `${isImageMime(record.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(record.name)}`,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    })
    createReadStream(path).pipe(res)
  }

  return {
    put,
    get,
    require,
    view,
    viewsOf,
    partsOf,
    manifestFor,
    resolveSafePath,
    send,
    /** Absolute path of one attachment, for tests and diagnostics. */
    pathOf: (id) => resolveSafePath(require(id)),
  }
}
