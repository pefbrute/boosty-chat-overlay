'use strict';

const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function testLaunch() {
  const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-clean-pkg-'));
  const packagedExe = path.resolve(__dirname, '..', 'dist', 'linux-unpacked', 'boosty-chat-overlay');

  console.log('Testing packaged launch:', packagedExe);
  console.log('Clean user-data-dir:', cleanDir);

  const env = {
    ...process.env,
    HOME: cleanDir,
    BOOSTY_OVERLAY_PORT: '17371',
  };

  const app = await electron.launch({
    executablePath: packagedExe,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${cleanDir}`,
    ],
    env,
  });

  const win = await app.firstWindow();
  console.log('Window title:', await win.title());

  await win.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 5000 });

  const currentView = await win.evaluate(() => {
    const ob = document.querySelector('#onboarding-view');
    const shell = document.querySelector('#main-app-shell');
    return {
      onboardingDisplay: ob ? window.getComputedStyle(ob).display : 'missing',
      shellDisplay: shell ? window.getComputedStyle(shell).display : 'missing',
      isPackaged: window.boostyOverlay?.isPackaged,
      boostyAudit: window.boostyAudit,
      boostyUiTest: window.__BOOSTY_UI_TEST__,
    };
  });
  console.log('First run view evaluation:', currentView);

  // Check extension info via IPC in packaged mode
  const extInfo = await win.evaluate(async () => {
    if (window.boostyOverlay?.getExtensionInfo) {
      return await window.boostyOverlay.getExtensionInfo();
    }
    return null;
  });
  console.log('Packaged Extension Info:', extInfo);

  if (!extInfo || !extInfo.persistentPath) {
    throw new Error('Expected extInfo to have persistentPath in packaged mode');
  }
  if (!fs.existsSync(extInfo.persistentPath)) {
    throw new Error(`Persistent extension directory does not exist: ${extInfo.persistentPath}`);
  }
  const manifestPath = path.join(extInfo.persistentPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest missing in deployed extension: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log('Deployed manifest version:', manifest.version, 'id key exists:', Boolean(manifest.key));
  if (!manifest.key) {
    throw new Error('Manifest key missing from deployed extension!');
  }

  // Check update status IPC in packaged mode
  const updateStatus = await win.evaluate(async () => {
    if (window.boostyOverlay?.getUpdateStatus) {
      return await window.boostyOverlay.getUpdateStatus();
    }
    return null;
  });
  console.log('Packaged Update Status:', updateStatus);

  // Test single-instance lock: launch a second instance with same userDataDir
  console.log('Testing single-instance lock on packaged binary...');
  const { spawnSync } = require('node:child_process');
  const secondLaunch = spawnSync(packagedExe, [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--user-data-dir=${cleanDir}`,
  ], {
    env,
    timeout: 5000,
  });
  console.log('Second instance exit code:', secondLaunch.status);
  if (secondLaunch.status !== 0) {
    throw new Error(`Second instance exited with unexpected code: ${secondLaunch.status}`);
  }
  console.log('Single-instance lock successfully blocked duplicate launch!');

  await app.close();
  fs.rmSync(cleanDir, { recursive: true, force: true });
  console.log('Packaged launch test passed successfully!');
}

testLaunch().catch(err => {
  console.error('Launch test failed:', err);
  process.exit(1);
});
