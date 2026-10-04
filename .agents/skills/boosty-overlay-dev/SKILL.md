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

### 2.14. Canonical Boosty Asset & Sticky Live Preview UX
- **Invariant:** Single centralized SVG asset `desktop/assets/boosty.svg` (symbol `#icon-boosty`) across the entire desktop UI.
- **Invariant:** Live preview container `#sticky-preview-container` is sticky (`position: sticky; top: 80px;`) on viewports >= 900px and falls back to `position: relative` on compact viewports (<900px).

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

---

## 3. Where to Change What (Quick Index)

| Task | Target Files |
| :--- | :--- |
| Boosty chat DOM selectors or layout parsing | [`extension/parser.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/parser.js) |
| Message schema or validation | [`core/messages/model.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/model.js), [`types/message.d.ts`](file:///home/fedor/projects/boosty-chat-overlay/types/message.d.ts) |
| Message history ring buffer or deduplication | [`core/messages/history.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/history.js), [`core/messages/dedup.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/dedup.js) |
| Overlay config defaults and schema | [`core/config/defaults.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/defaults.js), [`core/config/schema.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/schema.js) |
| Drag & Drop math, corner mapping & snapping | [`core/layout/positioning.js`](file:///home/fedor/projects/boosty-chat-overlay/core/layout/positioning.js) |
| Stream Profiles definitions & auto-detector | [`core/config/profiles.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/profiles.js), [`core/config/presets.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/presets.js) |
| SSE broadcasting and reconnection | [`core/sse/hub.js`](file:///home/fedor/projects/boosty-chat-overlay/core/sse/hub.js), [`server.js`](file:///home/fedor/projects/boosty-chat-overlay/server.js) |
| OBS WebSocket client, scenes, and mutations | [`desktop/obs/`](file:///home/fedor/projects/boosty-chat-overlay/desktop/obs/) (`client.js`, `scenes.js`, `service.js`) |
| OBS Canonical 1:1 transform math & validation | [`desktop/obs/transform.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/obs/transform.js) |
| Chromium browser detection or extension unpack | [`desktop/browser/manager.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/browser/manager.js) |
| Electron IPC channels | [`desktop/main/ipc.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/main/ipc.js), [`desktop/preload.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/preload.js) |
| Dashboard Status Hub logic and CTAs | [`desktop/ui/status-hub.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/ui/status-hub.js) |
| Overlay visual card layout, animations & CSS | [`overlay/renderer.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/renderer.js), [`overlay/style.css`](file:///home/fedor/projects/boosty-chat-overlay/overlay/style.css) |
| Desktop Electron UI Visual QA runner | [`scripts/visual-test-electron.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-electron.js) |
| OBS Overlay Visual QA runner | [`scripts/visual-test-overlay.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-overlay.js) |
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

# 5. Playwright Overlay Visual QA (если затронут overlay/)
npm run test:overlay:visual

# 6. Check for whitespace/git diff issues
git diff --check
```

### Visual Inspection Protocols:
- **При изменении `desktop/`:**
  1. Запустить `npm run test:ui:visual`.
  2. Проверить `artifacts/ui/console-errors.json` (0 ошибок).
  3. Открыть через `view_file`: `dashboard-1280x850.png`, `dashboard-800x650.png`, `appearance.png`, `state-obs-offline.png`.
- **При изменении `overlay/`:**
  1. Запустить `npm run test:overlay:visual`.
  2. Проверить `artifacts/overlay/console-errors.json` (0 ошибок).
  3. Открыть через `view_file`: `single-message.png`, `multiple-messages.png`, `long-message.png`, `narrow-source.png`, `small-height.png`, `top-right.png`.
  4. Проверить отсутствие наложения карточек, корректность отступов, читаемость кириллицы и отсутствие горизонтального скролла.
