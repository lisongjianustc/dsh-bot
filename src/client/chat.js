/**
 * The center column: one chat's header, timeline and composer.
 *
 * Everything renders inside the page container (no portal, no document.body
 * mount), and all state that must survive a panel switch lives in the store.
 * Bubbles follow the MiniMax product shape: bot initial + colour on the left,
 * tool rows folded into the bubble, a streaming cursor while text arrives, and
 * `[PASS]` / `pass` messages hidden entirely.
 */

'use strict'

var React = require('react')
var ui = require('./ui.js')
var transport = require('./transport.js')
var markdown = require('./markdown.js')

var h = ui.h
var useStoreVersion = ui.useStoreVersion
var Icon = ui.Icon
var Spinner = function Spinner(props) {
  return h('span', { className: 'db-spinner' + (props && props.size === 'lg' ? ' is-lg' : '') })
}

/** Copy text to the clipboard with a best-effort fallback. */
function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && navigator.clipboard.writeText !== undefined) {
      return navigator.clipboard.writeText(text)
    }
  } catch (error) {
    /* fall through */
  }
  return Promise.reject(new Error('clipboard-unavailable'))
}

/** Read the visible text of one message. */
function textOf(message) {
  if (message === null || message === undefined) return ''
  if (typeof message.text === 'string' && message.text !== '') return message.text
  var out = ''
  var parts = Array.isArray(message.parts) ? message.parts : []
  for (var i = 0; i < parts.length; i += 1) {
    if (parts[i] !== null && parts[i] !== undefined && parts[i].type === 'text' && typeof parts[i].text === 'string') {
      out += (out === '' ? '' : '\n') + parts[i].text
    }
  }
  return out
}

/** Hide protocol noise: `[PASS]` turns and pass-status rows. */
function isHiddenMessage(message) {
  if (message === null || message === undefined) return true
  if (message.status === 'pass') return true
  var text = textOf(message)
  if (text.trim() === '[PASS]') return true
  if (text.trim() === '' && (message.parts === undefined || message.parts.length === 0) && message.status !== 'streaming') {
    return true
  }
  return false
}

/** Render a tool argument/result value as readable text. */
function toolValueText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    return String(value)
  }
}

/**
 * One foldable tool call row inside a bubble.
 *
 * A `running` part on a message that already settled is shown as
 * "unconfirmed" instead of spinning forever: the Host's result merge can lose
 * a `tool/result`, and a permanent spinner would be worse than an honest
 * unknown. Arguments/results are shown when the Host includes them.
 */
