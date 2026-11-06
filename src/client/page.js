/**
 * The workspace page: a three-column, container-adaptive layout rendered
 * inside the shell's `main` panel.
 *
 * Left is the bot/chat roster with search and filters, center is the selected
 * conversation, right is a slim action rail that opens the settings drawer.
 * The layout collapses by container width (CSS container query): under 900px
 * the roster becomes an overlay drawer behind the header's menu button, and
 * under 640px the rail folds into the drawer tabs. Nothing here portals out of
 * the page container.
 */

'use strict'

var React = require('react')
var ui = require('./ui.js')
var chat = require('./chat.js')
var panels = require('./panels.js')
var transport = require('./transport.js')

var h = ui.h
var useStoreVersion = ui.useStoreVersion
var Icon = ui.Icon

/** Sort chats: pinned first, then most recently updated. */
function sortChats(a, b) {
  var aPinned = a !== null && a.pinned === true ? 1 : 0
  var bPinned = b !== null && b.pinned === true ? 1 : 0
  if (aPinned !== bPinned) return bPinned - aPinned
  return (b === null ? 0 : b.updatedAt || 0) - (a === null ? 0 : a.updatedAt || 0)
}

/** Apply the current filter and search query to the chat list. */
function filteredChats(store) {
  var all = store.chats()
  var filter = store.filter
  var query = typeof store.search === 'string' ? store.search.trim().toLowerCase() : ''
  var out = []
  for (var i = 0; i < all.length; i += 1) {
    var conversation = all[i]
    if (conversation === null || conversation === undefined) continue
    if (filter === 'dm' && conversation.kind !== 'dm') continue
    if (filter === 'group' && conversation.kind !== 'group') continue
    if (query !== '') {
      var title = store.chatTitle(conversation).toLowerCase()
      var haystack = title
      if (conversation.kind === 'dm') {
        var bot = store.botById(conversation.botId)
        if (bot !== undefined) haystack += ' ' + String(bot.role === undefined ? '' : bot.role).toLowerCase()
      } else {
        var group = store.groupById(conversation.groupId)
        if (group !== undefined) haystack += ' ' + String(group.notice === undefined ? '' : group.notice).toLowerCase()
      }
      if (haystack.indexOf(query) < 0) continue
    }
    out.push(conversation)
  }
  return out.sort(sortChats)
}

/** One row of the roster. */
function ChatRow(props) {
  var t = props.t
  var store = props.store
  var conversation = props.chat
  var selected = store.selectedChatId === conversation.id
  var bot = conversation.kind === 'dm' ? store.botById(conversation.botId) : undefined
  var group = conversation.kind === 'group' ? store.groupById(conversation.groupId) : undefined
  var running = store.runningOf(conversation.id)
  var title = store.chatTitle(conversation)
  var meta = ''
  if (conversation.kind === 'group') {
    var members = group === undefined || !Array.isArray(group.memberIds) ? 0 : group.memberIds.length
    meta = t('chat.memberCount', { count: String(members) })
  } else if (bot !== undefined) {
    meta = bot.role === '' || bot.role === undefined ? t('chat.dm') : bot.role
  }
  return h(
    'button',
    {
      type: 'button',
      className: 'db-chat' + (selected ? ' is-active' : '') + (conversation.pinned === true ? ' is-pinned' : ''),
      onClick: function () {
        store.selectChat(conversation.id)
      },
      title: title,
    },
    conversation.kind === 'group'
      ? h(
          'span',
          {
            className: 'db-avatar',
            style: {
              background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent)',
              color: 'var(--dsw-alias-brand-primary)',
            },
          },
          h(Icon, { name: 'users', size: 14 }),
        )
      : h(ui.Avatar, {
          name: title,
          color: bot === undefined ? undefined : bot.color,
          avatar: bot === undefined ? undefined : bot.avatar,
        }),
    h(
      'span',
      { className: 'db-chat-main' },
      h(
        'span',
        { className: 'db-chat-line' },
        conversation.pinned === true
          ? h('span', { className: 'db-pin-mark', title: t('left.pinned'), 'aria-hidden': 'true' }, h(Icon, { name: 'pin', size: 10 }))
          : null,
        h('span', { className: 'db-chat-name' }, title),
        running === undefined ? null : h('span', { className: 'db-spinner', style: { width: '9px', height: '9px', borderWidth: '1.5px' } }),
        conversation.unread > 0 ? h('span', { className: 'db-unread' }, String(conversation.unread)) : null,
        conversation.updatedAt === undefined ? null : h('span', { className: 'db-chat-time' }, ui.formatTime(conversation.updatedAt)),
      ),
      h('span', { className: 'db-chat-meta' }, meta),
    ),
  )
}

