/**
 * Browser half of the dsh-bot plugin.
 *
 * Registers the zh/en dictionaries, the sidebar panel row (`sidebar.panellist`)
 * and the center-column workspace (`main`), both addressed by the same panel id
 * so the shell's row selection drives the page. An optional `settings.section`
 * page links back to the workspace from the Settings dialog.
 *
 * The store is module-level (panel switches unmount the page but not this
 * plugin), and every registration plus the injected stylesheet and the SSE
 * stream is owned by a `ctx.effect` disposer.
 */

'use strict'

var ui = require('./ui.js')
var storeModule = require('./store.js')
var locales = require('./locales.js')
var styles = require('./styles.css.js')
var page = require('./page.js')
var panels = require('./panels.js')

var h = ui.h
var PANEL_ID = 'dsh-bot'
var NS = locales.NS

/**
 * Services `apply` waits for. The locale seat is required: dictionaries
 * registered after first paint would leave the page rendering raw keys, so a
 * load-order race must pend the apply instead of being absorbed.
 */
var inject = ['slots', 'locale']

/** The one workspace store this bundle keeps across panel switches. */
var singleton = null

/** Resolve the store, minting a fresh one after a plugin reload. */
function workspaceStore() {
  if (singleton === null || singleton.disposed === true) {
    singleton = storeModule.createStore()
  }
  return singleton
}

/** Translate through the shell locale service; fall back to the key. */
function translate(ctx, key, params) {
  try {
    var bound = ctx.locale.bind(NS)
    return bound(key, params)
  } catch (error) {
    return key
  }
}

/**
 * Read one optional client service by name without injecting it.
 * The service property is tried after `ctx.get` so a deployment whose resolver
 * does not answer for a service still exposes it on the context.
 */
function optionalService(ctx, name) {
  var resolved
  try {
    if (typeof ctx.get === 'function') resolved = ctx.get(name)
  } catch (error) {
    resolved = undefined
  }
  if (resolved !== undefined && resolved !== null) return resolved
  try {
    return ctx[name]
  } catch (error) {
    return undefined
  }
}

/**
 * The GUI's session opener. The service is resolved on every click rather than
 * once: it is an optional sibling package, so it may be registered either
 * before or after this plugin mounts, and a stale undefined would hide a
 * working action. A deployment without the service simply does nothing.
 */
function sessionOpener(ctx) {
  return function (sessionId) {
    var workspace = optionalService(ctx, 'uiWorkspace')
    if (workspace === null || workspace === undefined) return
    if (typeof workspace.openSession !== 'function') return
    try {
      workspace.openSession(sessionId)
    } catch (error) {
      /* the shell refused the target; nothing sensible to do here */
    }
  }
}

/**
 * The shell's absolute-path folder picker, or a silent no-op.
 *
 * `uiWorkspace.pickDirectory()` may be missing on older shells and may resolve
 * with `undefined` when the user cancels; both are non-events for the form.
 */
function directoryPicker(ctx) {
  return function () {
    var workspace = optionalService(ctx, 'uiWorkspace')
    if (workspace === null || workspace === undefined) return Promise.resolve(undefined)
    if (typeof workspace.pickDirectory !== 'function') return Promise.resolve(undefined)
    try {
      var picked = workspace.pickDirectory()
      if (picked === undefined || picked === null) return Promise.resolve(undefined)
      return Promise.resolve(picked)
    } catch (error) {
      return Promise.resolve(undefined)
    }
  }
}

/** The panel switcher used by the settings page to jump to the workspace. */
function panelOpener(ctx) {
  return function () {
    var layout = optionalService(ctx, 'layout')
    if (layout === null || layout === undefined) return
    if (typeof layout.selectPanel !== 'function') return
    try {
      layout.selectPanel(PANEL_ID)
    } catch (error) {
      /* layout refused the id; the user can still click the sidebar row */
    }
  }
}

/**
 * The sidebar row glyph. The shell owns the row box, label, tooltip and active
 * highlight; this component draws only the glyph at the requested size and
 * carries `data-dsh-panel-entry` so skins can target the row.
 */
function BotPanelIcon(props) {
  return h(ui.Icon, {
    name: 'bot',
    size: props.size === undefined || props.size === null ? 16 : props.size,
    panelEntry: PANEL_ID,
  })
}

/**
 * Mount the plugin.
 * @param ctx client root context (services: slots, locale).
 */
function apply(ctx) {
  ctx.effect(function () {
    return locales.registerLocales(ctx)
  }, 'dsh-bot: dictionaries')

  ctx.effect(function () {
    return styles.installStyles()
  }, 'dsh-bot: styles')

  var store = workspaceStore()
  // The data channel starts with the first panel mount (the page calls
  // `store.ensureStarted()`), so a deployment that never opens this panel
  // does not hold an event-stream connection. Only teardown is bound here.
  ctx.effect(
    function () {
      return function () {
        store.dispose()
      }
    },
    'dsh-bot: store and event stream',
  )

  var slots = ctx.slots
  var opener = sessionOpener(ctx)
  var pickDirectory = directoryPicker(ctx)
  var showPanel = panelOpener(ctx)

  // Sidebar row: the shell projects the label thunk on every locale change, so
  // the row follows the Language setting without a re-registration.
  ctx.effect(
    function () {
      return slots.inject('sidebar.panellist', function () {
        return slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 40,
            label: function () {
              return translate(ctx, 'entry.label')
            },
          },
          BotPanelIcon,
        )
      })
    },
    'dsh-bot: sidebar row',
  )

  // Center-column page: same id as the row, so selecting the row shows this.
  ctx.effect(
    function () {
      return slots.inject('main', function () {
        return slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: function () {
              return { store: store, openSession: opener, pickDirectory: pickDirectory }
            },
          },
          page.BotWorkspacePage,
        )
      })
    },
    'dsh-bot: main panel',
  )

  // Optional settings page. A deployment without the settings seat loses only
  // this page; the workspace itself is unaffected.
  try {
    ctx.effect(
      function () {
        return slots.inject('settings.section', function () {
          return slots.register(
            {
              name: 'settings.section',
              id: PANEL_ID,
              order: 80,
              locale: NS,
              label: function () {
                return translate(ctx, 'settings.title')
              },
              inject: function () {
                return { store: store, openPanel: showPanel }
              },
            },
            panels.SettingsSectionPage,
          )
        })
      },
      'dsh-bot: settings section',
    )
  } catch (error) {
    /* this deployment serves no settings seat */
  }
}

module.exports = {
  PANEL_ID: PANEL_ID,
  inject: inject,
  apply: apply,
}
