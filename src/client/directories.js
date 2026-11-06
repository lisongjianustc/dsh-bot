/**
 * Pure helpers for a group's project directories.
 *
 * The group form keeps an ordered list whose first entry is the main directory.
 * Everything here is side-effect free and framework free so the same rules can
 * be reasoned about (and smoke-tested) without mounting the drawer.
 */

'use strict'

/** Last path segment, used as a readable title when none is supplied. */
function basename(value) {
  if (typeof value !== 'string') return ''
  var path = value.trim()
  if (path === '') return ''
  path = path.replace(/[\\/]+$/, '')
  if (path === '') return value.trim()
  var parts = path.split(/[\\/]/)
  return parts[parts.length - 1] === '' ? path : parts[parts.length - 1]
}

/** Both lookup keys of one entry; a directory is a duplicate if either hits. */
function entryKeys(entry) {
  var keys = []
  if (typeof entry.id === 'string' && entry.id !== '') keys.push('id:' + entry.id)
  if (typeof entry.path === 'string' && entry.path !== '') keys.push('path:' + entry.path)
  return keys
}

/** Normalize one raw entry (string path or `{id?,title,path?}`). */
function normalizeEntry(raw) {
  if (typeof raw === 'string') {
    var pathValue = raw.trim()
    if (pathValue === '') return null
    return { title: basename(pathValue) || pathValue, path: pathValue }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  var id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined
  var path = typeof raw.path === 'string' && raw.path !== '' ? raw.path : undefined
  if (id === undefined && path === undefined) return null
  var title = typeof raw.title === 'string' && raw.title !== '' ? raw.title : ''
  if (title === '') title = basename(path) || id || ''
  var entry = { title: title }
  if (id !== undefined) entry.id = id
  if (path !== undefined) entry.path = path
  return entry
}

/** Normalize a `Group.workspaces` value into an ordered, deduplicated list. */
function normalize(value) {
  var list = []
  if (!Array.isArray(value)) return list
  var seen = Object.create(null)
  for (var i = 0; i < value.length; i += 1) {
    var entry = normalizeEntry(value[i])
    if (entry === null) continue
    var keys = entryKeys(entry)
    var duplicate = false
    for (var k = 0; k < keys.length; k += 1) {
      if (seen[keys[k]] === true) duplicate = true
    }
    if (duplicate) continue
    for (var s = 0; s < keys.length; s += 1) seen[keys[s]] = true
    list.push(entry)
  }
  return list
}

/** True when both lists describe the same directories in the same order. */
function sameEntries(left, right) {
  var a = Array.isArray(left) ? left : []
  var b = Array.isArray(right) ? right : []
  if (a.length !== b.length) return false
  for (var i = 0; i < a.length; i += 1) {
    var leftKeys = entryKeys(a[i]).join('|')
    var rightKeys = entryKeys(b[i]).join('|')
    if (leftKeys !== rightKeys) return false
  }
  return true
}

/** Whether the candidate is already in the list (either id or path matches). */
function contains(list, candidate) {
  var keys = entryKeys(candidate)
  for (var i = 0; i < list.length; i += 1) {
    var existing = entryKeys(list[i])
    for (var k = 0; k < keys.length; k += 1) {
      if (existing.indexOf(keys[k]) >= 0) return true
    }
  }
  return false
}

/** Add one DSH workspace (`{id,title,path?}`) unless it is already listed. */
function addWorkspace(list, workspace) {
  var entry = normalizeEntry(workspace)
  if (entry === null) return { entries: list, added: false }
  if (contains(list, entry)) return { entries: list, added: false }
  return { entries: list.concat([entry]), added: true }
}

/** Add one absolute path picked from disk unless it is already listed. */
function addPath(list, value) {
  var entry = normalizeEntry(typeof value === 'string' ? value : String(value === undefined ? '' : value))
  if (entry === null) return { entries: list, added: false }
  if (contains(list, entry)) return { entries: list, added: false }
  return { entries: list.concat([entry]), added: true }
}

/** Remove the entry at `index`; out-of-range indexes leave the list alone. */
function removeAt(list, index) {
  if (!Array.isArray(list) || index < 0 || index >= list.length) return list
  var next = list.slice()
  next.splice(index, 1)
  return next
}

/** Move the entry at `index` to the front (it becomes the main directory). */
function promote(list, index) {
  if (!Array.isArray(list) || index <= 0 || index >= list.length) return list
  var next = list.slice()
  var moved = next.splice(index, 1)[0]
  next.unshift(moved)
  return next
}

/** The strings the Host accepts: workspace ids when known, paths otherwise. */
function payloadOf(list) {
  var result = []
  if (!Array.isArray(list)) return result
  for (var i = 0; i < list.length; i += 1) {
    var entry = list[i]
    if (entry === null || entry === undefined) continue
    var value = typeof entry.id === 'string' && entry.id !== '' ? entry.id : entry.path
    if (typeof value === 'string' && value !== '' && result.indexOf(value) < 0) result.push(value)
  }
  return result
}

/**
 * Run the shell's directory picker and append the picked path.
 *
 * A missing picker, a rejected promise, `undefined`/empty results and user
 * cancels all resolve to the unchanged list (the caller stays silent).
 * @returns {Promise<{entries: object[], added: boolean}>} the next list.
 */
function pickDirectoryEntries(list, picker) {
  if (typeof picker !== 'function') return Promise.resolve({ entries: list, added: false })
  var picked
  try {
    picked = picker()
  } catch (error) {
    return Promise.resolve({ entries: list, added: false })
  }
  return Promise.resolve(picked).then(
    function (value) {
      if (typeof value !== 'string' || value.trim() === '') return { entries: list, added: false }
      return addPath(list, value.trim())
    },
    function () {
      return { entries: list, added: false }
    },
  )
}

/** Merge the chosen directories into a create/update group payload. */
function applyToPayload(payload, entries) {
  var next = payload === null || typeof payload !== 'object' ? {} : payload
  next.workspaces = payloadOf(entries)
  return next
}

/**
 * The top-level `resetSessions` value the Host expects beside `group`.
 *
 * `undefined` means "not provided" (the list did not change); otherwise the
 * checkbox decides, so an unchecked box can explicitly ask for no reset.
 */
function resetFlag(initialEntries, entries, resetChecked) {
  if (sameEntries(initialEntries, entries)) return undefined
  return resetChecked === true
}

/** Readable label of the main directory. */
function summaryTitle(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return ''
  var first = entries[0]
  if (first === null || first === undefined) return ''
  if (typeof first.title === 'string' && first.title !== '') return first.title
  return basename(first.path) || (typeof first.id === 'string' ? first.id : '')
}

/** Card summary such as `📁 game/ · 2 个目录`; empty when nothing is set. */
function summaryText(entries, t) {
  var title = summaryTitle(entries)
  if (title === '') return ''
  var text = '📁 ' + title
  if (entries.length > 1 && typeof t === 'function') text += ' · ' + t('groups.dirCount', { count: String(entries.length) })
  return text
}

module.exports = {
  basename: basename,
  normalize: normalize,
  sameEntries: sameEntries,
  addWorkspace: addWorkspace,
  addPath: addPath,
  removeAt: removeAt,
  promote: promote,
  payloadOf: payloadOf,
  pickDirectoryEntries: pickDirectoryEntries,
  applyToPayload: applyToPayload,
  resetFlag: resetFlag,
  summaryTitle: summaryTitle,
  summaryText: summaryText,
}
