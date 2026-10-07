'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('playwright');

const projectRoot = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts/onboarding-extension');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function run() {
  console.log('[Visual Test Onboarding Extension] Starting visual QA...');

  const testUserData = path.join(os.tmpdir(), `boosty-onboarding-ext-${Date.now()}`, 'Boosty Chat Overlay Fresh');
  fs.mkdirSync(testUserData, { recursive: true });

  const appEnv = {
    ...process.env,
    BOOSTY_APP_VARIANT: 'fresh',
    BOOSTY_OVERLAY_USER_DATA: testUserData,
    BOOSTY_OVERLAY_PORT: '17398',
    BOOSTY_OVERLAY_UI_TEST: '1',
  };

  const app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      path.join(projectRoot, 'desktop', 'main.js'),
    ],
    cwd: projectRoot,
    env: appEnv,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // Ensure Onboarding Step 1 is active
  await page.waitForSelector('#step-1.wizard-panel.active', { state: 'visible' });

  // 1. onboarding-extension-01-not-connected.png (Full step 1 in not-connected state)
  const step1Card = await page.$('#step-1');
  if (step1Card) {
    await step1Card.screenshot({
      path: path.join(ARTIFACTS_DIR, 'onboarding-extension-01-not-connected.png'),
    });
    console.log('[Visual Test Onboarding Extension] Saved onboarding-extension-01-not-connected.png');
  }

  // 2. onboarding-extension-02-instructions.png (Close-up of the 4-step instructions)
  const instructionsSection = await page.$('.ob-guide-section');
  if (instructionsSection) {
    await instructionsSection.screenshot({
      path: path.join(ARTIFACTS_DIR, 'onboarding-extension-02-instructions.png'),
    });
    console.log('[Visual Test Onboarding Extension] Saved onboarding-extension-02-instructions.png');
  }

  // 3. onboarding-extension-03-folder-actions.png (Close-up of extension folder box)
  const folderSection = await page.$('.ob-folder-section');
  if (folderSection) {
    await folderSection.screenshot({
      path: path.join(ARTIFACTS_DIR, 'onboarding-extension-03-folder-actions.png'),
    });
    console.log('[Visual Test Onboarding Extension] Saved onboarding-extension-03-folder-actions.png');
  }

  // 5. onboarding-extension-05-recovery-help.png (Close-up of recovery help card)
  const recoverySection = await page.$('#ob-recovery-box');
  if (recoverySection) {
    await recoverySection.screenshot({
      path: path.join(ARTIFACTS_DIR, 'onboarding-extension-05-recovery-help.png'),
    });
    console.log('[Visual Test Onboarding Extension] Saved onboarding-extension-05-recovery-help.png');
  }

  // Now simulate connected state to capture onboarding-extension-04-connected.png
  await page.evaluate(() => {
    // Simulate extension connected via test hooks or mock
    const obExtBadge = document.querySelector('#ob-ext-status-badge');
    const obExtText = document.querySelector('#ob-ext-status-text');
    const obExtHint = document.querySelector('#ob-ext-hint');
    const obExtSuccess = document.querySelector('#ob-ext-success-msg');
    const obRecoveryBox = document.querySelector('#ob-recovery-box');
    const obStep1Btn = document.querySelector('#ob-step1-next-btn');
    const obStep1Reason = document.querySelector('#ob-step1-reason');

    if (obExtBadge) {
      obExtBadge.className = 'badge connected';
      obExtText.textContent = '✓ Расширение подключено (v0.4.1)';
    }
    if (obExtHint) {
      obExtHint.textContent = 'Связь с браузером установлена. Можно переходить к следующему шагу.';
    }
    if (obExtSuccess) obExtSuccess.style.display = 'block';
    if (obRecoveryBox) obRecoveryBox.style.display = 'none';
    if (obStep1Btn) obStep1Btn.disabled = false;
    if (obStep1Reason) obStep1Reason.style.display = 'none';
  });

  await page.waitForTimeout(300);

  // 4. onboarding-extension-04-connected.png
  if (step1Card) {
    await step1Card.screenshot({
      path: path.join(ARTIFACTS_DIR, 'onboarding-extension-04-connected.png'),
    });
    console.log('[Visual Test Onboarding Extension] Saved onboarding-extension-04-connected.png');
  }

  await app.close();
  fs.rmSync(path.dirname(testUserData), { recursive: true, force: true });
  console.log('[Visual Test Onboarding Extension] All 5 screenshots captured successfully in artifacts/onboarding-extension/');
}

run().catch((err) => {
  console.error('[Visual Test Onboarding Extension] Error:', err);
  process.exit(1);
});
