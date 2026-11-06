/**
 * Shared React toolkit for the dsh-bot workspace: the `h` shorthand (the
 * bundle has no JSX transform), tiny hooks, icons, form primitives and the
 * formatting helpers every panel uses.
 *
 * No component here touches the store by closure: each takes the store it
 * renders, so the same primitives could serve a second panel instance.
 */

'use strict'

var React = require('react')
var avatarLib = require('./avatar.js')
var h = React.createElement

/* --------------------------------------------------------------- hooks */

var useSyncExternalStore =
  typeof React.useSyncExternalStore === 'function'
    ? React.useSyncExternalStore
    : function (subscribe, getSnapshot) {
        var pair = React.useState(0)
        var force = pair[1]
        React.useEffect(
          function () {
            return subscribe(function () {
              force(function (version) {
                return version + 1
              })
            })
          },
          [subscribe, force],
        )
        return getSnapshot()
      }

/**
 * Subscribe one component to the workspace store.
 * `version` is the stable snapshot value; components read the mutable fields
 * of `store` directly after the version changes.
 */
function useStoreVersion(store) {
  return useSyncExternalStore(
    store.subscribe,
    function () {
      return store.version
    },
    function () {
      return store.version
    },
  )
}

/* --------------------------------------------------------------- icons */

var ICONS = {
  bot: [{ r: [4, 5.2, 8, 6.6, 2.2] }, 'M8 3.6V5.2', { c: [8, 3, 0.9] }, 'M6.3 8.1v1.1', 'M9.7 8.1v1.1', 'M6.1 10.6h3.8'],
  users: [
    { c: [6, 6.2, 2.2] },
    'M2.4 13.2c0-2 1.6-3.4 3.6-3.4s3.6 1.4 3.6 3.4',
    { c: [11.6, 6.8, 1.7] },
    'M10.7 10.3c1.6.2 2.8 1.4 2.8 3',
  ],
  settings: [{ c: [10, 5, 1.6] }, { c: [6, 11, 1.6] }, 'M3 5h4.4', 'M12.6 5H13', 'M3 11h1.4', 'M8.6 11H13'],
  memory: [
    { r: [4, 4, 8, 8, 1.6] },
    'M6 1.6v2.4',
    'M10 1.6v2.4',
    'M6 12v2.4',
    'M10 12v2.4',
    'M1.6 6H4',
    'M1.6 10H4',
    'M12 6h2.4',
    'M12 10h2.4',
  ],
  clock: [{ c: [8, 8, 5.6] }, 'M8 4.8v3.4l2.4 1.4'],
  chart: ['M3.4 13V8.6', 'M7 13V4.8', 'M10.6 13V7.2', 'M14 13V3'],
  plus: ['M8 3v10', 'M3 8h10'],
  search: [{ c: [7, 7, 4.4] }, 'M10.4 10.4L14 14'],
  x: ['M4 4l8 8', 'M12 4l-8 8'],
  send: ['M8 13V3', 'M4 7l4-4 4 4'],
  copy: [{ r: [3, 3, 7.5, 7.5, 1.4] }, { r: [6, 6, 7.5, 7.5, 1.4] }],
  quote: ['M6 5.4C4.6 5.4 3.6 6.4 3.6 7.8s1 2.4 2.4 2.4c0 1.6-1 2.7-2.6 3.3', 'M12.4 5.4c-1.4 0-2.4 1-2.4 2.4s1 2.4 2.4 2.4c0 1.6-1 2.7-2.6 3.3'],
  external: ['M9.2 3H13v3.8', 'M13 3L7.4 8.6', 'M11 9.2v3.3A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5h3.3'],
  'chevron-down': ['M4 6.2L8 10l4-3.8'],
  'chevron-up': ['M4 9.8L8 6l4 3.8'],
  'chevron-left': ['M10 3L5 8l5 5'],
  'chevron-right': ['M6 3l5 5-5 5'],
  check: ['M3 8.4l3.2 3.2L13 5.2'],
  alert: ['M8 2.2l6 11.2H2z', 'M8 6.2v3.4', { c: [8, 11.6, 0.5] }],
  refresh: ['M13.4 8a5.4 5.4 0 1 1-1.6-3.8', 'M13.4 2.6V6H10'],
  trash: ['M3 5h10', 'M6 5V3.4h4V5', 'M4.6 5l.6 8.2h5.6L11.4 5', 'M6.8 7.6v3.4', 'M9.2 7.6v3.4'],
  edit: ['M10.4 2.6l3 3L6.2 12.8H3.2v-3z', 'M9.2 3.8l3 3'],
  stop: [{ r: [5, 5, 6, 6, 1.2] }],
  menu: ['M3 4.2h10', 'M3 8h10', 'M3 11.8h10'],
  pin: ['M9.2 2l4.8 4.8-2.4.9-2.9 2.9-3.3-3.3 2.9-2.9z', 'M4.6 11.4l2.6-2.6'],
  sparkle: ['M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z'],
  inbox: ['M2.4 9.2h3l1 2h3.2l1-2h3', 'M2.4 9.2V4.6A1.6 1.6 0 0 1 4 3h8a1.6 1.6 0 0 1 1.6 1.6v4.6', 'M2.4 9.2v2.4A1.6 1.6 0 0 0 4 13.2h8a1.6 1.6 0 0 0 1.6-1.6V9.2'],
  dot: [{ c: [8, 8, 2.6] }],
  file: ['M4.5 2h4.7L13 5.8V14H4.5z', 'M9 2v4h4'],
  image: [{ r: [2, 3.5, 12, 9.5, 1.6] }, 'M2.6 11l3.2-3.4 2.6 2.6 2-2 3 3', { c: [10.8, 6.2, 1] }],
  download: ['M8 2.5v8', 'M4.6 7.4L8 10.8l3.4-3.4', 'M3 13.2h10'],
  paperclip: ['M10.8 5.2L5.4 10.6a2.2 2.2 0 0 0 3.1 3.1l5.9-5.9a3.3 3.3 0 0 0-4.7-4.7L4.6 8.2a4.4 4.4 0 0 0 6.2 6.2l4-4'],
  tasks: [{ r: [3, 2.5, 10, 11, 2] }, 'M5.8 6.2h4.4', 'M5.8 9h3', 'M10.6 11.6l1.4 1.4 2.2-2.6'],
}

