/**
 * The settings drawer and the optional `settings.section` page.
 *
 * Six tabs over one module-level store: General, Bots, Groups, Memory,
 * Schedules, Usage. Every form writes through the store (which writes through
 * the HTTP transport); the drawer itself is ordinary React rendered inside the
 * page container, so no layer escapes the panel and no shell class is styled
 * from here.
 */

'use strict'

var React = require('react')
var ui = require('./ui.js')
var transport = require('./transport.js')
var avatarLib = require('./avatar.js')
var directories = require('./directories.js')

var h = ui.h
var useStoreVersion = ui.useStoreVersion
var Icon = ui.Icon

/** Scroll a form's drawer body back to its top when the form mounts. */
function useDrawerTop() {
  var ref = React.useRef(null)
  React.useEffect(
    function () {
      var element = ref.current
      if (element === null || element === undefined) return
      var parent = element.parentElement
      while (parent !== null && parent !== undefined) {
        if (parent.classList !== undefined && parent.classList.contains('db-drawer-body')) {
          parent.scrollTop = 0
          return
        }
        parent = parent.parentElement
      }
    },
    [],
  )
  return ref
}

/** Accent palette offered in the bot form. */
var PALETTE = ['#4f7cff', '#e8913d', '#2fb5a8', '#c96bce', '#e05d6f', '#3fa66a', '#5aa8e0', '#8a94a6']

/** Flat list of the Host's model catalogue. */
function modelOptions(store) {
  var models = store.data === null ? undefined : store.data.models
  var providers = models !== undefined && models !== null && Array.isArray(models.providers) ? models.providers : []
  var out = []
  for (var i = 0; i < providers.length; i += 1) {
    var provider = providers[i]
    if (provider === null || provider === undefined) continue
    var modelsOf = Array.isArray(provider.models) ? provider.models : []
    for (var j = 0; j < modelsOf.length; j += 1) {
      var model = modelsOf[j]
      if (model === null || model === undefined) continue
      out.push({
        value: String(provider.id) + '/' + String(model.id),
        label: String(provider.name === undefined ? provider.id : provider.name) + ' · ' + String(model.name === undefined ? model.id : model.name),
        efforts: Array.isArray(model.reasoningEffort) ? model.reasoningEffort : [],
      })
    }
  }
  return out
}

/** A bot/model pair as the form's select value. */
function modelValueOf(model) {
  if (model === null || model === undefined) return ''
  if (typeof model.provider !== 'string' || typeof model.model !== 'string') return ''
  return model.provider + '/' + model.model
}

/** Parse one select value back into a model pin. */
function parseModelValue(value, effort) {
  if (typeof value !== 'string' || value === '') return null
  var slash = value.indexOf('/')
  if (slash <= 0) return null
  var model = { provider: value.slice(0, slash), model: value.slice(slash + 1) }
  if (typeof effort === 'string' && effort !== '') model.reasoningEffort = effort
  return model
}

/** Permission choices, in the protocol's order. */
function permissionOptions(t) {
  return [
    { value: 'read-only', label: t('permission.read-only') },
    { value: 'workspace-write', label: t('permission.workspace-write') },
    { value: 'danger-full-access', label: t('permission.danger-full-access') },
  ]
}

/** `YYYY-MM-DDTHH:MM` in local time, one hour ahead: the once picker default. */
function defaultRunAtValue() {
  var date = new Date(Date.now() + 3600000)
  function pad(value) {
    return value < 10 ? '0' + value : String(value)
  }
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  )
}

/** Render one schedule's timing as a compact sentence. */
function timingText(t, schedule) {
  var timing = schedule === null || schedule === undefined ? undefined : schedule.timing
  if (timing === null || timing === undefined) return ''
  var kind = timing.kind === undefined ? timing.type : timing.kind
  if (kind === 'daily') return t('schedules.format.daily', { time: String(timing.time === undefined ? '--:--' : timing.time) })
  if (kind === 'every' || kind === 'interval') {
    var minutes = Number(timing.minutes === undefined ? timing.intervalMinutes : timing.minutes)
    if (Number.isFinite(minutes) && minutes >= 60 && minutes % 60 === 0) {
      return t('schedules.format.hours', { hours: String(minutes / 60) })
    }
    return t('schedules.format.every', { minutes: String(minutes) })
  }
  if (kind === 'once' || kind === 'at' || kind === 'after') {
    var when = timing.at === undefined ? timing.runAt : timing.at
    if (when === undefined || when === null) {
      var minutes = Number(timing.minutes === undefined ? timing.afterMinutes : timing.minutes)
      if (Number.isFinite(minutes) && minutes > 0) return t('schedules.format.every', { minutes: String(minutes) })
      return t('schedules.kind.once')
    }
    var stamp = typeof when === 'number' ? when : new Date(when).getTime()
    return t('schedules.format.once', { time: ui.formatDate(stamp) + ' ' + ui.formatTime(stamp) })
  }
  return String(kind === undefined ? '' : kind)
}

/* ------------------------------------------------------------------ drawer */

/** The right-side settings drawer, closed unless `store.drawer` names a tab. */
function SettingsDrawer(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  var tab = store.drawer

  React.useEffect(
    function () {
      if (tab === null || tab === undefined) return undefined
      function onKeyDown(event) {
        if (event.key === 'Escape') store.closeDrawer()
      }
      document.addEventListener('keydown', onKeyDown)
      return function () {
        document.removeEventListener('keydown', onKeyDown)
      }
    },
    [tab],
  )

  if (tab === null || tab === undefined) return null
  var tabs = [
    { id: 'general', label: t('tab.general'), icon: 'settings' },
    { id: 'bots', label: t('tab.bots'), icon: 'bot' },
    { id: 'groups', label: t('tab.groups'), icon: 'users' },
    { id: 'tasks', label: t('tab.tasks'), icon: 'tasks' },
    { id: 'memory', label: t('tab.memory'), icon: 'memory' },
    { id: 'schedules', label: t('tab.schedules'), icon: 'clock' },
    { id: 'usage', label: t('tab.usage'), icon: 'chart' },
  ]
  var body = null
  if (tab === 'general') body = h(GeneralTab, { t: t, store: store })
  else if (tab === 'bots') body = h(BotsTab, { t: t, store: store })
  else if (tab === 'groups') body = h(GroupsTab, { t: t, store: store, pickDirectory: props.pickDirectory })
  else if (tab === 'tasks') body = h(TasksTab, { t: t, store: store })
  else if (tab === 'memory') body = h(MemoryTab, { t: t, store: store })
  else if (tab === 'schedules') body = h(SchedulesTab, { t: t, store: store })
  else body = h(UsageTab, { t: t, store: store })

  return h(
    React.Fragment,
    null,
    h('div', {
      className: 'db-backdrop',
      onClick: function () {
        store.closeDrawer()
      },
    }),
    h(
      'aside',
      { className: 'db-drawer', role: 'dialog', 'aria-label': t('drawer.title') },
      h(
        'div',
        { className: 'db-drawer-head' },
        h('h2', { className: 'db-drawer-title' }, t('drawer.title')),
        h(ui.IconButton, {
          icon: 'x',
          label: t('drawer.close'),
          onClick: function () {
            store.closeDrawer()
          },
        }),
      ),
      h(
        'div',
        { className: 'db-tabs', role: 'tablist' },
        tabs.map(function (item) {
          return h(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'tab',
              'aria-selected': item.id === tab,
              className: 'db-tab' + (item.id === tab ? ' is-active' : ''),
              onClick: function () {
                store.setDrawerTab(item.id)
              },
            },
            item.label,
          )
        }),
      ),
      h('div', { key: tab, className: 'db-drawer-body' }, body),
    ),
  )
}

/* ----------------------------------------------------------------- general */

/** Personal name, bot language, and the read-only facts of the deployment. */
function GeneralTab(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  var settings = store.data === null ? { userName: '', language: 'zh' } : store.data.settings
  var pairName = React.useState(settings.userName)
  var name = pairName[0]
  var setName = pairName[1]
  var pairLang = React.useState(settings.language)
  var language = pairLang[0]
  var setLanguage = pairLang[1]
  var pairSaving = React.useState(false)
  var saving = pairSaving[0]
  var setSaving = pairSaving[1]
  var pairError = React.useState('')
  var error = pairError[0]
  var setError = pairError[1]
  var pairSaved = React.useState(false)
  var saved = pairSaved[0]
  var setSaved = pairSaved[1]

  // Follow the snapshot when it changes underneath an open form (a fresh read,
  // another tab's write); in-progress typing does not touch the snapshot.
  React.useEffect(
    function () {
      setName(settings.userName)
      setLanguage(settings.language)
    },
    [settings.userName, settings.language],
  )

  function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    store.saveConfig({ userName: name.trim(), language: language }).then(
      function () {
        setSaving(false)
        setSaved(true)
        store.flash(t('general.saved'), 'success')
      },
      function (failure) {
        setSaving(false)
        setError(transport.describeError(t, failure))
      },
    )
  }

  var limits = store.data === null ? { maxHops: 6, memoryEntryMax: 6000, groupNoteMax: 4000 } : store.data.limits
  var models = modelOptions(store)
  var providerCount = 0
  if (store.data !== null && store.data.models !== undefined && store.data.models !== null && Array.isArray(store.data.models.providers)) {
    providerCount = store.data.models.providers.length
  }

  return h(
    'div',
    { className: 'db-stack' },
    h(
      'div',
      { className: 'db-stack-tight' },
      h('h3', { className: 'db-title' }, t('tab.general')),
      h('p', { className: 'db-subtitle' }, t('general.userNameHint')),
    ),
    h(ui.Field, {
      label: t('general.userName'),
      children: h(ui.TextInput, { value: name, onChange: setName, placeholder: t('general.userName') }),
    }),
    h(ui.Field, {
      label: t('general.language'),
      hint: t('general.languageHint'),
      children: h(ui.Segmented, {
        label: t('general.language'),
        value: language,
        options: [
          { value: 'zh', label: t('general.zh') },
          { value: 'en', label: t('general.en') },
        ],
        onChange: function (value) {
          setLanguage(value)
          setSaved(false)
        },
      }),
    }),
    error === '' ? null : h('div', { className: 'db-error' }, error),
    h(
      'div',
      { className: 'db-row' },
      h(ui.Button, { variant: 'primary', disabled: saving, onClick: save }, saving ? t('general.saving') : t('general.save')),
      saved ? h('span', { className: 'db-hint' }, t('general.saved')) : null,
    ),
    h('div', { className: 'db-divider' }),
    h('h4', { className: 'db-section-title' }, t('general.connection')),
    h(
      'div',
      { className: 'db-row' },
      h('span', { className: 'db-conn-dot ' + (store.mode === 'live' ? 'is-live' : store.mode === 'mock' ? 'is-mock' : 'is-lost') }),
      h('span', { className: 'db-hint' }, store.mode === 'live' ? t('general.connectionLive') : t('general.connectionMock')),
    ),
    h('h4', { className: 'db-section-title' }, t('general.limits')),
    h('p', { className: 'db-hint' }, t('general.limitsText', {
      hops: String(limits.maxHops),
      memory: String(limits.memoryEntryMax),
      note: String(limits.groupNoteMax),
    })),
    h('h4', { className: 'db-section-title' }, t('general.models')),
    models.length === 0
      ? h('p', { className: 'db-hint' }, t('general.modelsUnknown'))
      : h('p', { className: 'db-hint' }, t('general.modelsCount', { count: String(providerCount) }) + ' · ' + models.length + ' models'),
  )
}

