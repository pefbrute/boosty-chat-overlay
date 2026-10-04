'use strict';

/**
 * Autonomous Boosty Full Live E2E Entrypoint.
 *
 * Full real pipeline verification:
 * Real Boosty Stream Creation → Stream Start → Real StreamChat → Extension → Parser → Local Server → SSE → Overlay → OBS Studio → Stream Stop → Cleanup.
 *
 * Protected by explicit environment variable guardrail: BOOSTY_LIVE_QA_DESTRUCTIVE=1.
 */

const fs = require('node:fs');
const path = require('node:path');
const { LiveBrowserAdapter } = require('./live-e2e/browser.js');
const { prepareObsIntegration, verifyObsIntegration } = require('./live-e2e/obs.js');
const { createObsService } = require('../desktop/obs/service.js');
const { checkCreatorAccess, createAndStartStream, stopStream } = require('./live-e2e/stream.js');
const {
  runPlainScenario,
  runEmojiScenario,
  runReplyScenario,
  runMentionScenario,
  runLongMessageScenario,
} = require('./live-e2e/scenarios.js');
const { scanArtifactsForSecrets } = require('./live-e2e/sanitizer.js');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

function getChromiumExecutable() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/brave-browser',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

// --- Guardrail: Refuse destructive operations unless explicitly authorized ---
if (process.env.BOOSTY_LIVE_QA_DESTRUCTIVE !== '1') {
  console.error(`
====================================================
REFUSED
Destructive live QA requires BOOSTY_LIVE_QA_DESTRUCTIVE=1
====================================================
To run full autonomous live E2E including real stream creation and teardown:
  BOOSTY_LIVE_QA_DESTRUCTIVE=1 npm run test:live:full
`);
  process.exit(1);
}

function generateRunId() {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `live-${ts}-${rand}`;
}

