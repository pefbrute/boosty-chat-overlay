---
name: boosty-overlay-dev
description: >-
  Development standards, architectural invariants, and verification protocols for the Boosty Chat Overlay project.
  Use when modifying, refactoring, or extending this codebase, working on message normalization,
  core server logic, OBS Studio integration, Electron IPC, or verifying changes before completion.
---

# Boosty Chat Overlay Development Guide (`boosty-overlay-dev`)

> [!IMPORTANT]
> **Золотое правило UI-задач:**
> Любые изменения `desktop/index.html`, `desktop/app.css`, `desktop/app.js` или `desktop/ui/*` считаются завершёнными **ТОЛЬКО** после `npm run test:ui:visual` и обязательного просмотра всех затронутых скриншотов через `view_file`.
> Агент не имеет права сдавать работу или рапортовать о готовности без визуальной инспекции сгенерированных PNG в `artifacts/ui/`.

This skill defines the architectural boundaries, critical invariants, and verification pipeline for developing and maintaining the `boosty-chat-overlay` codebase.

---

## 1. Architectural Boundaries & Directory Isolation

The codebase is strictly modularized into isolated responsibility layers. Never blur these boundaries:

```text
Boosty DOM (in browser)
       ↓
extension/parser.js  ──► NormalizedMessage
       ↓  (HTTP POST /message)
server.js (127.0.0.1:17369)
   ├── core/messages/ (history, dedup, model)
   ├── core/config/   (schema, defaults, store)
   ├── core/sse/      (hub, clients, replay)
   └── core/health/   (tracker, semver)
       ↓  (Server-Sent Events)
overlay/ (renderer.js, overlay.js) ──► OBS Browser Source
       ▲
desktop/ (Electron Application)
   ├── desktop/main.js       (Minimal bootstrap & lifecycle)
   ├── desktop/obs/          (OBS WebSocket v5, scenes, mutation queue)
   ├── desktop/browser/      (Browser manager, extension unpacker)
   ├── desktop/main/ipc.js   (Thin IPC routing & validation ONLY)
   └── desktop/ui/status-hub (Pure function deriveSystemStatus)
```

### Boundary Rules:
1. **`core/` must NEVER depend on Electron or OBS.** It contains pure Node.js business logic that can be tested in isolation with zero GUI or Electron dependencies.
2. **OBS logic lives strictly in `desktop/obs/`.** Never move OBS WebSocket code back into `desktop/main.js` or into `core/`.
3. **`desktop/main/ipc.js` is glue code only.** Handlers validate arguments, catch errors, and delegate to `ObsService` or `BrowserManager`. **No business logic in IPC handlers.**
4. **`extension/parser.js` must be browser-independent.** It operates on standard DOM nodes and produces a `NormalizedMessage` contract.

---

## 2. Critical Architecture Invariants (Do Not Break)

### 2.1. `publishedAt` vs `receivedAt`
- `publishedAt` (string/number): The time shown in Boosty chat. Used for display and fallback ID hashing.
- `receivedAt` (number, server timestamp): Assigned strictly by the server when the message reaches `127.0.0.1:17369`.
- **Invariant:** Message TTL (fade-out timer) is **always** calculated from `receivedAt`. This prevents reloaded or replayed messages from outliving their intended lifespan.

### 2.2. Deterministic Fallback FNV-1a Hash
- When Boosty does not provide a native message ID, the ID is calculated via FNV-1a from:
  `${pathname}|${author}|${text}|${publishTime}`
- **Invariant:** Never change this hashing algorithm without a dedicated migration. Changing it causes active sessions to duplicate messages on reconnect.

### 2.3. OBS Mutation Queue (`createMutationQueue`)
- OBS WebSocket v5 scene modifications (`addScene`, `removeScene`) are asynchronous and prone to race conditions.
- **Invariant:** All OBS mutations must be enqueued through `createMutationQueue`.
- **Invariant:** Listen to `CurrentSceneCollectionChanging` and block mutations until `CurrentSceneCollectionChanged`.

