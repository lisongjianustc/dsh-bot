/**
 * Styles of the dsh-bot workspace.
 *
 * The sheet is a plain CSS string (no CSS-modules build step) inserted once by
 * `index.js` through `ctx.effect`, and removed when the plugin unloads. Every
 * selector is scoped under `.db` so nothing here can reach a class another
 * package owns.
 *
 * Colour comes exclusively from the 14 public theme aliases plus
 * `--dsw-specific-sidebar-fill`; light/dark follow automatically because those
 * variables swap with the shell theme. Tints are mixed from the same tokens
 * with `color-mix`, so a custom shell palette still reads correctly.
 */

'use strict'

var CSS = `
.db {
  --db-left-w: 268px;
  --db-rail-w: 46px;
  --db-radius: 12px;
  --db-font: 13px;
  container-type: inline-size;
  container-name: db;
  position: relative;
  display: flex;
  flex-direction: column;
  block-size: 100%;
  min-block-size: 0;
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font-size: var(--db-font);
  line-height: 1.45;
  font-family: inherit;
}

.db *,
.db *::before,
.db *::after { box-sizing: border-box; }

.db ::-webkit-scrollbar { width: 8px; height: 8px; }
.db ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 26%, transparent);
  border-radius: 4px;
}
.db ::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 42%, transparent);
}
.db ::-webkit-scrollbar-track { background: transparent; }

.db button { font: inherit; color: inherit; }
.db input, .db textarea, .db select { font: inherit; color: inherit; }
.db :focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent);
  outline-offset: 1px;
}

/* ---------------------------------------------------------------- banner */

.db-banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, var(--dsw-alias-bg-layer-1));
  border-block-end: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 38%, transparent);
}
.db-banner.is-error {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 13%, var(--dsw-alias-bg-layer-1));
  border-block-end-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);
}
.db-banner-main { flex: 1; min-inline-size: 0; overflow-wrap: anywhere; }
.db-banner-hint { color: var(--dsw-alias-label-secondary); }
.db-banner-actions { flex: none; display: flex; gap: 6px; }

/* ---------------------------------------------------------------- shell */

.db-body {
  flex: 1 1 auto;
  display: flex;
  min-block-size: 0;
  min-inline-size: 0;
  position: relative;
}

/* ----------------------------------------------------------------- left */

.db-left {
  flex: none;
  inline-size: var(--db-left-w);
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1));
  border-inline-end: 1px solid var(--dsw-alias-border-l1);
}

.db-left-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 13px 12px 6px 14px;
}
.db-left-title {
  flex: 1;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.db-left-actions { display: flex; align-items: center; gap: 2px; }

.db-search {
  flex: none;
  position: relative;
  margin: 4px 12px 8px;
}
.db-search-icon {
  position: absolute;
  inset-inline-start: 9px;
  inset-block-start: 50%;
  translate: 0 -50%;
  display: flex;
  color: var(--dsw-alias-label-secondary);
  pointer-events: none;
}
.db-search-input {
  inline-size: 100%;
  block-size: 30px;
  padding: 0 10px 0 30px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
}
.db-search-input::placeholder { color: var(--dsw-alias-label-secondary); }
.db-search-input:focus { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent); outline: none; }

.db-filters {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 0 12px 6px;
}
.db-filter {
  flex: 1 1 0;
  min-inline-size: 0;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.db-filter:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); }
.db-filter.is-active {
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);
}

.db-list {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 8px 10px;
}

.db-section-label.db-section-pinned {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--dsw-alias-brand-primary);
}
.db-section-label {
  padding: 10px 7px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}

.db-chat {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  inline-size: 100%;
  padding: 8px 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: start;
  cursor: pointer;
  min-inline-size: 0;
}
.db-chat:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 9%, transparent); }
.db-chat.is-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent);
}
.db-chat.is-pinned:not(.is-active) {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent);
}
.db-chat.is-pinned::before {
  content: '';
  position: absolute;
  inset-block: 7px;
  inset-inline-start: 0;
  inline-size: 2px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);
}
.db-pin-mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-brand-primary);
}

.db-chat-main { flex: 1; min-inline-size: 0; }
.db-chat-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-inline-size: 0;
}
.db-chat-name {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.db-chat-meta {
  margin-block-start: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
}
.db-chat-time { flex: none; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }

.db-unread {
  flex: none;
  min-inline-size: 16px;
  block-size: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

.db-left-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-block-start: 1px solid var(--dsw-alias-border-l1);
}
.db-conn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-inline-size: 0;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-conn-dot {
  flex: none;
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary);
}
.db-conn-dot.is-live {
  background: var(--dsw-alias-state-success-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent);
}
.db-conn-dot.is-mock { background: var(--dsw-alias-state-warn-primary); }
.db-conn-dot.is-lost { background: var(--dsw-alias-state-error-primary); }

/* ---------------------------------------------------------------- center */

.db-center {
  flex: 1 1 auto;
  min-inline-size: 0;
  min-block-size: 0;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base);
}

.db-chat-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  min-block-size: 56px;
  padding: 8px 16px;
  border-block-end: 1px solid var(--dsw-alias-border-l1);
}
.db-chat-head-main { flex: 1; min-inline-size: 0; }
.db-chat-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  min-inline-size: 0;
}
.db-chat-title > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-chat-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-block-start: 1px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-chat-head-actions { flex: none; display: flex; align-items: center; gap: 2px; }

.db-timeline {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 18px 22px 8px;
  scroll-behavior: smooth;
}
.db-timeline-inner {
  max-inline-size: 900px;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.db-day {
  align-self: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}

.db-loadmore {
  align-self: center;
  margin-block-end: 2px;
  padding: 4px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  cursor: pointer;
}
.db-loadmore:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.db-loadmore:disabled { cursor: default; opacity: 0.6; }

/* --------------------------------------------------------------- message */

.db-msg {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-inline-size: 0;
  animation: db-msg-in 0.16s ease-out;
}
@keyframes db-msg-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}

.db-msg.is-user { flex-direction: row-reverse; }
.db-msg-body { min-inline-size: 0; max-inline-size: min(78%, 660px); display: flex; flex-direction: column; gap: 3px; }
.db-msg.is-user .db-msg-body { align-items: flex-end; }

.db-msg-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-inline-size: 0;
  padding-inline: 2px;
}
.db-msg.is-user .db-msg-head { justify-content: flex-end; }
.db-msg-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-inline-size: 220px;
}
.db-msg-time { flex: none; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.db-msg-role {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 15px;
}

.db-bubble {
  min-inline-size: 0;
  max-inline-size: 100%;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 3px 13px 13px 13px;
  background: var(--dsw-alias-bg-layer-2);
  overflow-wrap: anywhere;
  word-break: break-word;
}
.db-msg.is-user .db-bubble {
  border-radius: 13px 3px 13px 13px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);
}
.db-msg.is-relay .db-bubble {
  border-style: dashed;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 60%, transparent);
}
.db-msg.is-system {
  justify-content: center;
  animation: none;
}
.db-msg.is-system .db-msg-body { max-inline-size: 88%; align-items: center; }
.db-system {
  padding: 2px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 9%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  text-align: center;
  overflow-wrap: anywhere;
}

.db-text { font-size: 13px; line-height: 1.55; white-space: pre-wrap; }

.db-clamp {
  position: relative;
  max-block-size: 340px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(180deg, #000 78%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 78%, transparent 100%);
}
.db-expand {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-block-start: 4px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-brand-primary);
  font-size: 11.5px;
  cursor: pointer;
}
.db-expand:hover { text-decoration: underline; }
.db-text + .db-text { margin-block-start: 6px; }

/* Markdown blocks rendered from Bot text (see markdown.js). */
.db-md-p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.db-md-p + .db-md-p,
.db-md-p + .db-md-ul,
.db-md-p + .db-md-ol,
.db-md-ul + .db-md-p,
.db-md-ol + .db-md-p,
.db-md-pre + .db-md-p { margin-block-start: 6px; }
.db-md-h { margin: 8px 0 3px; font-weight: 600; line-height: 1.35; }
.db-md-h:first-child { margin-block-start: 0; }
.db-md-h1 { font-size: 1.28em; }
.db-md-h2 { font-size: 1.16em; }
.db-md-h3 { font-size: 1.06em; }
.db-md-h4, .db-md-h5, .db-md-h6 { font-size: 1em; }
.db-md-ul, .db-md-ol { margin: 3px 0 5px; padding-inline-start: 19px; }
.db-md-li { margin-block: 1px; white-space: pre-wrap; overflow-wrap: anywhere; }
.db-md-li::marker { color: var(--dsw-alias-label-secondary); }
.db-md-quote {
  margin: 4px 0;
  padding: 1px 0 1px 10px;
  border-inline-start: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.db-md-hr {
  margin: 8px 0;
  border: 0;
  border-block-start: 1px solid var(--dsw-alias-border-l1);
}
.db-md-pre {
  position: relative;
  margin: 6px 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  overflow-x: auto;
}
.db-md-pre code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre;
}
.db-md-lang {
  display: block;
  margin-block-end: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.db-md-code-inline {
  padding: 1px 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 13%, transparent);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.92em;
}
.db-md-link {
  color: var(--dsw-alias-brand-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
}

.db-msg.is-error .db-bubble { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 52%, transparent); }

.db-msg-error {
  display: flex;
  gap: 5px;
  margin-block-start: 4px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}
.db-msg-hint { margin-block-start: 2px; color: var(--dsw-alias-label-secondary); font-size: 11px; }

.db-msg-status {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-inline: 2px;
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary);
}
.db-msg-status.is-error { color: var(--dsw-alias-state-error-primary); }
.db-msg-status.is-warn { color: var(--dsw-alias-state-warn-primary); }

.db-msg-actions {
  display: flex;
  gap: 2px;
  padding-inline: 2px;
  opacity: 0;
  transition: opacity 0.12s;
}
.db-msg:hover .db-msg-actions,
.db-msg:focus-within .db-msg-actions { opacity: 1; }
.db-msg.is-user .db-msg-actions { justify-content: flex-end; }
@media (hover: none) {
  .db-msg-actions { opacity: 1; }
}

/* ----------------------------------------------------------------- tools */

.db-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-block-end: 6px;
}
.db-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  inline-size: fit-content;
  max-inline-size: 100%;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  text-align: start;
  cursor: default;
}
.db-tool.is-clickable { cursor: pointer; }
.db-tool.is-clickable:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.db-tool-name {
  max-inline-size: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
}
.db-tool-state { flex: none; display: inline-flex; align-items: center; gap: 3px; }
.db-tool.is-ok .db-tool-state { color: var(--dsw-alias-state-success-primary); }
.db-tool.is-failed .db-tool-state { color: var(--dsw-alias-state-error-primary); }
.db-tool.is-running .db-tool-state { color: var(--dsw-alias-label-secondary); }
.db-tool.is-unknown {
  border-style: dashed;
  color: var(--dsw-alias-label-secondary);
}
.db-tool.is-unknown .db-tool-name { color: var(--dsw-alias-label-secondary); }

.db-tool-detail-wrap { display: flex; flex-direction: column; gap: 5px; margin-block-start: 3px; }
.db-tool-summary {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
}
.db-tool-kind-read { color: var(--dsw-alias-state-success-primary); }
.db-tool-kind-write { color: var(--dsw-alias-state-warn-primary); }
.db-tool-kind-bash { color: var(--dsw-alias-state-idle-primary); }
.db-tool-kind-web { color: var(--dsw-alias-brand-primary); }
.db-tool-kind-search { color: var(--dsw-alias-label-secondary); }
.db-tool-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.db-tool-detail-body {
  margin: 0;
  max-block-size: 240px;
  overflow: auto;
}
.db-tool-detail { display: flex; flex-direction: column; gap: 2px; }
.db-tool-detail-label {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.db-tool-detail-body {
  margin: 0;
  max-block-size: 180px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.db-tool-hint {
  padding: 6px 8px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 7px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.db-tool-error {
  margin-block-start: 2px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.db-event {
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  font-style: italic;
}

.db-cursor {
  display: inline-block;
  inline-size: 7px;
  block-size: 14px;
  margin-inline-start: 2px;
  translate: 0 2px;
  border-radius: 1px;
  background: var(--dsw-alias-brand-primary);
  animation: db-blink 1s steps(2, start) infinite;
}
@keyframes db-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .db-cursor { animation: none; opacity: 0.7; }
}

/* -------------------------------------------------------------- composer */

.db-composer { flex: none; padding: 8px 20px 14px; }
.db-composer-inner { max-inline-size: 900px; margin-inline: auto; }

.db-quote {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-block-end: 6px;
  padding: 5px 9px;
  border-inline-start: 2px solid var(--dsw-alias-brand-primary);
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
}
.db-quote-text {
  flex: 1;
  min-inline-size: 0;
  max-block-size: 54px;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.db-quote-close { flex: none; }

.db-composer-box {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.db-composer-box:focus-within {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}
.db-input {
  display: block;
  inline-size: 100%;
  min-block-size: 42px;
  max-block-size: 180px;
  padding: 10px 12px 2px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
  overflow-y: auto;
}
.db-input::placeholder { color: var(--dsw-alias-label-secondary); }

.db-composer-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 8px 12px;
}
.db-composer-hint {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}

.db-running {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
}

/* ---------------------------------------------------------------- button */

.db-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s, opacity 0.12s;
}
.db-btn:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, var(--dsw-alias-bg-layer-1)); }
.db-btn:disabled { opacity: 0.5; cursor: default; }
.db-btn.is-primary {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  font-weight: 600;
}
.db-btn.is-primary:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 88%, var(--dsw-alias-label-primary)); }
.db-btn.is-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
}
.db-btn.is-ghost:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); color: var(--dsw-alias-label-primary); }
.db-btn.is-danger {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
}
.db-btn.is-danger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.db-btn.is-sm { padding: 3px 9px; font-size: 11.5px; border-radius: 7px; }
.db-btn.is-block { inline-size: 100%; }

.db-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 28px;
  block-size: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.db-icon-btn:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 12%, transparent);
  color: var(--dsw-alias-label-primary);
}
.db-icon-btn:disabled { opacity: 0.4; cursor: default; }
.db-icon-btn.is-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  color: var(--dsw-alias-brand-primary);
}

.db-send {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 30px;
  block-size: 30px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  cursor: pointer;
  transition: opacity 0.12s;
}
.db-send:disabled { opacity: 0.35; cursor: default; }

/* ------------------------------------------------------------------ rail */

.db-rail {
  flex: none;
  inline-size: var(--db-rail-w);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  border-inline-start: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.db-rail-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 34px;
  block-size: 34px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.db-rail-btn:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 12%, transparent);
  color: var(--dsw-alias-label-primary);
}
.db-rail-btn.is-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.db-rail-sep {
  inline-size: 22px;
  block-size: 1px;
  margin-block: 4px;
  background: var(--dsw-alias-border-l1);
}

/* ---------------------------------------------------------------- drawer */

.db-backdrop {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 62%, transparent);
  animation: db-fade-in 0.14s ease-out;
}
@keyframes db-fade-in { from { opacity: 0; } to { opacity: 1; } }

.db-drawer {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  z-index: 31;
  inline-size: min(470px, 94%);
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  border-inline-start: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: -12px 0 32px color-mix(in srgb, var(--dsw-alias-bg-overlay) 55%, transparent);
  animation: db-slide-in 0.16s ease-out;
}
@keyframes db-slide-in {
  from { transform: translateX(16px); opacity: 0; }
  to { transform: none; opacity: 1; }
}

.db-drawer-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 8px 16px;
  border-block-end: 1px solid var(--dsw-alias-border-l1);
}
.db-drawer-title { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }

.db-tabs {
  flex: none;
  display: flex;
  gap: 2px;
  padding: 8px 12px;
  overflow-x: auto;
  border-block-end: 1px solid var(--dsw-alias-border-l1);
  scrollbar-width: none;
}
.db-tabs::-webkit-scrollbar { display: none; }
.db-tab {
  flex: none;
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.db-tab:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); }
.db-tab.is-active {
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent);
}

.db-drawer-body {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 14px 16px 22px;
}

/* ----------------------------------------------------------------- forms */

.db-stack { display: flex; flex-direction: column; gap: 14px; }
.db-stack-tight { display: flex; flex-direction: column; gap: 6px; }
.db-row { display: flex; align-items: center; gap: 8px; min-inline-size: 0; }
.db-row-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.db-grow { flex: 1; min-inline-size: 0; }
.db-spacer { flex: 1; }

.db-section-title {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.db-title { margin: 0; font-size: 15px; font-weight: 600; }
.db-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.db-divider { block-size: 1px; background: var(--dsw-alias-border-l1); margin: 4px 0; }

.db-field { display: flex; flex-direction: column; gap: 5px; min-inline-size: 0; }
.db-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.db-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.db-error { font-size: 11.5px; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }

.db-input-text,
.db-textarea,
.db-select {
  inline-size: 100%;
  min-inline-size: 0;
  padding: 6px 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
}
.db-textarea { min-block-size: 78px; resize: vertical; line-height: 1.5; }
.db-input-text:focus,
.db-textarea:focus,
.db-select:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 58%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}
.db-select { appearance: auto; }

.db-color-field { display: flex; align-items: center; gap: 14px; min-inline-size: 0; }
.db-swatches { display: flex; flex-wrap: wrap; gap: 7px; flex: 1; min-inline-size: 0; }

.db-note-section {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-block-start: 8px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
}
.db-note-section .db-note-entry { flex-basis: 100%; margin: 0; }
.db-note-section .db-section-title { margin: 0; }
.db-swatch {
  inline-size: 22px;
  block-size: 22px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent);
}
.db-swatch.is-active {
  border-color: var(--dsw-alias-label-primary);
  box-shadow: none;
}

.db-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.db-toggle-track {
  position: relative;
  flex: none;
  inline-size: 30px;
  block-size: 17px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 30%, transparent);
  transition: background 0.14s;
}
.db-toggle-track::after {
  content: '';
  position: absolute;
  inset-block-start: 2px;
  inset-inline-start: 2px;
  inline-size: 13px;
  block-size: 13px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base);
  transition: transform 0.14s;
}
.db-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.db-toggle input:checked + .db-toggle-track { background: var(--dsw-alias-brand-primary); }
.db-toggle input:checked + .db-toggle-track::after { transform: translateX(13px); }
.db-toggle-text { font-size: 12px; }

.db-checks { display: flex; flex-direction: column; gap: 4px; }
.db-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 7px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12.5px;
}
.db-check:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 8%, transparent); }
.db-check input { accent-color: var(--dsw-alias-brand-primary); }

.db-seg {
  align-self: flex-start;
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  gap: 2px;
}
.db-seg button {
  padding: 3px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  cursor: pointer;
}
.db-seg button.is-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.db-form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  position: sticky;
  inset-block-end: -22px;
  margin: 2px -16px -22px;
  padding: 10px 16px;
  border-block-start: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.db-form-actions .db-error {
  flex-basis: 100%;
  margin-block-end: 2px;
}

/* ----------------------------------------------------------------- cards */

.db-card {
  padding: 11px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--db-radius);
  background: var(--dsw-alias-bg-base);
  min-inline-size: 0;
}
.db-card + .db-card { margin-block-start: 8px; }
.db-card-head { display: flex; align-items: center; gap: 9px; min-inline-size: 0; }
.db-card-main { flex: 1; min-inline-size: 0; }
.db-card-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  min-inline-size: 0;
}
.db-card-name > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-card-sub {
  margin-block-start: 1px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-card-actions { flex: none; display: flex; gap: 2px; }
.db-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 12%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
}
.db-tag.is-brand {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.db-tag.is-success {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

.db-avatar {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 30px;
  block-size: 30px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  user-select: none;
  overflow: hidden;
}
.db-avatar.is-lg { inline-size: 38px; block-size: 38px; font-size: 15px; }
.db-avatar.is-sm { inline-size: 24px; block-size: 24px; font-size: 10.5px; }
.db-avatar.is-xl { inline-size: 56px; block-size: 56px; font-size: 22px; }
.db-avatar img { inline-size: 100%; block-size: 100%; object-fit: cover; display: block; }

/* ----------------------------------------------------------------- empty */

.db-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  inline-size: 100%;
  padding: 28px 18px;
  text-align: center;
}
.db-empty-title { margin: 4px 0 0; font-size: 15px; font-weight: 600; }
.db-empty-body {
  margin: 0;
  max-inline-size: 460px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.db-empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-block-start: 6px; }
.db-empty-note { font-size: 11px; color: var(--dsw-alias-label-secondary); }

.db-empty-state {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-block-size: 0;
  padding: 24px;
}
.db-empty-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 64px;
  block-size: 64px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  color: var(--dsw-alias-brand-primary);
}

.db-center-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}

/* ------------------------------------------------------------------ misc */

.db-spinner {
  display: inline-block;
  inline-size: 14px;
  block-size: 14px;
  border: 2px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 30%, transparent);
  border-block-start-color: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  animation: db-spin 0.72s linear infinite;
}
.db-spinner.is-lg { inline-size: 22px; block-size: 22px; border-width: 2.5px; }
@keyframes db-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .db-spinner { animation-duration: 2s; }
}

.db-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 26px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.db-toasts {
  position: absolute;
  inset-block-end: 16px;
  inset-inline-start: 50%;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  translate: -50% 0;
  pointer-events: none;
}
.db-toast {
  max-inline-size: 380px;
  padding: 6px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  box-shadow: 0 6px 18px color-mix(in srgb, var(--dsw-alias-bg-overlay) 45%, transparent);
  animation: db-fade-in 0.14s ease-out;
  overflow-wrap: anywhere;
}
.db-toast.is-error {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, transparent);
  color: var(--dsw-alias-state-error-primary);
}
.db-toast.is-success {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 42%, transparent);
}

.db-note-entry {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.db-inline-note {
  padding: 7px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.db-inline-note.is-error {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

/* --------------------------------------------------------------- memory */

.db-mem-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-base);
}
.db-mem-item + .db-mem-item { margin-block-start: 6px; }
.db-mem-text {
  flex: 1;
  min-inline-size: 0;
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.db-mem-meta {
  margin-block-start: 2px;
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary);
}
.db-mem-actions { flex: none; display: flex; align-items: center; gap: 2px; }

/* ------------------------------------------------------------- schedules */

.db-sch-item {
  padding: 9px 11px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
}
.db-sch-item + .db-sch-item { margin-block-start: 7px; }
.db-sch-head { display: flex; align-items: center; gap: 8px; min-inline-size: 0; }
.db-sch-title { flex: 1; min-inline-size: 0; font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-sch-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-block-start: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.db-sch-prompt {
  margin-block-start: 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}

/* ----------------------------------------------------------------- usage */

.db-stats { display: flex; gap: 8px; }
.db-stat {
  flex: 1;
  min-inline-size: 0;
  padding: 9px 11px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
}
.db-stat-value { font-size: 19px; font-weight: 700; line-height: 1.2; }
.db-stat-label { margin-block-start: 1px; font-size: 11px; color: var(--dsw-alias-label-secondary); }

.db-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  block-size: 120px;
  padding: 8px 2px 0;
}
.db-bar-col {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  block-size: 100%;
}
.db-bar {
  inline-size: 100%;
  max-inline-size: 26px;
  min-block-size: 2px;
  border-radius: 4px 4px 2px 2px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 72%, transparent);
  transition: height 0.2s;
}
.db-bar.is-empty { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 16%, transparent); }
.db-bar-count { font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.db-bar-label {
  max-inline-size: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9.5px;
  color: var(--dsw-alias-label-secondary);
}

.db-rank-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  min-inline-size: 0;
}
.db-rank-name {
  flex: none;
  inline-size: 84px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.db-rank-track {
  display: block;
  flex: 1;
  min-inline-size: 0;
  block-size: 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, transparent);
  overflow: hidden;
}
.db-rank-fill {
  display: block;
  block-size: 100%;
  border-radius: 3px;
  background: var(--dsw-alias-brand-primary);
}
.db-rank-value { flex: none; inline-size: 62px; text-align: end; font-size: 11px; color: var(--dsw-alias-label-secondary); }

/* ------------------------------------------------------- settings section */

.db-settings-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px;
  min-inline-size: 0;
}
.db-settings-page .db-title { font-size: 14px; }
.db-settings-actions { display: flex; gap: 8px; margin-block-start: 2px; }

/* ------------------------------------------------------------ file panel */

.db-files {
  flex: none;
  inline-size: 520px;
  max-inline-size: 54vw;
  display: flex;
  flex-direction: column;
  min-block-size: 0;
  border-inline-start: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.db-files-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-block-end: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
}
.db-files-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.db-files-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-inline-start: 6px;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 8%, transparent);
}
.db-files-tab {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 6px;
  cursor: pointer;
}
.db-files-tab.is-active {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l1);
}
.db-files-root { flex: 1; min-inline-size: 120px; }
.db-files-root .db-select { inline-size: 100%; font-size: 11px; }
.db-file-pane { display: flex; flex-direction: column; min-block-size: 0; flex: 1; }
.db-file-browse { display: flex; flex-direction: column; min-block-size: 0; flex: 1; }
.db-file-nav {
  flex: none;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 8px;
  border-block-end: 1px solid var(--dsw-alias-border-l1);
  min-inline-size: 0;
}
.db-file-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow-x: auto;
  min-inline-size: 0;
  gap: 1px;
}
.db-file-crumb {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  padding: 2px 3px;
  cursor: pointer;
  border-radius: 5px;
  max-inline-size: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-file-crumb::after { content: '/'; color: var(--dsw-alias-label-secondary); opacity: 0.6; }
.db-file-crumb:last-child::after { content: ''; }
.db-file-crumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); }
.db-file-crumb.is-current { color: var(--dsw-alias-label-primary); }
.db-file-list {
  flex: 1;
  min-block-size: 0;
  overflow: auto;
  padding: 4px;
}
.db-file-row {
  display: flex;
  align-items: center;
  gap: 7px;
  inline-size: 100%;
  min-inline-size: 0;
  padding: 4px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 11.5px;
  text-align: start;
  cursor: pointer;
}
.db-file-row:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); }
.db-file-row-icon { flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary); }
.db-file-row.is-dir .db-file-row-icon { color: var(--dsw-alias-brand-primary); }
.db-file-row-name { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-file-row-meta { flex: none; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.db-file-empty {
  padding: 14px 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  text-align: center;
}
.db-file-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
}
.db-file-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11.5px;
}
.db-file-content { flex: 1; min-block-size: 0; overflow: auto; display: flex; flex-direction: column; }
.db-file-preview-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-block-end: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.db-file-preview-name { flex: 1; min-inline-size: 0; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-file-preview-meta { flex: none; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.db-file-code { padding: 6px 0; font-family: var(--db-mono); font-size: 11px; line-height: 1.55; }
.db-file-line { display: flex; gap: 8px; min-inline-size: 0; padding-inline: 6px; }
.db-file-line-no {
  flex: none;
  inline-size: 34px;
  text-align: end;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.65;
  user-select: none;
}
.db-file-line-text { flex: 1; min-inline-size: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.db-file-md { padding: 8px 10px; font-size: 12px; }
.db-file-image { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px; }
.db-file-image img { max-inline-size: 100%; max-block-size: 100%; object-fit: contain; border-radius: 6px; }
.db-file-caption { color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.db-file-binary { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; padding: 24px 12px; }
.db-file-truncated { padding: 6px 10px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; border-block-start: 1px solid var(--dsw-alias-border-l1); }

.db-md-file {
  display: inline;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-brand-primary);
  font: inherit;
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}
.db-md-file:hover { text-decoration: underline solid; }

/* --------------------------------------------------------- mentions & group */

.db-mention {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  border-radius: 5px;
  padding: 0 3px;
  font-weight: 600;
  white-space: nowrap;
}
.db-mention.is-all { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); }
.db-mention-pop {
  position: absolute;
  inset-inline: 8px;
  inset-block-end: calc(100% + 6px);
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-block-size: 260px;
  overflow: auto;
  padding: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: 0 10px 26px color-mix(in srgb, var(--dsw-alias-bg-overlay) 26%, transparent);
}
.db-mention-row {
  display: flex;
  align-items: center;
  gap: 8px;
  inline-size: 100%;
  padding: 5px 7px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  text-align: start;
  cursor: pointer;
}
.db-mention-row:hover, .db-mention-row.is-active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.db-mention-row-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 24px;
  block-size: 24px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}
.db-mention-row-main { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; gap: 1px; }
.db-mention-row-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-mention-row-role { font-size: 10px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-mention-empty { padding: 10px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; text-align: center; }
.db-speakers-hint strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
.db-group-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; padding: 16px; color: var(--dsw-alias-label-secondary); }
.db-group-empty p { margin: 0; font-size: 12px; line-height: 1.6; }
.db-msg.is-relay .db-msg-role {
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-brand-primary);
}

/* ------------------------------------------------------ markdown tables */

.db-md-table-wrap {
  margin-block: 8px;
  max-inline-size: 100%;
  overflow-x: auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
}
.db-md-table {
  inline-size: 100%;
  border-collapse: collapse;
  font-size: 12px;
  line-height: 1.5;
  background: var(--dsw-alias-bg-base);
}
.db-md-table th,
.db-md-table td {
  padding: 5px 9px;
  border-block-end: 1px solid var(--dsw-alias-border-l1);
  border-inline-end: 1px solid var(--dsw-alias-border-l1);
  text-align: start;
  vertical-align: top;
  overflow-wrap: anywhere;
}
.db-md-table th:last-child,
.db-md-table td:last-child { border-inline-end: 0; }
.db-md-table tbody tr:last-child td { border-block-end: 0; }
.db-md-table thead th {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 8%, transparent);
  font-weight: 600;
  white-space: nowrap;
}
.db-md-table th.db-md-align-center,
.db-md-table td.db-md-align-center { text-align: center; }
.db-md-table th.db-md-align-right,
.db-md-table td.db-md-align-right { text-align: end; }

/* ------------------------------------------------------------ avatars */

.db-avatar-img {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
  border-radius: 26%;
}
.db-avatar.is-image { overflow: hidden; }
.db-avatar.is-svg {
  background: transparent;
  box-shadow: none;
  overflow: visible;
}
.db-avatar-svg { display: block; border-radius: 26%; }
.db-avatar-field { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; min-inline-size: 0; }
.db-avatar-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: 1; min-inline-size: 0; }
.db-avatar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(74px, 1fr));
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.db-avatar-choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 2px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  min-inline-size: 0;
}
.db-avatar-choice:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); }
.db-avatar-choice.is-active {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}
.db-avatar-choice-label {
  font-size: 9.5px;
  line-height: 1.25;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* -------------------------------------------------------- attachments */

.db-attach-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-block-end: 8px;
}
.db-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  max-inline-size: 240px;
  min-inline-size: 0;
  padding: 5px 6px 5px 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.db-chip.is-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); }
.db-chip-thumb {
  flex: none;
  inline-size: 30px;
  block-size: 30px;
  object-fit: cover;
  border-radius: 6px;
}
.db-chip-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 30px;
  block-size: 30px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 12%, transparent);
  color: var(--dsw-alias-label-secondary);
}
.db-chip-main { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; gap: 1px; }
.db-chip-name {
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-chip-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-chip.is-error .db-chip-meta { color: var(--dsw-alias-state-error-primary); }
.db-chip-spinner { inline-size: 10px; block-size: 10px; border-width: 1.5px; }
.db-chip-bar {
  position: absolute;
  inset-block-end: 0;
  inset-inline-start: 0;
  block-size: 2px;
  inline-size: 45%;
  background: var(--dsw-alias-brand-primary);
  animation: db-chip-progress 1.1s ease-in-out infinite;
}
@keyframes db-chip-progress {
  0% { inset-inline-start: -45%; }
  100% { inset-inline-start: 100%; }
}

.db-composer-inner.is-dragging .db-composer-box {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
}
.db-drop-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-block-end: 6px;
  padding: 7px;
  border: 1px dashed var(--dsw-alias-brand-primary);
  border-radius: 9px;
  color: var(--dsw-alias-brand-primary);
  font-size: 12px;
}
.db-attach-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px;
  margin: 8px 8px 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--dsw-alias-bg-overlay) 22%, transparent);
}
.db-attach-menu-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  text-align: start;
  cursor: pointer;
}
.db-attach-menu-item:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 12%, transparent); }

/* Attachments already in the timeline */
.db-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-block: 4px 2px; }
.db-attach-link { display: block; text-decoration: none; color: inherit; min-inline-size: 0; }
.db-attach {
  display: flex;
  align-items: center;
  gap: 8px;
  min-inline-size: 0;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
}
.db-attach-link:hover .db-attach { border-color: var(--dsw-alias-border-l2); }
.db-attach-image { flex-direction: column; align-items: stretch; gap: 4px; padding: 5px; max-inline-size: 260px; }
.db-attach-image img {
  display: block;
  inline-size: 100%;
  max-block-size: 220px;
  object-fit: contain;
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 8%, transparent);
}
.db-attach-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 9%, transparent);
  color: var(--dsw-alias-label-secondary);
}
.db-attach-caption {
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-inline-size: 240px;
}
.db-attach-file { min-inline-size: 190px; max-inline-size: 300px; color: var(--dsw-alias-label-secondary); }
.db-attach-main { display: flex; flex-direction: column; gap: 1px; flex: 1; min-inline-size: 0; }
.db-attach-name {
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-attach-meta { font-size: 10.5px; color: var(--dsw-alias-label-secondary); }

/* -------------------------------------------------------------- activity */

.db-activity {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 18px;
  border-block-end: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  min-inline-size: 0;
}
.db-activity-text { flex: none; }
.db-activity-title {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

/* ----------------------------------------------------------------- tasks */

.db-task {
  padding: 9px 11px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
}
.db-task + .db-task { margin-block-start: 6px; }
.db-task-head { display: flex; align-items: flex-start; gap: 8px; min-inline-size: 0; }
.db-task-main { flex: 1; min-inline-size: 0; }
.db-task-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.db-task-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-block-start: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.db-task-actions { flex: none; display: flex; align-items: center; gap: 2px; }
.db-task-summary {
  margin-block-start: 5px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.db-task-result {
  margin: 6px 0 0;
  max-block-size: 220px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.db-task-error {
  margin-block-start: 5px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}

/* -------------------------------------------------------------- memory */

.db-mem-auto {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent);
}
.db-mem-candidates {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.db-mem-item.is-candidate { background: var(--dsw-alias-bg-base); }
.db-mem-body { overflow-wrap: anywhere; }
.db-mem-reason {
  margin-block-start: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  overflow-wrap: anywhere;
}
.db-row.db-gap { display: flex; align-items: center; gap: 4px; }

/* ------------------------------------------------- group directories */

.db-dir-field { display: flex; flex-direction: column; gap: 8px; min-inline-size: 0; }
.db-dir-list { display: flex; flex-direction: column; gap: 6px; }
.db-dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-inline-size: 0;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
}
.db-dir-icon { flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary); }
.db-dir-main { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; gap: 1px; }
.db-dir-title {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-dir-path {
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-dir-add { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.db-dir-add .db-select { flex: 1; min-inline-size: 160px; }
.db-dir-empty {
  padding: 8px 10px;
  border: 1px dashed var(--dsw-alias-border-l1);
  border-radius: 9px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
}
.db-dir-reset {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent);
}
.db-card-dir {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-block-start: 2px;
  color: var(--dsw-alias-label-secondary);
}

.db-tag.is-error {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 13%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

/* --------------------------------------------------- responsive: narrow */

@container db (max-width: 900px) {
  .db-left {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 20;
    inline-size: min(288px, 86%);
    transform: translateX(-102%);
    transition: transform 0.18s ease;
    box-shadow: 12px 0 28px color-mix(in srgb, var(--dsw-alias-bg-overlay) 38%, transparent);
  }
  .db.is-left-open .db-left { transform: none; }
  .db-left-scrim {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 19;
    background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 48%, transparent);
  }
  .db.is-left-open .db-left-scrim { display: block; }
  .db-left-toggle { display: inline-flex !important; }
}

@container db (max-width: 640px) {
  .db-rail { display: none; }
  .db-timeline { padding: 14px 12px 6px; }
  .db-composer { padding: 6px 10px 10px; }
  .db-chat-head { padding-inline: 10px; }
  .db-drawer { inline-size: 100%; border-inline-start: 0; }
  .db-msg-body { max-inline-size: 88%; }
  .db-chat-time { display: none; }
}

/* The toggle exists wide too (hidden) so the narrow rule only flips display. */
.db-left-toggle { display: none; }
.db-left-scrim { display: none; }
`

/** Install the sheet once; returns the disposer that removes it. */
function installStyles() {
  if (typeof document === 'undefined') return function () {}
  var style = document.createElement('style')
  style.setAttribute('data-dsh-bot', '')
  style.textContent = CSS
  ;(document.head || document.documentElement).appendChild(style)
  return function () {
    if (style.parentNode !== null && style.parentNode !== undefined) style.parentNode.removeChild(style)
  }
}

module.exports = { CSS: CSS, installStyles: installStyles }