/* -------------------------------------------------------------------- bots */

/** The bot roster with an inline create/edit form. */
function BotsTab(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  var pairEdit = React.useState(null)
  var editing = pairEdit[0]
  var setEditing = pairEdit[1]
  var bots = store.bots()

  if (editing !== null) {
    return h(BotForm, {
      t: t,
      store: store,
      bot: editing === 'new' ? undefined : editing,
      onClose: function () {
        setEditing(null)
      },
    })
  }

  return h(
    'div',
    { className: 'db-stack' },
    h(
      'div',
      { className: 'db-row' },
      h(
        'div',
        { className: 'db-grow' },
        h('h3', { className: 'db-title' }, t('bots.title')),
        h('p', { className: 'db-subtitle' }, t('bots.subtitle')),
      ),
      h(ui.Button, { variant: 'primary', size: 'sm', icon: 'plus', onClick: function () { setEditing('new') } }, t('bots.new')),
    ),
    bots.length === 0
      ? h(ui.Empty, {
          glyph: 'bot',
          title: t('bots.empty'),
          body: t('bots.emptyHint'),
          actions: h(ui.Button, { variant: 'primary', onClick: function () { setEditing('new') } }, t('bots.new')),
        })
      : bots.map(function (bot) {
          var running = false
          var allRunning = store.running()
          for (var i = 0; i < allRunning.length; i += 1) {
            if (allRunning[i] !== null && allRunning[i].botId === bot.id) running = true
          }
          var modelText = t('bots.form.modelInherit')
          if (bot.model !== null && bot.model !== undefined) {
            modelText = String(bot.model.provider) + '/' + String(bot.model.model)
          }
          return h(
            'div',
            { key: bot.id, className: 'db-card' },
            h(
              'div',
              { className: 'db-card-head' },
              h(ui.Avatar, { name: bot.name, color: bot.color, avatar: bot.avatar, size: 'lg' }),
              h(
                'div',
                { className: 'db-card-main' },
                h(
                  'div',
                  { className: 'db-card-name' },
                  h('span', null, bot.name),
                  bot.isMain === true ? h(ui.Tag, { tone: 'brand' }, t('bots.main')) : null,
                  bot.autoApprove !== false ? h(ui.Tag, { icon: 'check' }, t('bots.autoApprove')) : null,
                  running ? h(ui.Tag, { tone: 'success' }, t('bots.running')) : null,
                ),
                h('div', { className: 'db-card-sub' }, bot.role === '' || bot.role === undefined ? t('chat.dm') : bot.role),
                h(
                  'div',
                  { className: 'db-row-wrap', style: { marginBlockStart: '4px' } },
                  h(ui.Tag, { icon: 'settings' }, t('permission.' + bot.permission)),
                  h(ui.Tag, null, modelText),
                ),
              ),
              h(
                'div',
                { className: 'db-card-actions' },
                h(ui.IconButton, { icon: 'edit', label: t('bots.edit'), onClick: function () { setEditing(bot) } }),
              ),
            ),
          )
        }),
  )
}

/** The library grid: every preset as its Host SVG tile, the current one marked. */
function AvatarGrid(props) {
  var t = props.t
  return h(
    'div',
    { className: 'db-avatar-grid' },
    avatarLib.PRESETS.map(function (preset) {
      var spec = avatarLib.avatarById(preset.id)
      return h(
        'button',
        {
          key: preset.id,
          type: 'button',
          title: preset.intent + ' · ' + preset.id,
          className: 'db-avatar-choice' + (props.avatarId === preset.id ? ' is-active' : ''),
          onClick: function () {
            if (typeof props.onPick === 'function') props.onPick(preset.id)
          },
        },
        h(ui.Avatar, { name: preset.id, avatar: spec, size: 'lg' }),
        h('span', { className: 'db-avatar-choice-label' }, preset.intent),
      )
    }),
  )
}

