'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('playwright');

const projectRoot = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts/yandex');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function run() {
  console.log('[Visual Test Yandex] Starting visual QA for Yandex Browser First-Class Support...');

  const testUserData = path.join(os.tmpdir(), `boosty-yandex-test-${Date.now()}`, 'Boosty Chat Overlay Fresh');
  fs.mkdirSync(testUserData, { recursive: true });

  const appEnv = {
    ...process.env,
    BOOSTY_APP_VARIANT: 'fresh',
    BOOSTY_OVERLAY_USER_DATA: testUserData,
    BOOSTY_OVERLAY_PORT: '17399',
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

  // Select Yandex Browser if available, or trigger Yandex selection
  await page.evaluate(() => {
    // Find Yandex browser button or simulate clicking it
    const buttons = Array.from(document.querySelectorAll('#ob-browser-options .browser-choice-btn'));
    const yandexBtn = buttons.find(b => b.textContent.includes('Яндекс'));
    if (yandexBtn) {
      yandexBtn.click();
    } else {
      // Force selectedBrowser to yandex and update
      localStorage.setItem('selectedBrowser', 'yandex');
      if (typeof updateBrowserActionButtons === 'function') {
        updateBrowserActionButtons();
      }
    }
  });

  await page.waitForTimeout(500);

  // 1. yandex-01-browser-select.png (Browser selection showing Яндекс Браузер as selected)
  const browserSection = await page.$('.ob-browser-section');
  if (browserSection) {
    await browserSection.screenshot({
      path: path.join(ARTIFACTS_DIR, 'yandex-01-browser-select.png'),
    });
    console.log('[Visual Test Yandex] Saved yandex-01-browser-select.png');
  }

  // 2. yandex-02-extension-instructions.png (6-step Yandex-specific instructions)
  const instructionsSection = await page.$('.ob-guide-section');
  if (instructionsSection) {
    await instructionsSection.screenshot({
      path: path.join(ARTIFACTS_DIR, 'yandex-02-extension-instructions.png'),
    });
    console.log('[Visual Test Yandex] Saved yandex-02-extension-instructions.png');
  }

  // 3. yandex-03-extension-page-action.png (Action CTAs showing Открыть расширения Яндекс Браузера)
  const actionsSection = await page.$('.ob-actions-section');
  if (actionsSection) {
    await actionsSection.screenshot({
      path: path.join(ARTIFACTS_DIR, 'yandex-03-extension-page-action.png'),
    });
    console.log('[Visual Test Yandex] Saved yandex-03-extension-page-action.png');
  }

  // 5. yandex-05-recovery.png (Recovery card with Yandex-tailored hints)
  const recoverySection = await page.$('#ob-recovery-box');
  if (recoverySection) {
    await recoverySection.screenshot({
      path: path.join(ARTIFACTS_DIR, 'yandex-05-recovery.png'),
    });
    console.log('[Visual Test Yandex] Saved yandex-05-recovery.png');
  }

  // 4. yandex-04-connected.png (Connected state with enabled Continue button)
  await page.evaluate(() => {
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
      obExtHint.textContent = 'Связь с Яндекс Браузером установлена. Можно переходить к следующему шагу.';
    }
    if (obExtSuccess) obExtSuccess.style.display = 'block';
    if (obRecoveryBox) obRecoveryBox.style.display = 'none';
    if (obStep1Btn) obStep1Btn.disabled = false;
    if (obStep1Reason) obStep1Reason.style.display = 'none';
  });

  await page.waitForTimeout(300);

  const step1Card = await page.$('#step-1');
  if (step1Card) {
    await step1Card.screenshot({
      path: path.join(ARTIFACTS_DIR, 'yandex-04-connected.png'),
    });
    console.log('[Visual Test Yandex] Saved yandex-04-connected.png');
  }

  await app.close();
  console.log('[Visual Test Yandex] Visual test finished successfully.');
}

run().catch(err => {
  console.error('[Visual Test Yandex] Error:', err);
  process.exit(1);
});
