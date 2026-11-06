/**
 * Right-hand file browser: roots, directories and a preview pane.
 *
 * The Host keeps the filesystem authority: this module only composes the four
 * read-only `/fs/*` routes (`roots`, `list`, `read`, `raw`) and never touches a
 * path itself beyond display arithmetic. Chat messages open it through
 * `store.openFile(path)`; relative references are resolved by the Host against
 * the chat's main directory.
 */

'use strict'

var React = require('react')
var ui = require('./ui.js')
var transport = require('./transport.js')
var markdown = require('./markdown.js')

var h = ui.h
var Icon = ui.Icon

var TEXT_PREVIEW_MAX_LINES = 2000

/** Directory part of a POSIX-ish path (no trailing slash). */
function dirname(path) {
  var value = String(path === undefined || path === null ? '' : path)
  var trimmed = value.replace(/\/+$/, '')
  var index = trimmed.lastIndexOf('/')
  if (index < 0) return ''
  if (index === 0) return '/'
  return trimmed.slice(0, index)
}

/** Last path segment. */
function basename(path) {
  var value = String(path === undefined || path === null ? '' : path).replace(/\/+$/, '')
  var index = value.lastIndexOf('/')
  return index < 0 ? value : value.slice(index + 1)
}

/** Human-readable byte size. */
function formatSize(value) {
  var bytes = typeof value === 'number' && isFinite(value) ? value : 0
  if (bytes < 1024) return bytes + ' B'
  var kb = bytes / 1024
  if (kb < 1024) return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB'
  var mb = kb / 1024
  return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB'
}

function extensionOf(name) {
  var value = String(name === undefined || name === null ? '' : name)
  var index = value.lastIndexOf('.')
  if (index < 0) return ''
  return value.slice(index + 1).toLowerCase()
}

var IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']
var TEXT_EXTENSIONS = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  json: 'text',
  yml: 'text',
  yaml: 'text',
  toml: 'text',
  xml: 'text',
  html: 'text',
  css: 'text',
  js: 'text',
  mjs: 'text',
  cjs: 'text',
  ts: 'text',
  tsx: 'text',
  jsx: 'text',
  py: 'text',
  rb: 'text',
  go: 'text',
  rs: 'text',
  java: 'text',
  c: 'text',
  h: 'text',
  cpp: 'text',
  hpp: 'text',
  cs: 'text',
  sql: 'text',
  gd: 'text',
  sh: 'text',
  zsh: 'text',
  bash: 'text',
  yaml: 'text',
  ini: 'text',
  cfg: 'text',
  conf: 'text',
  env: 'text',
  gitignore: 'text',
  csv: 'text',
  tsv: 'text',
  patch: 'text',
  diff: 'text',
}

/** Whether a file name should be previewed as an image. */
function isImagePath(path) {
  return IMAGE_EXTENSIONS.indexOf(extensionOf(path)) >= 0
}

/** Whether a file name should be rendered as Markdown. */
function isMarkdownPath(path) {
  var extension = extensionOf(path)
  return extension === 'md' || extension === 'markdown'
}

/** Coarse kind of one entry, for icons and preview routing. */
function fileKind(name, type) {
  if (type === 'dir') return 'dir'
  if (isImagePath(name)) return 'image'
  if (isMarkdownPath(name)) return 'markdown'
  var extension = extensionOf(name)
  if (TEXT_EXTENSIONS[extension] !== undefined) return 'text'
  return 'binary'
}

/** Directories first, then files, both alphabetically. */
function sortEntries(entries) {
  var list = Array.isArray(entries) ? entries.slice() : []
  list.sort(function (left, right) {
    var leftDir = left !== null && left !== undefined && left.type === 'dir'
    var rightDir = right !== null && right !== undefined && right.type === 'dir'
    if (leftDir !== rightDir) return leftDir ? -1 : 1
    var a = String(left !== null && left !== undefined && left.name !== undefined ? left.name : '')
    var b = String(right !== null && right !== undefined && right.name !== undefined ? right.name : '')
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  })
  return list
}