/** The left roster: header actions, search, filters, grouped chat list, footer. */
function LeftColumn(props) {
  var t = props.t
  var store = props.store
  var chats = filteredChats(store)
  var dmChats = []
  var groupChats = []
  for (var i = 0; i < chats.length; i += 1) {
    if (chats[i].kind === 'group') groupChats.push(chats[i])
    else dmChats.push(chats[i])
  }
  var bots = store.bots()
  var mode = store.mode
  var status = mode === 'live' ? t('connection.live') : mode === 'mock' ? t('connection.demo') : t('connection.reconnecting')
  var dot = mode === 'live' ? 'is-live' : mode === 'mock' ? 'is-mock' : 'is-lost'

  var children = [
    h(
      'div',
      { key: 'head', className: 'db-left-head' },
      h('h2', { className: 'db-left-title' }, t('left.title')),
      h(
        'div',
        { className: 'db-left-actions' },
        h(ui.IconButton, {
          icon: 'refresh',
          label: t('left.refresh'),
          title: t('left.refreshLabel'),
          disabled: store.refreshing === true,
          onClick: function () {
            store.refreshState().catch(function (error) {
              store.flash(transport.describeError(t, error), 'error')
            })
          },
        }),
        h(ui.IconButton, {
          icon: 'plus',
          label: t('left.newBot'),
          title: t('left.newBot'),
          onClick: function () {
            store.openDrawer('bots')
          },
        }),
        h(ui.IconButton, {
          icon: 'settings',
          label: t('left.settings'),
          title: t('left.settings'),
          onClick: function () {
            store.openDrawer('general')
          },
        }),
      ),
    ),
    h(
      'div',
      { key: 'search', className: 'db-search' },
      h('span', { className: 'db-search-icon' }, h(Icon, { name: 'search', size: 13 })),
      h('input', {
        className: 'db-search-input',
        value: store.search,
        placeholder: t('left.search'),
        'aria-label': t('left.search'),
        spellCheck: false,
        onChange: function (event) {
          store.setSearch(event.target.value)
        },
      }),
    ),
    h(
      'div',
      { key: 'filters', className: 'db-filters' },
      ['all', 'dm', 'group'].map(function (value) {
        return h(
          'button',
          {
            key: value,
            type: 'button',
            className: 'db-filter' + (store.filter === value ? ' is-active' : ''),
            onClick: function () {
              store.setFilter(value)
            },
          },
          t('left.filter.' + value),
        )
      }),
    ),
  ]

  // With no filter, pinned conversations of both kinds share one section at
  // the top, so a pinned group is not buried under the direct chats. The
  // per-kind filters keep their usual section (pinned ones sort first inside
  // it, which `filteredChats` already guarantees).
  var pinnedChats = []
  var plainDm = []
  var plainGroup = []
  for (var pc = 0; pc < chats.length; pc += 1) {
    if (chats[pc].pinned === true) pinnedChats.push(chats[pc])
    else if (chats[pc].kind === 'group') plainGroup.push(chats[pc])
    else plainDm.push(chats[pc])
  }

  var list = []
  if (store.filter === 'all' && pinnedChats.length > 0) {
    list.push(h('div', { key: 'pinned-label', className: 'db-section-label db-section-pinned' }, t('left.pinnedSection')))
    for (var p = 0; p < pinnedChats.length; p += 1) {
      list.push(h(ChatRow, { key: pinnedChats[p].id, t: t, store: store, chat: pinnedChats[p] }))
    }
  }
  var sectionDm = store.filter === 'all' ? plainDm : dmChats
  var sectionGroup = store.filter === 'all' ? plainGroup : groupChats
  if (store.filter !== 'group' && sectionDm.length > 0) {
    list.push(h('div', { key: 'dm-label', className: 'db-section-label' }, t('left.dmSection')))
    for (var d = 0; d < sectionDm.length; d += 1) {
      list.push(h(ChatRow, { key: sectionDm[d].id, t: t, store: store, chat: sectionDm[d] }))
    }
  }
  if (store.filter !== 'dm' && sectionGroup.length > 0) {
    list.push(h('div', { key: 'group-label', className: 'db-section-label' }, t('left.groupSection')))
    for (var g = 0; g < sectionGroup.length; g += 1) {
      list.push(h(ChatRow, { key: sectionGroup[g].id, t: t, store: store, chat: sectionGroup[g] }))
    }
  }
  if (list.length === 0) {
    list.push(
      h(
        'div',
        { key: 'empty', className: 'db-empty' },
        h('div', { className: 'db-empty-glyph' }, h(Icon, { name: 'inbox', size: 24 })),
        h('div', { className: 'db-empty-body' }, bots.length === 0 ? t('left.emptyHint') : store.search !== '' ? t('left.noMatch') : t('left.empty')),
      ),
    )
  }

  children.push(h('div', { key: 'list', className: 'db-list' }, list))
  children.push(
    h(
      'div',
      { key: 'foot', className: 'db-left-foot' },
      h('span', { className: 'db-conn' }, h('span', { className: 'db-conn-dot ' + dot }), h('span', null, status)),
      h(ui.IconButton, {
        icon: 'clock',
        label: t('tab.schedules'),
        title: t('tab.schedules'),
        onClick: function () {
          store.openDrawer('schedules')
        },
      }),
      h(ui.IconButton, {
        icon: 'chart',
        label: t('tab.usage'),
        title: t('tab.usage'),
        onClick: function () {
          store.openDrawer('usage')
        },
      }),
    ),
  )

  return h('aside', { className: 'db-left', 'aria-label': t('left.title') }, children)
}