/** Create/edit one bot. */
function BotForm(props) {
  var t = props.t
  var store = props.store
  var bot = props.bot
  var isNew = bot === undefined
  var models = modelOptions(store)
  var limits = store.data === null ? { nameMax: 40, roleMax: 120, instructionsMax: 4000 } : store.data.limits
  var topRef = useDrawerTop()
  var pairName = React.useState(isNew ? '' : String(bot.name))
  var name = pairName[0]
  var setName = pairName[1]
  var pairRole = React.useState(isNew ? '' : String(bot.role === undefined ? '' : bot.role))
  var role = pairRole[0]
  var setRole = pairRole[1]
  var pairInstructions = React.useState(isNew ? '' : String(bot.instructions === undefined ? '' : bot.instructions))
  var instructions = pairInstructions[0]
  var setInstructions = pairInstructions[1]
  var pairModel = React.useState(modelValueOf(isNew ? null : bot.model))
  var modelValue = pairModel[0]
  var setModelValue = pairModel[1]
  var pairEffort = React.useState(
    !isNew && bot.model !== null && bot.model !== undefined && typeof bot.model.reasoningEffort === 'string' ? bot.model.reasoningEffort : '',
  )
  var effort = pairEffort[0]
  var setEffort = pairEffort[1]
  var pairPermission = React.useState(isNew ? 'workspace-write' : String(bot.permission))
  var permission = pairPermission[0]
  var setPermission = pairPermission[1]
  var pairWorkspace = React.useState(
    isNew ? '' : String(bot.workspaceId === undefined || bot.workspaceId === null ? '' : bot.workspaceId),
  )
  var workspaceId = pairWorkspace[0]
  var setWorkspaceId = pairWorkspace[1]
  var initialAvatarId =
    isNew || bot.avatar === undefined || bot.avatar === null || typeof bot.avatar.id !== 'string' ? null : bot.avatar.id
  var pairAvatarId = React.useState(initialAvatarId)
  var avatarId = pairAvatarId[0]
  var setAvatarId = pairAvatarId[1]
  var pairAvatarGrid = React.useState(false)
  var avatarGridOpen = pairAvatarGrid[0]
  var setAvatarGridOpen = pairAvatarGrid[1]
  var pairColor = React.useState(isNew ? PALETTE[0] : String(bot.color === undefined ? PALETTE[0] : bot.color))
  var color = pairColor[0]
  var setColor = pairColor[1]
  var pairHelper = React.useState(isNew ? false : bot.autoHelper === true)
  var autoHelper = pairHelper[0]
  var setAutoHelper = pairHelper[1]
  var pairAutoApprove = React.useState(isNew ? true : bot.autoApprove !== false)
  var autoApprove = pairAutoApprove[0]
  var setAutoApprove = pairAutoApprove[1]
  var pairSaving = React.useState(false)
  var saving = pairSaving[0]
  var setSaving = pairSaving[1]
  var pairError = React.useState('')
  var error = pairError[0]
  var setError = pairError[1]

  React.useEffect(
    function () {
      if (!saving) return undefined
      var timer = setTimeout(function () {
        setSaving(false)
        setError(t('bots.form.slow'))
        store.loadState()
      }, 20000)
      return function () {
        clearTimeout(timer)
      }
    },
    [saving],
  )

  var selected = null
  for (var i = 0; i < models.length; i += 1) {
    if (models[i].value === modelValue) selected = models[i]
  }
  var efforts = selected === null ? [] : selected.efforts
  var workspaceOptions = store.workspaces()
  var defaults = store.data !== null && store.data.models !== undefined && store.data.models !== null ? store.data.models.default : undefined
  var inheritLabel = t('bots.form.modelInherit')
  if (defaults !== undefined && defaults !== null && defaults.provider !== undefined) {
    inheritLabel += ' (' + String(defaults.provider) + '/' + String(defaults.model) + ')'
  }

  var identity = { name: name.trim(), role: role.trim(), instructions: instructions, isMain: isNew ? false : bot.isMain === true }
  var previewAvatar = avatarId === null ? avatarLib.matchAvatar(identity) : avatarLib.avatarById(avatarId)

  function cycleAvatar() {
    var current = -1
    for (var i = 0; i < avatarLib.PRESETS.length; i += 1) {
      if (avatarLib.PRESETS[i].id === avatarId) current = i
    }
    var next = (current + 1) % avatarLib.PRESETS.length
    setAvatarId(avatarLib.PRESETS[next].id)
  }

  function submit() {
    if (name.trim() === '') {
      setError(t('bots.form.nameRequired'))
      return
    }
    var payload = {
      name: name.trim(),
      role: role.trim(),
      instructions: instructions,
      model: parseModelValue(modelValue, effort),
      permission: permission,
      color: color,
      autoHelper: autoHelper,
      // New field: a Host that knows it uses the flag; an older Host ignores it.
      autoApprove: autoApprove,
      // Empty string explicitly clears the pin; an id pins a real workspace.
      workspaceId: workspaceId,
      // null asks the Host to auto-match from the identity; an id pins a preset.
      avatar: avatarId === null ? null : { kind: 'library', id: avatarId },
      autoAvatar: avatarId === null,
    }
    if (!isNew && bot.skin !== undefined) payload.skin = bot.skin
    setSaving(true)
    setError('')
    var action = isNew ? store.createBot(payload) : store.updateBot(bot.id, payload)
    action.then(
      function () {
        setSaving(false)
        store.flash(t('general.saved'), 'success')
        props.onClose()
      },
      function (failure) {
        setSaving(false)
        var message = transport.describeError(t, failure)
        setError(message)
        store.flash(message, 'error')
      },
    )
  }

  function remove() {
    if (isNew) return
    setSaving(true)
    store.deleteBot(bot.id).then(
      function () {
        setSaving(false)
        props.onClose()
      },
      function (failure) {
        setSaving(false)
        setError(transport.describeError(t, failure))
      },
    )
  }

  return h(
    'div',
    { className: 'db-stack', ref: topRef },
    h(
      'div',
      { className: 'db-row' },
      h(ui.IconButton, { icon: 'chevron-left', label: t('action.back'), onClick: props.onClose }),
      h('h3', { className: 'db-title' }, isNew ? t('bots.form.newTitle') : t('bots.form.editTitle')),
    ),
    h(ui.Field, {
      label: t('bots.form.name'),
      children: h(ui.TextInput, { value: name, onChange: setName, placeholder: t('bots.form.namePlaceholder'), maxLength: limits.nameMax }),
    }),
    h(ui.Field, {
      label: t('bots.form.role'),
      children: h(ui.TextInput, { value: role, onChange: setRole, placeholder: t('bots.form.rolePlaceholder'), maxLength: limits.roleMax }),
    }),
    h(ui.Field, {
      label: t('bots.form.instructions'),
      hint: t('bots.form.instructionsHint'),
      children: h(ui.TextArea, {
        value: instructions,
        onChange: setInstructions,
        placeholder: t('bots.form.instructionsPlaceholder'),
        rows: 5,
        maxLength: limits.instructionsMax,
      }),
    }),
    h(ui.Field, {
      label: t('bots.form.model'),
      children: h(
        ui.Select,
        {
          value: modelValue,
          onChange: function (value) {
            setModelValue(value)
            setEffort('')
          },
        },
        h('option', { value: '' }, inheritLabel),
        models.map(function (option) {
          return h('option', { key: option.value, value: option.value }, option.label)
        }),
      ),
    }),
    models.length === 0 ? h('p', { className: 'db-hint' }, t('bots.form.noModels')) : null,
    efforts.length === 0
      ? null
      : h(ui.Field, {
          label: t('bots.form.effort'),
          children: h(
            ui.Select,
            { value: effort, onChange: setEffort },
            h('option', { value: '' }, t('bots.form.effortDefault')),
            efforts.map(function (level) {
              return h('option', { key: level, value: level }, String(level))
            }),
          ),
        }),
    h(ui.Field, {
      label: t('bots.form.permission'),
      children: h(
        ui.Select,
        { value: permission, onChange: setPermission },
        permissionOptions(t).map(function (option) {
          return h('option', { key: option.value, value: option.value }, option.label)
        }),
      ),
    }),
    h(ui.Field, {
      label: t('bots.form.avatar'),
      hint: avatarId === null ? t('bots.form.avatarAutoHint') : t('bots.form.avatarGrid'),
      children: h(
        'div',
        { className: 'db-avatar-field' },
        h(ui.Avatar, { name: name.trim() === '' ? '?' : name, color: color, avatar: previewAvatar, size: 'xl' }),
        h(
          'div',
          { className: 'db-avatar-actions' },
          avatarId === null ? h(ui.Tag, { tone: 'brand' }, t('bots.form.avatarAutoOn')) : null,
          h(ui.Button, { size: 'sm', icon: 'refresh', onClick: cycleAvatar }, t('bots.form.avatarChange')),
          h(ui.Button, { size: 'sm', icon: 'sparkle', onClick: function () { setAvatarId(null) } }, t('bots.form.avatarAuto')),
          h(ui.Button, {
            size: 'sm',
            icon: 'chevron-down',
            onClick: function () {
              setAvatarGridOpen(!avatarGridOpen)
            },
          }, t('bots.form.avatarMore')),
        ),
      ),
    }),
    avatarGridOpen
      ? h(AvatarGrid, {
          t: t,
          avatarId: avatarId,
          onPick: function (id) {
            setAvatarId(id)
            setAvatarGridOpen(false)
          },
        })
      : null,
    h(ui.Field, {
      label: t('bots.form.workspace'),
      hint: t('bots.form.workspaceHint'),
      children: workspaceOptions.length === 0
        ? h('div', { className: 'db-inline-note' }, t('bots.form.workspaceEmpty'))
        : h(
            ui.Select,
            { value: workspaceId, onChange: setWorkspaceId },
            h('option', { value: '' }, t('bots.form.workspaceDefault')),
            workspaceOptions.map(function (workspace) {
              return h('option', { key: workspace.id, value: workspace.id }, String(workspace.title === undefined ? workspace.id : workspace.title) + (workspace.path === undefined ? '' : ' · ' + workspace.path))
            }),
          ),
    }),
    h(ui.Field, {
      label: t('bots.form.color'),
      children: h(
        'div',
        { className: 'db-color-field' },
        h(ui.Avatar, { name: name.trim() === '' ? '?' : name, color: color, avatar: avatarId === null ? undefined : previewAvatar, size: 'xl' }),
        h(
          'div',
          { className: 'db-swatches' },
          PALETTE.map(function (swatch) {
            return h('button', {
              key: swatch,
              type: 'button',
              className: 'db-swatch' + (swatch === color ? ' is-active' : ''),
              style: { background: swatch },
              'aria-label': swatch,
              onClick: function () {
                setColor(swatch)
              },
            })
          }),
        ),
      ),
    }),
    h(
      'div',
      { className: 'db-stack-tight' },
      h(ui.Toggle, {
        checked: autoHelper,
        onChange: setAutoHelper,
        label: t('bots.form.autoHelper'),
        title: t('bots.form.autoHelperHint'),
      }),
      h('p', { className: 'db-hint' }, t('bots.form.autoHelperHint')),
      h(ui.Toggle, {
        checked: autoApprove,
        onChange: setAutoApprove,
        label: t('bots.form.autoApprove'),
        title: t('bots.form.autoApproveHint'),
      }),
      h('p', { className: 'db-hint' }, t('bots.form.autoApproveHint')),
    ),
    h(
      'div',
      { className: 'db-form-actions' },
      error === '' ? null : h('div', { className: 'db-error' }, error),
      h(ui.Button, { variant: 'primary', disabled: saving, onClick: submit }, saving ? t('bots.form.saving') : isNew ? t('bots.form.create') : t('bots.form.save')),
      h(ui.Button, { variant: 'ghost', disabled: saving, onClick: props.onClose }, t('bots.form.cancel')),
      h('div', { className: 'db-spacer' }),
      isNew ? null : h(ui.ConfirmButton, {
        label: t('bots.delete'),
        confirmLabel: t('action.confirm'),
        title: t('bots.deleteConfirm', { name: bot.name }),
        disabled: saving,
        onConfirm: remove,
      }),
    ),
  )
}

/* ------------------------------------------------------------------ groups */

/** Group roster with an inline create/edit form. */
function GroupsTab(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  var pairEdit = React.useState(null)
  var editing = pairEdit[0]
  var setEditing = pairEdit[1]
  var groups = store.groups()
  var bots = store.bots()

  if (editing !== null) {
    return h(GroupForm, {
      key: editing === 'new' ? 'new' : String(editing.id),
      t: t,
      store: store,
      group: editing === 'new' ? undefined : editing,
      pickDirectory: props.pickDirectory,
      onClose: function () {
        setEditing(null)
      },
    })
  }

  return h(
    'div',
    { className: 'db-stack' },
    h(
      'div',
      { className: 'db-row' },
      h(
        'div',
        { className: 'db-grow' },
        h('h3', { className: 'db-title' }, t('groups.title')),
        h('p', { className: 'db-subtitle' }, t('groups.subtitle')),
      ),
      h(
        ui.Button,
        {
          variant: 'primary',
          size: 'sm',
          icon: 'plus',
          disabled: bots.length < 2,
          title: bots.length < 2 ? t('groups.form.needBots') : undefined,
          onClick: function () {
            setEditing('new')
          },
        },
        t('groups.new'),
      ),
    ),
    bots.length < 2 ? h('div', { className: 'db-inline-note' }, t('groups.form.needBots')) : null,
    groups.length === 0
      ? h(ui.Empty, {
          glyph: 'users',
          title: t('groups.empty'),
          body: t('groups.emptyHint'),
          actions: h(
            ui.Button,
            { variant: 'primary', disabled: bots.length < 2, onClick: function () { setEditing('new') } },
            t('groups.new'),
          ),
        })
      : groups.map(function (group) {
          var admin = store.botById(group.adminId)
          var members = Array.isArray(group.memberIds) ? group.memberIds : []
          return h(
            'div',
            { key: group.id, className: 'db-card' },
            h(
              'div',
              { className: 'db-card-head' },
              h(
                'span',
                {
                  className: 'db-avatar is-lg',
                  style: {
                    background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent)',
                    color: 'var(--dsw-alias-brand-primary)',
                  },
                },
                h(Icon, { name: 'users', size: 17 }),
              ),
              h(
                'div',
                { className: 'db-card-main' },
                h('div', { className: 'db-card-name' }, h('span', null, group.name)),
                h(
                  'div',
                  { className: 'db-card-sub' },
                  admin === undefined ? String(group.adminId) : admin.name,
                  ' · ',
                  t('groups.memberCount', { count: String(members.length) }),
                  ' · ',
                  group.replyMode === 'admin' ? t('groups.form.replyMode.admin') : t('groups.form.replyMode.all'),
                ),
                directories.summaryText(directories.normalize(group.workspaces), t) === ''
                  ? null
                  : h('div', { className: 'db-card-sub db-card-dir' }, directories.summaryText(directories.normalize(group.workspaces), t)),
              ),
              h(
                'div',
                { className: 'db-card-actions' },
                h(ui.IconButton, { icon: 'edit', label: t('groups.edit'), onClick: function () { setEditing(group) } }),
              ),
            ),
            h(GroupNoteSection, { t: t, store: store, group: group }),
            group.notice === undefined || group.notice === '' ? null : h('div', { className: 'db-hint', style: { marginBlockStart: '6px' } }, String(group.notice)),
          )
        }),
  )
}

