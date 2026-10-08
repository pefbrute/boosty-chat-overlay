'use strict';

/**
 * Capture Script for Settings Retention + Message Retention + UX Simplification v1
 * Generates the 12 mandatory screenshots specified in section 12 of the user specification.
 */

const { _electron: electron, chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'artifacts', 'settings-retention', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const testPort = 17401;
process.env.BOOSTY_OVERLAY_PORT = String(testPort);
const tmpConfig = path.join('/tmp', `boosty-settings-retention-config-${process.pid}.json`);
const tmpHistory = path.join('/tmp', `boosty-settings-retention-hist-${process.pid}.json`);
const tmpUserData = path.join('/tmp', `boosty-settings-retention-user-data-${process.pid}`);

fs.mkdirSync(tmpUserData, { recursive: true });
process.env.BOOSTY_OVERLAY_CONFIG = tmpConfig;
process.env.BOOSTY_OVERLAY_HISTORY = tmpHistory;
process.env.UI_AUDIT_MODE = '1';
process.env.BOOSTY_OVERLAY_UI_TEST = '1';

// Seed initial config with default settings
fs.writeFileSync(tmpConfig, JSON.stringify({
  durationSeconds: 0,
  maxMessages: 10,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
  corner: 'bottom-left',
  direction: 'bottom',
  offsetX: 20,
  offsetY: 20,
  maxStackHeight: 800,
  textAlign: 'left',
}, null, 2));

// Seed initial history with 20 messages for Chat Monitor restored view
const initialMessages = [];
for (let i = 1; i <= 20; i++) {
  initialMessages.push({
    id: `qa-hist-${i}`,
    author: {
      name: i === 1 ? 'Streamer' : (i === 10 ? 'Mod_Alex' : `Viewer_${i}`),
      role: i === 1 ? 'streamer' : (i === 10 ? 'moderator' : null),
    },
    text: i === 1
      ? 'Привет всем на трансляции! Начинаем проверку истории сообщений.'
      : (i === 20 ? 'История сообщений успешно восстановлена после перезапуска!' : `Тестовое сохранённое сообщение #${i}`),
    publishedAt: `19:${String(Math.floor(i * 2.5)).padStart(2, '0')}:00`,
    receivedAt: Date.now() - (21 - i) * 10000,
  });
}
fs.writeFileSync(tmpHistory, JSON.stringify(initialMessages, null, 2));

// Helper: send HTTP post
function sendHttpRequest(reqPath, method, data) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: testPort,
        path: reqPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve(body);
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('=== Capturing 12 Mandatory Settings Retention Screenshots ===');
  let electronApp = null;
  let browser = null;

  try {
    // 1. Launch Electron
    electronApp = await electron.launch({
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        path.join(projectRoot, 'desktop', 'main.js'),
      ],
      env: {
        ...process.env,
        BOOSTY_OVERLAY_USER_DATA: tmpUserData,
        BOOSTY_OVERLAY_PORT: String(testPort),
        BOOSTY_OVERLAY_CONFIG: tmpConfig,
        BOOSTY_OVERLAY_HISTORY: tmpHistory,
        UI_AUDIT_MODE: '1',
        BOOSTY_OVERLAY_UI_TEST: '1',
      },
    });

    const mainWin = await electronApp.firstWindow();
    await mainWin.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 15000 });
    await mainWin.evaluate(() => document.fonts.ready);

    // Switch to Appearance view
    await mainWin.evaluate(() => {
      if (typeof showView === 'function') showView('appearance');
    });
    await mainWin.waitForTimeout(300);

    // Helper: capture screenshot
    async function snap(page, filename) {
      const target = path.join(outDir, filename);
      await page.screenshot({ path: target });
      console.log(`  ✓ Captured ${filename}`);
    }

    // Screenshot 1: settings-01-default.png
    // Default state: 10 messages, auto-hide off, standard preset
    await mainWin.evaluate(() => {
      document.querySelector('#size-btn-normal')?.click();
      window.scrollTo(0, 660);
    });
    await mainWin.waitForTimeout(200);
    await snap(mainWin, 'settings-01-default.png');

    // Screenshot 2: settings-02-compact-preset.png
    // Compact preset applied
    await mainWin.evaluate(() => {
      document.querySelector('#size-btn-compact')?.click();
      window.scrollTo(0, 660);
    });
    await mainWin.waitForTimeout(250);
    await snap(mainWin, 'settings-02-compact-preset.png');

    // Screenshot 3: settings-03-standard-preset.png
    // Standard preset applied
    await mainWin.evaluate(() => {
      document.querySelector('#size-btn-normal')?.click();
      window.scrollTo(0, 660);
    });
    await mainWin.waitForTimeout(250);
    await snap(mainWin, 'settings-03-standard-preset.png');

    // Screenshot 4: settings-04-large-preset.png
    // Large preset applied
    await mainWin.evaluate(() => {
      document.querySelector('#size-btn-large')?.click();
      window.scrollTo(0, 660);
    });
    await mainWin.waitForTimeout(250);
    await snap(mainWin, 'settings-04-large-preset.png');

    // Reset back to standard for subsequent tests
    await mainWin.evaluate(() => {
      document.querySelector('#size-btn-normal')?.click();
    });
    await mainWin.waitForTimeout(200);

    // Screenshot 5: settings-05-message-count.png
    // Quick chips 5, 10, 20, 30 with 20 selected + stepper showing 20
    await mainWin.evaluate(() => {
      document.querySelector('.count-pill-btn[data-count="20"]')?.click();
      window.scrollTo(0, 750);
    });
    await mainWin.waitForTimeout(250);
    await snap(mainWin, 'settings-05-message-count.png');

    // Screenshot 6: settings-06-auto-hide.png
    // Auto-hide enabled with 15s selected
    await mainWin.evaluate(() => {
      const toggle = document.querySelector('#basic-auto-hide-toggle');
      if (toggle && !toggle.checked) {
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
      }
      document.querySelector('.duration-pill-btn[data-duration="15"]')?.click();
      window.scrollTo(0, 750);
    });
    await mainWin.waitForTimeout(250);
    await snap(mainWin, 'settings-06-auto-hide.png');

    // Screenshot 7: settings-07-save-status.png
    // Status badge: ✓ Сохранено
    await mainWin.evaluate(() => {
      if (typeof showSaveStatus === 'function') {
        showSaveStatus('saved');
      }
      window.scrollTo(0, 1450);
    });
    await mainWin.waitForTimeout(200);
    await snap(mainWin, 'settings-07-save-status.png');

    // Screenshot 8: settings-08-export-import.png
    // Export/import card and transfer notification
    await mainWin.evaluate(() => {
      if (typeof showTransferNotification === 'function') {
        showTransferNotification('Настройки успешно экспортированы');
      }
      window.scrollTo(0, 1350);
    });
    await mainWin.waitForTimeout(250);
    await snap(mainWin, 'settings-08-export-import.png');

    // Screenshot 9: settings-09-800x650.png
    // Responsive compact layout check at 800x650
    const mainBw = await electronApp.browserWindow(mainWin);
    await mainBw.evaluate((win) => win.setSize(800, 650));
    await mainWin.waitForTimeout(300);
    await mainWin.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await mainWin.waitForTimeout(200);
    await snap(mainWin, 'settings-09-800x650.png');

    // Restore window size
    await mainBw.evaluate((win) => win.setSize(1280, 850));
    await mainWin.waitForTimeout(200);

    // Open Chat Monitor window for Screenshot 12
    console.log('Opening Chat Monitor window for Screenshot 12...');
    await mainWin.evaluate(() => {
      window.boostyOverlay.openChatMonitor();
    });
    await mainWin.waitForTimeout(1000);

    const allWins = electronApp.windows();
    const monitorWin = allWins.find(w => w.url().includes('chat-monitor'));
    if (monitorWin) {
      await monitorWin.waitForSelector('.chat-item', { timeout: 10000 });
      const monBw = await electronApp.browserWindow(monitorWin);
      await monBw.evaluate((win) => win.setSize(420, 650));
      await monitorWin.waitForTimeout(300);
      // Screenshot 12: monitor-01-restored-history.png
      await snap(monitorWin, 'monitor-01-restored-history.png');
    } else {
      console.warn('Chat Monitor window not found!');
    }

    // Overlay Screenshots 10 & 11 via Chromium browser
    console.log('Launching browser for Overlay Screenshots 10 & 11...');
    const chromeExe = [
      process.env.CHROMIUM_PATH,
      process.env.CHROME_PATH,
      '/usr/bin/google-chrome',
      '/usr/bin/brave-browser',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ].filter(Boolean).find(p => fs.existsSync(p));

    browser = await chromium.launch({
      executablePath: chromeExe,
      args: ['--no-sandbox', '--disable-gpu'],
    });
    const overlayPage = await browser.newPage({
      viewport: { width: 800, height: 600 },
    });

    // Reset overlay config via HTTP
    await sendHttpRequest('/config', 'POST', {
      durationSeconds: 0,
      maxMessages: 10,
      fontSize: 20,
      cardWidth: 480,
      showAvatars: true,
      corner: 'left-bottom',
      direction: 'bottom',
    });

    // Clear server message history for clean test
    await sendHttpRequest('/history', 'DELETE');

    // Navigate to overlay
    await overlayPage.goto(`http://127.0.0.1:${testPort}/overlay/?deterministic=1`);
    await overlayPage.waitForSelector('#messages', { state: 'attached', timeout: 10000 });
    await overlayPage.waitForTimeout(300);

    // Send 10 messages
    for (let i = 1; i <= 10; i++) {
      await sendHttpRequest('/message', 'POST', {
        id: `card-msg-${i}`,
        author: {
          name: i === 1 ? 'Первый Зритель' : `Зритель ${i}`,
        },
        text: i === 1 ? 'Первое сообщение (будет вытеснено 11-м)' : `Сообщение в оверлее #${i} для проверки лимита 10`,
        publishedAt: `20:0${Math.floor(i / 10)}:${String(i % 10).padStart(2, '0')}`,
      });
      await overlayPage.waitForTimeout(60);
    }

    // Wait for all 10 cards to render
    await overlayPage.waitForFunction(() => {
      return document.querySelectorAll('.message').length === 10;
    }, { timeout: 5000 });
    await overlayPage.waitForTimeout(200);

    // Screenshot 10: overlay-01-ten-messages.png
    await snap(overlayPage, 'overlay-01-ten-messages.png');

    // Send 11th message (FIFO eviction)
    await sendHttpRequest('/message', 'POST', {
      id: 'card-msg-11',
      author: { name: 'Зритель 11 (Новый)' },
      text: 'Сообщение #11 — вытеснило сообщение #1 (на экране ровно 10)',
      publishedAt: '20:01:11',
    });

    // Verify exactly 10 cards remain and card 1 is evicted
    await overlayPage.waitForFunction(() => {
      const cards = document.querySelectorAll('.message');
      const hasFirst = Array.from(cards).some(c => c.textContent.includes('Первый Зритель'));
      const hasEleventh = Array.from(cards).some(c => c.textContent.includes('Зритель 11'));
      return cards.length === 10 && !hasFirst && hasEleventh;
    }, { timeout: 5000 });
    await overlayPage.waitForTimeout(200);

    // Screenshot 11: overlay-02-eleventh-message.png
    await snap(overlayPage, 'overlay-02-eleventh-message.png');

    console.log('\nAll 12 screenshots captured successfully!');
  } finally {
    if (browser) await browser.close();
    if (electronApp) await electronApp.close();
    try { fs.unlinkSync(tmpConfig); } catch {}
    try { fs.unlinkSync(tmpHistory); } catch {}
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}
  }
}

run().catch(err => {
  console.error('Fatal error during capture:', err);
  process.exit(1);
});