### 2.4. Idempotent Service Scene in OBS
- The application creates a dedicated scene `Boosty Chat Overlay` containing Browser Source `Boosty Chat`.
- This service scene is linked into the streamer's active scene as a nested scene item.
- **Invariant:** Never delete or alter user sources. On scene removal, remove only the reference to `Boosty Chat Overlay`.

### 2.5. Last-Event-ID & History Replay
- The server maintains an in-memory ring buffer of the last 50 messages with auto-incrementing `eventId`.
- When an overlay client reconnects with header `Last-Event-ID`, the server replays only messages newer than that ID.
- In the overlay client, `seenMessageIds` is capped at 300 with FIFO eviction to prevent memory leaks.

### 2.6. XSS Prevention & Text Injection
- **Invariant:** All chat messages and author names must be rendered via `element.textContent`, never `innerHTML`.

### 2.7. Production Isolation of Test Hooks
- Test hooks (`window.__BOOSTY_UI_TEST__` and `window.boostyAudit`) are injected **only** when `BOOSTY_OVERLAY_UI_TEST=1`.
- **Invariant:** In production mode, both must be strictly `undefined`. This is asserted by `test/production-isolation.test.js`.

---

## 3. Where to Change What (Quick Index)

| Task | Target Files |
| :--- | :--- |
| Boosty chat DOM selectors or layout parsing | [`extension/parser.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/parser.js) |
| Message schema or validation | [`core/messages/model.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/model.js), [`types/message.d.ts`](file:///home/fedor/projects/boosty-chat-overlay/types/message.d.ts) |
| Message history ring buffer or deduplication | [`core/messages/history.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/history.js), [`core/messages/dedup.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/dedup.js) |
| Overlay config defaults and schema | [`core/config/defaults.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/defaults.js), [`core/config/schema.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/schema.js) |
| SSE broadcasting and reconnection | [`core/sse/hub.js`](file:///home/fedor/projects/boosty-chat-overlay/core/sse/hub.js), [`server.js`](file:///home/fedor/projects/boosty-chat-overlay/server.js) |
| OBS Studio connection, scenes, or mutations | [`desktop/obs/`](file:///home/fedor/projects/boosty-chat-overlay/desktop/obs/) (`client.js`, `scenes.js`, `service.js`) |
| Chromium browser detection or extension unpack | [`desktop/browser/manager.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/browser/manager.js) |
| Electron IPC channels | [`desktop/main/ipc.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/main/ipc.js), [`desktop/preload.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/preload.js) |
| Dashboard Status Hub logic and CTAs | [`desktop/ui/status-hub.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/ui/status-hub.js) |
| Overlay visual card layout and CSS | [`overlay/renderer.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/renderer.js), [`overlay/style.css`](file:///home/fedor/projects/boosty-chat-overlay/overlay/style.css) |
| Desktop Electron UI Visual QA runner | [`scripts/visual-test-electron.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-electron.js) |

---

## 4. Mandatory Pre-Completion Verification Checklist

Before finishing any task, submitting a PR, or presenting completed work to the user, run the complete verification suite:

```bash
# 1. Syntax check across all JavaScript files via V8 CLI
npm run check

# 2. Unit tests (core, obs, desktop, model, parser)
npm test

# 3. Integration tests inside real Electron instance
npm run test:integration

# 4. Playwright Electron UI Visual QA (viewports, states, zero errors)
npm run test:ui:visual

# 5. Check for whitespace/git diff issues
git diff --check
```

### Visual Inspection Protocol:
If any file in `desktop/` or `overlay/` was modified:
1. Run `npm run test:ui:visual`.
2. Verify `artifacts/ui/console-errors.json` has 0 errors.
3. Open and inspect key generated screenshots via `view_file` (e.g. `artifacts/ui/dashboard-1280x850.png`, `artifacts/ui/dashboard-800x650.png`, `artifacts/ui/appearance.png`).
4. Verify typography hierarchy, Cyrillic text wrapping, and zero horizontal scroll overflow.
