# Live E2E Testing Contour (`npm run test:live`)

## 1. Purpose & Architecture

`npm run test:live` is the top-level automated end-to-end verification contour for `boosty-chat-overlay`.
It tests the complete production path against a real running browser and Boosty chat:

```text
Real Boosty Chat (Brave / Chrome)
       ↓ (DOM mutation / user typing)
extension/parser.js (Modular DOM Parser)
       ↓ (Dual transport message delivery)
server.js (127.0.0.1:17369)
       ↓ (NormalizedMessage + Dedup + History)
Server-Sent Events (/events)
       ↓ (Streaming client)
overlay/ (Renderer + Overlay.js in Playwright)
       ↓ (Scene items & browser source)
OBS Studio (Optional OBS WebSocket v5 integration)
```

> [!NOTE]
> `test:live` is **NOT** a replacement for unit (`npm test`), integration (`npm run test:integration`), or visual QA (`npm run test:ui:visual`, `npm run test:overlay:visual`). It is an additional top-level test invoked before releases and after changes to Boosty DOM parser or extension integration.

---

## 2. SAFE Mode Invariant

`test:live` operates strictly in **SAFE mode**:
- **NEVER** creates public streams or broadcasts.
- **NEVER** starts or stops streaming in OBS or Boosty.
- **NEVER** modifies public channel/creator settings.
- **NEVER** deletes user content or other users' chat messages.
- **NEVER** messages other people outside the QA test scenario.
- All test messages are prefixed with a unique run identifier: `[BOOSTY-OVERLAY-QA <run-id>]`.

---

## 3. Environment Variables Configuration

The runner reads settings from environment variables or a local `.env` file (which is git-ignored):

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `BOOSTY_LIVE_QA_URL` | string | auto-detected | URL of the target Boosty stream chat page (e.g. `https://boosty.to/<channel>/streams/<id>`). |
| `BOOSTY_LIVE_QA_BROWSER` | string | `brave` | Browser session ID used with Playwright CLI (`brave` or `chrome`). |
| `BOOSTY_LIVE_QA_TIMEOUT` | number | `30000` | Global stage timeout in milliseconds. |
| `BOOSTY_LIVE_QA_DRY_RUN` | `0` \| `1` | `0` | When `1`, verifies server, browser connection, authorization, and extension heartbeat without sending any message. |
| `BOOSTY_LIVE_QA_CAPTURE_FIXTURE` | `0` \| `1` | `0` | When `1`, copies the sanitized DOM fixture to `test/fixtures/real/live-text-message-<date>.html`. |
| `BOOSTY_LIVE_QA_STRICT` | `0` \| `1` | `0` | When `1`, exits with code 1 if a stage was skipped (e.g. no active stream). Default `0` exits cleanly with notice. |
| `BOOSTY_OVERLAY_PORT` | number | `17369` | Port for the local overlay HTTP server. |

---

## 4. Dry Run Mode

To quickly verify that the local server is running, the browser extension is connected, and the user is authenticated on Boosty without posting any chat messages:

```bash
BOOSTY_LIVE_QA_DRY_RUN=1 npm run test:live
```

---

## 5. Artifacts and Reports

Every execution creates an isolated artifact directory: `artifacts/live/<run-id>/` containing:

- `health.json`: Snapshot of `/health` including extension version, connection status, and last seen timestamps.
- `boosty-message-dom.html`: Cleaned, sanitized DOM of the actual Boosty message root.
- `parser-output.json`: Output from `extension/parser.js` applied to the captured DOM.
- `normalized-message.json`: The `NormalizedMessage` object stored in server history.
- `sse-event.json`: The exact Server-Sent Event received over `/events`.
- `overlay-browser.png`: Headless Playwright screenshot of the actual overlay rendering the message.
- `obs-source.png`: (If OBS is running) Screenshot captured directly from the OBS Browser Source via WebSocket v5.
- `console-errors.json`: Categorized browser console logs (`project-related` vs `external-page-noise`).
- `live-report.json`: Machine-readable execution report summarizing all stages, timing, IDs, and errors.

---

## 6. Troubleshooting

1. **Browser attach failed:**
   - Verify that Brave/Chrome is running and the Playwright Extension is active.
   - Run `playwright-cli attach --extension=chrome -s=brave` manually to verify connection.
2. **Extension heartbeat timeout (`stage: extension`):**
   - Check if the extension `Boosty Chat Connector` is loaded in `brave://extensions`.
   - Ensure developer mode is ON and reload the unpacked extension if files were changed.
3. **StreamChat not found (`stage: boostyPage`):**
   - Verify the stream URL has an open `Live chat` panel.
   - If the creator is not currently live or has chat disabled, specify `BOOSTY_LIVE_QA_URL` to an active chat page.

---

## 7. Autonomous Full Destructive Run (`npm run test:live:full`)

> [!CAUTION]
> **FULL DESTRUCTIVE MODE**: Creates, starts, and stops a real test stream on the creator's Boosty channel.
> **STRICT GUARDRAIL**: Requires explicit authorization via environment variable:
> ```bash
> BOOSTY_LIVE_QA_DESTRUCTIVE=1 npm run test:live:full
> ```
> Without this flag, the runner immediately refuses execution with an error.

### 7.1. Pipeline Stages
```text
Boosty Creator UI (/edit-stream)
       ↓ (Form fill: Title "[QA] ...", Level, Chat=ON, Recording=OFF, NOW)
Stream Launch ("START STREAM")
       ↓
Real StreamChat DOM ([class*="ChatPublisher"])
       ↓
5 Multi-Scenario Executions:
  1. Plain Message ("[BOOSTY-OVERLAY-QA <runId>] plain 👋") + Streamer role check
  2. Custom Boosty Emoji (via UI Smile Selector -> img[data-type="smile"])
  3. Reply Message (via UI Reply button -> quote block)
  4. User Mention (via @mention autocomplete)
  5. Long Message (250-400 chars wrap & overflow check)
       ↓
Real OBS Studio CEF Browser Source (GetSourceScreenshot -> obs-*.png)
       ↓
Teardown & Cleanup (Stream Stop via UI/API, Watchdog max 10m, 0 leaks security scan)
```

### 7.2. Safe Stream Configuration
- **Title**: Strictly formatted as `[QA] Boosty Chat Overlay <runId>`.
- **Publicity / Access**: Selected tier (e.g. `Просмотр`), no description, no custom cover image.
- **Monetization**: No DonationAlerts username.
- **Recording**: Disabled (`Save broadcast recording = OFF`).
- **Schedule**: Immediate (`NOW`).
- **Stream Key Protection**: Stream key and RTMP URLs are never logged, never captured in screenshots, and never saved in artifacts.

### 7.3. Stream Watchdog & Emergency Teardown
- Global watchdog timer (`BOOSTY_LIVE_QA_MAX_STREAM_MINUTES`, default 10 minutes) terminates the stream if tests hang.
- The `finally` block strictly verifies `createdStream.createdByRunner === true` and `title.startsWith('[QA]')` before stopping the stream.
- If stopping fails, a high-visibility warning is logged: `⚠ WARNING: QA STREAM MAY STILL BE LIVE!` and recorded in `live-report.json`.