/** Breadcrumb items for the current directory inside one root. */
function breadcrumbOf(rootPath, currentPath, rootTitle) {
  var root = String(rootPath === undefined || rootPath === null ? '' : rootPath).replace(/\/+$/, '')
  var current = String(currentPath === undefined || currentPath === null ? '' : currentPath).replace(/\/+$/, '')
  var items = []
  if (root === '') return items
  items.push({ label: rootTitle === undefined || rootTitle === '' ? basename(root) || root : rootTitle, path: root })
  if (current === '' || current === root) return items
  if (current.indexOf(root + '/') !== 0) {
    items.push({ label: current, path: current })
    return items
  }
  var rest = current.slice(root.length + 1).split('/')
  var accumulated = root
  for (var i = 0; i < rest.length; i += 1) {
    if (rest[i] === '') continue
    accumulated += '/' + rest[i]
    items.push({ label: rest[i], path: accumulated })
  }
  return items
}

/** Readable copy for one filesystem failure. */
function fsErrorText(t, failure) {
  if (failure === null || failure === undefined) return t('files.error')
  var status = failure.status
  if (failure.failure === 'forbidden' || status === 403) return t('files.forbidden')
  if (failure.failure === 'not-mounted' || status === 404) return t('files.notFound')
  if (failure.code === 'unsupported' || status === 415) return t('files.unsupported')
  if (failure.code === 'workspace-unavailable') return t('files.noRoots')
  return transport.describeError(t, failure)
}

function entryIcon(kind, size) {
  if (kind === 'dir') return h(Icon, { name: 'folder', size: size })
  if (kind === 'image') return h(Icon, { name: 'image', size: size })
  if (kind === 'markdown' || kind === 'text') return h(Icon, { name: 'file', size: size })
  return h(Icon, { name: 'file', size: size })
}

/** One preview pane body. */
function PreviewBody(props) {
  var t = props.t
  var store = props.store
  var preview = props.preview
  if (preview === null || preview === undefined) return h('div', { className: 'db-file-empty' }, t('files.pickPreview'))

  if (preview.kind === 'loading') return h('div', { className: 'db-file-loading' }, h('span', { className: 'db-spinner' }), t('files.loading'))
  if (preview.kind === 'error') {
    return h(
      'div',
      { className: 'db-file-error' },
      h(Icon, { name: 'alert', size: 13 }),
      h('span', null, preview.message === undefined ? t('files.error') : preview.message),
    )
  }
  if (preview.kind === 'image') {
    return h(
      'div',
      { className: 'db-file-image' },
      h('img', { src: preview.url, alt: preview.name === undefined ? '' : preview.name, loading: 'lazy' }),
      h('div', { className: 'db-file-caption' }, preview.name === undefined ? basename(preview.path) : preview.name),
    )
  }
  if (preview.kind === 'binary') {
    return h(
      'div',
      { className: 'db-file-binary' },
      h(Icon, { name: 'file', size: 18 }),
      h('div', { className: 'db-file-binary-text' }, t('files.unsupported')),
      h(
        'a',
        {
          className: 'db-md-link',
          href: preview.url === undefined ? store.fsRawUrl(props.chatId, preview.path) : preview.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          download: basename(preview.path),
        },
        t('files.download'),
      ),
    )
  }
  var text = String(preview.text === undefined || preview.text === null ? '' : preview.text)
  var head = h(
    'div',
    { className: 'db-file-preview-head' },
    h('span', { className: 'db-file-preview-name', title: preview.path }, basename(preview.path)),
    h('span', { className: 'db-file-preview-meta' }, preview.size === undefined ? '' : formatSize(preview.size)),
    h(ui.IconButton, {
      icon: 'copy',
      size: 11,
      label: t('files.copy'),
      title: t('files.copy'),
      onClick: function () {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) navigator.clipboard.writeText(text)
        } catch (error) {
          /* clipboard unavailable: the text stays selectable */
        }
      },
    }),
  )
  if (preview.kind === 'markdown') {
    return h(
      'div',
      { className: 'db-file-preview' },
      head,
      h(
        'div',
        { className: 'db-file-md' },
        markdown.render(text, undefined, {
          fileLink: function (target) {
            store.openFile(target)
          },
        }),
      ),
    )
  }
  var lines = text.split('\n')
  var truncated = false
  if (lines.length > TEXT_PREVIEW_MAX_LINES) {
    lines = lines.slice(0, TEXT_PREVIEW_MAX_LINES)
    truncated = true
  }
  var rows = []
  for (var i = 0; i < lines.length; i += 1) {
    rows.push(
      h(
        'div',
        { key: 'line-' + i, className: 'db-file-line' },
        h('span', { className: 'db-file-line-no', 'aria-hidden': 'true' }, String(i + 1)),
        h('span', { className: 'db-file-line-text' }, lines[i] === '' ? ' ' : lines[i]),
      ),
    )
  }
  return h(
    'div',
    { className: 'db-file-preview' },
    head,
    h('div', { className: 'db-file-code' }, rows),
    truncated ? h('div', { className: 'db-file-truncated' }, t('files.truncated', { max: String(TEXT_PREVIEW_MAX_LINES) })) : null,
  )
}

