'use strict';

const { _electron: electron, chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const http = require('node:http');

const APPIMAGE_PATH = path.resolve(__dirname, '..', 'dist', 'Boosty Chat Overlay-0.4.0.AppImage');
const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'artifacts', 'release-audit', 'screenshots');
const EXPECTED_STABLE_ID = 'bcoadgccgjomlcadhmeognidaoocohdp';
const BRAVE_BIN = '/usr/bin/brave-browser';
const CANONICAL_PORT = 17369;

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function waitForServer(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchJson(`http://127.0.0.1:${port}/health`);
      if (res && res.ok) return res;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server on port ${port} did not respond within ${timeoutMs}ms`);
}

async function runScenario1_RealAppImage() {
  console.log('\n======================================================');
  console.log('SCENARIO 1: REAL APPIMAGE CLEAN LAUNCH, UNMOUNT & RESTART');
  console.log('======================================================');

  assert.ok(fs.existsSync(APPIMAGE_PATH), `AppImage not found at ${APPIMAGE_PATH}`);
  fs.chmodSync(APPIMAGE_PATH, 0o755);

  const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-appimage-s1-'));
  const xdgConfig = path.join(cleanHome, '.config');
  const cleanBraveData = fs.mkdtempSync(path.join(os.tmpdir(), 'brave-s1-data-'));

  console.log('Clean HOME:', cleanHome);
  console.log('AppImage Binary:', APPIMAGE_PATH);

  // 1. Launch Real AppImage
  const app = await electron.launch({
    executablePath: APPIMAGE_PATH,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
    env: {
      ...process.env,
      HOME: cleanHome,
      XDG_CONFIG_HOME: xdgConfig,
      BOOSTY_OVERLAY_PORT: String(CANONICAL_PORT),
    },
  });

  const win = await app.firstWindow();
  await win.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 10000 });
  await waitForServer(CANONICAL_PORT);

  // 2. Identify AppImage Mount Point
  let mountDir = null;
  const tmpEntries = fs.readdirSync('/tmp');
  for (const entry of tmpEntries) {
    if (entry.startsWith('.mount_Boosty') || entry.startsWith('.mount_')) {
      const full = path.join('/tmp', entry);
      try {
        if (fs.existsSync(path.join(full, 'resources', 'extension'))) {
          mountDir = full;
          break;
        }
      } catch {}
    }
  }
  console.log('Detected AppImage Mount Point:', mountDir);
  assert.ok(mountDir, 'Expected active AppImage mount point in /tmp/.mount_*');
  assert.ok(fs.existsSync(mountDir), 'Mount directory must exist while AppImage is running');

  // 3. Verify persistent extension path offered in UI
  const extInfo = await win.evaluate(async () => {
    return await window.boostyOverlay.getExtensionInfo();
  });
  console.log('AppImage Persistent Extension Path:', extInfo.persistentPath);
  console.log('AppImage Bundled Path (inside mount):', extInfo.bundledPath);
  assert.equal(extInfo.isTransient, false, 'Persistent extension path must NOT be transient');
  assert.ok(!extInfo.persistentPath.includes('/tmp/.mount_'), 'Persistent path must not contain /tmp/.mount_');
  assert.ok(extInfo.bundledPath.includes('/tmp/.mount_'), 'Bundled path must be inside AppImage mount');
  assert.ok(fs.existsSync(extInfo.persistentPath), 'Persistent extension directory must have been deployed');

  // Verify manifest in persistent dir has stable key
  const deployedManifest = JSON.parse(fs.readFileSync(path.join(extInfo.persistentPath, 'manifest.json'), 'utf8'));
  assert.ok(deployedManifest.key, 'Deployed manifest must contain public key');
  assert.equal(deployedManifest.version, '0.4.0');

  // Reveal onboarding setup guide box to display persistent extension path in screenshot
  await win.evaluate(() => {
    const guideBox = document.querySelector('#ob-guide-box');
    if (guideBox) guideBox.style.display = 'block';
  });
  await new Promise(r => setTimeout(r, 500));

  // Take Screenshot 1: appimage-onboarding-extension-path.png
  ensureDir(SCREENSHOTS_DIR);
  const screenshot1Path = path.join(SCREENSHOTS_DIR, 'appimage-onboarding-extension-path.png');
  await win.screenshot({ path: screenshot1Path });
  console.log('Screenshot 1 saved:', screenshot1Path);

  // 4. Load persistent extension in clean Brave profile
  console.log('Launching clean Brave with persistent extension...');
  const braveContext = await chromium.launchPersistentContext(cleanBraveData, {
    executablePath: BRAVE_BIN,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${extInfo.persistentPath}`,
      `--load-extension=${extInfo.persistentPath}`,
    ],
    headless: true,
  });

  let [sw] = braveContext.serviceWorkers();
  if (!sw) {
    sw = await braveContext.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const braveExtId = await sw.evaluate(() => chrome.runtime.id);
  console.log('Brave Extension ID from persistent path:', braveExtId);
  assert.equal(braveExtId, EXPECTED_STABLE_ID, 'Extension ID in Brave must match EXPECTED_STABLE_ID');

  // Open Boosty tab in Brave to establish connection with AppImage
  const boostyPage = await braveContext.newPage();
  await boostyPage.route('https://boosty.to/**', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><div class="stream-chat-container">Chat active</div></body></html>',
    });
  });
  await boostyPage.goto('https://boosty.to/streamer/stream');

  // Wait for health to reflect connected extension
  let extConnected = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const h = await fetchJson(`http://127.0.0.1:${CANONICAL_PORT}/health`);
      if (h.extension?.state === 'connected' && h.extensionId === EXPECTED_STABLE_ID) {
        extConnected = true;
        break;
      }
    } catch {}
  }
  console.log('Extension connected to AppImage:', extConnected);
  assert.ok(extConnected, 'Extension must connect to AppImage server');

  // 5. Close AppImage completely
  console.log('Closing AppImage process...');
  await app.close();
  await new Promise(r => setTimeout(r, 2000));

  // 6. Verify mount has disappeared
  const mountExistsAfter = fs.existsSync(mountDir);
  console.log('Mount exists after exit:', mountExistsAfter);
  assert.equal(mountExistsAfter, false, 'AppImage mount directory MUST disappear after AppImage exit');

  // 7. Verify persistent extension survived unmount
  assert.ok(fs.existsSync(extInfo.persistentPath), 'Persistent extension directory must survive AppImage exit');
  assert.ok(fs.existsSync(path.join(extInfo.persistentPath, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(extInfo.persistentPath, 'background.js')));
  assert.ok(fs.existsSync(path.join(extInfo.persistentPath, 'content.js')));
  assert.ok(fs.existsSync(path.join(extInfo.persistentPath, 'parser.js')));
  console.log('Persistent extension directory verified completely intact after unmount!');

  // 8. Verify Brave still considers extension valid
  const braveExtIdAfter = await sw.evaluate(() => chrome.runtime.id);
  console.log('Brave extension ID after AppImage unmount:', braveExtIdAfter);
  assert.equal(braveExtIdAfter, EXPECTED_STABLE_ID);

  // 9. Relaunch AppImage with same profile (Second launch)
  console.log('Relaunching AppImage with same user profile...');
  const app2 = await electron.launch({
    executablePath: APPIMAGE_PATH,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
    env: {
      ...process.env,
      HOME: cleanHome,
      XDG_CONFIG_HOME: xdgConfig,
      BOOSTY_OVERLAY_PORT: String(CANONICAL_PORT),
    },
  });

  const win2 = await app2.firstWindow();
  await win2.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 10000 });
  await waitForServer(CANONICAL_PORT);

  // Verify auto-reconnect without re-loading unpacked extension
  let reconnected = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const h = await fetchJson(`http://127.0.0.1:${CANONICAL_PORT}/health`);
      if (h.extension?.state === 'connected' && h.extensionId === EXPECTED_STABLE_ID) {
        reconnected = true;
        break;
      }
    } catch {}
  }
  console.log('Extension reconnected automatically after AppImage relaunch:', reconnected);
  assert.ok(reconnected, 'Extension must automatically reconnect after AppImage relaunch');

  // Complete onboarding to show Dashboard ready
  await win2.evaluate(() => {
    localStorage.setItem('onboardingCompleted', 'true');
    const ob = document.querySelector('#onboarding-view');
    const shell = document.querySelector('#main-app-shell');
    if (ob) ob.style.display = 'none';
    if (shell) shell.style.display = 'grid';
  });
  await new Promise(r => setTimeout(r, 1000));

  // Take Screenshot 2: appimage-ready-after-restart.png
  const screenshot2Path = path.join(SCREENSHOTS_DIR, 'appimage-ready-after-restart.png');
  await win2.screenshot({ path: screenshot2Path });
  console.log('Screenshot 2 saved:', screenshot2Path);

  await app2.close();
  await braveContext.close();
  fs.rmSync(cleanHome, { recursive: true, force: true });
  fs.rmSync(cleanBraveData, { recursive: true, force: true });
  console.log('Scenario 1 PASSED successfully!');
}

