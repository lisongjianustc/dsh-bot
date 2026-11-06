# dsh-bot

MiniMax-Bot-style always-on agent team for **DeepSeek Harness** (DSH) Web GUI and desktop client.

Create named Bots, chat with them one-on-one, pull them into groups, give them shared or private memory, schedule recurring work, and read the usage ledger — while every Bot reply is a real DSH Agent session you can open at any time.

## Features

- **Bots are real sessions.** Each Bot runs in an ordinary DSH Session, grouped in a dedicated `dsh-bot` workspace. Open it from the workbench (or the sidebar) and you get the full native chat: tool cards, approvals, queue, search.
- **Private chats** with a Bot: every message is one real Agent turn.
- **Group chats** with `@Name` mentions, admin/all reply modes, `[PASS]` skipping, a hop limit with a wrap-up turn, optional handover of the previous conclusion, and a group note that survives clearing the chat.
- **Memory**: one store per Bot plus one shared by the team, selected into the next turn under a 6,000-character budget, guarded by revisions and a journal.
- **Background jobs**: hidden child sessions for work that should not block the chat; a report is posted back into the conversation and the Bot verifies it in its own words (`bot_start_helper` / `bot_list_helpers` / `bot_stop_helper`).
- **Automatic tool approval**: a Bot session answers approval requests itself (`autoApprove`, on by default) so background turns never hang; turn it off to review every approval by hand.
- **Scheduled tasks**: daily / every / once, delivered to a Bot's session by the Host schedule service.
- **Usage**: turns, characters, tools and time per Bot over 24h / 7 / 30 / 90 days.
- **Settings page** for Bots, groups, memory, schedules and usage; Chinese and English UI.

## Install

The published bundle is installed through the DSH plugin manager (Settings → Plugins → install from a package, or the Workshop card):

```sh
dsh plugin add @lisongjianustc/dsh-bot
```

For local development, install the workspace package directory through `plugin_manager` (`action: install_bundle`) and rebuild the browser half with `node scripts/build-client.mjs` after changing `src/client/**`.

## Requirements

- DSH `>= 0.2.2-rc.1`
- Desktop or Web GUI with the Web extension bundle (this package declares `dsh.client` and is served as a client plugin)

## Layout

```
src/index.js        Host half entry (Cordis plugin: routes, tools, prompt section, runtime)
src/host/*.js       ledger, bot runtime, dispatcher, prompt, tools, routes, SSE hub
src/client/*.js     browser half sources (CommonJS style, built into lib/client.js)
scripts/build-client.mjs  concatenates src/client/*.js into the __ModuleLoader__ bundle
docs/PROTOCOL.md    the frozen Host↔Client contract
```

## Privacy

All bot data lives in `$DSH_HOME/dsh-bot/` on this machine. Nothing is uploaded by this plugin.

## License

MIT