function ToolRow(props) {
  var pair = React.useState(false)
  var expanded = pair[0]
  var setExpanded = pair[1]
  var tool = props.tool === undefined || props.tool === null ? {} : props.tool
  var rawStatus =
    tool.status === 'failed' ? 'failed' : tool.status === 'running' ? 'running' : tool.status === 'ok' ? 'ok' : 'ok'
  var unconfirmed = rawStatus === 'running' && props.messageDone === true
  var status = unconfirmed ? 'unknown' : rawStatus
  var label =
    status === 'failed'
      ? props.t('chat.tool.failed')
      : status === 'running'
        ? props.t('chat.tool.running')
        : status === 'unknown'
          ? props.t('chat.tool.unknown')
          : props.t('chat.tool.ok')
  var args = tool.args === undefined ? tool.input : tool.args
  var result = tool.result === undefined ? tool.output : tool.result
  var hasArgs = args !== undefined && args !== null && args !== ''
  var hasResult = result !== undefined && result !== null && result !== ''
  var hasError = status === 'failed' && typeof tool.error === 'string' && tool.error !== ''
  var expandable = hasError || hasArgs || hasResult || unconfirmed
  var className = 'db-tool is-' + status + (expandable ? ' is-clickable' : '')
  var glyph =
    status === 'failed'
      ? h(Icon, { name: 'alert', size: 11 })
      : status === 'running'
        ? h(Spinner, null)
        : status === 'unknown'
          ? h(Icon, { name: 'dot', size: 11 })
          : h(Icon, { name: 'check', size: 11 })

  var detail = null
  if (expanded && expandable) {
    var blocks = []
    if (hasError) blocks.push(h('div', { key: 'error', className: 'db-tool-error' }, tool.error))
    if (hasArgs) {
      blocks.push(
        h(
          'div',
          { key: 'args', className: 'db-tool-detail' },
          h('div', { className: 'db-tool-detail-label' }, props.t('chat.tool.args')),
          h('pre', { className: 'db-tool-detail-body' }, toolValueText(args)),
        ),
      )
    }
    if (hasResult) {
      blocks.push(
        h(
          'div',
          { key: 'result', className: 'db-tool-detail' },
          h('div', { className: 'db-tool-detail-label' }, props.t('chat.tool.result')),
          h('pre', { className: 'db-tool-detail-body' }, toolValueText(result)),
        ),
      )
    }
    if (unconfirmed) blocks.push(h('div', { key: 'hint', className: 'db-tool-hint' }, props.t('chat.tool.hint')))
    detail = h('div', { className: 'db-tool-detail-wrap' }, blocks)
  }

  return h(
    'div',
    { className: 'db-tools' },
    h(
      'div',
      {
        className: className,
        role: expandable ? 'button' : undefined,
        tabIndex: expandable ? 0 : undefined,
        title: expandable ? props.t('chat.tool.showError') : tool.name,
        onClick: expandable
          ? function () {
              setExpanded(!expanded)
            }
          : undefined,
        onKeyDown: expandable
          ? function (event) {
              if (event.key === 'Enter' || event.key === ' ') setExpanded(!expanded)
            }
          : undefined,
      },
      glyph,
      h('span', { className: 'db-tool-name' }, tool.name === undefined ? 'tool' : tool.name),
      h('span', { className: 'db-tool-state' }, label),
    ),
    detail,
  )
}