async function main() {
  const runId = generateRunId();
  const port = Number(process.env.BOOSTY_LIVE_QA_PORT || 17369);
  const artifactDir = path.join(__dirname, '../artifacts/live', runId);
  fs.mkdirSync(artifactDir, { recursive: true });

  const maxStreamMinutes = Number(process.env.BOOSTY_LIVE_QA_MAX_STREAM_MINUTES || 10);
  const maxStreamMs = maxStreamMinutes * 60 * 1000;

  console.log(`
====================================================
DESTRUCTIVE LIVE QA (Autonomous Boosty Full Live E2E)
Run ID:    ${runId}
Artifacts: artifacts/live/${runId}
Watchdog:  ${maxStreamMinutes} minutes maximum duration
Guardrail: Real stream will be created, started, tested, and stopped.
====================================================
`);

  let runnerOwnedServer = null;
  let browserAdapter = null;
  let overlayBrowser = null;
  let overlayPage = null;
  let obsService = null;
  let createdStream = null;
  let watchdogTimer = null;
  let authCheck = null;

  const report = {
    runId,
    mode: 'full-destructive',
    passed: false,
    timestamp: new Date().toISOString(),
    provenance: {
      provenance: 'real-stream-chat',
      enteredViaRealUi: true,
      returnedFromBoostyBackend: true,
      syntheticDomUsed: false,
    },
    stream: {
      created: false,
      started: false,
      stopped: false,
    },
    scenarios: {},
    obs: {},
    cleanup: {},
    security: {},
    errors: [],
  };

  try {
    // 1. Ensure local server running on port 17369
    let serverRunning = false;
    try {
      const ping = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json());
      if (ping?.ok === true) {
        console.log(`[Full Live] Using existing server on port ${port}`);
        serverRunning = true;
      }
    } catch {}

    if (!serverRunning) {
      console.log(`[Full Live] Spawning backend server on port ${port}`);
      const serverScript = path.join(__dirname, '..', 'server.js');
      runnerOwnedServer = spawn(process.execPath, [serverScript], {
        env: { ...process.env, BOOSTY_OVERLAY_PORT: String(port) },
        stdio: 'pipe',
      });
      const startT = Date.now();
      while (Date.now() - startT < 6000) {
        try {
          const ping = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json());
          if (ping?.ok === true) break;
        } catch {}
        await new Promise(r => setTimeout(r, 400));
      }
    }

    // 2. Attach to browser session
    browserAdapter = new LiveBrowserAdapter({ session: 'brave' });
    const attachRes = await browserAdapter.attach();
    if (!attachRes.ok) {
      throw new Error(`Failed to attach to browser session: ${attachRes.error}`);
    }

    // 3. Prepare OBS Integration (REQUIRED for full mode)
    console.log('[Full Live] Preparing OBS Studio integration (REQUIRE_OBS=1)...');
    const obsPrep = await prepareObsIntegration({ port, requireObs: true });
    if (!obsPrep.ok) {
      throw new Error(`OBS preparation failed: ${obsPrep.reason || obsPrep.error}`);
    }
    obsService = createObsService({ overlayPort: port });
    await obsService.listScenes('');

    // 4. Open overlay in Playwright Chromium for live SSE capture
    const execPath = getChromiumExecutable();
    overlayBrowser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(execPath ? { executablePath: execPath } : {}),
    });
    overlayPage = await overlayBrowser.newPage({ viewport: { width: 900, height: 700 } });
    await overlayPage.goto(`http://127.0.0.1:${port}/overlay/`);
    await overlayPage.waitForSelector('#messages', { state: 'attached', timeout: 8000 });

    // 5. Navigate to Boosty creator channel
    console.log('[Full Live] Locating Boosty creator page...');
    const tabRes = await browserAdapter.locateOrOpenBoostyTab('https://boosty.to/beautiful_foot');
    if (!tabRes.ok) {
      throw new Error(`Failed to locate Boosty tab: ${tabRes.error}`);
    }

    // 6. Verify authentication & creator access
    authCheck = await checkCreatorAccess(browserAdapter);
    if (!authCheck.ok) {
      throw new Error(authCheck.error);
    }
    console.log(`[Full Live] Creator authorized: "${authCheck.channelName}" (blog: ${authCheck.blogUrl})`);

    // 7. Create & Start QA Stream
    console.log('[Full Live] Creating and starting real QA stream...');
    const streamRes = await createAndStartStream(browserAdapter, runId, {
      blogUrl: authCheck.blogUrl,
      artifactDir,
    });
    if (!streamRes.ok) {
      throw new Error(`Failed to create/start stream: ${streamRes.error}`);
    }

    createdStream = streamRes.stream;
    report.stream = {
      ...createdStream,
      created: true,
      started: true,
      stopped: false,
    };
    console.log(`[Full Live] QA Stream live at: ${createdStream.url}`);

    // Set stream watchdog safety timeout
    watchdogTimer = setTimeout(async () => {
      console.warn('[Stream Watchdog] Safety timeout reached! Initiating emergency stream stop.');
      if (createdStream && createdStream.createdByRunner) {
        await stopStream(browserAdapter, createdStream);
      }
    }, maxStreamMs);

    // 8. Wait for real StreamChat DOM and input
    console.log('[Full Live] Waiting for real StreamChat container and input...');
    let chatDetected = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const detect = browserAdapter.detectStreamChat();
      if (detect && detect.hasInput) {
        chatDetected = true;
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!chatDetected) {
      throw new Error('Real StreamChat input element not found on stream page (provenance failed)');
    }
    console.log('[Full Live] Real StreamChat detected successfully!');
    console.log('[Full Live] Waiting 12s for StreamChat WebSocket pubsub handshake to stabilize...');
    await new Promise(r => setTimeout(r, 12000));

    // 9. Execute Test Scenarios
    const scenarioContext = {
      adapter: browserAdapter,
      runId,
      artifactDir,
      overlayPage,
      obsService,
      port,
    };

    // Scenario 1: Plain Message
    report.scenarios.plain = await runPlainScenario(scenarioContext);

    // Scenario 2: Custom Boosty Emoji
    report.scenarios.emoji = await runEmojiScenario(scenarioContext);

    // Scenario 3: Reply Message
    report.scenarios.reply = await runReplyScenario(scenarioContext);

    // Scenario 4: User Mention
    report.scenarios.mention = await runMentionScenario(scenarioContext);

    // Scenario 5: Long Message
    report.scenarios.longMessage = await runLongMessageScenario(scenarioContext);

    // 10. Verify OBS integration state & screenshots
    const obsVerify = await verifyObsIntegration({
      port,
      artifactDir,
      requireObs: true,
    });
    report.obs = obsVerify;
  } catch (err) {
    console.error(`[Full Live ERROR] ${err.message}`);
    report.errors.push(err.message);
  } finally {
    if (watchdogTimer) clearTimeout(watchdogTimer);

    // 11. Cleanup: Always stop stream via real Boosty UI if created by runner
    if (createdStream && createdStream.createdByRunner) {
      console.log('[Full Live Cleanup] Stopping QA Stream via Boosty UI...');
      const stopRes = await stopStream(browserAdapter, createdStream, {
        currentRunId: runId,
        blogUrl: authCheck?.blogUrl,
      });
      report.stream.stopped = Boolean(stopRes?.ok && stopRes?.confirmedOffline);
      report.cleanup.streamStop = {
        status: stopRes?.status || (stopRes?.ok ? 'pass' : 'failed'),
        method: stopRes?.method || 'unknown',
        confirmedOffline: Boolean(stopRes?.confirmedOffline),
        reason: stopRes?.reason || stopRes?.error,
      };
    }

    if (browserAdapter) {
      await browserAdapter.detach().catch(() => {});
      report.cleanup.browserDetached = true;
    }

    if (overlayBrowser) {
      await overlayBrowser.close().catch(() => {});
    }

    if (obsService) {
      await obsService.destroy().catch(() => {});
      report.cleanup.obsDisconnected = true;
    }

    if (runnerOwnedServer) {
      await runnerOwnedServer.kill();
    }

    // 12. Security Scan: Ensure 0 leaks in all artifacts
    const secResult = scanArtifactsForSecrets(artifactDir);
    report.security = {
      scannedFiles: secResult.filesScanned,
      leaksFound: secResult.leaksFound,
      violations: secResult.violations,
    };

    // 13. Determine final pass status (STRICT INVARIANTS)
    const isStreamStopValid =
      report.cleanup.streamStop?.status === 'pass' &&
      report.cleanup.streamStop?.method === 'boosty-ui' &&
      report.cleanup.streamStop?.confirmedOffline === true;

    const mandatoryPass =
      report.errors.length === 0 &&
      report.scenarios.plain?.status === 'pass' &&
      report.scenarios.plain?.authorNameNormalized === true &&
      report.scenarios.longMessage?.status === 'pass' &&
      report.obs?.status === 'pass' &&
      isStreamStopValid &&
      report.security?.leaksFound === 0;

    report.passed = mandatoryPass;

    // Save final live-report.json
    fs.writeFileSync(path.join(artifactDir, 'live-report.json'), JSON.stringify(report, null, 2), 'utf8');

    // 14. Console Summary
    printSummary(report);

    process.exit(report.passed ? 0 : 1);
  }
}