/** One stroke icon drawn in the shell's current text colour. */
function Icon(props) {
  var name = props.name === undefined ? 'dot' : props.name
  var glyphs = ICONS[name] === undefined ? ICONS.dot : ICONS[name]
  var size = props.size === undefined ? 16 : props.size
  var children = []
  for (var i = 0; i < glyphs.length; i += 1) {
    var glyph = glyphs[i]
    if (typeof glyph === 'string') {
      children.push(h('path', { key: i, d: glyph }))
    } else if (glyph.c !== undefined) {
      children.push(h('circle', { key: i, cx: glyph.c[0], cy: glyph.c[1], r: glyph.c[2] }))
    } else if (glyph.r !== undefined) {
      children.push(
        h('rect', { key: i, x: glyph.r[0], y: glyph.r[1], width: glyph.r[2], height: glyph.r[3], rx: glyph.r[4] }),
      )
    }
  }
  return h(
    'svg',
    {
      className: props.className === undefined ? undefined : props.className,
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: props.strokeWidth === undefined ? 1.4 : props.strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      'data-dsh-panel-entry': props.panelEntry,
    },
    children,
  )
}

/* ------------------------------------------------------------- buttons */

/** Inline icon button. */
function IconButton(props) {
  return h(
    'button',
    {
      type: 'button',
      className:
        'db-icon-btn' +
        (props.active === true ? ' is-active' : '') +
        (props.className === undefined ? '' : ' ' + props.className),
      title: props.title === undefined ? props.label : props.title,
      'aria-label': props.label === undefined ? props.title : props.label,
      disabled: props.disabled === true,
      onClick: props.onClick,
      style: props.style,
    },
    h(Icon, { name: props.icon, size: props.size === undefined ? 16 : props.size }),
  )
}

