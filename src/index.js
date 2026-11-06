/**
 * @lisongjianustc/dsh-bot — Host half.
 *
 * One Cordis plugin owns the bot ledger, the session runtime that turns every
 * Bot reply into a real DSH Agent turn, the bot-team system-prompt section,
 * the model-facing bot tools and the /dsh-bot/api routes the workbench page
 * talks to. The browser half lives in src/client and is built into
 * lib/client.js.
 *
 * All wiring stays here; each module owns one concern and communicates only
 * through the exports documented in docs/PROTOCOL.md.
 *
 * @module @lisongjianustc/dsh-bot
 */
import { createStore } from './host/store.js'
import { createServices } from './host/services.js'
import { createRuntime } from './host/runtime.js'
import { createPrompt } from './host/prompt.js'
import { createHub } from './host/hub.js'
import { createDispatcher } from './host/dispatcher.js'
import { registerTools } from './host/tools.js'
import { registerRoutes } from './host/routes.js'

export const name = 'dsh-bot'

/**
 * Hard dependencies: without a web server there is no page channel; without a
 * session controller a Bot reply cannot become a real Agent turn; without the
 * tool registry the Bot tools cannot be seen by models; without the prompt
 * registry the Bot persona cannot be injected.
 */
export const inject = ['webServer', 'sessionController', 'systemPrompt', 'tools', 'sessions']

/**
 * Mount the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {Record<string, unknown>} config - row configuration (currently empty).
 */
export function apply(ctx, config = {}) {
  const store = createStore(ctx)
  ctx.effect(() => () => store.close(), 'dsh-bot: store')
  const services = createServices({ ctx, config, store })
  const hub = createHub()
  ctx.effect(() => () => hub.dispose(), 'dsh-bot: hub')
  const runtime = createRuntime({ ctx, store, services, hub })
  ctx.effect(() => () => runtime.dispose(), 'dsh-bot: runtime')
  const prompt = createPrompt({ ctx, store, services })
  // createPrompt registers the persona section eagerly and exposes the exact
  // disposer; the effect only owns teardown.
  ctx.effect(() => () => prompt.dispose(), 'dsh-bot: prompt section')
  const dispatcher = createDispatcher({ ctx, services, runtime })
  ctx.effect(() => () => dispatcher.dispose(), 'dsh-bot: dispatcher')
  // Both registrations are effects on this context: a profile reload must
  // dispose the old route and tools before the next row generation applies,
  // otherwise the webserver rejects the duplicate prefix and the tool registry
  // rejects the duplicate names.
  ctx.effect(() => registerTools({ ctx, services, dispatcher, runtime }), 'dsh-bot: tools')
  ctx.effect(
    () => registerRoutes({ ctx, store, services, runtime, hub, prompt, dispatcher }),
    'dsh-bot: routes',
  )
}
