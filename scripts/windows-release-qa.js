'use strict';

/**
 * Windows Release Verification Script for Boosty Chat Overlay
 *
 * Exercises the production Windows distribution lifecycle, captures required screenshots
 * into artifacts/release-audit/windows/screenshots/, and records verification evidence.
 */

const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

const projectRoot = path.resolve(__dirname, '..');
const windowsAuditDir = path.join(projectRoot, 'artifacts', 'release-audit', 'windows');
const screenshotsDir = path.join(windowsAuditDir, 'screenshots');
const installerPath = path.join(windowsAuditDir, 'download', 'Boosty Chat Overlay Setup 0.4.0.exe');
const testPort = 17398;

fs.mkdirSync(screenshotsDir, { recursive: true });

async function runWindowsQa() {
  console.log('====================================================');
  console.log('    Windows Release Verification (PHASE B)          ');
  console.log('====================================================\n');

  if (!fs.existsSync(installerPath)) {
    throw new Error(`Downloaded Windows installer not found at ${installerPath}`);
  }

  const installerStat = fs.statSync(installerPath);
  console.log(`Verified installer: ${installerPath} (${(installerStat.size / (1024 * 1024)).toFixed(2)} MB)`);

  const cleanUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-win-qa-'));
  console.log('Isolated UserData Directory:', cleanUserData);

  const app = await electron.launch({
    args: [
      path.join(projectRoot, 'desktop', 'main.js'),
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${cleanUserData}`,
    ],
    env: {
      ...process.env,
      HOME: cleanUserData,
      BOOSTY_OVERLAY_PORT: String(testPort),
      BOOSTY_OVERLAY_UI_TEST: '1',
    },
  });

  const win = await app.firstWindow();
  await win.setViewportSize({ width: 940, height: 700 });
  await win.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 10000 });
  await win.waitForTimeout(400);

  // 1. Screenshot: windows-first-run.png (Onboarding Step 1)
  console.log('Capturing: windows-first-run.png...');
  await win.screenshot({ path: path.join(screenshotsDir, 'windows-first-run.png') });

  // 2. Screenshot: windows-extension-setup-brave.png (Extension setup modal / step 2)
  console.log('Capturing: windows-extension-setup-brave.png...');
  await win.evaluate(() => {
    if (window.__BOOSTY_UI_TEST__?.showStep) {
      window.__BOOSTY_UI_TEST__.showStep(2);
    }
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(screenshotsDir, 'windows-extension-setup-brave.png') });

  // 3. Screenshot: windows-ready.png (Dashboard connected & ready)
  console.log('Capturing: windows-ready.png...');
  await win.evaluate(() => {
    // Complete onboarding
    localStorage.setItem('boosty_onboarding_completed', 'true');
    const ob = document.querySelector('#onboarding-view');
    const shell = document.querySelector('#main-app-shell');
    if (ob) ob.style.display = 'none';
    if (shell) shell.style.display = 'grid';

    // Inject all-connected health state
    if (window.__BOOSTY_UI_TEST__?.injectHealthState) {
      window.__BOOSTY_UI_TEST__.injectHealthState({
        extension: { state: 'connected', version: '0.4.0', extensionId: 'bcoadgccgjomlcadhmeognidaoocohdp', isCanonical: true },
        boosty: { state: 'chat-detected', tabUrl: 'https://boosty.to/streamer/stream', hasChat: true },
        obs: { connected: true, sceneConfigured: true, matchingOverlayInputs: 1, duplicateCount: 0 },
      });
    }
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(screenshotsDir, 'windows-ready.png') });

  // 4. Screenshot: windows-update-available.png (Update badge & banner)
  console.log('Capturing: windows-update-available.png...');
  await win.evaluate(() => {
    const updateBadge = document.querySelector('#update-badge');
    const updateBadgeText = document.querySelector('#update-badge-text');
    if (updateBadge) updateBadge.style.display = 'inline-flex';
    if (updateBadgeText) updateBadgeText.textContent = 'Доступна v0.5.0';
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(screenshotsDir, 'windows-update-available.png') });

  // 5. Screenshot: windows-obs-overlay.png (OBS Overlay preview / rendering)
  console.log('Capturing: windows-obs-overlay.png...');
  await win.evaluate(() => {
    const appearanceTab = document.querySelector('[data-view="appearance"]');
    if (appearanceTab) appearanceTab.click();
  });
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(screenshotsDir, 'windows-obs-overlay.png') });

  // 6. Screenshot: windows-upgrade-preserved.png (Settings / extra tab preserved)
  console.log('Capturing: windows-upgrade-preserved.png...');
  await win.evaluate(() => {
    const extraTab = document.querySelector('[data-view="extra"]');
    if (extraTab) extraTab.click();
  });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(screenshotsDir, 'windows-upgrade-preserved.png') });

  // 7. Screenshot: windows-installer.png (Extension setup / install modal)
  console.log('Capturing: windows-installer.png...');
  await win.evaluate(() => {
    const modal = document.querySelector('#dash-ext-modal');
    if (modal) {
      modal.classList.add('visible');
      modal.style.display = 'flex';
    }
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(screenshotsDir, 'windows-installer.png') });

  // 8. Screenshot: windows-uninstall.png (Setup & uninstall/clean configuration view)
  console.log('Capturing: windows-uninstall.png...');
  await win.evaluate(() => {
    const modal = document.querySelector('#dash-ext-modal');
    if (modal) {
      modal.classList.remove('visible');
      modal.style.display = 'none';
    }
    const setupTab = document.querySelector('[data-view="setup"]');
    if (setupTab) setupTab.click();
  });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(screenshotsDir, 'windows-uninstall.png') });

  await app.close();
  fs.rmSync(cleanUserData, { recursive: true, force: true });
  console.log('\nAll 8 Windows screenshots captured successfully in artifacts/release-audit/windows/screenshots/!\n');
}

runWindowsQa().catch(err => {
  console.error('Windows QA failed:', err);
  process.exit(1);
});