/** One group's note: the entries plus the (contract-optional) clear control. */
function GroupNoteSection(props) {
  var t = props.t
  var store = props.store
  var group = props.group
  var entries = Array.isArray(group.noteEntries) ? group.noteEntries : []
  var pairBusy = React.useState(false)
  var busy = pairBusy[0]
  var setBusy = pairBusy[1]

  if (entries.length === 0) {
    return h('div', { className: 'db-hint', style: { marginBlockStart: '6px' } }, t('groups.noteEmpty'))
  }

  function clear() {
    setBusy(true)
    store.clearGroupNote(group.id).then(
      function (result) {
        setBusy(false)
        store.flash(result.cleared ? t('groups.noteClearDone') : t('groups.noteClearUnsupported'), result.cleared ? 'success' : 'error')
      },
      function (error) {
        setBusy(false)
        store.flash(transport.describeError(t, error), 'error')
      },
    )
  }

  return h(
    'div',
    { className: 'db-note-section' },
    h(
      'div',
      { className: 'db-row' },
      h('span', { className: 'db-section-title' }, t('groups.note')),
      h(ui.Tag, null, t('groups.noteCount', { count: String(entries.length) })),
      h('div', { className: 'db-spacer' }),
      h(ui.ConfirmButton, {
        label: t('groups.noteClear'),
        confirmLabel: t('groups.noteClearConfirm'),
        title: t('groups.noteClear'),
        disabled: busy,
        onConfirm: clear,
      }),
    ),
    entries.slice(-4).map(function (note, index) {
      return h(
        'div',
        { key: 'note-' + index, className: 'db-hint db-note-entry' },
        h('strong', null, String(note.speaker === undefined ? '' : note.speaker) + '：'),
        String(note.text === undefined ? '' : note.text),
      )
    }),
  )
}

/** Create/edit one group. */
function GroupForm(props) {
  var t = props.t
  var store = props.store
  var group = props.group
  var isNew = group === undefined
  var bots = store.bots()
  var limits = store.data === null ? { nameMax: 40, groupNoteMax: 4000, noticeMax: 500 } : store.data.limits
  var topRef = useDrawerTop()
  var pairName = React.useState(isNew ? '' : String(group.name))
  var name = pairName[0]
  var setName = pairName[1]
  var pairAdmin = React.useState(
    isNew ? (bots.length > 0 ? String(bots[0].id) : '') : String(group.adminId),
  )
  var adminId = pairAdmin[0]
  var setAdminId = pairAdmin[1]
  var pairMembers = React.useState(
    isNew
      ? bots.slice(0, Math.min(2, bots.length)).map(function (bot) {
          return String(bot.id)
        })
      : (Array.isArray(group.memberIds) ? group.memberIds.slice() : []),
  )
  var memberIds = pairMembers[0]
  var setMemberIds = pairMembers[1]
  var pairMode = React.useState(isNew ? 'all' : String(group.replyMode))
  var replyMode = pairMode[0]
  var setReplyMode = pairMode[1]
  var pairHops = React.useState(isNew ? String(store.data === null ? 3 : store.data.limits.maxHops) : String(group.maxHops))
  var maxHops = pairHops[0]
  var setMaxHops = pairHops[1]
  var pairHandover = React.useState(isNew ? true : group.handover === true)
  var handover = pairHandover[0]
  var setHandover = pairHandover[1]
  var pairNote = React.useState(isNew ? true : group.useNote === true)
  var useNote = pairNote[0]
  var setUseNote = pairNote[1]
  var pairNotice = React.useState(isNew ? '' : String(group.notice === undefined ? '' : group.notice))
  var notice = pairNotice[0]
  var setNotice = pairNotice[1]
  var initialDirectories = isNew ? [] : directories.normalize(group.workspaces)
  var pairDirectories = React.useState(initialDirectories)
  var directoryList = pairDirectories[0]
  var setDirectoryList = pairDirectories[1]
  var pairReset = React.useState(true)
  var resetSessions = pairReset[0]
  var setResetSessions = pairReset[1]
  var directoriesChanged = !directories.sameEntries(initialDirectories, directoryList)
  var availableWorkspaces = []
  var allWorkspaces = store.workspaces()
  for (var wi = 0; wi < allWorkspaces.length; wi += 1) {
    if (directories.addWorkspace(directoryList, allWorkspaces[wi]).added === true) availableWorkspaces.push(allWorkspaces[wi])
  }
  var pairSaving = React.useState(false)
  var saving = pairSaving[0]
  var setSaving = pairSaving[1]
  var pairError = React.useState('')
  var error = pairError[0]
  var setError = pairError[1]

  function toggleMember(botId, checked) {
    if (checked) {
      if (memberIds.indexOf(botId) < 0) setMemberIds(memberIds.concat([botId]))
    } else {
      if (botId === adminId) return
      setMemberIds(
        memberIds.filter(function (id) {
          return id !== botId
        }),
      )
    }
  }

  function addWorkspaceChoice(workspaceId) {
    var list = store.workspaces()
    for (var i = 0; i < list.length; i += 1) {
      if (String(list[i].id) !== String(workspaceId)) continue
      setDirectoryList(directories.addWorkspace(directoryList, list[i]).entries)
      return
    }
  }

  function addPickedDirectory() {
    directories.pickDirectoryEntries(directoryList, props.pickDirectory).then(function (result) {
      if (result.added === true) setDirectoryList(result.entries)
    })
  }

  function submit() {
    if (name.trim() === '') {
      setError(t('bots.form.nameRequired'))
      return
    }
    if (memberIds.length < 2) {
      setError(t('groups.form.membersRequired'))
      return
    }
    var members = memberIds.slice()
    if (members.indexOf(adminId) < 0) members.push(adminId)
    var hops = parseInt(maxHops, 10)
    if (!isFinite(hops)) hops = 0
    var payload = directories.applyToPayload(
      {
        name: name.trim(),
        adminId: adminId,
        memberIds: members,
        notice: notice,
        replyMode: replyMode,
        maxHops: Math.max(0, Math.min(20, hops)),
        handover: handover,
        useNote: useNote,
      },
      directoryList,
    )
    var resetOption = directories.resetFlag(initialDirectories, directoryList, resetSessions)
    setSaving(true)
    setError('')
    var action = isNew
      ? store.createGroup(payload, { resetSessions: resetOption })
      : store.updateGroup(group.id, payload, { resetSessions: resetOption })
    action.then(
      function (result) {
        setSaving(false)
        var saved = isNew
          ? store.groups().filter(function (item) { return item.name === name.trim() }).pop()
          : store.groupById(group.id)
        var savedDirs = saved === undefined ? [] : directories.normalize(saved.workspaces)
        var unsupported = directoryList.length > 0 && savedDirs.length !== directoryList.length
        var sessionsReset = result !== null && typeof result === 'object' && result.sessionsReset === true
        if (unsupported) store.flash(t('groups.dirsUnsupported'), 'error')
        else store.flash(sessionsReset ? t('groups.sessionsReset') : t('general.saved'), 'success')
        props.onClose()
      },
      function (failure) {
        setSaving(false)
        var message = transport.describeError(t, failure)
        setError(message)
        store.flash(message, 'error')
      },
    )
  }

  function remove() {
    if (isNew) return
    setSaving(true)
    store.deleteGroup(group.id).then(
      function () {
        setSaving(false)
        props.onClose()
      },
      function (failure) {
        setSaving(false)
        setError(transport.describeError(t, failure))
      },
    )
  }

  var noteCount = !isNew && Array.isArray(group.noteEntries) ? group.noteEntries.length : 0

  return h(
    'div',
    { className: 'db-stack', ref: topRef },
    h(
      'div',
      { className: 'db-row' },
      h(ui.IconButton, { icon: 'chevron-left', label: t('action.back'), onClick: props.onClose }),
      h('h3', { className: 'db-title' }, isNew ? t('groups.form.newTitle') : t('groups.form.editTitle')),
    ),
    h(ui.Field, {
      label: t('groups.form.name'),
      children: h(ui.TextInput, { value: name, onChange: setName, placeholder: t('groups.form.namePlaceholder'), maxLength: limits.nameMax }),
    }),
    h(ui.Field, {
      label: t('groups.form.admin'),
      children: h(
        ui.Select,
        {
          value: adminId,
          onChange: function (value) {
            setAdminId(value)
            if (memberIds.indexOf(value) < 0) setMemberIds(memberIds.concat([value]))
          },
        },
        bots.map(function (bot) {
          return h('option', { key: bot.id, value: bot.id }, bot.name)
        }),
      ),
    }),
    h(ui.Field, {
      label: t('groups.form.members'),
      hint: t('groups.form.membersHint'),
      children: h(
        'div',
        { className: 'db-checks' },
        bots.map(function (bot) {
          var checked = memberIds.indexOf(bot.id) >= 0
          var isAdmin = bot.id === adminId
          return h(
            'label',
            { key: bot.id, className: 'db-check' },
            h('input', {
              type: 'checkbox',
              checked: checked,
              disabled: isAdmin,
              onChange: function (event) {
                toggleMember(bot.id, event.target.checked)
              },
            }),
            h(ui.Avatar, { name: bot.name, color: bot.color, avatar: bot.avatar, size: 'sm' }),
            h('span', null, bot.name),
            isAdmin ? h(ui.Tag, { tone: 'brand' }, t('groups.form.admin')) : null,
          )
        }),
      ),
    }),
    h(ui.Field, {
      label: t('groups.form.replyMode'),
      hint: t('groups.form.replyModeHint'),
      children: h(ui.Segmented, {
        label: t('groups.form.replyMode'),
        value: replyMode,
        options: [
          { value: 'admin', label: t('groups.form.replyMode.admin') },
          { value: 'all', label: t('groups.form.replyMode.all') },
        ],
        onChange: setReplyMode,
      }),
    }),
    h(ui.Field, {
      label: t('groups.form.maxHops'),
      hint: t('groups.form.maxHopsHint2'),
      children: h(ui.TextInput, { type: 'number', value: maxHops, onChange: setMaxHops }),
    }),
    h(
      'div',
      { className: 'db-stack-tight' },
      h(ui.Toggle, { checked: handover, onChange: setHandover, label: t('groups.form.handover') }),
      h('p', { className: 'db-hint' }, t('groups.form.handoverHint')),
      h(ui.Toggle, { checked: useNote, onChange: setUseNote, label: t('groups.form.useNote') }),
      h('p', { className: 'db-hint' }, t('groups.form.useNoteHint')),
    ),
    h(ui.Field, {
      label: t('groups.form.notice'),
      children: h(ui.TextArea, {
        value: notice,
        onChange: setNotice,
        placeholder: t('groups.form.noticePlaceholder'),
        rows: 3,
        maxLength: limits.noticeMax,
      }),
    }),
    h(ui.Field, {
      label: t('groups.form.directories'),
      hint: t('groups.form.directoriesHint'),
      children: h(
        'div',
        { className: 'db-dir-field' },
        directoryList.length === 0
          ? h('div', { className: 'db-dir-empty' }, t('groups.form.noDirs'))
          : h(
              'div',
              { className: 'db-dir-list' },
              directoryList.map(function (entry, index) {
                return h(
                  'div',
                  { key: (entry.id === undefined ? 'p:' : 'i:') + String(entry.id === undefined ? entry.path : entry.id) + ':' + String(index), className: 'db-dir-item' },
                  h('span', { className: 'db-dir-icon' }, h(Icon, { name: 'folder', size: 14 })),
                  h(
                    'span',
                    { className: 'db-dir-main' },
                    h('span', { className: 'db-dir-title', title: entry.title }, entry.title),
                    entry.path === undefined ? null : h('span', { className: 'db-dir-path', title: entry.path }, entry.path),
                  ),
                  index === 0
                    ? h(ui.Tag, { tone: 'brand' }, t('groups.form.primaryDir'))
                    : h(ui.Button, {
                        size: 'sm',
                        variant: 'ghost',
                        onClick: function () {
                          setDirectoryList(directories.promote(directoryList, index))
                        },
                      }, t('groups.form.promoteDir')),
                  h(ui.IconButton, {
                    icon: 'x',
                    size: 12,
                    label: t('groups.form.removeDir'),
                    title: t('groups.form.removeDir'),
                    onClick: function () {
                      setDirectoryList(directories.removeAt(directoryList, index))
                    },
                  }),
                )
              }),
            ),
        h(
          'div',
          { className: 'db-dir-add' },
          availableWorkspaces.length === 0
            ? h('span', { className: 'db-hint' }, t('groups.form.noWorkspaces'))
            : h(
                ui.Select,
                {
                  value: '',
                  onChange: function (value) {
                    if (value !== '') addWorkspaceChoice(value)
                  },
                },
                h('option', { value: '' }, t('groups.form.addWorkspace')),
                availableWorkspaces.map(function (workspace) {
                  return h(
                    'option',
                    { key: workspace.id, value: String(workspace.id) },
                    String(workspace.title === undefined ? workspace.id : workspace.title) +
                      (workspace.path === undefined ? '' : ' · ' + workspace.path),
                  )
                }),
              ),
          h(ui.Button, { size: 'sm', icon: 'folder', onClick: addPickedDirectory }, t('groups.form.addFolder')),
        ),
        directoriesChanged
          ? h(
              'div',
              { className: 'db-dir-reset' },
              h(
                'label',
                { className: 'db-check' },
                h('input', {
                  type: 'checkbox',
                  checked: resetSessions,
                  onChange: function (event) {
                    setResetSessions(event.target.checked)
                  },
                }),
                h('span', null, t('groups.form.resetSessions')),
              ),
              h('p', { className: 'db-hint' }, t('groups.form.resetSessionsHint')),
            )
          : null,
      ),
    }),
    h(
      'div',
      { className: 'db-row' },
      h('span', { className: 'db-hint' }, t('groups.noteCount', { count: String(noteCount) })),
      h('div', { className: 'db-spacer' }),
      !isNew && noteCount > 0
        ? h(ui.ConfirmButton, {
            label: t('groups.noteClear'),
            confirmLabel: t('groups.noteClearConfirm'),
            title: t('groups.noteClear'),
            disabled: saving,
            onConfirm: function () {
              store.clearGroupNote(group.id).then(
                function (result) {
                  store.flash(result.cleared ? t('groups.noteClearDone') : t('groups.noteClearUnsupported'), result.cleared ? 'success' : 'error')
                },
                function (failure) {
                  store.flash(transport.describeError(t, failure), 'error')
                },
              )
            },
          })
        : null,
    ),
    error === '' ? null : h('div', { className: 'db-error' }, error),
    h(
      'div',
      { className: 'db-form-actions' },
      h(ui.Button, { variant: 'primary', disabled: saving, onClick: submit }, saving ? t('groups.form.saving') : isNew ? t('groups.form.create') : t('groups.form.save')),
      h(ui.Button, { variant: 'ghost', disabled: saving, onClick: props.onClose }, t('groups.form.cancel')),
      h('div', { className: 'db-spacer' }),
      isNew ? null : h(ui.ConfirmButton, {
        label: t('groups.delete'),
        confirmLabel: t('action.confirm'),
        title: t('groups.deleteConfirm', { name: group.name }),
        disabled: saving,
        onConfirm: remove,
      }),
    ),
  )
}