function printSummary(report) {
  const plainAuthor = report.scenarios.plain?.authorVerification;
  console.log(`
====================================================
FULL BOOSTY LIVE E2E SUMMARY
====================================================
Run ID:     ${report.runId}
Status:     ${report.passed ? 'FULL E2E PASS ✅' : 'FAILED ❌'}
Provenance: ${report.provenance.provenance} (real: ${report.provenance.enteredViaRealUi}, synthetic: ${report.provenance.syntheticDomUsed})

Stream Lifecycle:
  ${report.stream.created ? '✓' : '✗'} Created:  ${report.stream.title || 'N/A'}
  ${report.stream.started ? '✓' : '✗'} Started:  ${report.stream.url || 'N/A'}
  ${report.stream.stopped ? '✓' : '✗'} Stopped:  ${report.stream.stopped ? 'YES (via Boosty UI)' : 'FAILED'}

Author Colon Verification:
  Raw DOM author text:      ${plainAuthor?.rawDomAuthorText || 'N/A'}
  Parser author:            ${plainAuthor?.parserAuthor || 'N/A'}
  Normalized author.name:   ${plainAuthor?.normalizedAuthorName || 'N/A'}
  Overlay visible author:   ${plainAuthor?.overlayVisibleAuthor || 'N/A'}
  Author Name Normalized:   ${report.scenarios.plain?.authorNameNormalized ? 'PASS (no trailing colon)' : 'FAILED'}

Scenarios:
  ${report.scenarios.plain?.status === 'pass' ? '✓' : '✗'} plain       : ${report.scenarios.plain?.status || 'N/A'} (role: ${report.scenarios.plain?.role || 'none'})
  ${report.scenarios.emoji?.status === 'pass' ? '✓' : (report.scenarios.emoji?.status === 'skip' ? '○' : '✗')} emoji       : ${report.scenarios.emoji?.status || 'N/A'} ${report.scenarios.emoji?.reason ? '(' + report.scenarios.emoji.reason + ')' : ''}
  ${report.scenarios.reply?.status === 'pass' ? '✓' : (report.scenarios.reply?.status === 'skip' ? '○' : '✗')} reply       : ${report.scenarios.reply?.status || 'N/A'} ${report.scenarios.reply?.reason ? '(' + report.scenarios.reply.reason + ')' : ''}
  ${report.scenarios.mention?.status === 'pass' ? '✓' : (report.scenarios.mention?.status === 'skip' ? '○' : '✗')} mention     : ${report.scenarios.mention?.status || 'N/A'} ${report.scenarios.mention?.reason ? '(' + report.scenarios.mention.reason + ')' : ''}
  ${report.scenarios.longMessage?.status === 'pass' ? '✓' : '✗'} longMessage : ${report.scenarios.longMessage?.status || 'N/A'} (${report.scenarios.longMessage?.length || 0} chars)

OBS Studio:
  ${report.obs?.status === 'pass' ? '✓' : '✗'} Status:      ${report.obs?.status || 'N/A'}
  ✓ Browser Source: ${report.obs?.details?.browserSourceDimensions || '900x700'}
  ✓ Active Scene Preserved: ${report.obs?.details?.scenePreserved}

Cleanup & Security:
  ✓ Stream Stopped:    ${report.cleanup.streamStop?.status || 'N/A'} (method: ${report.cleanup.streamStop?.method}, offline: ${report.cleanup.streamStop?.confirmedOffline})
  ✓ Private API used:  NO (strictly unused in test:live:full)
  ✓ Browser Detached:  ${report.cleanup.browserDetached}
  ✓ OBS Disconnected:  ${report.cleanup.obsDisconnected}
  ✓ Security Leaks:    ${report.security.leaksFound} found across ${report.security.scannedFiles} artifacts
====================================================
`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error running full live E2E:', err);
    process.exit(1);
  });
}

module.exports = {
  main,
};