/** The right action rail: one button per settings tab. */
function RightRail(props) {
  var t = props.t
  var store = props.store
  var tabs = [
    { id: 'general', icon: 'settings', label: t('tab.general') },
    { id: 'bots', icon: 'bot', label: t('tab.bots') },
    { id: 'groups', icon: 'users', label: t('tab.groups') },
    { id: 'memory', icon: 'memory', label: t('tab.memory') },
    { id: 'schedules', icon: 'clock', label: t('tab.schedules') },
    { id: 'usage', icon: 'chart', label: t('tab.usage') },
  ]
  var children = []
  for (var i = 0; i < tabs.length; i += 1) {
    children.push(
      h(ui.IconButton, {
        key: tabs[i].id,
        icon: tabs[i].icon,
        label: tabs[i].label,
        title: tabs[i].label,
        active: store.drawer === tabs[i].id,
        className: 'db-rail-btn' + (store.drawer === tabs[i].id ? ' is-active' : ''),
        onClick: function (id) {
          return function () {
            store.openDrawer(id)
          }
        }(tabs[i].id),
      }),
    )
  }
  return h('nav', { className: 'db-rail', 'aria-label': t('drawer.title') }, children)
}

/** Connection banner: demo fallback, dropped stream, and the retry control. */
function Banner(props) {
  var t = props.t
  var store = props.store
  var mode = store.mode
  if (mode === 'live' || mode === 'connecting') return null
  var mock = mode === 'mock'
  var hint = mock ? t('connection.offlineHint') : store.error === null || store.error === undefined ? '' : transport.describeError(t, store.error)
  return h(
    'div',
    { className: 'db-banner' + (mock ? '' : ' is-error') },
    h(Icon, { name: mock ? 'alert' : 'refresh', size: 13 }),
    h(
      'div',
      { className: 'db-banner-main' },
      h('strong', null, mock ? t('connection.offline') : t('connection.lost')),
      hint === '' ? null : h('span', { className: 'db-banner-hint' }, ' · ' + hint),
    ),
    mock ? h(ui.Tag, { tone: 'brand' }, t('connection.demo')) : null,
    h(
      'div',
      { className: 'db-banner-actions' },
      h(
        ui.Button,
        {
          size: 'sm',
          icon: 'refresh',
          onClick: function () {
            store.retry()
          },
        },
        t('connection.retry'),
      ),
    ),
  )
}

/** Toast strip. */
function Toasts(props) {
  var store = props.store
  if (store.toasts.length === 0) return null
  return h(
    'div',
    { className: 'db-toasts', role: 'status', 'aria-live': 'polite' },
    store.toasts.map(function (toast) {
      return h('div', { key: toast.id, className: 'db-toast' + (toast.kind === 'error' ? ' is-error' : toast.kind === 'success' ? ' is-success' : '') }, toast.text)
    }),
  )
}