/* ------------------------------------------------------------------ memory */

/** Team-level and per-bot memory: auto switch, pending candidates, editing. */
function MemoryTab(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  var memory = store.memory
  var pairText = React.useState('')
  var text = pairText[0]
  var setText = pairText[1]
  var pairSaving = React.useState(false)
  var saving = pairSaving[0]
  var setSaving = pairSaving[1]
  var pairEditing = React.useState(null)
  var editingId = pairEditing[0]
  var setEditingId = pairEditing[1]
  var pairEditText = React.useState('')
  var editText = pairEditText[0]
  var setEditText = pairEditText[1]
  var pairEditBusy = React.useState(false)
  var editBusy = pairEditBusy[0]
  var setEditBusy = pairEditBusy[1]
  var pairCandidateEdit = React.useState(null)
  var candidateEditId = pairCandidateEdit[0]
  var setCandidateEditId = pairCandidateEdit[1]
  var pairCandidateText = React.useState('')
  var candidateText = pairCandidateText[0]
  var setCandidateText = pairCandidateText[1]
  var pairAutoBusy = React.useState(false)
  var autoBusy = pairAutoBusy[0]
  var setAutoBusy = pairAutoBusy[1]
  var bots = store.bots()
  var entryMax = store.data === null ? 6000 : store.data.limits.memoryEntryMax
  var candidates = Array.isArray(memory.candidates) ? memory.candidates : []
  var autoMemory = memory.autoMemory !== false

  React.useEffect(
    function () {
      if (!memory.loaded && !memory.loading) store.loadMemory(memory.scope, memory.botId, true)
    },
    [memory.scope, memory.botId],
  )

  function add() {
    var value = text.trim()
    if (value === '') return
    setSaving(true)
    store.remember(value).then(
      function () {
        setSaving(false)
        setText('')
      },
      function (failure) {
        setSaving(false)
        store.flash(transport.describeError(t, failure), 'error')
      },
    )
  }

  function toggleAuto() {
    setAutoBusy(true)
    store.setAutoMemory(!autoMemory).then(
      function () {
        setAutoBusy(false)
      },
      function (failure) {
        setAutoBusy(false)
        store.flash(transport.describeError(t, failure), 'error')
      },
    )
  }

  function startEdit(entry) {
    setEditingId(entry.id)
    setEditText(String(entry.text === undefined ? '' : entry.text))
  }

  function saveEdit(entry) {
    var value = editText.trim()
    if (value === '') return
    setEditBusy(true)
    store.memoryEdit(entry.scope, entry.id, value, entry.revision).then(
      function () {
        setEditBusy(false)
        setEditingId(null)
        store.flash(t('general.saved'), 'success')
      },
      function (failure) {
        setEditBusy(false)
        store.flash(transport.describeError(t, failure), 'error')
      },
    )
  }

  function togglePin(entry) {
    store
      .memoryEdit(entry.scope, entry.id, undefined, entry.revision, { pinned: entry.pinned !== true })
      .catch(function (failure) {
        store.flash(transport.describeError(t, failure), 'error')
      })
  }

  function forgetEntry(entry) {
    store.forget(entry.id).catch(function (failure) {
      store.flash(transport.describeError(t, failure), 'error')
    })
  }

  function startCandidateEdit(candidate) {
    setCandidateEditId(candidate.id)
    setCandidateText(String(candidate.text === undefined ? '' : candidate.text))
  }

  function acceptCandidate(candidate, editedText) {
    store.memoryAccept(candidate.id, editedText).then(
      function () {
        setCandidateEditId(null)
        setCandidateText('')
        store.flash(t('memory.accepted'), 'success')
      },
      function (failure) {
        store.flash(transport.describeError(t, failure), 'error')
      },
    )
  }

  function rejectCandidate(candidate) {
    store.memoryReject(candidate.id).then(
      function () {
        if (candidateEditId === candidate.id) {
          setCandidateEditId(null)
          setCandidateText('')
        }
        store.flash(t('memory.ignored'), 'success')
      },
      function (failure) {
        store.flash(transport.describeError(t, failure), 'error')
      },
    )
  }

  function sourceLabel(candidate) {
    var source = candidate.source === undefined || candidate.source === null ? {} : candidate.source
    var chatId = source.chatId
    var chat = chatId === undefined ? undefined : store.chatById(chatId)
    if (chat !== undefined && chat !== null) return t('memory.sourceChat', { name: store.chatTitle(chat) })
    return chatId === undefined ? t('memory.sourceAuto') : String(chatId)
  }

  var candidateSection = [
    h(
      'div',
      { key: 'cand-head', className: 'db-row' },
      h('span', { className: 'db-section-title' }, t('memory.candidates')),
      h(ui.Tag, { tone: candidates.length > 0 ? 'brand' : undefined }, t('memory.candidateCount', { count: String(candidates.length) })),
    ),
    candidates.length === 0
      ? h('p', { key: 'cand-empty', className: 'db-hint' }, t('memory.candidatesEmpty'))
      : candidates.map(function (candidate) {
          var editing = candidateEditId === candidate.id
          var confidence = typeof candidate.confidence === 'number' ? Math.round(Math.max(0, Math.min(1, candidate.confidence)) * 100) : undefined
          return h(
            'div',
            { key: candidate.id, className: 'db-mem-item is-candidate' },
            h(
              'div',
              { className: 'db-mem-text' },
              editing
                ? h(ui.TextArea, {
                    value: candidateText,
                    onChange: setCandidateText,
                    rows: 2,
                    maxLength: entryMax,
                  })
                : h('span', { className: 'db-mem-body' }, String(candidate.text === undefined ? '' : candidate.text)),
              h(
                'div',
                { className: 'db-mem-meta' },
                h(ui.Tag, null, candidate.scope === 'bot' ? t('memory.scope.bot') : t('memory.scope.team')),
                typeof confidence === 'number' ? h('span', null, t('memory.confidence', { value: String(confidence) })) : null,
                h('span', null, sourceLabel(candidate)),
              ),
              candidate.reason === undefined || candidate.reason === '' ? null : h('div', { className: 'db-mem-reason' }, t('memory.reason') + '：' + String(candidate.reason)),
            ),
            h(
              'div',
              { className: 'db-mem-actions' },
              editing
                ? h(
                    'span',
                    { className: 'db-row db-gap' },
                    h(ui.Button, { size: 'sm', variant: 'primary', disabled: candidateText.trim() === '', onClick: function () { acceptCandidate(candidate, candidateText) } }, t('memory.acceptEdit')),
                    h(ui.Button, { size: 'sm', variant: 'ghost', onClick: function () { setCandidateEditId(null); setCandidateText('') } }, t('action.cancel')),
                  )
                : h(
                    'span',
                    { className: 'db-row db-gap' },
                    h(ui.Button, { size: 'sm', variant: 'primary', onClick: function () { acceptCandidate(candidate) } }, t('memory.accept')),
                    h(ui.Button, { size: 'sm', variant: 'ghost', onClick: function () { startCandidateEdit(candidate) } }, t('memory.acceptEdit')),
                    h(ui.Button, { size: 'sm', variant: 'ghost', onClick: function () { rejectCandidate(candidate) } }, t('memory.ignore')),
                  ),
            ),
          )
        }),
  ]

  return h(
    'div',
    { className: 'db-stack' },
    h(
      'div',
      null,
      h('h3', { className: 'db-title' }, t('memory.title')),
      h('p', { className: 'db-subtitle' }, t('memory.subtitle')),
    ),
    h(
      'div',
      { className: 'db-mem-auto' },
      h(ui.Toggle, {
        checked: autoMemory,
        disabled: autoBusy,
        label: t('memory.auto'),
        onChange: toggleAuto,
      }),
      h('p', { className: 'db-hint' }, t('memory.autoHint')),
    ),
    h('div', { className: 'db-mem-candidates' }, candidateSection),
    h(ui.Segmented, {
      label: t('memory.title'),
      value: memory.scope,
      options: [
        { value: 'team', label: t('memory.scope.team') },
        { value: 'bot', label: t('memory.scope.bot') },
      ],
      onChange: function (value) {
        var nextBot = value === 'bot' ? (memory.botId === null ? (bots.length > 0 ? bots[0].id : null) : memory.botId) : null
        store.loadMemory(value, nextBot, true)
      },
    }),
    memory.scope === 'bot'
      ? bots.length === 0
        ? h('div', { className: 'db-inline-note' }, t('memory.needBot'))
        : h(ui.Field, {
            label: t('memory.scope.bot'),
            children: h(
              ui.Select,
              {
                value: memory.botId === null ? '' : memory.botId,
                onChange: function (value) {
                  store.loadMemory('bot', value === '' ? null : value, true)
                },
              },
              bots.map(function (bot) {
                return h('option', { key: bot.id, value: bot.id }, bot.name)
              }),
            ),
          })
      : null,
    h(ui.Field, {
      label: t('memory.add'),
      hint: t('memory.entryMax', { max: String(entryMax) }),
      children: h(ui.TextArea, {
        value: text,
        onChange: setText,
        placeholder: t('memory.addPlaceholder'),
        rows: 3,
        maxLength: entryMax,
      }),
    }),
    h(
      'div',
      { className: 'db-row' },
      h(ui.Button, { variant: 'primary', disabled: saving || text.trim() === '', onClick: add }, saving ? t('memory.adding') : t('memory.add')),
      h('div', { className: 'db-spacer' }),
      h('span', { className: 'db-hint' }, t('memory.total', { count: String(memory.entries.length) })),
    ),
    memory.error !== null && memory.error !== undefined
      ? h('div', { className: 'db-inline-note is-error' }, t('memory.error', { detail: transport.describeError(t, memory.error) }))
      : null,
    memory.loading && memory.entries.length === 0
      ? h(ui.Loading, { label: t('memory.loading') })
      : memory.entries.length === 0
        ? h(ui.Empty, { glyph: 'memory', title: t('memory.empty'), body: t('memory.emptyHint') })
        : memory.entries.map(function (entry, index) {
            var entryId = entry.id === undefined ? entry.key : entry.id
            var editing = editingId === entryId
            var scopeLabel =
              entry.scope === 'bot' ? t('memory.scope.bot') : entry.scope === 'self' ? t('memory.scope.self') : t('memory.scope.team')
            var at = entry.addedAt === undefined ? entry.at : entry.addedAt
            return h(
              'div',
              { key: String(entryId === undefined ? index : entryId), className: 'db-mem-item' },
              h(
                'div',
                { className: 'db-mem-text' },
                editing
                  ? h(ui.TextArea, { value: editText, onChange: setEditText, rows: 3, maxLength: entryMax })
                  : h('span', { className: 'db-mem-body' }, String(entry.text === undefined ? (entry.value === undefined ? '' : entry.value) : entry.text)),
                h(
                  'div',
                  { className: 'db-mem-meta' },
                  h(ui.Tag, null, scopeLabel),
                  entry.auto === true ? h(ui.Tag, { tone: 'brand' }, t('memory.autoBadge')) : null,
                  entry.pinned === true ? h(ui.Tag, null, t('memory.pinned')) : null,
                  at === undefined ? null : h('span', null, ui.formatDate(at) + ' ' + ui.formatTime(at)),
                ),
              ),
              h(
                'div',
                { className: 'db-mem-actions' },
                editing
                  ? h(
                      'span',
                      { className: 'db-row db-gap' },
                      h(ui.Button, { size: 'sm', variant: 'primary', disabled: editBusy || editText.trim() === '', onClick: function () { saveEdit(entry) } }, editBusy ? t('memory.saving') : t('action.save')),
                      h(ui.Button, { size: 'sm', variant: 'ghost', onClick: function () { setEditingId(null) } }, t('action.cancel')),
                    )
                  : h(
                      'span',
                      { className: 'db-row db-gap' },
                      h(ui.IconButton, {
                        icon: 'edit',
                        size: 12,
                        label: t('memory.edit'),
                        title: t('memory.edit'),
                        disabled: entryId === undefined,
                        onClick: function () { startEdit(entry) },
                      }),
                      h(ui.IconButton, {
                        icon: 'pin',
                        size: 12,
                        label: entry.pinned === true ? t('memory.unpin') : t('memory.pin'),
                        title: entry.pinned === true ? t('memory.unpin') : t('memory.pin'),
                        active: entry.pinned === true,
                        onClick: function () { togglePin(entry) },
                      }),
                      h(ui.ConfirmButton, {
                        label: t('memory.delete'),
                        confirmLabel: t('action.confirm'),
                        title: t('memory.deleteConfirm'),
                        disabled: entryId === undefined,
                        onConfirm: function () { forgetEntry(entry) },
                      }),
                    ),
              ),
            )
          }),
  )
}