/** Text button with the workspace's three variants. */
function Button(props) {
  var className = 'db-btn'
  if (props.variant === 'primary') className += ' is-primary'
  else if (props.variant === 'ghost') className += ' is-ghost'
  else if (props.variant === 'danger') className += ' is-danger'
  if (props.size === 'sm') className += ' is-sm'
  if (props.block === true) className += ' is-block'
  if (props.className !== undefined) className += ' ' + props.className
  return h(
    'button',
    {
      type: props.type === undefined ? 'button' : props.type,
      className: className,
      disabled: props.disabled === true,
      onClick: props.onClick,
      title: props.title,
      'aria-label': props.label,
    },
    props.icon === undefined ? null : h(Icon, { name: props.icon, size: 13 }),
    props.children === undefined ? null : props.children,
  )
}

/**
 * A two-step destructive action: the first click arms, the second confirms.
 * Avoids a modal layer (the drawer must stay inside the page container) while
 * still guarding against a stray click on "delete".
 */
function ConfirmButton(props) {
  var pair = React.useState(false)
  var armed = pair[0]
  var setArmed = pair[1]
  var timer = React.useRef(null)

  function disarm() {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setArmed(false)
  }

  function onClick() {
    if (props.disabled === true) return
    if (!armed) {
      setArmed(true)
      timer.current = setTimeout(function () {
        timer.current = null
        setArmed(false)
      }, 4000)
      return
    }
    disarm()
    props.onConfirm()
  }

  React.useEffect(function () {
    return function () {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  return h(
    'button',
    {
      type: 'button',
      className: 'db-btn is-sm ' + (armed ? 'is-danger' : 'is-ghost'),
      disabled: props.disabled === true,
      onClick: onClick,
      title: armed ? props.confirmLabel : props.title,
    },
    h(Icon, { name: 'trash', size: 12 }),
    h('span', null, armed ? props.confirmLabel : props.label),
  )
}

/* --------------------------------------------------------------- forms */

/** Label + control + hint/error block. */
function Field(props) {
  return h(
    'div',
    { className: 'db-field' },
    props.label === undefined ? null : h('label', { className: 'db-label' }, props.label),
    props.children,
    props.hint === undefined ? null : h('div', { className: 'db-hint' }, props.hint),
    props.error === undefined || props.error === null || props.error === ''
      ? null
      : h('div', { className: 'db-error' }, props.error),
  )
}

/** Single-line text input bound to a value. */
function TextInput(props) {
  return h('input', {
    className: 'db-input-text' + (props.className === undefined ? '' : ' ' + props.className),
    type: props.type === undefined ? 'text' : props.type,
    value: props.value === undefined || props.value === null ? '' : props.value,
    placeholder: props.placeholder,
    disabled: props.disabled === true,
    maxLength: props.maxLength,
    spellCheck: false,
    onChange: function (event) {
      props.onChange(event.target.value)
    },
    onKeyDown: props.onKeyDown,
    onBlur: props.onBlur,
  })
}

/** Multi-line text area bound to a value. */
function TextArea(props) {
  return h('textarea', {
    className: 'db-textarea',
    value: props.value === undefined || props.value === null ? '' : props.value,
    placeholder: props.placeholder,
    disabled: props.disabled === true,
    rows: props.rows === undefined ? 3 : props.rows,
    maxLength: props.maxLength,
    onChange: function (event) {
      props.onChange(event.target.value)
    },
    onKeyDown: props.onKeyDown,
  })
}

/** Native select bound to a value. */
function Select(props) {
  return h(
    'select',
    {
      className: 'db-select',
      value: props.value === undefined || props.value === null ? '' : props.value,
      disabled: props.disabled === true,
      onChange: function (event) {
        props.onChange(event.target.value)
      },
    },
    props.children,
  )
}

/** Checkbox switch row. */
function Toggle(props) {
  return h(
    'label',
    { className: 'db-toggle', title: props.title },
    h('input', {
      type: 'checkbox',
      checked: props.checked === true,
      disabled: props.disabled === true,
      onChange: function (event) {
        props.onChange(event.target.checked)
      },
    }),
    h('span', { className: 'db-toggle-track', 'aria-hidden': 'true' }),
    props.label === undefined ? null : h('span', { className: 'db-toggle-text' }, props.label),
  )
}

/** Radio-style segmented control. */
function Segmented(props) {
  var options = props.options === undefined ? [] : props.options
  return h(
    'div',
    { className: 'db-seg', role: 'group', 'aria-label': props.label },
    options.map(function (option) {
      return h(
        'button',
        {
          key: option.value,
          type: 'button',
          className: option.value === props.value ? 'is-active' : '',
          onClick: function () {
            props.onChange(option.value)
          },
        },
        option.label,
      )
    }),
  )
}

/** Small pill label. */
function Tag(props) {
  var className = 'db-tag'
  if (props.tone === 'brand') className += ' is-brand'
  else if (props.tone === 'success') className += ' is-success'
  else if (props.tone === 'error') className += ' is-error'
  return h(
    'span',
    { className: className, title: props.title },
    props.icon === undefined ? null : h(Icon, { name: props.icon, size: 9 }),
    props.children,
  )
}

/* ------------------------------------------------------------ surfaces */

/** Rendered edge in CSS pixels for each avatar size name. */
var AVATAR_EDGE = { sm: 24, md: 30, lg: 38, xl: 56 }

/**
 * Bot avatar: a library SVG when the Bot carries one, otherwise the legacy
 * initial-letter circle tinted with the Bot colour. Every surface (list, chat
 * bubble, group member picker, form preview) goes through this component so
 * the fallback is uniform.
 */
function Avatar(props) {
  var name = props.name === undefined || props.name === null ? '' : String(props.name)
  var spec = avatarLib.normalizeAvatarValue(props.avatar)
  var className = 'db-avatar'
  if (props.size === 'lg') className += ' is-lg'
  else if (props.size === 'sm') className += ' is-sm'
  else if (props.size === 'xl') className += ' is-xl'
  var edge = AVATAR_EDGE[props.size] === undefined ? AVATAR_EDGE.md : AVATAR_EDGE[props.size]

  if (spec !== undefined) {
    return h(
      'span',
      { className: className + ' is-svg', title: name, 'aria-hidden': 'true' },
      avatarLib.renderAvatar(spec, edge),
    )
  }

  var initial = initialOf(name)
  var color = typeof props.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(props.color) ? props.color : null
  var style = color === null ? undefined : { background: color + '2e', color: color, boxShadow: 'inset 0 0 0 1px ' + color + '55' }
  return h(
    'span',
    { className: className, style: style, title: name, 'aria-hidden': 'true' },
    props.image !== undefined && props.image !== null && props.image !== '' ? h('img', { src: props.image, alt: '' }) : initial,
  )
}

/** Centered empty state block. */
function Empty(props) {
  var actions = props.actions === undefined ? null : props.actions
  return h(
    'div',
    { className: 'db-empty' },
    props.glyph === undefined ? null : h('div', { className: 'db-empty-glyph' }, h(Icon, { name: props.glyph, size: 28 })),
    props.title === undefined ? null : h('h3', { className: 'db-empty-title' }, props.title),
    props.body === undefined ? null : h('p', { className: 'db-empty-body' }, props.body),
    actions === null ? null : h('div', { className: 'db-empty-actions' }, actions),
    props.note === undefined ? null : h('div', { className: 'db-empty-note' }, props.note),
  )
}

/** Inline spinner plus label. */
function Loading(props) {
  return h('div', { className: 'db-loading' }, h('span', { className: 'db-spinner' }), h('span', null, props.label))
}

/* -------------------------------------------------------- formatting */

/** First visible character of a name, upper-cased for latin initials. */
function initialOf(name) {
  var text = String(name === undefined || name === null ? '' : name).trim()
  if (text === '') return '?'
  var first = Array.from(text)[0]
  return first.toUpperCase()
}

/** `HH:MM` in the browser locale. */
function formatTime(ts) {
  var date = new Date(typeof ts === 'number' && isFinite(ts) ? ts : Date.now())
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
}

/** `MM-DD`. */
function formatDate(ts) {
  var date = new Date(typeof ts === 'number' && isFinite(ts) ? ts : Date.now())
  return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
}

/** `YYYY-MM-DD`. */
function formatDay(ts) {
  var date = new Date(typeof ts === 'number' && isFinite(ts) ? ts : Date.now())
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
}

/** Relative-ish day header: today / yesterday / MM-DD. */
function dayLabel(t, ts) {
  var date = new Date(typeof ts === 'number' && isFinite(ts) ? ts : Date.now())
  var today = new Date()
  var startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  var start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  if (start === startOfToday) return t('chat.today')
  if (start === startOfToday - 86400000) return t('chat.yesterday')
  return formatDate(ts)
}

/** Thousands-separated integer. */
function formatNumber(value) {
  var number = typeof value === 'number' && isFinite(value) ? value : 0
  return String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Two-digit padding. */
function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

/** A short one-line preview of a message for the chat list. */
function previewOf(message) {
  if (message === null || message === undefined) return ''
  var text = typeof message.text === 'string' ? message.text : ''
  if (text === '') {
    var parts = Array.isArray(message.parts) ? message.parts : []
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i] !== null && parts[i] !== undefined && parts[i].type === 'text' && typeof parts[i].text === 'string') {
        text += parts[i].text
      }
    }
  }
  text = text.replace(/\s+/g, ' ').trim()
  if (text === '' && Array.isArray(message.parts) && message.parts.length > 0) return ''
  return text.length > 60 ? text.slice(0, 60) + '…' : text
}

/**
 * Error boundary for one panel subtree.
 *
 * A single form crash must never blank the whole workbench: the boundary keeps
 * the surrounding page alive and offers a retry that remounts the children.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error: error }
  }

  componentDidCatch(error) {
    try {
      console.error('dsh-bot panel crashed:', error)
    } catch (ignored) {
      /* a logging failure must not escape the boundary */
    }
  }

  reset() {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error !== null) {
      return h(
        'div',
        { className: 'db-error-block', role: 'alert' },
        h('p', { className: 'db-error' }, this.props.message || 'This panel hit an error.'),
        h(Button, { variant: 'ghost', onClick: this.reset }, this.props.retry || 'Retry'),
      )
    }
    return this.props.children
  }
}

module.exports = {
  React: React,
  h: h,
  useStoreVersion: useStoreVersion,
  Icon: Icon,
  IconButton: IconButton,
  Button: Button,
  ConfirmButton: ConfirmButton,
  Field: Field,
  TextInput: TextInput,
  TextArea: TextArea,
  Select: Select,
  Toggle: Toggle,
  Segmented: Segmented,
  Tag: Tag,
  Avatar: Avatar,
  Empty: Empty,
  Loading: Loading,
  initialOf: initialOf,
  formatTime: formatTime,
  formatDate: formatDate,
  formatDay: formatDay,
  dayLabel: dayLabel,
  formatNumber: formatNumber,
  previewOf: previewOf,
  ErrorBoundary: ErrorBoundary,
}