/** One rendered message row. */
function MessageRow(props) {
  var t = props.t
  var message = props.message
  var store = props.store
  var chat = props.chat
  var pairExpanded = React.useState(false)
  var expanded = pairExpanded[0]
  var setExpanded = pairExpanded[1]
  // A message that already settled must never show a spinning tool row: the
  // Host's result merge can miss a tool/result, and "unconfirmed" is honest.
  var messageDone = message.status !== 'streaming' && message.status !== 'pending'
  var isUser = message.role === 'user'
  var isSystem = message.role === 'system'
  var isRelay = message.role === 'relay'
  var bot = message.botId === undefined || message.botId === null ? undefined : store.botById(message.botId)
  var name = isUser
    ? (store.data !== null && store.data.settings.userName !== '' ? store.data.settings.userName : t('chat.you'))
    : bot === undefined
      ? String(message.botId === undefined ? 'Bot' : message.botId)
      : bot.name
  var color = bot === undefined ? undefined : bot.color
  var text = textOf(message)
  var parts = Array.isArray(message.parts) ? message.parts : []
  var hasContent = false
  for (var i = 0; i < parts.length; i += 1) {
    var part = parts[i]
    if (part === null || part === undefined) continue
    if (part.type === 'text' && typeof part.text === 'string' && part.text !== '') hasContent = true
    else if (part.type === 'tool') hasContent = true
    else if (part.type === 'event' && typeof part.text === 'string' && part.text !== '') hasContent = true
  }
  if (!hasContent && text !== '') hasContent = true

  // The last text part carries the streaming cursor.
  var lastTextIndex = -1
  for (var j = 0; j < parts.length; j += 1) {
    if (parts[j] !== null && parts[j] !== undefined && parts[j].type === 'text' && typeof parts[j].text === 'string' && parts[j].text !== '') {
      lastTextIndex = j
    }
  }
  var streaming = message.status === 'streaming'

  var nodes = []
  for (var k = 0; k < parts.length; k += 1) {
    var current = parts[k]
    if (current === null || current === undefined) continue
    if (current.type === 'tool') {
      nodes.push(h(ToolRow, { key: 'tool-' + k, tool: current, t: t, messageDone: messageDone }))
    } else if (current.type === 'event') {
      if (typeof current.text === 'string' && current.text !== '') {
        nodes.push(h('div', { key: 'event-' + k, className: 'db-event' }, current.text))
      }
    } else if (current.type === 'text' && typeof current.text === 'string' && current.text !== '') {
      nodes.push(
        h(
          'div',
          { key: 'text-' + k, className: 'db-text' },
          markdown.render(current.text, streaming && k === lastTextIndex ? 'db-cursor' : undefined),
        ),
      )
    }
  }
  if (nodes.length === 0 && text !== '') {
    nodes.push(
      h('div', { key: 'text-fallback', className: 'db-text' }, markdown.render(text, streaming ? 'db-cursor' : undefined)),
    )
  }
  if (nodes.length === 0 && streaming) {
    nodes.push(
      h(
        'div',
        { key: 'typing', className: 'db-row', style: { gap: '7px', color: 'var(--dsw-alias-label-secondary)', fontSize: '11.5px' } },
        h(Spinner, null),
        h('span', null, t('chat.status.streaming')),
      ),
    )
  }

  // Long Bot answers collapse behind an explicit expand control (>1200 chars).
  var longMessage = message.status !== 'streaming' && message.status !== 'pending' && text.length > 1200
  var clamped = longMessage && !expanded
  var bubbleChildren = nodes
  if (longMessage) {
    var expandLabel = expanded ? t('chat.collapse') : t('chat.expandCount', { count: ui.formatNumber(text.length) })
    var expandButton = h(
      'button',
      {
        key: 'expand',
        type: 'button',
        className: 'db-expand',
        onClick: function () {
          setExpanded(!expanded)
        },
      },
      expandLabel,
    )
    bubbleChildren = clamped
      ? [h('div', { key: 'clamp', className: 'db-clamp' }, nodes), expandButton]
      : nodes.concat([expandButton])
  }

  var statusNode = null
  if (message.status === 'error') {
    statusNode = h(
      'div',
      { className: 'db-msg-error' },
      h(Icon, { name: 'alert', size: 11 }),
      h('span', null, message.error === undefined || message.error === '' ? t('chat.status.error') : t('chat.messageError', { detail: String(message.error) })),
    )
  } else if (message.status === 'aborted') {
    statusNode = h('div', { className: 'db-msg-status is-warn' }, h(Icon, { name: 'stop', size: 10 }), h('span', null, t('chat.status.aborted')))
  } else if (message.status === 'pending') {
    statusNode = h('div', { className: 'db-msg-status' }, h(Spinner, null), h('span', null, t('chat.status.pending')))
  } else if (message.status === 'held') {
    statusNode = h('div', { className: 'db-msg-status is-warn' }, h('span', null, t('chat.status.held')))
  }

  var actions = null
  if (text.trim() !== '') {
    actions = h(
      'div',
      { className: 'db-msg-actions' },
      h(ui.IconButton, {
        icon: 'copy',
        size: 13,
        label: t('chat.copy'),
        onClick: function () {
          copyText(text).then(
            function () {
              store.flash(t('chat.copied'), 'success')
            },
            function () {
              store.flash(t('error.unknown'), 'error')
            },
          )
        },
      }),
      isUser || isSystem
        ? null
        : h(ui.IconButton, {
            icon: 'quote',
            size: 13,
            label: t('chat.quote'),
            onClick: function () {
              props.onQuote(text)
            },
          }),
      !isUser && !isSystem && message.sessionId !== undefined && message.sessionId !== null && message.sessionId !== '' && props.openSession !== undefined
        ? h(ui.IconButton, {
            icon: 'external',
            size: 13,
            label: t('chat.openSession'),
            title: t('chat.openSessionHint'),
            onClick: function () {
              props.openSession(message.sessionId)
            },
          })
        : null,
    )
  }

  if (isSystem) {
    return h(
      'div',
      { className: 'db-msg is-system' },
      h('div', { className: 'db-msg-body' }, h('div', { className: 'db-system' }, text === '' ? t('chat.system') : text)),
    )
  }

  return h(
    'div',
    { className: 'db-msg ' + (isUser ? 'is-user' : isRelay ? 'is-relay' : 'is-bot') + (message.status === 'error' ? ' is-error' : '') },
    !isUser
      ? h(ui.Avatar, {
          name: name,
          color: isRelay ? undefined : color,
          size: 'sm',
          image: bot === undefined ? undefined : bot.avatar,
        })
      : null,
    h(
      'div',
      { className: 'db-msg-body' },
      h(
        'div',
        { className: 'db-msg-head' },
        h('span', { className: 'db-msg-name' }, name),
        isRelay ? h('span', { className: 'db-msg-role' }, t('chat.relay')) : null,
        h('span', { className: 'db-msg-time' }, ui.formatTime(message.ts)),
      ),
      h('div', { className: 'db-bubble' }, bubbleChildren),
      statusNode,
      actions,
    ),
  )
}