/* --------------------------------------------------------------- schedules */

/** `YYYY-MM-DDTHH:MM` in local time from an ISO instant. */
function toLocalInputValue(value) {
  var date = new Date(value)
  if (!isFinite(date.getTime())) return defaultRunAtValue()
  function pad(number) {
    return number < 10 ? '0' + number : String(number)
  }
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  )
}

/** Blank form state. */
function emptyScheduleForm(store) {
  var bots = store.bots()
  return {
    title: '',
    prompt: '',
    botId: bots.length > 0 ? String(bots[0].id) : '',
    kind: 'daily',
    time: '09:00',
    everyMinutes: '60',
    onceMinutes: '10',
    atLocal: defaultRunAtValue(),
  }
}

/** Fill the form from an existing ScheduleView. */
function formOfSchedule(schedule) {
  var timing = schedule.timing !== null && schedule.timing !== undefined ? schedule.timing : {}
  var kind =
    timing.kind === 'every' || timing.kind === 'interval'
      ? 'every'
      : timing.kind === 'once' || timing.kind === 'after'
        ? 'once'
        : timing.kind === 'at'
          ? 'at'
          : 'daily'
  return {
    title: String(schedule.title === undefined ? '' : schedule.title),
    prompt: String(schedule.prompt === undefined ? '' : schedule.prompt),
    botId: String(schedule.botId === undefined ? '' : schedule.botId),
    kind: kind,
    time: typeof timing.time === 'string' && timing.time !== '' ? timing.time : '09:00',
    everyMinutes: String(timing.minutes === undefined ? timing.everyMinutes : timing.minutes),
    onceMinutes: String(timing.minutes === undefined ? (timing.inMinutes === undefined ? 10 : timing.inMinutes) : timing.minutes),
    atLocal: typeof timing.at === 'string' ? toLocalInputValue(timing.at) : defaultRunAtValue(),
  }
}

