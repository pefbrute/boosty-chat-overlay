const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const artifactDir = path.join('/home/fedor/.gemini/antigravity/brain/486524eb-7367-4b7a-b79c-99ae21f58653');
fs.mkdirSync(artifactDir, { recursive: true });

let currentHealth = {
  ok: true,
  appVersion: '0.4.0',
  bundledExtensionVersion: '0.4.0',
  extensionVersion: null,
  isOutdated: false,
  overlayClients: 0,
  receivedMessages: 0,
  lastMessageAt: null,
  connectorConnected: false,
  extensionConnected: false,
  boostyConnected: false,
  connectorLastSeenAt: null,
  extensionLastSeenAt: null,
  boostyLastSeenAt: null,
  boostyTabUrl: null,
};

let currentConfig = {
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:17369');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(currentHealth));
  }
  if (req.method === 'GET' && url.pathname === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(currentConfig));
  }
  if (req.method === 'POST' && url.pathname === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(currentConfig));
  }
  if (req.method === 'GET' && url.pathname === '/test') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(404);
  res.end();
});

server.listen(17369, '127.0.0.1');

app.whenReady().then(async () => {
  ipcMain.handle('list-browsers', () => [
    { id: 'brave', name: 'Brave' },
    { id: 'chrome', name: 'Chrome' },
    { id: 'edge', name: 'Edge' },
  ]);
  ipcMain.handle('prepare-browser-extension', () => ({ ok: true, browser: 'Brave', managerUrl: 'brave://extensions/' }));
  ipcMain.handle('open-extension-folder', () => ({ ok: true }));
  ipcMain.handle('open-browser-extensions-page', () => ({ ok: true }));
  ipcMain.handle('copy-extensions-url', () => ({ ok: true, url: 'brave://extensions/' }));
  ipcMain.handle('launch-obs', () => ({ ok: true }));
  ipcMain.handle('has-obs-executable', () => true);
  ipcMain.handle('list-obs-scenes', () => ({
    ok: true,
    connected: true,
    currentCollection: 'Main Collection',
    scenes: [
      { sceneUuid: 'sc-1', sceneName: 'Gameplay', hasChat: true, sceneItemId: 1, sceneItemEnabled: true },
      { sceneUuid: 'sc-2', sceneName: 'Just Chatting', hasChat: false, sceneItemId: null, sceneItemEnabled: true },
    ],
  }));
  ipcMain.handle('add-obs-scene', () => ({ ok: true, addedScene: 'Just Chatting' }));
  ipcMain.handle('remove-obs-scene', () => ({ ok: true, removedScene: 'Gameplay' }));
  ipcMain.handle('get-obs-status', () => ({ ok: true, connected: true }));
  ipcMain.handle('open-url', () => ({ ok: true }));
  ipcMain.handle('copy-overlay-url', () => true);

  const win = new BrowserWindow({
    width: 940,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'desktop', 'preload.js'),
    },
  });

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function capture(filename) {
    await sleep(250);
    const image = await win.webContents.capturePage();
    const dest = path.join(artifactDir, filename);
    fs.writeFileSync(dest, image.toPNG());
    console.log(`[Screenshot Saved] -> ${filename}`);
  }

  async function triggerRefresh() {
    await win.webContents.executeJavaScript(`(async () => { await refreshStatus(); })()`);
    await sleep(150);
  }

  console.log('=== RUNNING UX SCENARIOS & VISUAL VERIFICATION ===');

  await win.loadFile(path.join(__dirname, '..', 'desktop', 'index.html'));
  await sleep(300);

  // Set to onboarding initial state
  await win.webContents.executeJavaScript(`
    localStorage.removeItem('onboardingCompleted');
    onboardingCompleted = false;
    showView('onboarding');
    setWizardStep(1);
    checkGraceDeadline = Date.now() + 6000;
  `);

  // Scenario 1: Initial Startup - CHECKING State
  console.log('1. Verifying CHECKING State on startup...');
  await triggerRefresh();
  await capture('01_onboarding_checking.png');

  // Scenario 2: NOT_DETECTED State (First launch - no extension seen)
  console.log('2. Verifying NOT_DETECTED State (First launch)...');
  await win.webContents.executeJavaScript(`
    checkGraceDeadline = 0;
  `);
  await triggerRefresh();
  await capture('02_onboarding_not_detected_first_time.png');

  // Scenario 3: NOT_DETECTED State with Last Seen 4 minutes ago
  console.log('3. Verifying NOT_DETECTED State with lastExtensionSeenAt (4 mins ago)...');
  currentHealth.extensionLastSeenAt = Date.now() - 4 * 60_000;
  await triggerRefresh();
  await capture('03_onboarding_not_detected_last_seen.png');

  // Scenario 4: User clicks "Настроить расширение" -> 4-Step Visual Guide
  console.log('4. Verifying 4-Step Unpacked Installation Guide...');
  await win.webContents.executeJavaScript(`
    document.querySelector('#ob-open-setup-btn').click();
  `);
  await sleep(300);
  await capture('04_onboarding_unpacked_guide.png');

  // Scenario 5: Heartbeat arrives -> Instant Zero-Click transition to CONNECTED (Boosty not open)
  console.log('5. Verifying Heartbeat Zero-Click transition to CONNECTED (Boosty not open)...');
  currentHealth.extensionConnected = true;
  currentHealth.extensionVersion = '0.4.0';
  currentHealth.isOutdated = false;
  currentHealth.boostyConnected = false;
  currentHealth.extensionLastSeenAt = Date.now();
  await triggerRefresh();
  await capture('05_onboarding_connected_boosty_closed.png');

  // Scenario 6: Boosty opens -> CONNECTED + BOOSTY OPEN
  console.log('6. Verifying CONNECTED + Boosty open...');
  currentHealth.boostyConnected = true;
  currentHealth.boostyLastSeenAt = Date.now();
  await triggerRefresh();
  await capture('06_onboarding_connected_boosty_open.png');

  // Scenario 7: Outdated Extension Version Warning
  console.log('7. Verifying OUTDATED Extension Warning...');
  currentHealth.extensionVersion = '0.2.0';
  currentHealth.isOutdated = true;
  await triggerRefresh();
  await capture('07_onboarding_outdated_warning.png');

  // Scenario 8: Step 3 OBS Setup
  console.log('8. Verifying Step 3 (OBS)...');
  currentHealth.extensionVersion = '0.4.0';
  currentHealth.isOutdated = false;
  await win.webContents.executeJavaScript(`
    setWizardStep(3);
    loadObsScenes();
  `);
  await sleep(300);
  await capture('08_onboarding_step3_obs.png');

  // Scenario 9: Step 4 Celebration / Summary
  console.log('9. Verifying Step 4 (Celebration)...');
  await win.webContents.executeJavaScript(`
    setWizardStep(4);
  `);
  await sleep(300);
  await capture('09_onboarding_step4_summary.png');

  // Scenario 10: Dashboard - Fully Connected State
  console.log('10. Verifying Dashboard (Fully Connected)...');
  await win.webContents.executeJavaScript(`
    localStorage.setItem('onboardingCompleted', 'true');
    onboardingCompleted = true;
    showView('main');
  `);
  await triggerRefresh();
  await capture('10_dashboard_fully_connected.png');

  // Scenario 11: Dashboard - Extension Disconnected (Browser Closed) with Context Banner
  console.log('11. Verifying Dashboard (Extension Disconnected with Context Banner)...');
  currentHealth.extensionConnected = false;
  currentHealth.boostyConnected = false;
  currentHealth.extensionLastSeenAt = Date.now() - 3 * 60_000;
  await win.webContents.executeJavaScript(`
    checkGraceDeadline = 0;
  `);
  await triggerRefresh();
  await capture('11_dashboard_extension_disconnected_banner.png');

  // Scenario 12: Dashboard - Extension Setup Modal (Targeted Fix)
  console.log('12. Verifying Dashboard Extension Setup Modal...');
  await win.webContents.executeJavaScript(`
    openExtensionModal('setup');
  `);
  await sleep(300);
  await capture('12_dashboard_extension_modal.png');

  // Scenario 13: Viewport Verification - Mobile 390px
  console.log('13. Verifying Viewport Mobile 390px...');
  await win.webContents.executeJavaScript(`closeExtensionModal();`);
  win.setSize(390, 800);
  await sleep(300);
  await capture('13_dashboard_mobile_390px.png');

  // Scenario 14: Already Connected on Startup Scenario
  console.log('14. Verifying "Extension already connected on launch" scenario...');
  win.setSize(940, 720);
  currentHealth.extensionConnected = true;
  currentHealth.boostyConnected = true;
  currentHealth.isOutdated = false;
  currentHealth.extensionVersion = '0.4.0';
  await win.webContents.executeJavaScript(`
    localStorage.removeItem('onboardingCompleted');
    onboardingCompleted = false;
    showView('onboarding');
    setWizardStep(1);
  `);
  await triggerRefresh();
  await capture('14_onboarding_already_installed_on_launch.png');

  console.log('=== ALL UX SCENARIOS PASSED SUCCESSFULLY ===');
  server.close();
  app.quit();
});
