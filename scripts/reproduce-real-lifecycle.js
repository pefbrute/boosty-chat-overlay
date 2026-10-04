// scripts/reproduce-real-lifecycle.js
// Reproduce and document real Chromium/Brave Manifest V3 lifecycle issues in vivo.
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function fetchHealth(port = 17369) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 800 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runReproduction() {
  console.log('========================================================');
  console.log(' Phase 1: In-Vivo Lifecycle Reproduction & Measurement ');
  console.log('========================================================');
  console.log('Timestamp:', new Date().toISOString());

  // 1. Check if an existing server is running
  const initialHealth = await fetchHealth(17369);
  console.log('Initial server state:', initialHealth ? 'Running' : 'Not running');
  if (initialHealth) {
    console.log('Initial extension state:', initialHealth.extension?.state, `(${initialHealth.extension?.lastSeenSecondsAgo}s ago)`);
    console.log('Initial Boosty state:', initialHealth.boosty?.state, `(tabs: ${initialHealth.boosty?.activeTabsCount})`);
  }

  // 2. Kill existing electron process if running so we measure cold desktop startup
  console.log('\nStopping existing desktop instance to measure restart...');
  try {
    const { execSync } = require('child_process');
    execSync('pkill -f "electron ." || true');
  } catch {}

  await sleep(1500);

  // 3. Launch desktop app
  console.log('\nLaunching desktop app (electron .)...');
  const t0 = Date.now();
  const logs = [];

  function record(event, details = {}) {
    const t = Date.now() - t0;
    const entry = { t_ms: t, t_sec: (t / 1000).toFixed(3), event, ...details };
    logs.push(entry);
    console.log(`[+${entry.t_sec}s] ${event}:`, JSON.stringify(details));
  }

  record('desktop_launch_initiated');

  const electronProc = spawn('npx', ['electron', '.'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, BOOSTY_OVERLAY_UI_TEST: '0' },
    stdio: 'ignore',
  });

  let serverReadyAt = null;
  let extFirstSeenAt = null;
  let boostyFirstSeenAt = null;
  let lastExtState = null;
  let lastBoostyState = null;
  let disconnectCount = 0;

  // Poll for 45 seconds to observe idle service worker suspension
  const pollEnd = Date.now() + 45000;
  while (Date.now() < pollEnd) {
    const health = await fetchHealth(17369);
    const now = Date.now();

    if (health) {
      if (!serverReadyAt) {
        serverReadyAt = now;
        record('desktop_server_ready', { port: 17369 });
      }

      const extState = health.extension?.state;
      const boostyState = health.boosty?.state;
      const extAge = health.extension?.lastSeenSecondsAgo;
      const boostyAge = health.boosty?.lastSeenSecondsAgo;
      const tabsCount = health.boosty?.activeTabsCount;

      if (extState && extState !== lastExtState) {
        record('extension_state_change', { from: lastExtState, to: extState, extAge, tabsCount });
        if (extState === 'connected' && !extFirstSeenAt) {
          extFirstSeenAt = now;
        }
        if (extState === 'reconnecting' || extState === 'unavailable') {
          disconnectCount++;
        }
        lastExtState = extState;
      }

      if (boostyState && boostyState !== lastBoostyState) {
        record('boosty_state_change', { from: lastBoostyState, to: boostyState, boostyAge, tabsCount });
        if (boostyState !== 'unavailable' && boostyState !== 'checking' && !boostyFirstSeenAt) {
          boostyFirstSeenAt = now;
        }
        lastBoostyState = boostyState;
      }
    }

    await sleep(250);
  }

  console.log('\n--- Reproduction Summary ---');
  console.log(`T0 Launch: 0s`);
  console.log(`T1 Server Ready: ${serverReadyAt ? ((serverReadyAt - t0) / 1000).toFixed(3) + 's' : 'NEVER'}`);
  console.log(`T2 Extension First Connected: ${extFirstSeenAt ? ((extFirstSeenAt - t0) / 1000).toFixed(3) + 's' : 'NEVER'}`);
  console.log(`T3 Boosty Tab First Detected: ${boostyFirstSeenAt ? ((boostyFirstSeenAt - t0) / 1000).toFixed(3) + 's' : 'NEVER'}`);
  console.log(`Total Disconnect / Flapping Events: ${disconnectCount}`);

  // Save trace artifact
  const artifactsDir = path.resolve(__dirname, '../artifacts/connectivity');
  fs.mkdirSync(artifactsDir, { recursive: true });
  const traceFile = path.join(artifactsDir, `session-reproduce-${Date.now()}.json`);
  fs.writeFileSync(traceFile, JSON.stringify(logs, null, 2));
  console.log(`Trace saved: ${traceFile}`);

  // Clean up spawned electron
  try {
    electronProc.kill();
  } catch {}
}

runReproduction().catch(err => {
  console.error('Reproduction error:', err);
  process.exit(1);
});