/** The composer for one chat; mounted per chat so its draft resets cleanly. */
function Composer(props) {
  var t = props.t
  var store = props.store
  var chat = props.chat
  var pair = React.useState(store.draftOf(chat.id))
  var value = pair[0]
  var setValue = pair[1]
  var sending = React.useState(false)
  var isSending = sending[0]
  var setSending = sending[1]
  var areaRef = React.useRef(null)
  var quote = store.quoteOf(chat.id)
  var running = store.runningOf(chat.id)
  var runningBot = running === undefined ? undefined : store.botById(running.botId)
  var runningName = runningBot === undefined ? undefined : runningBot.name

  function resize() {
    var element = areaRef.current
    if (element === null || element === undefined) return
    element.style.height = 'auto'
    element.style.height = Math.min(180, element.scrollHeight) + 'px'
  }

  React.useEffect(function () {
    resize()
  }, [value])

  // A quote is materialised in the composer itself as `> …` lines, and the
  // one-shot request is consumed immediately so it cannot be applied twice.
  React.useEffect(
    function () {
      if (quote === '') return
      // Quoting a very long answer must not swallow the composer: keep the
      // inserted excerpt readable and let the user type right below it.
      var raw = String(quote)
      if (raw.length > 320) raw = raw.slice(0, 320) + '…'
      var lines = raw.split('\n')
      var prefix = ''
      for (var i = 0; i < lines.length; i += 1) prefix += '> ' + lines[i] + '\n'
      var next = value.trim() === '' ? prefix + '\n' : prefix + '\n' + value
      setValue(next)
      store.setDraft(chat.id, next)
      store.setQuote(chat.id, '')
      var element = areaRef.current
      if (element !== null && element !== undefined) {
        element.focus()
        try {
          element.setSelectionRange(next.length, next.length)
        } catch (error) {
          /* the shell may not support selection on this element */
        }
      }
    },
    [quote],
  )

  function submit() {
    var text = value.trim()
    if (text === '' || isSending) return
    setValue('')
    store.setDraft(chat.id, '')
    setSending(true)
    store.send(chat.id, text).then(
      function () {
        setSending(false)
      },
      function (error) {
        setSending(false)
        store.flash(transport.describeError(t, error), 'error')
      },
    )
  }

  function onKeyDown(event) {
    var native = event.nativeEvent === undefined ? event : event.nativeEvent
    if (native !== undefined && native.isComposing === true) return
    if (event.key === 'Enter' && event.shiftKey !== true) {
      event.preventDefault()
      submit()
    }
  }

  var placeholder =
    chat.kind === 'group'
      ? t('chat.placeholderGroup', { name: store.chatTitle(chat) })
      : t('chat.placeholder', { name: store.chatTitle(chat) })

  return h(
    'div',
    { className: 'db-composer' },
    h(
      'div',
      { className: 'db-composer-inner' },
      h(
        'div',
        { className: 'db-composer-box' },
        h('textarea', {
          ref: areaRef,
          className: 'db-input',
          value: value,
          placeholder: placeholder,
          rows: 1,
          spellCheck: false,
          onChange: function (event) {
            setValue(event.target.value)
            store.setDraft(chat.id, event.target.value)
            resize()
          },
          onKeyDown: onKeyDown,
        }),
        h(
          'div',
          { className: 'db-composer-foot' },
          h('span', { className: 'db-composer-hint' }, t('chat.hint.send')),
          running === undefined
            ? null
            : h(
                'span',
                { className: 'db-running' },
                h(Spinner, null),
                h('span', null, runningName === undefined ? t('chat.runningGeneric') : t('chat.running', { name: runningName })),
                h(ui.Button, {
                  size: 'sm',
                  icon: 'stop',
                  onClick: function () {
                    store.cancel(chat.id).catch(function (error) {
                      store.flash(transport.describeError(t, error), 'error')
                    })
                  },
                }, t('chat.stop')),
              ),
          h(
            'button',
            {
              type: 'button',
              className: 'db-send',
              disabled: value.trim() === '' || running !== undefined,
              title: running === undefined ? t('chat.send') : t('chat.sendBlocked'),
              'aria-label': t('chat.send'),
              onClick: submit,
            },
            h(Icon, { name: 'send', size: 15 }),
          ),
        ),
      ),
    ),
  )
}

