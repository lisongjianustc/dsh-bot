/**
 * The unattended-turn answerers: the two waterfall events a background Bot turn
 * would otherwise hang on.
 *
 * A desktop Host with the Web GUI connected composes `dsh-api-remotes`' forwarder
 * into `approval/request`; it forwards the request to a browser and awaits the
 * page forever. A Bot turn nobody is watching therefore never resolves — it does
 * not fail closed, it hangs (M0 probe C3/C4). The same shape applies to
 * `user-questions/request`.
 *
 * So this module claims both waterfalls for Bot sessions, and ONLY for them:
 * - an approval request from a ledger-managed Bot session whose Bot has
 *   `autoApprove` (default true) is answered `'allowed-once'` here;
 * - a structured question from such a session is answered with an explainable
 *   refusal, because a Bot has no human in front of it;
 * - every other caller falls through with `next()`, so the real user's sessions
 *   keep their native approval cards.
 *
 * `prepend: true` is load-bearing: the remotes forwarder is registered earlier
 * and never calls `next()`, so a listener appended after it is never reached
 * (M0 C4 measured exactly that).
 *
 * The iron rule for both handlers: either answer, or call `next()` — never leave
 * the waterfall pending.
 *
 * @module @lisongjianustc/dsh-bot/host/approval
 */

/** The refusal text a Bot reads when it asked a human a question. */
const QUESTION_REFUSAL = {
  zh: '这个 Bot 会话没有人类在场，无法回答交互式提问。请自行判断并继续，或把问题写进回复里留给用户。',
  en: 'No human is watching this Bot session, so an interactive question cannot be answered. Decide yourself and continue, or put the question in your reply for the user.',
}

/**
 * Resolve the Bot that owns one session, when the session is managed by this
 * plugin.
 * @param {object} services - the business services.
 * @param {unknown} sessionId - the session the request names.
 * @returns {object | undefined} the Bot record, or undefined for a foreign session.
 */
function managedBot(services, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const found = services.chats.bySession(sessionId)
  if (found === undefined) return undefined
  return services.bots.get(found.botId)
}

/**
 * Register the two answerers.
 * @param {{ ctx: object, services: object }} input - wiring.
 * @returns {() => void} the disposer for both registrations.
 */
export function registerApprovalAnswerers({ ctx, services }) {
  const disposers = []
  const language = () => (typeof services.language === 'function' ? services.language() : 'zh')

  /** `approval/request`: claim Bot sessions that approve themselves, delegate the rest. */
  const onApproval = async (request, next) => {
    const bot = managedBot(services, request?.agent?.id)
    // A foreign session (the user's own chat, a subagent, a scheduled helper)
    // keeps the native waterfall: the page must render its approval card.
    if (bot === undefined) return await next()
    // Auto-approval off means the request belongs to the user: the native
    // waterfall (the page's approval card) handles it, and a page-less Host
    // fails closed instead of hanging on our answerer.
    if (bot.autoApprove === false) return await next()
    return 'allowed-once'
  }

  /** `user-questions/request`: answer Bot sessions with an explainable refusal. */
  const onQuestions = async (request, next) => {
    const bot = managedBot(services, request?.agent?.id)
    if (bot === undefined) return await next()
    const questions = Array.isArray(request?.questions) ? request.questions : []
    return {
      answers: questions.map(question => ({
        id: String(question?.id ?? ''),
        selected: [],
        custom: QUESTION_REFUSAL[language() === 'en' ? 'en' : 'zh'],
      })),
    }
  }

  // `prepend` is required: the Host's own remotes forwarder is registered before
  // this plugin and never calls next() when a page is connected.
  disposers.push(ctx.on('approval/request', onApproval, { global: true, prepend: true }))
  disposers.push(ctx.on('user-questions/request', onQuestions, { global: true, prepend: true }))

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* the fiber is going away */
      }
    }
  }
}

export { managedBot }
