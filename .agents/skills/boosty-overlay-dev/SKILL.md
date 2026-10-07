---
name: boosty-overlay-dev
description: >-
  Development standards, architectural invariants, and verification protocols for the Boosty Chat Overlay project.
  Use when modifying, refactoring, or extending this codebase, working on message normalization,
  core server logic, OBS Studio integration, Electron IPC, or verifying changes before completion.
---

# Boosty Chat Overlay Development Guide (`boosty-overlay-dev`)

> [!IMPORTANT]
> **Золотое правило UI-задач (Desktop & Overlay):**
> 1. **Desktop UI (`desktop/**/*`):** Завершается **ТОЛЬКО** после `npm run test:ui:visual` и просмотра скриншотов в `artifacts/ui/` через `view_file`.
> 2. **OBS Overlay (`overlay/**/*`):** Завершается **ТОЛЬКО** после `npm run test:overlay:visual` и просмотра скриншотов в `artifacts/overlay/` через `view_file`.
> 3. **Desktop + Overlay:** Если затронуты обе части — обязательны **обе команды** и просмотр скриншотов обеих папок.
> Агент не имеет права сдавать работу без двухпроходной визуальной инспекции (Two-Pass Visual QA) созданных PNG.

This skill defines the architectural boundaries, critical invariants, and verification pipeline for developing and maintaining the `boosty-chat-overlay` codebase.

---

## 1. Architectural Boundaries & Directory Isolation

The codebase is strictly modularized into isolated responsibility layers. Never blur these boundaries:

```text
Boosty DOM (in browser)
       ↓
extension/parser.js + content.js  ──► NormalizedMessage & Tab State
       ↓  (chrome.runtime.Port 'boosty_tab')
extension/background.js (MV3 Service Worker)
       ↓  (Persistent WebSocket ws://127.0.0.1:17369/connector + HTTP fallback)
server.js (127.0.0.1:17369)
   ├── core/messages/ (history, dedup, model, GET /history)
   ├── core/config/   (schema, defaults, store)
   ├── core/sse/      (hub, clients, replay)
   └── core/health/   (tracker, WS connectionGeneration, diagnostic ring buffer)
       ↓  (Server-Sent Events /events)
overlay/ (renderer.js, overlay.js) ──► OBS Browser Source (auto-refreshed via refreshnocache)
       ▲
desktop/ (Electron Application)
   ├── desktop/main.js       (Minimal bootstrap & lifecycle)
   ├── desktop/obs/          (OBS WebSocket v5, scenes, mutation queue, CEF recovery)
   ├── desktop/browser/      (Browser manager, extension unpacker)
   ├── desktop/chat-monitor/ (Dedicated streamer Chat Monitor window manager & UI)
   ├── desktop/main/ipc.js   (Thin IPC routing & validation ONLY)
   └── desktop/ui/status-hub (Pure function deriveSystemStatus)
```

### Boundary Rules:
1. **`core/` must NEVER depend on Electron or OBS.** It contains pure Node.js business logic that can be tested in isolation with zero GUI or Electron dependencies.
2. **OBS logic lives strictly in `desktop/obs/`.** Never move OBS WebSocket code back into `desktop/main.js` or into `core/`.
3. **`desktop/main/ipc.js` is glue code only.** Handlers validate arguments, catch errors, and delegate to `ObsService` or `BrowserManager`. **No business logic in IPC handlers.**
4. **`extension/parser.js` must be browser-independent.** It operates on standard DOM nodes and produces a `NormalizedMessage` contract.
5. **Chat Monitor lives in `desktop/chat-monitor/`.** It is an independent secondary window for the streamer, consuming the existing `/history` and `/events` endpoints. Never create a duplicate message pipeline or transport for it.

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

### 2.8. `NormalizedMessage` v2 Contract (`segments`, `reply`, `author.role`)
- **`segments` (Array<MessageSegment> | null):** Structured message content supporting:
  - `{ type: 'text', text: string }`
  - `{ type: 'custom-emoji', id: string, name: string, url: string }`
  - `{ type: 'mention', text: string }`
- **Fallback `text`:** Always preserved as plain-text representation (e.g. `:heart:` for emoji) to guarantee backward compatibility with legacy consumers and logging.
- **`reply` ({ author: string, text: string } | null):** Context of quoted reply message rendered inside overlay card.
- **`author.role` ('streamer' | 'moderator' | null):** Role badge extracted from SVG icons (`#icon-star-*` for streamer/owner, `#icon-sword-*` for moderator). Sanitized to strict whitelist in `model.js`.

### 2.9. Author Presentation Colon Invariant
- Boosty DOM renders author name as `[author.name, ":"]` inside `CHATMESSAGE:author`.
- **Invariant:** Stripping of at most one trailing presentation colon is performed strictly at the parser and model boundary:
  - `extension/parser.js`: `normalizeAuthorName(raw)`
  - `core/messages/model.js`: `cleanAuthorName(rawName)`
- **Invariant:** Colons *inside* usernames (e.g., `"Foo:Bar"`, `"User:123"`) must be strictly preserved.
- Presentation styling (e.g. `: ` separator) belongs strictly in the UI/CSS layer (`overlay/style.css`), never stored in data models.

### 2.10. Full Canvas 1:1 OBS Viewport Invariant
- **Invariant:** Browser Source internal viewport (`width`, `height`) must dynamically match OBS base canvas (`GetVideoSettings` `baseWidth`, `baseHeight`). Never hardcode 1920×1080.
- **Invariant:** Scene item transform must be strictly canonical 1:1 (`positionX: 0, positionY: 0, scaleX: 1.0, scaleY: 1.0, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', crop: 0`).
- Chat positioning is performed exclusively in CSS within that full-canvas space. Dragging the red bounding box in OBS causes GPU quad scale distortion and is prohibited.
- Detection is non-destructive (`canvasStatus.isCanonical`); manual calibration is provided via IPC `fit-obs-overlay` (`fitOverlayToCanvas`).

