'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('playwright');

const projectRoot = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts/install-guide');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function run() {
  console.log('[Visual Test Install Guide v2] Starting visual QA...');

  const testUserData = path.join(os.tmpdir(), `boosty-install-guide-${Date.now()}`, 'Boosty Chat Overlay Fresh');
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
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // Ensure Onboarding Step 1 is active
  await page.waitForSelector('#step-1.wizard-panel.active', { state: 'visible' });

  // Select Yandex Browser if available in buttons
  await page.evaluate(() => {
    const yandexBtn = Array.from(document.querySelectorAll('.browser-choice-btn')).find(b => b.textContent.includes('Яндекс'));
    if (yandexBtn) {
      yandexBtn.click();
    }
  });
  await page.waitForTimeout(300);

  // 1. install-guide-01-three-steps.png (clean 3 steps, Yandex selected, 1280x850)
  const step1Card = await page.$('#step-1');
  if (step1Card) {
    await step1Card.screenshot({
      path: path.join(ARTIFACTS_DIR, 'install-guide-01-three-steps.png'),
    });
    console.log('✓ Saved install-guide-01-three-steps.png');
  }

  // Also capture compact viewport 800x650
  await page.setViewportSize({ width: 800, height: 650 });
  await page.waitForTimeout(300);
  if (step1Card) {
    await step1Card.screenshot({
      path: path.join(ARTIFACTS_DIR, 'install-guide-01-three-steps-800x650.png'),
    });
    console.log('✓ Saved install-guide-01-three-steps-800x650.png');
  }

  // Reset to standard 1280x850
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.waitForTimeout(300);

  // 2. install-guide-02-folder-opened.png ("Папка открыта в проводнике" visible)
  await page.evaluate(() => {
    const hint = document.querySelector('#ob-folder-opened-hint');
    if (hint) hint.style.display = 'inline-flex';
  });
  await page.waitForTimeout(200);
  const card3 = await page.$('.ob-step-card[data-step="3"]');
  if (card3) {
    await card3.screenshot({
      path: path.join(ARTIFACTS_DIR, 'install-guide-02-folder-opened.png'),
    });
    console.log('✓ Saved install-guide-02-folder-opened.png');
  }

  // 3. install-guide-03-waiting.png (live status: Ожидаем подключение…)
  const statusBox = await page.$('#ob-ext-status-box');
  if (statusBox) {
    await statusBox.screenshot({
      path: path.join(ARTIFACTS_DIR, 'install-guide-03-waiting.png'),
    });
    console.log('✓ Saved install-guide-03-waiting.png');
  }

  // 4. install-guide-04-connected.png (status: ✓ Расширение подключено, Continue active)
  await page.route('**/health', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        server: true,
        extensionConnected: true,
        extensionVersion: '0.5.0',
        extension: { state: 'connected', version: '0.5.0', lastSeenAt: Date.now() },
        boostyConnected: false,
        boosty: { state: 'unavailable' },
        obsConnected: false,
      }),
    });
  });

  await page.evaluate(async () => {
    if (typeof refreshStatus === 'function') {
      await refreshStatus();
    }
  });
  await page.waitForTimeout(500);
  if (step1Card) {
    await step1Card.screenshot({
      path: path.join(ARTIFACTS_DIR, 'install-guide-04-connected.png'),
    });
    console.log('✓ Saved install-guide-04-connected.png');
  }

  // 5. install-guide-05-manual-fallback.png (accordion open, path & copy button visible)
  await page.evaluate(() => {
    // Reset completed styles and open details
    const threeSteps = document.querySelector('#ob-three-steps-container');
    if (threeSteps) threeSteps.classList.remove('ob-steps-completed');
    const fallback = document.querySelector('#ob-manual-fallback');
    if (fallback) fallback.open = true;
    const pathEl = document.querySelector('#ob-ext-folder-path');
    if (pathEl) pathEl.textContent = '/home/fedor/projects/boosty-chat-overlay/extension';
  });
  await page.waitForTimeout(300);
  const fallbackEl = await page.$('#ob-manual-fallback');
  if (fallbackEl) {
    await fallbackEl.screenshot({
      path: path.join(ARTIFACTS_DIR, 'install-guide-05-manual-fallback.png'),
    });
    console.log('✓ Saved install-guide-05-manual-fallback.png');
  }

  // 6. install-guide-06-recovery.png (recovery card after timeout)
  await page.route('**/health', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        server: true,
        extensionConnected: false,
        extension: { state: 'unavailable' },
        boostyConnected: false,
        obsConnected: false,
      }),
    });
  });

  await page.evaluate(async () => {
    // Simulate 20s elapsed on Step 1
    if (typeof obStep1EnteredAt !== 'undefined') {
      obStep1EnteredAt = Date.now() - 20000;
    }
    const obRecoveryBox = document.querySelector('#ob-recovery-box');
    if (obRecoveryBox) obRecoveryBox.style.display = 'block';
    if (typeof refreshStatus === 'function') {
      await refreshStatus();
    }
    if (obRecoveryBox) obRecoveryBox.style.display = 'block';
  });
  await page.waitForTimeout(500);
  const recoveryEl = await page.$('#ob-recovery-box');
  if (recoveryEl) {
    await recoveryEl.screenshot({
      path: path.join(ARTIFACTS_DIR, 'install-guide-06-recovery.png'),
    });
    console.log('✓ Saved install-guide-06-recovery.png');
  }

  // 7. install-guide-07-already-connected.png (pre-connected banner state)
  await page.evaluate(() => {
    const banner = document.querySelector('#ob-ext-already-connected-banner');
    const threeSteps = document.querySelector('#ob-three-steps-container');
    const fallback = document.querySelector('#ob-manual-fallback');
    const recovery = document.querySelector('#ob-recovery-box');
    if (banner) banner.style.display = 'flex';
    if (threeSteps) threeSteps.style.display = 'none';
    if (fallback) fallback.style.display = 'none';
    if (recovery) recovery.style.display = 'none';
  });
  await page.waitForTimeout(300);
  if (step1Card) {
    await step1Card.screenshot({
      path: path.join(ARTIFACTS_DIR, 'install-guide-07-already-connected.png'),
    });
    console.log('✓ Saved install-guide-07-already-connected.png');
  }

  await app.close();
  console.log('[Visual Test Install Guide v2] Complete. All artifacts saved.');
}

run().catch((err) => {
  console.error('[Visual Test Install Guide v2] Failed:', err);
  process.exit(1);
});