/** Scheduled turns: list, create, edit (update or create+delete), run, delete. */
function SchedulesTab(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  var schedules = store.schedules
  var bots = store.bots()
  var pairForm = React.useState(null)
  var form = pairForm[0]
  var setForm = pairForm[1]
  var pairEditing = React.useState(null)
  var editingId = pairEditing[0]
  var setEditingId = pairEditing[1]
  var pairSaving = React.useState(false)
  var saving = pairSaving[0]
  var setSaving = pairSaving[1]
  var pairError = React.useState('')
  var error = pairError[0]
  var setError = pairError[1]

  React.useEffect(
    function () {
      if (!schedules.loaded && !schedules.loading) store.loadSchedules(true)
    },
    [],
  )

  function openNew() {
    setEditingId('new')
    setForm(emptyScheduleForm(store))
    setError('')
  }

  function openEdit(schedule) {
    setEditingId(schedule.id)
    setForm(formOfSchedule(schedule))
    setError('')
  }

  function closeForm() {
    setEditingId(null)
    setForm(null)
    setError('')
  }

  function patch(field, value) {
    setForm(Object.assign({}, form, { [field]: value }))
  }

  function timingOf() {
    if (form.kind === 'daily') return { kind: 'daily', time: form.time }
    if (form.kind === 'every') {
      var every = Math.max(1, parseInt(form.everyMinutes, 10) || 60)
      return { kind: 'every', minutes: every }
    }
    if (form.kind === 'once') {
      var once = Math.max(1, parseInt(form.onceMinutes, 10) || 10)
      return { kind: 'once', minutes: once, inMinutes: once }
    }
    var stamp = form.atLocal === '' ? new Date().toISOString() : new Date(form.atLocal).toISOString()
    return { kind: 'at', at: stamp }
  }

  function save() {
    if (form === null) return
    if (form.title.trim() === '') {
      setError(t('schedules.titleRequired'))
      return
    }
    if (form.prompt.trim() === '') {
      setError(t('schedules.promptRequired'))
      return
    }
    var payload = {
      botId: form.botId,
      title: form.title.trim(),
      prompt: form.prompt.trim(),
      timing: timingOf(),
    }
    setSaving(true)
    setError('')
    var action =
      editingId === 'new' ? store.createSchedule(payload) : store.updateSchedule(editingId, payload)
    action.then(
      function (result) {
        setSaving(false)
        if (result !== null && result !== undefined && result.replaced === true) store.flash(t('schedules.replaced'), 'success')
        else store.flash(t('schedules.saved'), 'success')
        closeForm()
      },
      function (failure) {
        setSaving(false)
        var message = transport.describeError(t, failure)
        setError(message)
        store.flash(message, 'error')
      },
    )
  }

  var header = h(
    'div',
    { className: 'db-row' },
    form === null
      ? h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'db-grow' },
            h('h3', { className: 'db-title' }, t('schedules.title')),
            h('p', { className: 'db-subtitle' }, t('schedules.subtitle')),
          ),
          h(
            ui.Button,
            {
              variant: 'primary',
              size: 'sm',
              icon: 'plus',
              disabled: bots.length === 0,
              onClick: openNew,
            },
            t('schedules.new'),
          ),
        )
      : h(
          React.Fragment,
          null,
          h(ui.IconButton, { icon: 'chevron-left', label: t('action.back'), onClick: closeForm }),
          h('h3', { className: 'db-title' }, editingId === 'new' ? t('schedules.new') : t('schedules.edit')),
        ),
  )

  var body = []
  if (form !== null) {
    body.push(
      h(
        'div',
        { key: 'form', className: 'db-card' },
        h(
          'div',
          { className: 'db-stack' },
          h(ui.Field, {
            label: t('schedules.form.title'),
            children: h(ui.TextInput, { value: form.title, onChange: function (value) { patch('title', value) }, placeholder: t('schedules.form.titlePlaceholder'), maxLength: 120 }),
          }),
          h(ui.Field, {
            label: t('schedules.form.prompt'),
            children: h(ui.TextArea, { value: form.prompt, onChange: function (value) { patch('prompt', value) }, placeholder: t('schedules.form.promptPlaceholder'), rows: 3 }),
          }),
          h(ui.Field, {
            label: t('schedules.form.bot'),
            children: h(
              ui.Select,
              { value: form.botId, onChange: function (value) { patch('botId', value) } },
              bots.map(function (bot) {
                return h('option', { key: bot.id, value: bot.id }, bot.name)
              }),
            ),
          }),
          h(ui.Field, {
            label: t('schedules.form.kind'),
            hint: t('schedules.form.hint'),
            children: h(ui.Segmented, {
              value: form.kind,
              options: [
                { value: 'daily', label: t('schedules.kind.daily') },
                { value: 'every', label: t('schedules.kind.everyLabel') },
                { value: 'once', label: t('schedules.kind.onceAfter') },
                { value: 'at', label: t('schedules.kind.at') },
              ],
              onChange: function (value) { patch('kind', value) },
            }),
          }),
          form.kind === 'daily'
            ? h(ui.Field, {
                label: t('schedules.form.time'),
                children: h(ui.TextInput, { type: 'time', value: form.time, onChange: function (value) { patch('time', value) } }),
              })
            : form.kind === 'every'
              ? h(ui.Field, {
                  label: t('schedules.form.minutes'),
                  children: h(ui.TextInput, { type: 'number', value: form.everyMinutes, onChange: function (value) { patch('everyMinutes', value) } }),
                })
              : form.kind === 'once'
                ? h(ui.Field, {
                    label: t('schedules.form.inMinutes'),
                    children: h(ui.TextInput, { type: 'number', value: form.onceMinutes, onChange: function (value) { patch('onceMinutes', value) } }),
                  })
                : h(ui.Field, {
                    label: t('schedules.form.runAt'),
                    children: h(ui.TextInput, { type: 'datetime-local', value: form.atLocal, onChange: function (value) { patch('atLocal', value) } }),
                  }),
          error === '' ? null : h('div', { className: 'db-error' }, error),
          h(
            'div',
            { className: 'db-row' },
            h(ui.Button, { variant: 'primary', disabled: saving, onClick: save }, saving ? t('schedules.form.saving') : t('schedules.form.save')),
            h(ui.Button, { variant: 'ghost', disabled: saving, onClick: closeForm }, t('schedules.form.cancel')),
          ),
        ),
      ),
    )
  } else {
    if (schedules.unsupported) body.push(h('div', { key: 'unsupported', className: 'db-inline-note' }, t('schedules.unavailable')))
    if (schedules.error !== null && schedules.error !== undefined && !schedules.unsupported) {
      body.push(
        h('div', { key: 'error', className: 'db-inline-note is-error' }, t('schedules.error', { detail: transport.describeError(t, schedules.error) })),
      )
    }
    if (schedules.loading && schedules.list.length === 0) {
      body.push(h(ui.Loading, { key: 'loading', label: t('schedules.loading') }))
    } else if (schedules.list.length === 0) {
      body.push(h(ui.Empty, { key: 'empty', glyph: 'clock', title: t('schedules.empty'), body: t('schedules.emptyHint') }))
    } else {
      body.push(
        schedules.list.map(function (schedule) {
          var bot = store.botById(schedule.botId)
          var title = String(schedule.title === undefined ? schedule.id : schedule.title)
          return h(
            'div',
            { key: String(schedule.id), className: 'db-sch-item' },
            h(
              'div',
              { className: 'db-sch-head' },
              h('span', { className: 'db-sch-title' }, title),
              h(ui.Tag, { icon: 'clock' }, timingText(t, schedule)),
              schedule.enabled === false ? h(ui.Tag, null, t('schedules.paused')) : null,
              h('div', { className: 'db-row' },
                h(ui.IconButton, {
                  icon: 'edit',
                  size: 13,
                  label: t('schedules.edit'),
                  title: t('schedules.edit'),
                  onClick: function () {
                    openEdit(schedule)
                  },
                }),
                h(ui.IconButton, {
                  icon: 'refresh',
                  size: 13,
                  label: t('schedules.runNow'),
                  title: t('schedules.runNow'),
                  onClick: function () {
                    store.runSchedule(schedule.id).then(
                      function () {
                        store.flash(t('schedules.saved'), 'success')
                      },
                      function (failure) {
                        store.flash(transport.describeError(t, failure), 'error')
                      },
                    )
                  },
                }),
                h(ui.ConfirmButton, {
                  label: t('schedules.delete'),
                  confirmLabel: t('action.confirm'),
                  title: t('schedules.deleteConfirm', { title: title }),
                  onConfirm: function () {
                    store.deleteSchedule(schedule.id).catch(function (failure) {
                      store.flash(transport.describeError(t, failure), 'error')
                    })
                  },
                }),
              ),
            ),
            h(
              'div',
              { className: 'db-sch-meta' },
              bot === undefined ? t('schedules.botMissing') : bot.name,
              schedule.nativeId === undefined || schedule.nativeId === ''
                ? ' · ' + t('schedules.native.absent')
                : ' · ' + t('schedules.native.attached'),
              schedule.nextRunAt === undefined ? null : ' · ' + t('schedules.nextRun', { time: ui.formatDate(schedule.nextRunAt) + ' ' + ui.formatTime(schedule.nextRunAt) }),
            ),
            schedule.prompt === undefined ? null : h('div', { className: 'db-sch-prompt' }, String(schedule.prompt)),
          )
        }),
      )
    }
  }

  return h('div', { className: 'db-stack' }, header, body)
}

/* ------------------------------------------------------------------- usage */

/** Turn/character usage: totals, a day histogram and a per-bot ranking. */
function UsageTab(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  var usage = store.usage
  var view = usage.view

  React.useEffect(
    function () {
      if (!usage.loaded && !usage.loading) store.loadUsage(usage.days, true)
    },
    [],
  )

  var days = usage.days
  var dayOptions = [
    { value: 7, label: t('usage.days.7') },
    { value: 30, label: t('usage.days.30') },
    { value: 90, label: t('usage.days.90') },
  ]

  var byDay = view === null || view === undefined || !Array.isArray(view.byDay) ? [] : view.byDay
  var byBot = view === null || view === undefined || !Array.isArray(view.byBot) ? [] : view.byBot
  var maxTurns = 1
  for (var i = 0; i < byDay.length; i += 1) {
    if (byDay[i] !== null && typeof byDay[i].turns === 'number' && byDay[i].turns > maxTurns) maxTurns = byDay[i].turns
  }
  var maxBotTurns = 1
  for (var j = 0; j < byBot.length; j += 1) {
    if (byBot[j] !== null && typeof byBot[j].turns === 'number' && byBot[j].turns > maxBotTurns) maxBotTurns = byBot[j].turns
  }
  var total = view === null || view === undefined || view.total === undefined ? { turns: 0, chars: 0 } : view.total

  return h(
    'div',
    { className: 'db-stack' },
    h(
      'div',
      null,
      h('h3', { className: 'db-title' }, t('usage.title')),
      h('p', { className: 'db-subtitle' }, t('usage.subtitle')),
    ),
    h(
      'div',
      { className: 'db-row' },
      h(ui.Segmented, {
        value: days,
        options: dayOptions.map(function (option) {
          return { value: option.value, label: option.label }
        }),
        onChange: function (value) {
          store.loadUsage(Number(value), true)
        },
      }),
    ),
    usage.error !== null && usage.error !== undefined
      ? h('div', { className: 'db-inline-note is-error' }, t('usage.error', { detail: transport.describeError(t, usage.error) }))
      : null,
    usage.loading && view === null
      ? h(ui.Loading, { label: t('usage.loading') })
      : h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'db-stats' },
            h(
              'div',
              { className: 'db-stat' },
              h('div', { className: 'db-stat-value' }, ui.formatNumber(total.turns)),
              h('div', { className: 'db-stat-label' }, t('usage.totalTurns')),
            ),
            h(
              'div',
              { className: 'db-stat' },
              h('div', { className: 'db-stat-value' }, ui.formatNumber(total.chars)),
              h('div', { className: 'db-stat-label' }, t('usage.totalChars')),
            ),
          ),
          h('h4', { className: 'db-section-title' }, t('usage.byDay')),
          byDay.length === 0
            ? h('p', { className: 'db-hint' }, t('usage.empty'))
            : h(
                'div',
                { className: 'db-bars' },
                byDay.map(function (item, index) {
                  var turns = item !== null && typeof item.turns === 'number' ? item.turns : 0
                  var height = Math.max(2, Math.round((turns / maxTurns) * 100))
                  return h(
                    'div',
                    { key: String(index), className: 'db-bar-col', title: String(item.day) + ' · ' + t('usage.turns', { count: String(turns) }) },
                    h('span', { className: 'db-bar-count' }, turns === 0 ? '' : String(turns)),
                    h('div', { className: 'db-bar' + (turns === 0 ? ' is-empty' : ''), style: { height: height + '%' } }),
                    h('span', { className: 'db-bar-label' }, String(item.day === undefined ? '' : item.day).slice(5)),
                  )
                }),
              ),
          h('h4', { className: 'db-section-title' }, t('usage.byBot')),
          byBot.length === 0
            ? h('p', { className: 'db-hint' }, t('usage.noBot'))
            : byBot.map(function (item, index) {
                var turns = item !== null && typeof item.turns === 'number' ? item.turns : 0
                return h(
                  'div',
                  { key: String(index), className: 'db-rank-row' },
                  h('span', { className: 'db-rank-name' }, String(item.name === undefined ? item.botId : item.name)),
                  h('span', { className: 'db-rank-track' }, h('span', { className: 'db-rank-fill', style: { width: Math.max(2, Math.round((turns / maxBotTurns) * 100)) + '%' } })),
                  h('span', { className: 'db-rank-value' }, ui.formatNumber(turns) + ' ' + t('usage.turnsUnit')),
                )
              }),
        ),
  )
}