async function runScenario2_LegacyMigration() {
  console.log('\n======================================================');
  console.log('SCENARIO 2: LEGACY UNPACKED EXTENSION MIGRATION');
  console.log('======================================================');

  const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-legacy-home-'));
  const xdgConfig = path.join(cleanHome, '.config');
  const userDataDir = path.join(xdgConfig, 'boosty-chat-overlay');
  ensureDir(userDataDir);

  // Simulate existing user configuration:
  // onboardingCompleted, existing overlay-settings.json, Focus Mode preference
  fs.writeFileSync(path.join(userDataDir, 'overlay-settings.json'), JSON.stringify({
    schemaVersion: 1,
    port: CANONICAL_PORT,
    theme: 'dark',
    activeProfile: 'chat',
    cardWidth: 380,
  }, null, 2));

  // Prepare Legacy Extension (NO "key" field in manifest)
  const legacyExtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-ext-dir-'));
  const realExtDir = path.resolve(__dirname, '..', 'extension');
  for (const f of fs.readdirSync(realExtDir)) {
    const src = path.join(realExtDir, f);
    const dest = path.join(legacyExtDir, f);
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  const legacyManifest = JSON.parse(fs.readFileSync(path.join(legacyExtDir, 'manifest.json'), 'utf8'));
  delete legacyManifest.key;
  fs.writeFileSync(path.join(legacyExtDir, 'manifest.json'), JSON.stringify(legacyManifest, null, 2));

  const cleanBraveData = fs.mkdtempSync(path.join(os.tmpdir(), 'brave-legacy-data-'));

  // 1. Launch Brave with Legacy Extension
  console.log('Launching Brave with Legacy Extension...');
  const braveContext = await chromium.launchPersistentContext(cleanBraveData, {
    executablePath: BRAVE_BIN,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${legacyExtDir}`,
      `--load-extension=${legacyExtDir}`,
    ],
    headless: true,
  });

  let [sw] = braveContext.serviceWorkers();
  if (!sw) {
    sw = await braveContext.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const legacyExtId = await sw.evaluate(() => chrome.runtime.id);
  console.log('Legacy Extension Path:', legacyExtDir);
  console.log('Legacy Extension ID in Brave:', legacyExtId);
  assert.notEqual(legacyExtId, EXPECTED_STABLE_ID, 'Legacy extension ID must be different from stable ID');

  // Open Boosty tab in Brave
  const boostyPage = await braveContext.newPage();
  await boostyPage.route('https://boosty.to/**', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><div class="stream-chat-container">Legacy Chat active</div></body></html>',
    });
  });
  await boostyPage.goto('https://boosty.to/legacy-streamer/stream');

  // 2. Launch New Desktop AppImage (Existing user upgrade)
  console.log('Launching Desktop AppImage for existing user...');
  const app = await electron.launch({
    executablePath: APPIMAGE_PATH,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
    env: {
      ...process.env,
      HOME: cleanHome,
      XDG_CONFIG_HOME: xdgConfig,
      BOOSTY_OVERLAY_PORT: String(CANONICAL_PORT),
    },
  });

  const win = await app.firstWindow();
  await win.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 10000 });
  await waitForServer(CANONICAL_PORT);

  // Existing user already completed onboarding
  await win.evaluate(() => {
    localStorage.setItem('onboardingCompleted', 'true');
    const ob = document.querySelector('#onboarding-view');
    const shell = document.querySelector('#main-app-shell');
    if (ob) ob.style.display = 'none';
    if (shell) shell.style.display = 'grid';
  });

  // Wait for health to report legacy extension connected and migration required
  let migrationReported = false;
  let healthState = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      healthState = await fetchJson(`http://127.0.0.1:${CANONICAL_PORT}/health`);
      if (healthState.extensionMigrationRequired && healthState.isLegacyExtension && healthState.detectedExtensionId === legacyExtId) {
        migrationReported = true;
        break;
      }
    } catch {}
  }
  console.log('Health State Detected Extension ID:', healthState?.detectedExtensionId);
  console.log('Health State Extension Migration Required:', healthState?.extensionMigrationRequired);
  assert.ok(migrationReported, 'Server must flag extensionMigrationRequired when legacy extension connects');
  assert.equal(healthState.detectedExtensionId, legacyExtId);
  assert.equal(healthState.expectedExtensionId, EXPECTED_STABLE_ID);

  // Trigger UI refresh in app
  await win.evaluate(() => {
    if (typeof refreshStatus === 'function') refreshStatus();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Check UI displays "Требуется обновление" / "Обновить расширение"
  const extUiState = await win.evaluate(() => {
    const pill = document.querySelector('#dash-ext-pill');
    const text = document.querySelector('#dash-ext-text');
    const detail = document.querySelector('#dash-ext-detail');
    const fixBtn = document.querySelector('#dash-ext-fix-btn');
    return {
      pillClass: pill ? pill.className : '',
      text: text ? text.textContent : '',
      detail: detail ? detail.textContent : '',
      btnLabel: fixBtn ? fixBtn.textContent : '',
      btnAction: fixBtn ? fixBtn.getAttribute('data-action-id') : '',
    };
  });
  console.log('Legacy Extension UI Representation:', extUiState);
  assert.ok(extUiState.text.includes('Требуется') || extUiState.text.includes('Нужно'), 'UI must show update/migration needed');
  assert.equal(extUiState.btnAction, 'migrate-ext');

  // Take Screenshot 3: legacy-extension-migration-required.png
  const screenshot3Path = path.join(SCREENSHOTS_DIR, 'legacy-extension-migration-required.png');
  await win.screenshot({ path: screenshot3Path });
  console.log('Screenshot 3 saved:', screenshot3Path);

  // 3. Test Coexistence: Simulate canonical extension connecting simultaneously with legacy
  console.log('Testing coexistence with both legacy and canonical connectors...');
  const WebSocket = require('ws');
  const canonicalWs = new WebSocket(`ws://127.0.0.1:${CANONICAL_PORT}/connector`);
  await new Promise(r => canonicalWs.once('open', r));

  canonicalWs.send(JSON.stringify({
    type: 'HANDSHAKE',
    client: 'boosty-chat-connector',
    version: '0.4.0',
    extensionVersion: '0.4.0',
    extensionId: EXPECTED_STABLE_ID,
  }));
  await new Promise(r => setTimeout(r, 500));

  const coexistenceHealth = await fetchJson(`http://127.0.0.1:${CANONICAL_PORT}/health`);
  console.log('Coexistence duplicateConnectors flag:', coexistenceHealth.duplicateConnectors);
  console.log('Primary extensionId during coexistence:', coexistenceHealth.extensionId);
  assert.equal(coexistenceHealth.extensionId, EXPECTED_STABLE_ID, 'Canonical extension must be primary during coexistence');

  // Send message from canonical -> should succeed
  const sseCollector = [];
  const sseReq = http.get(`http://127.0.0.1:${CANONICAL_PORT}/events`, (res) => {
    res.on('data', chunk => {
      const str = chunk.toString();
      if (str.includes('MIGRATION-QA-')) {
        sseCollector.push(str);
      }
    });
  });

  const testMsgId = `MIGRATION-QA-${Date.now()}`;
  canonicalWs.send(JSON.stringify({
    type: 'MESSAGE',
    payload: {
      id: testMsgId,
      platform: 'boosty',
      author: 'Tester',
      text: 'Testing migration message delivery',
      publishTime: '14:00',
    },
  }));
  await new Promise(r => setTimeout(r, 800));

  // Query /history
  const history = await fetchJson(`http://127.0.0.1:${CANONICAL_PORT}/history`);
  const matches = history.filter(m => m.id === testMsgId);
  console.log(`History count for ${testMsgId}:`, matches.length);
  assert.equal(matches.length, 1, 'Exactly one message must exist in history (zero duplicates)');
  assert.equal(sseCollector.length, 1, 'Exactly one message must be broadcast via SSE');

  canonicalWs.close();
  sseReq.destroy();

  // 4. Complete Migration: load persistent stable extension
  console.log('Performing migration to stable persistent extension in Brave...');
  await braveContext.close();

  // Get persistent extension path
  const persistentExtPath = path.join(userDataDir, 'extension');
  assert.ok(fs.existsSync(persistentExtPath), 'Persistent extension must exist');

  // Launch Brave with new persistent extension
  const braveContext2 = await chromium.launchPersistentContext(cleanBraveData, {
    executablePath: BRAVE_BIN,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${persistentExtPath}`,
      `--load-extension=${persistentExtPath}`,
    ],
    headless: true,
  });

  let [sw2] = braveContext2.serviceWorkers();
  if (!sw2) {
    sw2 = await braveContext2.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const migratedExtId = await sw2.evaluate(() => chrome.runtime.id);
  console.log('Migrated Extension ID in Brave:', migratedExtId);
  assert.equal(migratedExtId, EXPECTED_STABLE_ID);

  const boostyPage2 = await braveContext2.newPage();
  await boostyPage2.route('https://boosty.to/**', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><div class="stream-chat-container">Chat active</div></body></html>',
    });
  });
  await boostyPage2.goto('https://boosty.to/streamer/stream');

  // Wait for health to report stable connection
  let stableReported = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const h = await fetchJson(`http://127.0.0.1:${CANONICAL_PORT}/health`);
      if (h.extension?.state === 'connected' && h.extensionId === EXPECTED_STABLE_ID && !h.extensionMigrationRequired) {
        stableReported = true;
        break;
      }
    } catch {}
  }
  assert.ok(stableReported, 'Server must report stable connection without migration requirement after update');

  await win.evaluate(() => {
    if (typeof refreshStatus === 'function') refreshStatus();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Check UI displays "Активно"
  const extUiStateAfter = await win.evaluate(() => {
    const text = document.querySelector('#dash-ext-text');
    return text ? text.textContent : '';
  });
  console.log('UI text after migration:', extUiStateAfter);
  assert.ok(extUiStateAfter.includes('Активно'), 'UI must show "Активно" after migration');

  // Take Screenshot 4: stable-extension-connected.png
  const screenshot4Path = path.join(SCREENSHOTS_DIR, 'stable-extension-connected.png');
  await win.screenshot({ path: screenshot4Path });
  console.log('Screenshot 4 saved:', screenshot4Path);

  // Check existing config was NOT overwritten or reset
  const savedSettings = JSON.parse(fs.readFileSync(path.join(userDataDir, 'overlay-settings.json'), 'utf8'));
  console.log('User settings preserved after upgrade:', savedSettings);
  assert.equal(savedSettings.cardWidth, 380);
  assert.equal(savedSettings.activeProfile, 'chat');

  await app.close();
  await braveContext2.close();
  fs.rmSync(cleanHome, { recursive: true, force: true });
  fs.rmSync(cleanBraveData, { recursive: true, force: true });
  fs.rmSync(legacyExtDir, { recursive: true, force: true });
  console.log('Scenario 2 PASSED successfully!');
}

async function main() {
  await runScenario1_RealAppImage();
  await runScenario2_LegacyMigration();
  console.log('\n======================================================');
  console.log('ALL RELEASE READINESS SCENARIOS VERIFIED SUCCESSFULLY!');
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('\nFAILURE:', err);
  process.exit(1);
});
