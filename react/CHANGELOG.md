# Changelog

All notable changes to `threadlive-react`. The backend,
`threadlive/threadlive-laravel`, is released with the same version numbers;
use the two at the same version.

## 0.1.0 — 2026-11-19

First release.

- **The widget:** a launcher fixed in a corner (`pill`, `icon`, or your own
  button with `launcher="none"` and a ref), a panel that is full screen on
  phones, a home screen with topic buttons and "Continue the conversation".
- **Conversation:** optimistic sends with retry, read receipts, unread count
  (`onUnreadChange`), context cards, attachments (picker, paste, drag and
  drop), long messages collapsed behind "Show more", offline hours with an
  e-mail form.
- **Polling that costs little:** only for a conversation that is live, slower
  while the visitor is idle, nothing in a hidden tab unless a reply is
  awaited; backoff after errors. The transport is replaceable
  (`ThreadliveTransport`; `createDemoTransport()` for previews).
- **Background replies:** "(1)" in the tab title and a soft chime
  (`notify`).
- **Turnstile** on a guest's first message when the backend has it on.
- **Yours to style:** `theme` (CSS variables), every text (`texts`), `logo`,
  `launcherIcon`, `position`; `tl-` classes.
- React 18 and 19; server rendering safe (renders nothing on the server).