### 2.11. Visual Positioning Coordinate Model (`core/layout/positioning.js`)
- Coordinates map bidirectionally between Drag & Drop screen positions and `{ horizontalAnchor, verticalAnchor, offsetX, offsetY }`.
- **Invariant:** Zero-Jump Continuous Anchor Switching: crossing the center line transitions anchors smoothly without jumps.
- Snapping is applied to center axes (X=960, Y=540) and standard corner offsets (16, 20, 24, 32, 40 px), clamped to canvas bounds.

### 2.12. Stream Profiles vs. Style Presets Independence (`core/config/profiles.js`)
- 4 canonical stream profiles in UI order: `content` (#1 recommended), `gaming`, `talking`, `minimal`.
- **Invariant:** Complete separation between Profiles (full layout + stack limits + preset) and Appearance Presets (`Чистый`, `Компактный`, `Крупный`, `Стекло`).
- Changing layout or stack manually sets profile to "Custom" (`null`) while preserving the active style preset badge.

### 2.13. Message Animations & Deterministic Test Invariant (`overlay/renderer.js`, `overlay/style.css`)
- 4 animation types: `none`, `fade` (default), `slide-up`, `slide-side` (anchor-aware).
- Speed range 150–1000ms (presets: 180ms, 280ms, 450ms).
- Exit animation runs at 75% duration; DOM removal occurs only after transition ends.
- **Invariant:** In deterministic mode (`BOOSTY_OVERLAY_UI_TEST=1` / `setDeterministicMode(true)`) or reduced motion, animations are suppressed to ensure zero partial-frame flakiness in screenshots.

### 2.14. Canonical Boosty Asset, SVG Symbol Sizing & Sticky Live Preview UX
- **Invariant (Dual Boosty Symbols):**
  - `#icon-boosty-color` (`viewBox="23.6 46.6 189 199"`, gradient `#boosty-brand-gradient`): brand logo in `.logo` containers (sidebar header, onboarding header).
  - `#icon-boosty` (`viewBox="0 0 235.6 292.2"`, `currentColor`): monochrome icon in action buttons and status pills.
- **Invariant (Zero Duplicate ViewBox on Outer `<svg>`):** When `<svg class="logo-icon">` or `<svg class="icon-svg">` uses `<use href="#symbol">`, the outer `<svg>` element must **NEVER** duplicate the `<symbol>`'s non-zero `viewBox`. Per the W3C SVG 2 specification, `<use>` already instantiates a nested viewport using the symbol's viewBox; duplicating non-zero `(minX, minY)` on the outer `<svg>` shifts the rendered graphic twice, causing severe clipping by the outer SVG's default `overflow: hidden`.
- **Invariant (Sticky Live Preview):** Live preview container `#sticky-preview-container` is sticky (`position: sticky; top: 80px;`) on viewports >= 900px and falls back to `position: relative` on compact viewports (<900px).

### 2.15. Persistent WebSocket Transport v2 & Control/Data Plane Isolation
- **Primary Transport (`ws://127.0.0.1:17369/connector`):** The MV3 service worker (`extension/background.js`) maintains a persistent WebSocket to `server.js` with a 20-second `PING`/`PONG` keepalive (below Chromium's 30s MV3 worker idle suspension threshold).
- **Content-to-Background (`chrome.runtime.Port`):** `extension/content.js` communicates with `background.js` via a persistent `boosty_tab` Port and falls back to `POST /message` if the worker is unreachable.
- **Generation Guard (`connectionGeneration`):** Rapid socket reconnects increment `connectionGeneration`. Stale `close`/`error` events from superseded sockets must never overwrite an active newer connection (`unregisterWsConnection` validates `connectionId`).
- **Control Plane vs. Data Plane Separation:**
  - **Control Plane:** `HANDSHAKE`, `HANDSHAKE_ACK`, `PING`, `PONG`, `TAB_STATE`, `TAB_CLOSED` manage health state and active tab registry (`chrome.storage.session`), and must **never** leak into `messageHistory` or SSE `/events`.
  - **Data Plane:** `MESSAGE` (over WebSocket with `MESSAGE_ACK`) and `POST /message` (HTTP fallback) pass through `normalizeIncomingMessage` → `validateNormalizedMessage` → `messageDedup` → `messageHistory` (`GET /history`) → `sseHub.broadcastMessage`.

### 2.16. OBS Browser Source CEF `ERR_CONNECTION_REFUSED` Auto-Recovery
- When the local server restarts while OBS is running, OBS's embedded CEF hits `ERR_CONNECTION_REFUSED` and lands on `chrome-error://chromewebdata/`, where `overlay.js` is not loaded and `EventSource` cannot auto-reconnect.
- **Invariant:** Upon OBS WebSocket `Connected` in `desktop/obs/service.js`, automatically call `refreshOverlayInput` (`PressInputPropertiesButton` with `propertyName: 'refreshnocache'`) so OBS Browser Source immediately reloads `/overlay/` without manual user intervention.

### 2.17. Focus Mode & Single Source of Truth Configuration
- **Invariant (Single Source of Truth):** Focus Mode (`Основное`) and Advanced Mode (`Расширенное`) share the exact same underlying configuration state. Never create split objects such as `basicConfig` or `advancedConfig`.
- **Progressive Disclosure:** Focus Mode exposes only 6 high-value parameters: Stream Profile, Visual Position (Corner Picker + Drag & Drop), Card Size Preset (`core/config/size-presets.js`), Max Message Limit (Numeric Stepper), Fade-out Duration (Pill Selector: 5s, 10s, 15s, 30s, Always), and Animation Type/Speed.
- **Two-Way Sync:** Switching between Basic and Advanced modes, or changing manual sliders in Advanced mode, preserves consistency through bidirectional synchronization (`syncInputsFromConfig`, `detectActiveSizePreset`).

### 2.18. Packaged Extension Deployment & Persistent Storage (AppImage FUSE Guard)
- In packaged Linux AppImage mode, `process.resourcesPath` resolves into a temporary FUSE mount: `/tmp/.mount_XXXXXX/resources/extension`.
- **Invariant:** The application must **never** instruct the user or browser to load unpacked extensions from `/tmp/.mount_*`. When the AppImage process exits, the mount point is deleted, causing Chromium to flag the extension as corrupted or deleted upon restart.
- **Persistent Deployment:** On application startup, `desktop/browser/extension-deployer.js` performs atomic version-aware deployment from `process.resourcesPath/extension` into persistent storage: `app.getPath('userData')/extension` (`~/.config/boosty-chat-overlay/extension`).
- Onboarding, settings modals, and clipboard copy buttons expose strictly the persistent directory.

### 2.19. Deterministic Stable Extension ID Invariant
- **Invariant:** `extension/manifest.json` contains a permanent 2048-bit RSA SPKI public key in the `"key"` field.
- **Canonical ID:** In Chromium, Brave, and Chrome, this public key deterministically hashes to:
  `EXPECTED_EXTENSION_ID = 'bcoadgccgjomlcadhmeognidaoocohdp'`
  defined as an immutable constant in `core/constants.js`.
- **Handshake Validation:** `extension/background.js` transmits `extensionId: chrome.runtime.id` during `HANDSHAKE`. The server records this in `core/health/tracker.js` and flags whether the connection is canonical or legacy.

### 2.20. Single-Instance Lock & Port Collision Guard
- **Invariant:** `desktop/main.js` calls `app.requestSingleInstanceLock()` prior to `app.whenReady()`.
- If a second instance is launched (e.g. accidental double-click of desktop shortcut), the secondary process exits immediately with code 0 without attempting to re-bind port 17369 or spawn duplicate windows.
- The primary instance listens for `second-instance` and restores/focuses its existing main window.
- If port 17369 is occupied by an external process, `server.on('error')` intercepts `EADDRINUSE` and displays a user-friendly error dialog rather than crashing with an unhandled exception.

### 2.21. Dual-Connector Coexistence & Legacy Migration Guard
- When an existing user upgrades, their browser may temporarily run the older legacy extension (without `"key"`) alongside or prior to the updated canonical extension.
- **Invariant:** When both canonical and legacy connections are open simultaneously, the canonical connection is elected as primary.
- **Duplicate Suppression (`shouldAcceptWsMessage`):** All `MESSAGE` frames originating from legacy connections are rejected/dropped with `duplicate: true, ignored: true` while a canonical connector is active, ensuring strictly 0 duplicated messages in history and SSE.
- **Status Hub Guidance:** The UI detects `healthState.extensionMigrationRequired` and presents a non-intrusive warning badge (`Требуется обновление`) with a 3-step migration helper modal.

### 2.22. Windows as Primary Production Target & NSIS Packaging Pipeline
- **Production Target Priority:** Windows is the primary release target for this project.
- **NSIS Contract:** Electron builder packages the Windows installer as a per-user, non-elevated installation (`perMachine: false`, `oneClick: false`, `allowToChangeInstallationDirectory: true`).
  - Target install directory: `%LOCALAPPDATA%\Programs\boosty-chat-overlay`
  - Uninstaller: `%LOCALAPPDATA%\Programs\boosty-chat-overlay\Uninstall Boosty Chat Overlay.exe`
  - Shortcuts: Desktop shortcut and Start Menu folder `Boosty Chat Overlay`.
- **CI/CD Pipeline (`.github/workflows/build-windows.yml`):**
  - Runner: `windows-latest` with Node.js 22 LTS (`node-version: 22`).
  - Automation triggers: Manual (`workflow_dispatch`) and Tag push (`tags: ['v*']`).
  - Release publication: Computes SHA-256 hash in PowerShell (`Get-FileHash -Algorithm SHA256`) and uploads the NSIS setup executable along with `SHA256SUMS.txt` to GitHub Releases using `softprops/action-gh-release@v2`.

### 2.23. Cross-Platform Path Separator Invariant in Tests
- **Invariant:** Test suites and codebase utilities must **never** perform naive string comparisons on filesystem paths using hardcoded `/` or `\` separators.
- On Windows, `path.join` emits backslashes (`\`), whereas Linux uses forward slashes (`/`).
- Hardcoded path comparisons like `expect(result).toBe('/path/to/file')` or `.replace(/\\/g, '/')` without normalizers lead to false test failures on `windows-latest`.
- **Normalization Standard:** Always use `path.resolve(...)` for absolute path comparisons, or use `path.posix` / `path.win32` explicitly when dealing with simulated cross-platform inputs (e.g. `desktop/obs/config.js`).

### 2.24. Chromium-Only Browser Support Invariant (MV3)
- **Invariant:** Companion extension support is strictly limited to Chromium-based browsers (Brave, Google Chrome, Microsoft Edge, Yandex Browser).
- Firefox is explicitly excluded from candidate lists in `desktop/browser/manager.js` because Firefox requires signed `.xpi` add-ons and does not support persistent unpacked Manifest V3 extensions via a static directory in developer mode.

### 2.25. OBS WebSocket Password Auth & Fresh Onboarding Transition Invariants
- **Secret Storage & Redaction (`obsPassword`):**
  - `obsHost`, `obsPort`, and `obsPassword` are stored in `overlay-settings.json` via `core/config/store.js`.
  - **Strict Redaction Invariant:** `obsPassword` is **never** returned in `GET /config`, `POST /config` responses, `GET /health`, `GET /diagnostic`, or SSE `config` events (`stripSecrets` in `server.js` deletes `obsPassword` and exposes only boolean `hasObsPassword: Boolean(cfg.obsPassword)`).
- **Auth Error Classification & `connectionGeneration` Guard (`desktop/obs/client.js`):**
  - Close codes `4009` (`Authentication failed`) and `4005` / `Authentication` errors must be classified as `authFailed: true, unavailable: false` (never conflated with `ECONNREFUSED` / `OBS offline`).
  - Because `obs-websocket-js` emits a `ConnectionClosed` event right as a failed `connect()` promise rejects on `4009`, `client.js` tracks a monotonic `connectionGeneration` counter and `activeObs === obs` guard so stale/aborted sockets cannot overwrite `authFailed: true` with `unavailable: true`.
- **Idempotent `updateConnectionConfig` (`desktop/obs/service.js`):**
  - Calling `obsService.updateConnectionConfig({ host, port, password })` (e.g., when clicking `Готово` on Onboarding Step 3) must check whether `{ host, port, password }` actually changed before calling `client.disconnect()`. Disconnecting an already-authenticated OBS socket when parameters are unchanged causes a false disconnect right as the user lands on the Dashboard.
- **Dual-View DOM Input Trap (`readObsConnectionInputs` in `desktop/app.js`):**
  - Onboarding (`#ob-obs-*`) and Dashboard (`#dash-obs-*`) inputs coexist in `desktop/index.html`.
  - **Never** read them via `dashEl?.value ?? obEl?.value`: an empty string `""` in an unedited `#dash-obs-password` input is non-nullish and will silently mask the password typed into `#ob-obs-password`! Always pass an explicit `source` (`'onboarding'` vs `'dashboard'`) to `readObsConnectionInputs(source)` and keep both input sets synchronized.
- **Isolated Fresh Onboarding E2E (`npm run test:onboarding`):**
  - `desktop/main.js` supports `BOOSTY_OVERLAY_USER_DATA` (setting both `userData` and `sessionData` **before** `app.requestSingleInstanceLock()`), `BOOSTY_OVERLAY_OBS_CONFIG_PATH`, and `BOOSTY_OVERLAY_HIDE_WINDOW=1`.
  - `test/fresh-onboarding-e2e.test.js` verifies the complete `fresh state → onboarding → dashboard → connected services` flow without intermediate app restarts against a real protocol-level `obswebsocket.msgpack` SHA256 server.

### 2.26. Chat Monitor v1: Streamer Dedicated Window & Zero Redundant Pipeline
- **Dedicated Streamer View:** OBS Overlay is strictly for viewers on stream; Chat Monitor is a practical, dense, high-contrast Electron `BrowserWindow` for the streamer on a second monitor.
- **Zero Redundant Pipeline Invariant:** Chat Monitor must **never** instantiate its own WebSocket transport, duplicate the message model, or bypass the server. It is strictly a consumer of `GET /history` and SSE `GET /events`, receiving `NormalizedMessage`.
- **Single Canonical Instance:** Opening Chat Monitor when already open restores, shows, and focuses the existing window (`createChatMonitorManager`). It never spawns duplicate window instances.
- **Independent Window Lifecycle:** Closing the Chat Monitor window must never terminate the application. Closing the main application cleans up all secondary windows.
- **Multi-Display Safe Placement:** Saved window bounds (`chat-monitor-state.json`) are validated against `screen.getAllDisplays()` (`validateWindowBounds`). If saved coordinates are off-screen (e.g. disconnected external monitor), the window is safely centered on the primary display work area, with dimensions clamped to minimum `340×400`.
- **Pause Autoscroll Queue Invariant:** Pausing autoscroll suspends DOM mutations in the chat list and buffers incoming messages in memory. A floating indicator (`Новые сообщения ↓ (+N)`) displays the unread count. Resuming autoscroll flushes the queued DOM batch and scrolls smoothly to the latest message.
- **Client-Side Clear View:** The "Clear View" button clears only the local monitor DOM view; it must **never** wipe server history or affect OBS Overlay.

### 2.27. Content Script Invalidation & Idempotency Guard (`extension/content.js`)
- When an extension is updated or reloaded in developer mode, active content scripts in existing tabs have their extension context invalidated.
- **Teardown Invariant:** All `chrome.runtime.Port` and `chrome.runtime.sendMessage` calls are guarded with `isContextInvalidatedError(err)`. Upon detecting context invalidation, all DOM MutationObservers, polling timers, and listeners are immediately torn down via `teardown()`.
- **Idempotency Guard Invariant:** `content.js` registers `window.__BOOSTY_CHAT_CONNECTOR_ACTIVE__ = true` and `window.__BOOSTY_CHAT_CONNECTOR_CLEANUP__ = teardown`. If injected multiple times, any previous instance is cleanly disassembled before the new instance attaches, preventing duplicate observers and duplicate message emissions.

### 2.28. Localhost Connector Fast Bounded Backoff & Dynamic Auto-Reinjection (`extension/background.js`)
- **Fast Bounded Backoff:** Because desktop server startup on `127.0.0.1:17369` is a normal transient condition during app launch, connection retries to `ws://127.0.0.1:17369/connector` use bounded backoff: 250ms, 500ms, 1000ms, capped at 1500ms (never back off to 10–30s on localhost). Once connected, the retry counter resets to 0.
- **Dynamic Auto-Reinjection:** When `background.js` initializes, it queries `chrome.tabs.query({ url: '*://boosty.to/*' })` and uses `chrome.scripting.executeScript` to dynamically inject `parser.js` and `content.js` into existing tabs. This ensures Boosty tabs opened before the extension or server immediately activate without requiring the user to manually press Ctrl+R.

### 2.29. Stale Content Script Detection & User Guidance (`core/health/tracker.js`, `desktop/ui/status-hub.js`)
- If a Boosty tab was detected before an extension reload, or its Port disconnected without a new handshake, the server tracks tab state and marks `staleTabScript: true` in `/health`.
- Status Hub detects this state and renders actionable guidance (`Обновите страницу (Ctrl+R)`), eliminating confusion when a tab is visually present but the content script is detached.

### 2.30. Chat Monitor v1.2 Attention & Autoscroll Invariants (`desktop/chat-monitor/app.js`)
- **Decoupled `followLatest` vs. `hasFocus` Invariant:**
  - `followLatest` (boolean, default `true`, threshold `BOTTOM_THRESHOLD_PX = 60`): controls strictly whether incoming messages automatically scroll the container to the bottom (`scrollTop = scrollHeight`).
  - **Critical Rule:** Autoscroll must **never** be gated behind `document.hasFocus()`. Because Chat Monitor is a companion window on a secondary display while the streamer is focused in a game, OBS, or browser, it must continue autoscrolling when `followLatest === true` even when unfocused.
  - `hasFocus` (`document.hasFocus()`) controls only unread counter accumulation (`unreadTotal`, tab badges `#badge-important`, `#badge-mentions`, `#badge-replies`, and window title `Boosty Chat (N)`). Unreads reset automatically upon window focus when at the bottom (`checkResetUnread()`).
- **Pre-Mutation Snapshot & Synchronous Scroll:**
  - Always capture `const wasFollowLatest = followLatest;` **before** calling `appendMessageCard(message)`.
  - If `appendedCard !== null && wasFollowLatest`, call `scrollToBottom()` which assigns `chatContainer.scrollTop = chatContainer.scrollHeight` synchronously (never rely on `scrollTo({ behavior: 'smooth' })`, which is throttled in background/hidden Chromium windows), plus `requestAnimationFrame` and `onMediaLoad` hooks for async avatars/custom emojis.
- **Attention Filters & Local Search:**
  - 4 filter tabs (`all`, `important`, `mentions`, `replies` with hotkeys `Ctrl+1..4`) and expandable search panel (`Ctrl+F` / `Esc`) filter local `allMessages` without affecting SSE or server history.

### 2.31. Message Lab / QA Composer & Synthetic Pipeline (`desktop/chat-monitor/lab.js`)
- **Zero Fake Renderer Invariant:** Synthetic messages built in Message Lab (`buildSyntheticMessage`, `generateBatchMessages`, `MACRO_SCENARIOS`) are sent via `POST /message` into the exact same localhost server pipeline (`normalizeIncomingMessage` → `validateNormalizedMessage` → `messageDedup` → `messageHistory` → `sseHub.broadcastMessage`).
- **Contract Metadata:** `core/messages/model.js` preserves optional `source: 'message_lab'` and `qaSynthetic: true` fields.
- **Strict Production Isolation:** Message Lab UI (`#btn-message-lab`, `#message-lab-drawer`) and `.badge-qa` card pills are enabled **only** when `BOOSTY_MESSAGE_LAB=1` or `BOOSTY_APP_VARIANT=lab` (or in `BOOSTY_OVERLAY_UI_TEST=1`). In normal production mode, they are strictly hidden (`display: none`).

### 2.32. OS-Level Dev/QA Application Variant (`desktop/main/app-variant.js`)
- Launching via `npm run start:lab` (`scripts/start-lab.js` or `./run-desktop-lab.sh`) activates the `lab` variant (`BOOSTY_APP_VARIANT=lab`, `BOOSTY_MESSAGE_LAB=1`):
  - **Distinct App Name & Title:** `Boosty Chat Overlay Lab` / `Boosty Chat Monitor — Lab` with header badge `LAB`.
  - **Distinct App ID & WM_CLASS:** `ru.pefbrute.boosty-chat-overlay.lab` / `boosty-chat-overlay-lab`.
  - **Isolated `userData`:** `~/.config/boosty-chat-overlay-lab` (applied in `desktop/main.js` **before** `app.requestSingleInstanceLock()`), ensuring QA testing never overwrites production onboarding state, settings, or window bounds.
  - **Distinct Icon:** `build/icon-lab.png` (rendered from `build/icon-lab.svg` with a high-contrast purple `LAB` pill).

### 2.33. Tutorial Video Toolchain & Onboarding Media Invariants (`tools/tutorial-video/`, `desktop/assets/tutorials/`)
- **Zero Bundle Bloat Invariant:** Remotion, React 18, and video compilation dependencies live strictly in isolated `tools/tutorial-video/` with their own `package.json`. They must **never** be added to root `dependencies` or packaged into the Electron app / Windows NSIS installer.
- **Canonical Mini-Lesson Format:**
  - Aspect ratio: 16:9 (`1280×720`), 30 fps, VP8/WebM codec (sub-350 KB payload).
  - Duration: 8–15 seconds, silent, auto-looping, no music or voiceover.
  - Scene design: accent focus (single arrow/outline at a time), smooth subtle zooms, Russian text limited to 5–7 words per scene.
- **Complete Asset Triad:** Every onboarding tutorial must provide 3 assets in `desktop/assets/tutorials/`:
  1. `<id>.webm` — animated mini-lesson video;
  2. `<id>-poster.png` — crisp first-frame poster;
  3. `<id>-diagram.svg` — high-contrast vector infographic.
- **Accessibility & Graceful Degradation (`desktop/app.js`, `desktop/app.css`):**
  - **`prefers-reduced-motion: reduce`:** When active, `<video>` is automatically bypassed and replaced with the static `.svg` diagram.
  - **Error Fallback:** If `<video>` fails to load (`onerror`), UI gracefully falls back to the poster image and `.svg` diagram without broken media placeholders.
  - **Manual Mode Toggle:** Streamer can manually switch between video and diagram at any time.
  - **Lazy Mount & Teardown:** Video is mounted/started only upon entering the target onboarding step (e.g. Step 2) and torn down upon step change to eliminate background decoding overhead.
- **Visual QA Determinism:** In UI visual test mode (`BOOSTY_OVERLAY_UI_TEST=1`), tutorial video is initialized with deterministic playback hooks to prevent flakiness and race conditions in visual diffs.

---

## 3. Where to Change What (Quick Index)

| Task | Target Files |
| :--- | :--- |
| Canonical constants & Extension ID | [`core/constants.js`](file:///home/fedor/projects/boosty-chat-overlay/core/constants.js) |
| Card size presets (Focus Mode) | [`core/config/size-presets.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/size-presets.js) |
| Persistent extension deployer | [`desktop/browser/extension-deployer.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/browser/extension-deployer.js) |
| OS-level Production vs Lab app variant | [`desktop/main/app-variant.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/main/app-variant.js), [`scripts/start-lab.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/start-lab.js) |
| GitHub Releases update checker | [`desktop/main/update-checker.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/main/update-checker.js) |
| Windows CI/CD release workflow | [`.github/workflows/build-windows.yml`](file:///home/fedor/projects/boosty-chat-overlay/.github/workflows/build-windows.yml) |
| Windows release QA runner | [`scripts/windows-release-qa.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/windows-release-qa.js) |
| Release readiness E2E verification | [`scripts/verify-release-scenarios.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/verify-release-scenarios.js) |
| Fresh onboarding & OBS auth E2E test | [`test/fresh-onboarding-e2e.test.js`](file:///home/fedor/projects/boosty-chat-overlay/test/fresh-onboarding-e2e.test.js) |
| Boosty chat DOM selectors or layout parsing | [`extension/parser.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/parser.js) |
| Message schema or validation | [`core/messages/model.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/model.js), [`types/message.d.ts`](file:///home/fedor/projects/boosty-chat-overlay/types/message.d.ts) |
| Message history ring buffer or deduplication | [`core/messages/history.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/history.js), [`core/messages/dedup.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/dedup.js) |
| Overlay config defaults and schema | [`core/config/defaults.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/defaults.js), [`core/config/schema.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/schema.js) |
| Drag & Drop math, corner mapping & snapping | [`core/layout/positioning.js`](file:///home/fedor/projects/boosty-chat-overlay/core/layout/positioning.js) |
| Stream Profiles definitions & auto-detector | [`core/config/profiles.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/profiles.js), [`core/config/presets.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/presets.js) |
| SSE broadcasting and reconnection | [`core/sse/hub.js`](file:///home/fedor/projects/boosty-chat-overlay/core/sse/hub.js), [`server.js`](file:///home/fedor/projects/boosty-chat-overlay/server.js) |
| OBS WebSocket client, scenes, and mutations | [`desktop/obs/`](file:///home/fedor/projects/boosty-chat-overlay/desktop/obs/) (`client.js`, `scenes.js`, `service.js`, `config.js`) |
| OBS Canonical 1:1 transform math & validation | [`desktop/obs/transform.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/obs/transform.js) |
| Chromium browser detection or extension unpack | [`desktop/browser/manager.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/browser/manager.js) |
| Electron IPC channels | [`desktop/main/ipc.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/main/ipc.js), [`desktop/preload.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/preload.js) |
| Dashboard Status Hub logic and CTAs | [`desktop/ui/status-hub.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/ui/status-hub.js) |
| Overlay visual card layout, animations & CSS | [`overlay/renderer.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/renderer.js), [`overlay/style.css`](file:///home/fedor/projects/boosty-chat-overlay/overlay/style.css) |
| Desktop Electron UI Visual QA runner | [`scripts/visual-test-electron.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-electron.js) |
| OBS Overlay Visual QA runner | [`scripts/visual-test-overlay.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-overlay.js) |
| Chat Monitor window manager & lifecycle | [`desktop/chat-monitor/manager.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/chat-monitor/manager.js), [`desktop/chat-monitor/state.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/chat-monitor/state.js) |
| Chat Monitor UI, renderer & autoscroll | [`desktop/chat-monitor/index.html`](file:///home/fedor/projects/boosty-chat-overlay/desktop/chat-monitor/index.html), [`desktop/chat-monitor/app.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/chat-monitor/app.js), [`desktop/chat-monitor/app.css`](file:///home/fedor/projects/boosty-chat-overlay/desktop/chat-monitor/app.css) |
| Chat Monitor Message Lab / QA Composer | [`desktop/chat-monitor/lab.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/chat-monitor/lab.js), [`test/message-lab.test.js`](file:///home/fedor/projects/boosty-chat-overlay/test/message-lab.test.js) |
| Chat Monitor Visual QA & Electron E2E | [`scripts/visual-test-chat-monitor.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-chat-monitor.js), [`test/chat-monitor-autoscroll.electron.test.js`](file:///home/fedor/projects/boosty-chat-overlay/test/chat-monitor-autoscroll.electron.test.js) |
| Extension auto-reinjection & reconnect backoff | [`extension/background.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/background.js), [`extension/content.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/content.js) |
| Tutorial video Remotion composition | [`tools/tutorial-video/src/ExtensionInstallYandex.tsx`](file:///home/fedor/projects/boosty-chat-overlay/tools/tutorial-video/src/ExtensionInstallYandex.tsx), [`tools/tutorial-video/src/Root.tsx`](file:///home/fedor/projects/boosty-chat-overlay/tools/tutorial-video/src/Root.tsx) |
| Onboarding tutorial assets & SVG diagram | [`desktop/assets/tutorials/`](file:///home/fedor/projects/boosty-chat-overlay/desktop/assets/tutorials/) |
| Tutorial video workflow documentation | [`docs/TUTORIAL_VIDEO_WORKFLOW.md`](file:///home/fedor/projects/boosty-chat-overlay/docs/TUTORIAL_VIDEO_WORKFLOW.md) |
| Live E2E runners & test harnesses | [`scripts/live-e2e.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/live-e2e.js), [`scripts/live-e2e-full.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/live-e2e-full.js), [`scripts/live-e2e/`](file:///home/fedor/projects/boosty-chat-overlay/scripts/live-e2e/) |

---

## 4. Live E2E Verification Rules

### 4.1. Safe Mode (`npm run test:live`)
Перед релизами и при любых изменениях в `extension/` (parser, content, background) или интеграции с Boosty DOM:
- Запускать `npm run test:live` (или `BOOSTY_LIVE_QA_DRY_RUN=1 npm run test:live` для проверки готовности среды).
- При наличии активного стрим-чата E2E-контур отправляет безопасное smoke-сообщение через настоящий интерфейс Boosty, проверяет захват DOM, парсер, дедупликацию, SSE, рендеринг оверлея в Playwright и снимок OBS.
- Скриншот `artifacts/live/<run-id>/overlay-browser.png` (и `obs-source.png`) обязательно инспектируются через `view_file`.
- Тест пропускается (`SKIP`) только при отсутствии URL стрима или неавторизованной сессии, с обязательным явным уведомлением пользователя.

### 4.2. Autonomous Full Live Mode (`npm run test:live:full`)
Автономный сквозной боевой E2E тест полного жизненного цикла:
- **Требование явного флага:** Запускается **только** с `BOOSTY_LIVE_QA_DESTRUCTIVE=1`. Без него запуск немедленно блокируется (`REFUSED`).
- **Полный жизненный цикл:**
  1. Создание и настройка QA-стрима через реальный UI Boosty (`/edit-stream`).
  2. Пауза 3s после клика submit перед навигацией для гарантии завершения сетевого запроса к backend.
  3. Ожидание 10–12s для стабилизации WebSocket pubsub handshake в StreamChat.
  4. Отправка реальных сценариев (Plain, Long Message) с автоматическим повтором при pubsub джиттере.
  5. Проверка доставки в StreamChat DOM, extension, localhost server, SSE, overlay и OBS Studio Browser Source.
  6. **Остановка стрима строго через реальный UI Boosty (`stopQaStreamViaUi`):** переход на страницу канала, открытие 3-dots меню (`[data-test-id="COMMON_STREAM_STREAMACTIONSMENU:Button"]`), клик `Delete stream`, подтверждение в диалоге (`DELETE`), опрос до подтверждения `confirmedOffline: true`.
- **Защитные гарды (`validateStreamStopGuardrails`):**
  - Разрешает остановку **только** если `createdByRunner === true`, `title.startsWith('[QA]')`, `title.includes(currentRunId)`, и `stream.runId === currentRunId`.
  - Попытка остановки любого не-QA стрима немедленно блокируется с предупреждением `⚠ QA STREAM MAY STILL BE LIVE`.
- **Запрет приватного API:** Автоматический вызов `DELETE /api/v1/.../stream` строго запрещён в automated runner. Остановка производится только через браузерный UI.
- **Security Leak Audit:** Все сохранённые артефакты (`stream.json`, `live-report.json`, HTML DOM) автоматически сканируются на токены, куки и секреты (`scanArtifactsForSecrets`). Требуется строго 0 утечек.

---

## 5. Mandatory Pre-Completion Verification Checklist

Before finishing any task, submitting a PR, or presenting completed work to the user, run the complete verification suite:

```bash
# 1. Syntax check across all JavaScript files via V8 CLI
npm run check

# 2. Unit tests (core, obs, desktop, model, parser, helpers)
npm test

# 3. Integration tests inside real Electron instance
npm run test:integration

# 4. Playwright Desktop UI Visual QA (если затронут desktop/)
npm run test:ui:visual

# 5. Playwright Chat Monitor Visual QA (если затронут desktop/chat-monitor/)
npm run test:chat-monitor:visual

# 6. Playwright Overlay Visual QA (если затронут overlay/)
npm run test:overlay:visual

# 7. Check for whitespace/git diff issues
git diff --check
```

### Visual Inspection Protocols:
- **При изменении `desktop/` (основное окно):**
  1. Запустить `npm run test:ui:visual`.
  2. Проверить `artifacts/ui/console-errors.json` (0 ошибок).
  3. Открыть через `view_file`: `dashboard-1280x850.png`, `dashboard-800x650.png`, `appearance.png`, `state-obs-offline.png`.
  4. Если затронут Onboarding или обучающие материалы (`#ob-tutorial-card`), дополнительно проверить: `onboarding.png`, `onboarding-800x650.png`, `tutorial-01-video-start.png`, `tutorial-03-drag-folder.png`, `tutorial-05-reduced-motion.png`, `tutorial-06-video-fallback.png`.
- **При изменении видео-туториалов (`tools/tutorial-video/`):**
  1. Предпросмотр в Remotion Studio: `npm run tutorial:preview`.
  2. Рендер WebM 720p: `npm run tutorial:render`.
  3. Обновление постера: `npm run tutorial:poster`.
  4. Проверить размер итогового `.webm` (не более 400 KB) и отсутствие искажений кириллицы.
- **При изменении `desktop/chat-monitor/`:**
  1. Запустить `npm run test:chat-monitor:visual`.
  2. Проверить `artifacts/chat-monitor/console-errors.json` (0 ошибок).
  3. Открыть через `view_file`: `01-empty-waiting.png`, `02-normal-messages.png`, `04-reply-mention-emoji.png`, `07-new-messages-indicator.png`, `08-minimum-window-size.png`, `09-compact-mode.png`, `10-important-highlight.png`, `15-unread-counters.png`, `lab-01-composer.png`, `lab-03-presets-scenarios.png`, `lab-04-window-header-badge.png`, `autoscroll-after-burst.png`.
- **При изменении `overlay/`:**
  1. Запустить `npm run test:overlay:visual`.
  2. Проверить `artifacts/overlay/console-errors.json` (0 ошибок).
  3. Открыть через `view_file`: `single-message.png`, `multiple-messages.png`, `long-message.png`, `narrow-source.png`, `small-height.png`, `top-right.png`.
  4. Проверить отсутствие наложения карточек, корректность отступов, читаемость кириллицы и отсутствие горизонтального скролла.

---

## 6. Windows Release QA (VM `Winda`)

> [!IMPORTANT]
> Перед выпуском релиза **обязательно** запустить Windows Release QA на VM `Winda`.
> Используй скилл [`windows-qa-winda`](file:///home/fedor/.gemini/config/skills/windows-qa-winda/SKILL.md) для полной документации.

### Минимальный чеклист Windows Release QA:

```bash
# 1. Сбросить VM к чистому baseline
./scripts/local/winda.sh reset
# → restore WindowsQA-Clean → start → 7×PASS health check

# 2. Скопировать новый installer
./scripts/local/winda.sh copy-installer ./dist/"Boosty Chat Overlay Setup X.Y.Z.exe"

# 3. Запустить installer через GUI MCP
./scripts/local/winda.sh gui launch_app \
  '{"path":"\\\\VBOXSVR\\qa-share\\releases\\Boosty Chat Overlay Setup X.Y.Z.exe","wait_window_sec":5}'

# 4. Пройти wizard → проверить установку (обратите внимание на пробелы в имени каталога):
./scripts/local/winda.sh powershell \
  'Test-Path "$env:LOCALAPPDATA\Programs\Boosty Chat Overlay\Boosty Chat Overlay.exe"'

# 5. Запустить приложение → скриншот
./scripts/local/winda.sh screenshot /tmp/boosty-qa.png
# Обязательно проверить скриншот через view_file
# Для автоматизации Chromium/Electron использовать связку буфера обмена и скан-кодов (см. windows-qa-winda 5.12)

# 5.1. Верификация состояния и отправка тестового сообщения в OBS (без UI-кликов):
./scripts/local/winda.sh powershell 'Invoke-RestMethod "http://127.0.0.1:17369/health" | ConvertTo-Json'
./scripts/local/winda.sh powershell 'Invoke-RestMethod "http://127.0.0.1:17369/test"'

# 6. Восстановить чистый снапшот
./scripts/local/winda.sh stop
./scripts/local/winda.sh restore-clean
```

### Файлы Windows QA инфраструктуры:

| Файл | Назначение |
|---|---|
| [`scripts/local/winda.sh`](file:///home/fedor/projects/boosty-chat-overlay/scripts/local/winda.sh) | CLI управления VM |
| [`docs/WINDOWS_QA_VM.md`](file:///home/fedor/projects/boosty-chat-overlay/docs/WINDOWS_QA_VM.md) | Архитектурная документация |
| `~/.config/boosty-chat-overlay/winda.env` | Креды QA-юзера (не в repo) |
| `~/.gemini/config/skills/windows-qa-winda/SKILL.md` | Полное руководство агента по Windows QA |

### Ключевые факты:
- **Session 0 vs Session 1:** `VBoxManage guestcontrol` → Session 0 (без GUI). `windows-gui-mcp` → Session 1 (интерактивный рабочий стол с UIA).
- **UNC-пути и локальный стейджинг:** Для тихой установки NSIS (`/S`) всегда копировать инсталлер в локальный каталог `C:\QA\Setup.exe` и снимать `Unblock-File`. Прямой запуск с `\\VBOXSVR\qa-share\` может висеть на сетевой блокировке.
- **Снапшот `WindowsQA-Clean`:** Чистый baseline с Brave/Chrome/OBS, `Boosty Chat Overlay` не установлен.
- **Windows Update отключён** в снапшоте — старты всегда быстрые (~24s до готовности).
- **OBS Safe Mode (.sentinel):** Всегда удалять `$env:APPDATA\obs-studio\.sentinel` перед стартом OBS, иначе obs-websocket (порт 4455) блокируется.
- **Brave Profile Stale Locks:** При ошибке `#32770` в Brave — убить процессы `brave` и очистить `*lock*` файлы в `Brave-Browser\User Data`.
- **NSIS Silent Uninstall Lock:** Перед вызовом деинсталлятора всегда выполнять `taskkill /F /IM "Boosty Chat Overlay.exe" /T`, иначе uninstaller тихо оставит залоченные бинарники.
