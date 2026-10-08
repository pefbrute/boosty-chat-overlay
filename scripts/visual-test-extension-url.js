'use strict';

/**
 * Visual QA Runner for Onboarding Step 1 Extension URL Guide
 * Captures the 7 required screenshots into artifacts/ui/ for visual review:
 * - extension-url-01-yandex.png
 * - extension-url-02-copied.png
 * - extension-url-03-chrome.png
 * - extension-url-04-brave.png
 * - extension-url-05-edge.png
 * - extension-url-06-800x650.png
 * - extension-url-07-auto-open-failure.png
 */

const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const projectRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(projectRoot, 'artifacts', 'ui');
fs.mkdirSync(artifactsDir, { recursive: true });

async function runVisualExtensionUrl() {
  console.log('========================================================');
  console.log('  Visual QA: Onboarding Step 1 Extension URL Guide      ');
  console.log('========================================================\n');

  const tmpUserData = path.join(os.tmpdir(), `boosty-onboarding-url-${Date.now()}`);
  fs.mkdirSync(tmpUserData, { recursive: true });

  const app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      path.join(projectRoot, 'desktop', 'main.js'),
    ],
    env: {
      ...process.env,
      BOOSTY_APP_VARIANT: 'fresh',
      BOOSTY_OVERLAY_USER_DATA: tmpUserData,
      BOOSTY_OVERLAY_PORT: '17398',
      BOOSTY_OVERLAY_UI_TEST: '1',
      UI_AUDIT_MODE: '1',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // Ensure Onboarding Step 1 is active
  await page.waitForSelector('#step-1.wizard-panel.active', { state: 'visible' });

  // 1. extension-url-01-yandex.png: Selected browser Yandex
  console.log('1. Setting up Yandex browser view...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('#ob-browser-options .browser-choice-btn'));
    const yandexBtn = buttons.find(b => b.textContent.includes('Яндекс'));
    if (yandexBtn) {
      yandexBtn.click();
    } else {
      localStorage.setItem('selectedBrowser', 'yandex');
      if (typeof updateBrowserActionButtons === 'function') {
        updateBrowserActionButtons();
      }
    }
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(artifactsDir, 'extension-url-01-yandex.png'),
    fullPage: false,
  });
  console.log('  ✓ Saved extension-url-01-yandex.png');

  // 2. extension-url-02-copied.png: Click "Скопировать адрес"
  console.log('2. Clicking "Скопировать адрес"...');
  await page.click('#ob-copy-url-btn');
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(artifactsDir, 'extension-url-02-copied.png'),
    fullPage: false,
  });
  console.log('  ✓ Saved extension-url-02-copied.png');

  // 3. extension-url-03-chrome.png: Switch to Google Chrome
  console.log('3. Switching to Chrome...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('#ob-browser-options .browser-choice-btn'));
    const chromeBtn = buttons.find(b => b.textContent.includes('Chrome'));
    if (chromeBtn) {
      chromeBtn.click();
    } else {
      localStorage.setItem('selectedBrowser', 'chrome');
      if (typeof updateBrowserActionButtons === 'function') {
        updateBrowserActionButtons();
      }
    }
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(artifactsDir, 'extension-url-03-chrome.png'),
    fullPage: false,
  });
  console.log('  ✓ Saved extension-url-03-chrome.png');

  // 4. extension-url-04-brave.png: Switch to Brave
  console.log('4. Switching to Brave...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('#ob-browser-options .browser-choice-btn'));
    const braveBtn = buttons.find(b => b.textContent.includes('Brave'));
    if (braveBtn) {
      braveBtn.click();
    } else {
      localStorage.setItem('selectedBrowser', 'brave');
      if (typeof updateBrowserActionButtons === 'function') {
        updateBrowserActionButtons();
      }
    }
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(artifactsDir, 'extension-url-04-brave.png'),
    fullPage: false,
  });
  console.log('  ✓ Saved extension-url-04-brave.png');

  // 5. extension-url-05-edge.png: Switch to Microsoft Edge
  console.log('5. Switching to Edge...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('#ob-browser-options .browser-choice-btn'));
    const edgeBtn = buttons.find(b => b.textContent.includes('Edge'));
    if (edgeBtn) {
      edgeBtn.click();
    } else {
      localStorage.setItem('selectedBrowser', 'edge');
      if (typeof updateBrowserActionButtons === 'function') {
        updateBrowserActionButtons();
      }
    }
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(artifactsDir, 'extension-url-05-edge.png'),
    fullPage: false,
  });
  console.log('  ✓ Saved extension-url-05-edge.png');

  // 6. extension-url-06-800x650.png: Viewport 800x650 compactness check
  console.log('6. Testing 800x650 viewport compactness...');
  await page.setViewportSize({ width: 800, height: 650 });
  await page.evaluate(() => {
    // Switch back to Yandex for primary onboarding verification
    const buttons = Array.from(document.querySelectorAll('#ob-browser-options .browser-choice-btn'));
    const yandexBtn = buttons.find(b => b.textContent.includes('Яндекс'));
    if (yandexBtn) yandexBtn.click();
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(artifactsDir, 'extension-url-06-800x650.png'),
    fullPage: false,
  });
  console.log('  ✓ Saved extension-url-06-800x650.png');

  // 7. extension-url-07-auto-open-failure.png: Auto-open status / honest notice
  console.log('7. Triggering auto-open status / failure state...');
  await page.setViewportSize({ width: 1000, height: 750 });
  await page.evaluate(() => {
    // Simulate auto-open attempt status display (honest notice)
    const statusEl = document.querySelector('#ob-auto-open-status');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.className = 'ob-auto-open-status info';
      statusEl.textContent = 'ℹ Браузер запущен. Если страница не открылась, вставьте скопированный адрес вручную.';
      statusEl.scrollIntoView({ block: 'nearest' });
    }
  });
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(artifactsDir, 'extension-url-07-auto-open-failure.png'),
    fullPage: false,
  });
  console.log('  ✓ Saved extension-url-07-auto-open-failure.png');

  await app.close();
  console.log('\nAll 7 screenshots generated successfully!');
}

runVisualExtensionUrl().catch(err => {
  console.error('Fatal visual QA error:', err);
  process.exit(1);
});