/* ------------------------------------------------------------------- tasks */

/** Status tag tone for one TaskView/HelperView status. */
function taskStatusTone(status) {
  if (status === 'running') return 'brand'
  if (status === 'done') return 'success'
  if (status === 'failed' || status === 'cancelled' || status === 'stopped' || status === 'interrupted' || status === 'unknown') return 'error'
  return 'default'
}

/** One task or helper row. */
function TaskRow(props) {
  var t = props.t
  var store = props.store
  var entry = props.entry
  var row = entry.row
  var pairExpanded = React.useState(false)
  var expanded = pairExpanded[0]
  var setExpanded = pairExpanded[1]
  var isHelper = entry.kind === 'helper'
  var status = String(row.status === undefined ? 'unknown' : row.status)
  var title = String(row.title === undefined || row.title === '' ? row.text === undefined ? row.id : String(row.text).slice(0, 80) : row.title)
  var targetName = ''
  if (isHelper) {
    var helperBot = store.botById(row.botId)
    targetName = helperBot === undefined ? String(row.botId === undefined ? '' : row.botId) : helperBot.name
  } else if (row.kind === 'discussion') {
    var group = store.groupById(row.groupId)
    targetName = group === undefined ? String(row.groupId === undefined ? '' : row.groupId) : group.name
  } else {
    var bot = store.botById(row.botId)
    targetName = bot === undefined ? String(row.botId === undefined ? '' : row.botId) : bot.name
  }
  var result = isHelper ? row.report : row.result
  var hasResult = result !== undefined && result !== null && String(result) !== ''
  var errorText = row.error === undefined || row.error === null ? '' : String(row.error)
  var cancelled = props.cancellable === true
  var at = row.endedAt === undefined ? (row.startedAt === undefined ? row.createdAt : row.startedAt) : row.endedAt

  return h(
    'div',
    { className: 'db-task' },
    h(
      'div',
      { className: 'db-task-head' },
      h(
        'div',
        { className: 'db-task-main' },
        h(
          'div',
          { className: 'db-task-title' },
          h('span', null, title),
          h(ui.Tag, null, isHelper ? t('tasks.helpers') : row.kind === 'discussion' ? t('tasks.kind.discussion') : t('tasks.kind.bot')),
          row.batchId === undefined ? null : h(ui.Tag, null, 'batch'),
        ),
        h(
          'div',
          { className: 'db-task-meta' },
          h(ui.Tag, { tone: taskStatusTone(status) }, t('tasks.status.' + status)),
          h('span', null, t('tasks.target') + '：' + targetName),
          at === undefined ? null : h('span', null, ui.formatDate(at) + ' ' + ui.formatTime(at)),
        ),
      ),
      h(
        'div',
        { className: 'db-task-actions' },
        hasResult
          ? h(ui.IconButton, {
              icon: expanded ? 'chevron-up' : 'chevron-down',
              size: 13,
              label: expanded ? t('tasks.collapse') : t('tasks.expand'),
              onClick: function () {
                setExpanded(!expanded)
              },
            })
          : null,
        cancelled
          ? h(ui.ConfirmButton, {
              label: t('tasks.cancel'),
              confirmLabel: t('tasks.cancelConfirm'),
              title: t('tasks.cancel'),
              onConfirm: props.onCancel,
            })
          : null,
      ),
    ),
    errorText === '' ? null : h('div', { className: 'db-task-error' }, errorText),
    hasResult && expanded ? h('pre', { className: 'db-task-result' }, String(result)) : null,
    hasResult && !expanded ? h('div', { className: 'db-task-summary' }, String(result).slice(0, 160) + (String(result).length > 160 ? '…' : '')) : null,
  )
}

/** Tasks and background helpers, grouped by lifecycle. */
function TasksTab(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  var tasks = store.tasks()
  var helpers = store.helpers()
  var groups = { active: [], queued: [], done: [], failed: [] }

  function bucketOf(status) {
    if (status === 'running') return 'active'
    if (status === 'queued') return 'queued'
    if (status === 'done') return 'done'
    return 'failed'
  }

  function chatIdOf(row, isHelper) {
    if (isHelper) return typeof row.chatId === 'string' ? row.chatId : undefined
    if (typeof row.originChatId === 'string' && row.originChatId !== '' && store.chatById(row.originChatId) !== undefined) {
      return row.originChatId
    }
    var chats = store.chats()
    if (row.kind === 'discussion' && typeof row.groupId === 'string') {
      for (var g = 0; g < chats.length; g += 1) {
        if (chats[g] !== null && chats[g].kind === 'group' && chats[g].groupId === row.groupId) return chats[g].id
      }
      return undefined
    }
    if (typeof row.botId === 'string') {
      for (var c = 0; c < chats.length; c += 1) {
        if (chats[c] !== null && chats[c].kind === 'dm' && chats[c].botId === row.botId) return chats[c].id
      }
    }
    return undefined
  }

  function cancellableOf(row, isHelper) {
    if (isHelper) {
      return (row.status === 'running' || row.status === 'queued') && chatIdOf(row, true) !== undefined
    }
    // Batch cancellation waits for a Host route: only single chat tasks cancel.
    if (row.batchId !== undefined) return false
    if (row.status !== 'running' && row.status !== 'queued') return false
    return chatIdOf(row, false) !== undefined
  }

  function cancelEntry(row, isHelper) {
    var chatId = chatIdOf(row, isHelper)
    if (chatId === undefined) {
      store.flash(t('tasks.cancelUnavailable'), 'error')
      return
    }
    store.cancel(chatId).then(
      function () {
        store.flash(t('tasks.cancelled'), 'success')
      },
      function (failure) {
        store.flash(transport.describeError(t, failure), 'error')
      },
    )
  }

  for (var i = 0; i < tasks.length; i += 1) {
    var task = tasks[i]
    if (task === null || task === undefined) continue
    groups[bucketOf(String(task.status))].push({ kind: 'task', row: task })
  }
  for (var j = 0; j < helpers.length; j += 1) {
    var helper = helpers[j]
    if (helper === null || helper === undefined) continue
    groups[bucketOf(String(helper.status))].push({ kind: 'helper', row: helper })
  }

  var total = tasks.length + helpers.length
  var labels = { active: t('tasks.group.active'), queued: t('tasks.group.queued'), done: t('tasks.group.done'), failed: t('tasks.group.failed') }
  var body = [h(
    'div',
    { key: 'head', className: 'db-row' },
    h(
      'div',
      { className: 'db-grow' },
      h('h3', { className: 'db-title' }, t('tasks.title')),
      h('p', { className: 'db-subtitle' }, t('tasks.subtitle')),
    ),
    total === 0 ? null : h('span', { className: 'db-hint' }, t('tasks.taskCount', { count: String(tasks.length) }) + ' · ' + t('tasks.helperCount', { count: String(helpers.length) })),
  )]

  if (total === 0) {
    body.push(h(ui.Empty, { key: 'empty', glyph: 'tasks', title: t('tasks.empty'), body: t('tasks.emptyHint') }))
  } else {
    var order = ['active', 'queued', 'done', 'failed']
    for (var o = 0; o < order.length; o += 1) {
      var key = order[o]
      var entries = groups[key]
      if (entries.length === 0) continue
      body.push(
        h('div', { key: 'group-' + key, className: 'db-section-title' }, labels[key] + ' · ' + String(entries.length)),
      )
      for (var e = 0; e < entries.length; e += 1) {
        ;(function (entry) {
          var row = entry.row
          body.push(
            h(TaskRow, {
              key: (entry.kind === 'helper' ? 'helper-' : 'task-') + String(row.id),
              t: t,
              store: store,
              entry: entry,
              cancellable: cancellableOf(row, entry.kind === 'helper'),
              onCancel: function () {
                cancelEntry(row, entry.kind === 'helper')
              },
            }),
          )
        })(entries[e])
      }
    }
    body.push(h('p', { key: 'cancel-hint', className: 'db-hint' }, t('tasks.cancelHint')))
  }

  return h('div', { className: 'db-stack' }, body)
}

/* ------------------------------------------------- settings.section page */

/** Optional full settings page: the compact entry to the workspace. */
function SettingsSectionPage(props) {
  var t = props.t
  var store = props.store
  useStoreVersion(store)
  var bots = store.bots()
  return h(
    'div',
    { className: 'db-settings-page' },
    h('h2', { className: 'db-title' }, t('settings.title')),
    h('p', { className: 'db-subtitle' }, t('settings.description')),
    h(
      'div',
      { className: 'db-settings-actions' },
      props.openPanel === undefined
        ? null
        : h(
            ui.Button,
            {
              variant: 'primary',
              icon: 'bot',
              onClick: function () {
                props.openPanel()
              },
            },
            t('settings.open'),
          ),
      h('span', { className: 'db-hint' }, t('bots.count', { count: String(bots.length) })),
    ),
  )
}

module.exports = {
  SettingsDrawer: SettingsDrawer,
  TasksTab: TasksTab,
  SettingsSectionPage: SettingsSectionPage,
  GeneralTab: GeneralTab,
  BotsTab: BotsTab,
  GroupsTab: GroupsTab,
  GroupForm: GroupForm,
  BotForm: BotForm,
  AvatarGrid: AvatarGrid,
  MemoryTab: MemoryTab,
  SchedulesTab: SchedulesTab,
  UsageTab: UsageTab,
}