/**
 * The file browser itself.
 *
 * `props.initial` lets the smoke test seed a fully-loaded state; production
 * call sites never pass it and the component loads through the Host.
 */
function FilePanel(props) {
  var t = props.t
  var store = props.store
  var initial = props.initial === undefined || props.initial === null ? {} : props.initial
  var chatId = store.selectedChatId === undefined || store.selectedChatId === null ? '' : String(store.selectedChatId)
  var requestPath = store.fileRequest === null || store.fileRequest === undefined ? '' : String(store.fileRequest.path === undefined ? '' : store.fileRequest.path)

  var pairRoots = React.useState(Array.isArray(initial.roots) ? initial.roots : [])
  var roots = pairRoots[0]
  var setRoots = pairRoots[1]
  var pairRoot = React.useState(initial.rootPath === undefined ? '' : initial.rootPath)
  var rootPath = pairRoot[0]
  var setRootPath = pairRoot[1]
  var pairRootTitle = React.useState(initial.rootTitle === undefined ? '' : initial.rootTitle)
  var rootTitle = pairRootTitle[0]
  var setRootTitle = pairRootTitle[1]
  var pairListing = React.useState(initial.listing === true)
  var listing = pairListing[0]
  var setListing = pairListing[1]
  var pairPath = React.useState(initial.currentPath === undefined ? '' : initial.currentPath)
  var currentPath = pairPath[0]
  var setCurrentPath = pairPath[1]
  var pairEntries = React.useState(Array.isArray(initial.entries) ? initial.entries : [])
  var entries = pairEntries[0]
  var setEntries = pairEntries[1]
  var pairPreview = React.useState(initial.preview === undefined ? null : initial.preview)
  var preview = pairPreview[0]
  var setPreview = pairPreview[1]
  var pairError = React.useState(initial.error === undefined ? '' : initial.error)
  var error = pairError[0]
  var setError = pairError[1]
  var pairRootsError = React.useState(initial.rootsError === undefined ? '' : initial.rootsError)
  var rootsError = pairRootsError[0]
  var setRootsError = pairRootsError[1]

  function resolveChat() {
    return store.selectedChatId === undefined || store.selectedChatId === null ? '' : String(store.selectedChatId)
  }

  function showDir(path, keepPreview) {
    var id = resolveChat()
    setListing(true)
    setError('')
    store.fsList(id, path).then(
      function (body) {
        setListing(false)
        var resolved = body !== null && typeof body === 'object' && typeof body.path === 'string' ? body.path : path
        setCurrentPath(resolved)
        setEntries(sortEntries(body !== null && typeof body === 'object' && Array.isArray(body.entries) ? body.entries : []))
        if (keepPreview !== true) setPreview(null)
      },
      function (failure) {
        setListing(false)
        setError(fsErrorText(t, failure))
        setEntries([])
      },
    )
  }

  function showPreview(path) {
    var id = resolveChat()
    if (isImagePath(path)) {
      setPreview({ kind: 'image', path: path, name: basename(path), url: store.fsRawUrl(id, path) })
      return
    }
    setPreview({ kind: 'loading', path: path })
    store.fsRead(id, path).then(
      function (body) {
        var mime = body !== null && typeof body === 'object' && typeof body.mime === 'string' ? body.mime : ''
        var text = body !== null && typeof body === 'object' && typeof body.text === 'string' ? body.text : ''
        var size = body !== null && typeof body === 'object' && typeof body.size === 'number' ? body.size : undefined
        var kind = isMarkdownPath(path) || mime.indexOf('markdown') >= 0 ? 'markdown' : 'text'
        setPreview({ kind: kind, path: path, text: text, size: size, mime: mime })
      },
      function (failure) {
        if (failure !== null && failure !== undefined && (failure.code === 'unsupported' || failure.status === 415)) {
          setPreview({ kind: 'binary', path: path, name: basename(path), url: store.fsRawUrl(id, path) })
        } else {
          setPreview({ kind: 'error', path: path, message: fsErrorText(t, failure) })
        }
      },
    )
  }

  function openTarget(target) {
    var id = resolveChat()
    // A chain that names a file goes straight to its preview; listing first
    // would make a file path look like an empty directory on hosts that answer
    // `list` leniently.
    if (/\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(basename(target))) {
      var dir = dirname(target)
      setCurrentPath(dir === '' ? rootPath : dir)
      showDir(dir === '' ? rootPath : dir, true)
      showPreview(target)
      return
    }
    store.fsList(id, target).then(
      function (body) {
        var resolved = body !== null && typeof body === 'object' && typeof body.path === 'string' ? body.path : target
        var currentRoot = rootPath === '' ? resolved : rootPath
        setRootPath(currentRoot)
        setCurrentPath(resolved)
        setEntries(sortEntries(body !== null && typeof body === 'object' && Array.isArray(body.entries) ? body.entries : []))
        setPreview(null)
        setError('')
      },
      function () {
        var dir = dirname(target)
        showDir(dir, true)
        showPreview(target)
      },
    )
  }

  function start(request) {
    var id = resolveChat()
    setRootsError('')
    setError('')
    setPreview(null)
    store.fsRoots(id).then(
      function (body) {
        var list = body !== null && typeof body === 'object' && Array.isArray(body.roots) ? body.roots : []
        setRoots(list)
        var first = list.length > 0 ? list[0] : null
        var dir = first !== null && typeof first.path === 'string' ? first.path : ''
        setRootPath(dir)
        setRootTitle(first !== null && typeof first.title === 'string' ? first.title : '')
        if (request !== '') openTarget(request)
        else showDir(dir, false)
      },
      function (failure) {
        setRoots([])
        setRootsError(fsErrorText(t, failure))
      },
    )
  }

  // React to chat switches and to one-shot requests from chat links.
  var requestNonce = store.fileRequest === null || store.fileRequest === undefined ? 0 : store.fileRequest.nonce
  React.useEffect(
    function () {
      if (initial.roots !== undefined || initial.entries !== undefined) return
      start(requestPath)
    },
    [chatId, requestNonce],
  )

  React.useEffect(
    function () {
      function onKeyDown(event) {
        if (event.key === 'Escape' && store.fileOpen === true) store.closeFile()
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('keydown', onKeyDown)
        return function () {
          window.removeEventListener('keydown', onKeyDown)
        }
      }
      return undefined
    },
    [],
  )

  var crumbs = breadcrumbOf(rootPath, currentPath, rootTitle)
  var upPath = ''
  if (rootPath !== '' && currentPath !== '' && currentPath !== rootPath && currentPath.indexOf(rootPath + '/') === 0) {
    upPath = dirname(currentPath)
    if (upPath.length < rootPath.length) upPath = rootPath
  }

  var rootSelect = null
  if (roots.length > 0) {
    rootSelect = h(
      ui.Select,
      {
        value: rootPath,
        onChange: function (value) {
          setRootPath(value)
          for (var i = 0; i < roots.length; i += 1) if (roots[i].path === value) setRootTitle(roots[i].title)
          showDir(value, false)
        },
      },
      roots.map(function (root) {
        return h('option', { key: root.path, value: root.path }, String(root.title === undefined ? root.path : root.title))
      }),
    )
  }

  var rows = entries.map(function (entry) {
    var kind = fileKind(entry.name, entry.type)
    return h(
      'button',
      {
        key: entry.path === undefined ? String(entry.name) + ':' + String(entry.type) : String(entry.path),
        type: 'button',
        className: 'db-file-row is-' + kind,
        title: entry.path === undefined ? entry.name : entry.path,
        onClick: function () {
          if (kind === 'dir') showDir(entry.path, false)
          else showPreview(entry.path)
        },
      },
      h('span', { className: 'db-file-row-icon' }, entryIcon(kind, 14)),
      h('span', { className: 'db-file-row-name' }, String(entry.name === undefined ? '' : entry.name)),
      h('span', { className: 'db-file-row-meta' }, kind === 'dir' ? t('files.dir') : formatSize(entry.size)),
    )
  })

  var body
  if (rootsError !== '') {
    body = h('div', { className: 'db-file-error' }, h(Icon, { name: 'alert', size: 13 }), h('span', null, rootsError))
  } else if (roots.length === 0) {
    body = h('div', { className: 'db-file-empty' }, t('files.noRoots'))
  } else {
    body = h(
      'div',
      { className: 'db-file-body' },
      h(
        'div',
        { className: 'db-file-nav' },
        upPath === ''
          ? null
          : h(ui.IconButton, {
              icon: 'chevron-left',
              label: t('files.up'),
              title: t('files.up'),
              onClick: function () {
                showDir(upPath, false)
              },
            }),
        h(
          'div',
          { className: 'db-file-crumbs' },
          crumbs.map(function (crumb, index) {
            return h(
              'button',
              {
                key: 'crumb-' + index,
                type: 'button',
                className: 'db-file-crumb' + (index === crumbs.length - 1 ? ' is-current' : ''),
                onClick: function () {
                  showDir(crumb.path, false)
                },
              },
              crumb.label,
            )
          }),
        ),
      ),
      error === '' ? null : h('div', { className: 'db-file-error' }, h(Icon, { name: 'alert', size: 13 }), h('span', null, error)),
      h(
        'div',
        { className: 'db-file-list' },
        listing ? h('div', { className: 'db-file-loading' }, h('span', { className: 'db-spinner' }), t('files.loading')) : null,
        !listing && rows.length === 0 ? h('div', { className: 'db-file-empty' }, t('files.empty')) : null,
        rows,
      ),
      h(PreviewBody, { t: t, store: store, preview: preview, chatId: chatId }),
    )
  }

  return h(
    'aside',
    { className: 'db-files', 'aria-label': t('files.title') },
    h(
      'div',
      { className: 'db-files-head' },
      h(Icon, { name: 'folder', size: 14 }),
      h('span', { className: 'db-files-title' }, t('files.title')),
      roots.length > 0 ? h('div', { className: 'db-files-root' }, rootSelect) : null,
      h(ui.IconButton, { icon: 'x', label: t('files.close'), title: t('files.close'), onClick: function () { store.closeFile() } }),
    ),
    body,
  )
}

module.exports = {
  FilePanel: FilePanel,
  dirname: dirname,
  basename: basename,
  sortEntries: sortEntries,
  breadcrumbOf: breadcrumbOf,
  fileKind: fileKind,
  formatSize: formatSize,
  fsErrorText: fsErrorText,
  isImagePath: isImagePath,
  isMarkdownPath: isMarkdownPath,
}