/** First-run empty state: one click creates the Chief Bot. */
function EmptyWorkspace(props) {
  var t = props.t
  var store = props.store
  var pairSaving = React.useState(false)
  var saving = pairSaving[0]
  var setSaving = pairSaving[1]
  var pairError = React.useState('')
  var error = pairError[0]
  var setError = pairError[1]

  function createChief() {
    setSaving(true)
    setError('')
    store
      .createBot({
        name: t('empty.chiefName'),
        role: t('empty.chiefRole'),
        instructions: t('empty.chiefInstructions'),
        permission: 'workspace-write',
        color: '#4f7cff',
        autoHelper: true,
        model: null,
      })
      .then(
        function () {
          setSaving(false)
        },
        function (failure) {
          setSaving(false)
          setError(transport.describeError(t, failure))
        },
      )
  }

  return h(
    'div',
    { className: 'db-center' },
    h(ui.IconButton, {
      icon: 'menu',
      label: t('left.toggle'),
      className: 'db-left-toggle',
      style: { margin: '10px', alignSelf: 'flex-start' },
      onClick: function () {
        store.toggleLeft(true)
      },
    }),
    h(
      'div',
      { className: 'db-empty-state' },
      h(
        'div',
        { className: 'db-empty' },
        h('div', { className: 'db-empty-glyph' }, h(Icon, { name: 'sparkle', size: 30 })),
        h('h2', { className: 'db-empty-title' }, t('empty.title')),
        h('p', { className: 'db-empty-body' }, t('empty.body')),
        error === '' ? null : h('div', { className: 'db-error' }, error),
        h(
          'div',
          { className: 'db-empty-actions' },
          h(ui.Button, { variant: 'primary', disabled: saving, icon: 'bot', onClick: createChief }, saving ? t('empty.creating') : t('empty.create')),
          h(
            ui.Button,
            {
              onClick: function () {
                store.openDrawer('bots')
              },
            },
            t('empty.manual'),
          ),
        ),
        h('div', { className: 'db-empty-note' }, store.mode === 'mock' ? t('empty.demoNote') : t('app.subtitle')),
      ),
    ),
  )
}

/** Whole-page loading state before the first snapshot arrives, or the failure. */
function LoadingWorkspace(props) {
  var t = props.t
  var store = props.store
  var failed = store.mode === 'disconnected' && store.error !== null && store.error !== undefined
  return h(
    'div',
    { className: 'db-center' },
    h(ui.IconButton, {
      icon: 'menu',
      label: t('left.toggle'),
      className: 'db-left-toggle',
      style: { margin: '10px', alignSelf: 'flex-start' },
      onClick: function () {
        store.toggleLeft(true)
      },
    }),
    h(
      'div',
      { className: 'db-center-empty' },
      failed
        ? h(
            React.Fragment,
            null,
            h('div', { className: 'db-empty-glyph' }, h(Icon, { name: 'alert', size: 26 })),
            h('div', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, transport.describeError(t, store.error)),
            h(
              ui.Button,
              {
                icon: 'refresh',
                onClick: function () {
                  store.retry()
                },
              },
              t('connection.retry'),
            ),
          )
        : h(React.Fragment, null, h('span', { className: 'db-spinner is-lg' }), h('span', null, t('chat.loading'))),
    ),
  )
}

/** The workspace page registered into the shell's `main` slot. */
function BotWorkspacePage(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  React.useEffect(
    function () {
      if (store !== null && store !== undefined && typeof store.ensureStarted === 'function') store.ensureStarted()
    },
    [store],
  )
  if (store === null || store === undefined) return null
  var bots = store.bots()
  var loading = store.data === null
  var className = 'db' + (store.leftOpen === true ? ' is-left-open' : '')

  var center
  if (loading) center = h(LoadingWorkspace, { t: t, store: store })
  else if (bots.length === 0) center = h(EmptyWorkspace, { t: t, store: store })
  else center = h(chat.ChatPane, { t: t, store: store, openSession: props.openSession })

  return h(
    'div',
    { className: className },
    h(Banner, { t: t, store: store }),
    h(
      'div',
      { className: 'db-body' },
      h(LeftColumn, { t: t, store: store }),
      h('div', {
        className: 'db-left-scrim',
        onClick: function () {
          store.toggleLeft(false)
        },
      }),
      center,
      h(RightRail, { t: t, store: store }),
    ),
    h(ui.ErrorBoundary, { message: t('error.panelCrashed'), retry: t('action.retry') }, h(panels.SettingsDrawer, { t: t, store: store })),
    h(Toasts, { store: store }),
  )
}

module.exports = { BotWorkspacePage: BotWorkspacePage, filteredChats: filteredChats }