/** The whole center column for the selected chat. */
function ChatPane(props) {
  var t = props.t
  var store = props.store
  var openSession = props.openSession
  useStoreVersion(store)

  var chatId = store.selectedChatId
  var chat = chatId === null ? undefined : store.chatById(chatId)
  var scrollRef = React.useRef(null)
  var stickRef = React.useRef(true)
  var entry = chat === undefined ? undefined : store.messagesOf(chat.id)
  var list = entry === undefined ? [] : entry.list

  function visibleMessages() {
    var out = []
    for (var i = 0; i < list.length; i += 1) {
      if (!isHiddenMessage(list[i])) out.push({ message: list[i], index: i })
    }
    return out
  }

  var visible = visibleMessages()
  var lastMessage = list.length > 0 ? list[list.length - 1] : undefined
  var lastText = lastMessage === undefined ? '' : textOf(lastMessage)
  var tail = visible.length > 0 ? visible[visible.length - 1].message : undefined
  var tailText = tail === undefined ? '' : textOf(tail)

  React.useEffect(
    function () {
      var element = scrollRef.current
      if (element === null || element === undefined) return
      element.scrollTop = element.scrollHeight
      stickRef.current = true
    },
    [chatId],
  )

  React.useEffect(
    function () {
      var element = scrollRef.current
      if (element === null || element === undefined) return
      if (stickRef.current) element.scrollTop = element.scrollHeight
    },
    [list.length, lastText.length, tailText.length, entry === undefined ? 0 : entry.hasMore],
  )

  function onScroll() {
    var element = scrollRef.current
    if (element === null || element === undefined) return
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
  }

  if (chat === undefined) {
    return h(
      'div',
      { className: 'db-center' },
      h(
        'div',
        { className: 'db-center-empty' },
        h('div', { className: 'db-empty-glyph' }, h(Icon, { name: 'inbox', size: 28 })),
        h('h3', { className: 'db-empty-title' }, t('chat.empty')),
        h('p', { className: 'db-empty-body' }, t('chat.emptyHint')),
      ),
      h(ui.IconButton, {
        icon: 'menu',
        label: t('left.toggle'),
        className: 'db-left-toggle',
        onClick: function () {
          store.toggleLeft(true)
        },
      }),
    )
  }

  var bot = chat.kind === 'dm' && chat.botId !== undefined ? store.botById(chat.botId) : undefined
  var group = chat.kind === 'group' && chat.groupId !== undefined ? store.groupById(chat.groupId) : undefined
  var subtitle = ''
  if (chat.kind === 'group') {
    var memberCount = group === undefined ? 0 : (Array.isArray(group.memberIds) ? group.memberIds.length : 0)
    subtitle = t('chat.memberCount', { count: String(memberCount) })
    if (group !== undefined) subtitle += ' · ' + (group.replyMode === 'admin' ? t('groups.form.replyMode.admin') : t('groups.form.replyMode.all'))
  } else if (bot !== undefined) {
    subtitle = bot.role === '' || bot.role === undefined ? t('chat.dm') : bot.role
  }

  var rows = []
  var previousDay = ''
  for (var i = 0; i < visible.length; i += 1) {
    var item = visible[i]
    var message = item.message
    var day = ui.formatDay(message.ts)
    if (day !== previousDay) {
      previousDay = day
      rows.push(h('div', { key: 'day-' + day, className: 'db-day' }, ui.dayLabel(t, message.ts)))
    }
    rows.push(
      h(MessageRow, {
        key: message.id === undefined ? 'row-' + item.index : message.id,
        t: t,
        store: store,
        chat: chat,
        message: message,
        openSession: openSession,
        onQuote: function (text) {
          store.setQuote(chat.id, text)
        },
      }),
    )
  }

  var timelineChildren = []
  if (entry !== undefined && entry.hasMore) {
    timelineChildren.push(
      h(
        'button',
        {
          key: 'load-more',
          type: 'button',
          className: 'db-loadmore',
          disabled: entry.loading,
          onClick: function () {
            store.loadMessages(chat.id, true)
          },
        },
        entry.loading ? t('chat.loadingMore') : t('chat.loadMore'),
      ),
    )
  }
  if (entry !== undefined && entry.loading && list.length === 0) {
    timelineChildren.push(h(ui.Loading, { key: 'loading', label: t('chat.loading') }))
  } else if (entry !== undefined && entry.error !== null && entry.error !== undefined && list.length === 0) {
    timelineChildren.push(
      h(
        'div',
        { key: 'error', className: 'db-inline-note is-error' },
        h('div', null, transport.describeError(t, entry.error)),
        h(
          'div',
          { style: { marginBlockStart: '6px' } },
          h(
            ui.Button,
            {
              size: 'sm',
              icon: 'refresh',
              onClick: function () {
                store.loadMessages(chat.id, false, true)
              },
            },
            t('connection.retry'),
          ),
        ),
      ),
    )
  } else if (visible.length === 0) {
    timelineChildren.push(h('div', { key: 'empty', className: 'db-center-empty', style: { minBlockSize: '160px' } }, h('div', { className: 'db-empty-body' }, t('chat.noMessages'))))
  }

  return h(
    'div',
    { className: 'db-center' },
    h(
      'div',
      { className: 'db-chat-head' },
      h(ui.IconButton, {
        icon: 'menu',
        label: t('left.toggle'),
        className: 'db-left-toggle',
        onClick: function () {
          store.toggleLeft(true)
        },
      }),
      chat.kind === 'group'
        ? h('span', { className: 'db-avatar is-sm', style: { background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent)', color: 'var(--dsw-alias-brand-primary)' } }, h(Icon, { name: 'users', size: 13 }))
        : h(ui.Avatar, { name: store.chatTitle(chat), color: bot === undefined ? undefined : bot.color, size: 'sm', image: bot === undefined ? undefined : bot.avatar }),
      h(
        'div',
        { className: 'db-chat-head-main' },
        h(
          'div',
          { className: 'db-chat-title' },
          h('span', null, store.chatTitle(chat)),
          chat.pinned === true ? h(ui.Tag, { icon: 'pin' }, t('left.pinned')) : null,
          store.runningOf(chat.id) === undefined ? null : h(Spinner, null),
        ),
        h('div', { className: 'db-chat-sub' }, subtitle),
      ),
      h(
        'div',
        { className: 'db-chat-head-actions' },
        h(ui.IconButton, {
          icon: 'users',
          label: t('groups.title'),
          title: t('groups.title'),
          onClick: function () {
            store.openDrawer('groups')
          },
        }),
        h(ui.IconButton, {
          icon: 'memory',
          label: t('memory.title'),
          title: t('memory.title'),
          onClick: function () {
            store.openDrawer('memory')
          },
        }),
        openSession === undefined
          ? null
          : h(ui.IconButton, {
              icon: 'external',
              label: t('chat.openSession'),
              title: chat.sessionId === undefined || chat.sessionId === '' ? t('chat.noSession') : t('chat.openSessionHint'),
              disabled: chat.sessionId === undefined || chat.sessionId === '',
              onClick: function () {
                if (chat.sessionId !== undefined && chat.sessionId !== '') openSession(chat.sessionId)
              },
            }),
      ),
    ),
    h('div', { className: 'db-timeline', ref: scrollRef, onScroll: onScroll }, h('div', { className: 'db-timeline-inner' }, timelineChildren, rows)),
    h(Composer, { key: chat.id, t: t, store: store, chat: chat }),
  )
}

module.exports = { ChatPane: ChatPane, MessageRow: MessageRow, isHiddenMessage: isHiddenMessage, textOf: textOf }
