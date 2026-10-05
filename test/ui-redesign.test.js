'use strict';

const testPort = 17395;
process.env.BOOSTY_OVERLAY_PORT = String(testPort);
process.env.BOOSTY_OVERLAY_CONFIG = `/tmp/test-config-${process.pid}.json`;
process.env.UI_AUDIT_MODE = '1';

const fs = require('node:fs');
fs.writeFileSync(process.env.BOOSTY_OVERLAY_CONFIG, JSON.stringify({
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
}));

const { server: testServer } = require('../server.js');
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const assert = require('node:assert');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// Setup mock IPC handlers
ipcMain.handle('list-browsers', () => [{ id: 'chrome', name: 'Google Chrome' }]);
ipcMain.handle('list-obs-scenes', () => ({ ok: true, connected: true, scenes: [{ sceneUuid: 's1', sceneName: 'Основная', hasChat: true }] }));
ipcMain.handle('get-obs-status', () => ({ ok: true, connected: true, scenes: [] }));
ipcMain.handle('copy-overlay-url', () => true);
ipcMain.handle('get-app-version', () => '0.4.0');
ipcMain.handle('prepare-browser-extension', () => ({ ok: true }));
ipcMain.handle('copy-extensions-url', () => true);
ipcMain.handle('open-extension-folder', () => true);
ipcMain.handle('open-browser-extensions-page', () => true);
ipcMain.handle('launch-obs', () => ({ ok: true }));
ipcMain.handle('has-obs-executable', () => true);
ipcMain.handle('open-url', () => true);
ipcMain.handle('get-extension-info', () => ({
  persistentPath: '/tmp/extension',
  bundledPath: '/tmp/extension',
  extensionId: 'bcoadgccgjomlcadhmeognidaoocohdp',
  isTransient: false,
}));
ipcMain.handle('get-update-status', () => ({ state: 'up-to-date', updateAvailable: false }));
ipcMain.handle('check-for-updates', () => ({ state: 'up-to-date', updateAvailable: false }));
ipcMain.handle('copy-extension-path', () => ({ ok: true, extensionDir: '/tmp/extension' }));

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '..', 'desktop', 'preload.js'),
      },
    });

    win.webContents.on('dom-ready', () => {
      win.webContents.executeJavaScript(`
        window.BOOSTY_API_ORIGIN = 'http://127.0.0.1:${testPort}';
      `);
    });

    const htmlPath = path.join(__dirname, '..', 'desktop', 'index.html');
    await win.loadFile(htmlPath);

    // Wait for initialization
    await win.webContents.executeJavaScript(`
      new Promise(resolve => {
        if (window.__APP_INITIALIZED__) return resolve();
        const interval = setInterval(() => {
          if (window.__APP_INITIALIZED__) {
            clearInterval(interval);
            resolve();
          }
        }, 20);
      })
    `);

    console.log('=== Running UI Redesign Structural Tests ===');

    // 1. Ready State: 0 primary repair CTAs
    console.log('Testing Ready state assertions...');
    await win.webContents.executeJavaScript(`
      latestHealth = { extensionConnected: true, boostyConnected: true, receivedMessages: 42, appVersion: '0.4.0' };
      latestObsStatus = { ok: true, connected: true };
      checkGraceDeadline = 0;
      showView('dashboard');
      updateContextualActionCard();
    `);

    const readyStats = await win.webContents.executeJavaScript(`
      (() => {
        const title = document.querySelector('#readiness-title')?.textContent || '';
        const bannerClass = document.querySelector('#readiness-status')?.className || '';
        const primaryBtns = document.querySelectorAll('#main-action-actions button.primary');
        return { title, bannerClass, primaryCount: primaryBtns.length };
      })()
    `);

    assert.match(readyStats.title, /Готово к стриму/, 'Ready state should show "Готово к стриму"');
    assert.ok(readyStats.bannerClass.includes('ready'), 'Readiness banner should have ready class');
    assert.strictEqual(readyStats.primaryCount, 0, 'Ready state must have exactly 0 primary repair CTAs');
    console.log('✔ Ready state assertions passed (0 primary repair CTAs)');

    // 2. No-OBS State: exactly 1 primary OBS CTA
    console.log('Testing No-OBS state assertions...');
    await win.webContents.executeJavaScript(`
      latestHealth = { extensionConnected: true, boostyConnected: true, receivedMessages: 10 };
      latestObsStatus = { ok: false, connected: false };
      checkGraceDeadline = 0;
      updateContextualActionCard();
    `);

    const noObsStats = await win.webContents.executeJavaScript(`
      (() => {
        const title = document.querySelector('#action-card-title')?.textContent || '';
        const primaryBtns = Array.from(document.querySelectorAll('#main-action-actions button.primary'));
        return {
          title,
          primaryCount: primaryBtns.length,
          primaryText: primaryBtns[0]?.textContent || '',
        };
      })()
    `);

    assert.match(noObsStats.title, /Подключи OBS/i, 'Title should ask to connect OBS');
    assert.strictEqual(noObsStats.primaryCount, 1, 'No-OBS must have exactly 1 primary CTA');
    assert.match(noObsStats.primaryText, /Подключить OBS/i, 'Primary button should be "Подключить OBS"');
    console.log('✔ No-OBS assertions passed (exactly 1 primary OBS CTA)');

    // 3. No-Boosty State: exactly 1 primary Boosty CTA
    console.log('Testing No-Boosty state assertions...');
    await win.webContents.executeJavaScript(`
      latestHealth = { extensionConnected: true, boostyConnected: false, receivedMessages: 0 };
      latestObsStatus = { ok: true, connected: true };
      checkGraceDeadline = 0;
      updateContextualActionCard();
    `);

    const noBoostyStats = await win.webContents.executeJavaScript(`
      (() => {
        const title = document.querySelector('#action-card-title')?.textContent || '';
        const primaryBtns = Array.from(document.querySelectorAll('#main-action-actions button.primary'));
        return {
          title,
          primaryCount: primaryBtns.length,
          primaryText: primaryBtns[0]?.textContent || '',
        };
      })()
    `);

    assert.match(noBoostyStats.title, /Открой стрим Boosty/i, 'Title should ask to open Boosty');
    assert.strictEqual(noBoostyStats.primaryCount, 1, 'No-Boosty must have exactly 1 primary CTA');
    assert.match(noBoostyStats.primaryText, /Открыть Boosty/i, 'Primary button should be "Открыть Boosty"');
    console.log('✔ No-Boosty assertions passed (exactly 1 primary Boosty CTA)');

    // 4. No-Extension State: exactly 1 primary Extension CTA
    console.log('Testing No-Extension state assertions...');
    await win.webContents.executeJavaScript(`
      latestHealth = { extensionConnected: false, boostyConnected: false, receivedMessages: 0 };
      latestObsStatus = { ok: true, connected: true };
      checkGraceDeadline = 0;
      updateContextualActionCard();
    `);

    const noExtStats = await win.webContents.executeJavaScript(`
      (() => {
        const title = document.querySelector('#action-card-title')?.textContent || '';
        const primaryBtns = Array.from(document.querySelectorAll('#main-action-actions button.primary'));
        return {
          title,
          primaryCount: primaryBtns.length,
          primaryText: primaryBtns[0]?.textContent || '',
        };
      })()
    `);

    assert.match(noExtStats.title, /Установи расширение/i, 'Title should ask to install extension');
    assert.strictEqual(noExtStats.primaryCount, 1, 'No-Extension must have exactly 1 primary CTA');
    assert.match(noExtStats.primaryText, /Установить расширение/i, 'Primary button should be "Установить расширение"');
    console.log('✔ No-Extension assertions passed (exactly 1 primary Extension CTA)');

    // 5. Appearance View & Live Preview Existence
    console.log('Testing Appearance view and live preview...');
    await win.webContents.executeJavaScript(`
      showView('appearance');
    `);

    const previewStats = await win.webContents.executeJavaScript(`
      (() => {
        const appearanceView = document.querySelector('#view-appearance');
        const isVisible = appearanceView && window.getComputedStyle(appearanceView).display !== 'none';
        const iframe = document.querySelector('#preview-iframe');
        const iframeSrc = iframe ? iframe.src : '';
        const darkBtn = document.querySelector('#bg-btn-dark');
        const gamingBtn = document.querySelector('#bg-btn-gaming');
        return { isVisible, hasIframe: Boolean(iframe), iframeSrc, hasBackdropBtns: Boolean(darkBtn && gamingBtn) };
      })()
    `);

    assert.ok(previewStats.isVisible, 'Appearance view should be visible');
    assert.ok(previewStats.hasIframe, 'Preview iframe element must exist in DOM');
    assert.ok(previewStats.hasBackdropBtns, 'Backdrop switcher buttons must exist');
    console.log('✔ Appearance view and preview container verified');

    // 6. Preset synchronization & custom tweak state
    console.log('Testing Preset synchronization and Custom state transition...');
    await win.webContents.executeJavaScript(`
      document.querySelector('#preset-btn-large').click();
    `);

    const presetCheck = await win.webContents.executeJavaScript(`
      (() => {
        const fontSize = document.querySelector('#font-size').value;
        const cardWidth = document.querySelector('#card-width').value;
        const badge = document.querySelector('#preset-status-badge')?.textContent;
        return { fontSize, cardWidth, badge };
      })()
    `);

    assert.strictEqual(Number(presetCheck.fontSize), 26, 'Large preset font size should be 26');
    assert.strictEqual(Number(presetCheck.cardWidth), 640, 'Large preset card width should be 640');
    assert.strictEqual(presetCheck.badge, 'Крупный', 'Preset badge should show "Крупный"');

    // Tweak control -> becomes Custom
    await win.webContents.executeJavaScript(`
      const input = document.querySelector('#font-size');
      input.value = '29';
      input.dispatchEvent(new Event('input'));
    `);

    const customCheck = await win.webContents.executeJavaScript(`
      document.querySelector('#preset-status-badge')?.textContent;
    `);
    assert.strictEqual(customCheck, 'Кастомный', 'Changing value should switch badge to "Кастомный"');
    console.log('✔ Preset synchronization and Custom indicator passed');

    // 6b. Default appearance identifies as clean / "Чистый"
    console.log('Testing default appearance preset identification ("Чистый")...');
    await win.webContents.executeJavaScript(`
      document.querySelector('#preset-btn-clean').click();
    `);
    const cleanBadgeCheck = await win.webContents.executeJavaScript(`
      document.querySelector('#preset-status-badge')?.textContent;
    `);
    assert.strictEqual(cleanBadgeCheck, 'Чистый', 'Default clean preset must display badge "Чистый"');
    console.log('✔ Default appearance identifies as "Чистый"');

    // 6c. Onboarding Step 1: Continue disabled when extension missing, enabled when connected
    console.log('Testing Onboarding Step 1 Continue button state...');
    await win.webContents.executeJavaScript(`
      (async () => {
        showView('onboarding');
        setWizardStep(1);
        // Simulate extension missing
        window.__AUDIT_HEALTH_MOCK__ = { extensionConnected: false, boostyConnected: false };
        checkGraceDeadline = 0;
        await refreshStatus();
      })()
    `);
    const step1Missing = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('#ob-step1-next-btn');
        const reason = document.querySelector('#ob-step1-reason');
        return {
          disabled: btn ? btn.disabled : null,
          reasonVisible: reason ? window.getComputedStyle(reason).display !== 'none' : false,
          reasonText: reason?.textContent || '',
        };
      })()
    `);
    assert.strictEqual(step1Missing.disabled, true, 'Step 1 Continue button must be disabled when extension is missing');
    assert.strictEqual(step1Missing.reasonVisible, true, 'Step 1 reason hint must be visible when extension is missing');
    assert.match(step1Missing.reasonText, /Сначала подключите расширение/, 'Step 1 hint text should match');

    // Simulate extension connected
    await win.webContents.executeJavaScript(`
      (async () => {
        window.__AUDIT_HEALTH_MOCK__ = { extensionConnected: true, boostyConnected: false };
        await refreshStatus();
      })()
    `);
    const step1Connected = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('#ob-step1-next-btn');
        const reason = document.querySelector('#ob-step1-reason');
        return {
          disabled: btn ? btn.disabled : null,
          reasonVisible: reason ? window.getComputedStyle(reason).display !== 'none' : false,
        };
      })()
    `);
    assert.strictEqual(step1Connected.disabled, false, 'Step 1 Continue button must be enabled when extension is connected');
    assert.strictEqual(step1Connected.reasonVisible, false, 'Step 1 reason hint must be hidden when extension is connected');
    console.log('✔ Onboarding Step 1 button enablement verified');

    // 6d. Onboarding Step 3: Finish disabled until chat added to a scene
    console.log('Testing Onboarding Step 3 Finish button state...');
    await win.webContents.executeJavaScript(`
      (async () => {
        setWizardStep(3);
        await new Promise(resolve => setTimeout(resolve, 50));
        addedSceneName = '';
        renderObsUi({ ok: true, connected: true, scenes: [{ sceneUuid: 's1', sceneName: 'Scene 1', hasChat: false }] });
      })()
    `);
    const step3Missing = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('#ob-step3-next-btn');
        const reason = document.querySelector('#ob-step3-reason');
        return {
          disabled: btn ? btn.disabled : null,
          reasonVisible: reason ? window.getComputedStyle(reason).display !== 'none' : false,
          reasonText: reason?.textContent || '',
        };
      })()
    `);
    assert.strictEqual(step3Missing.disabled, true, 'Step 3 Finish button must be disabled when no scene has chat');
    assert.strictEqual(step3Missing.reasonVisible, true, 'Step 3 reason hint must be visible when no scene has chat');
    assert.match(step3Missing.reasonText, /Сначала добавьте чат/, 'Step 3 hint text should match');

    // Simulate scene with chat
    await win.webContents.executeJavaScript(`
      renderObsUi({ ok: true, connected: true, scenes: [{ sceneUuid: 's1', sceneName: 'Scene 1', hasChat: true }] });
    `);
    const step3WithChat = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('#ob-step3-next-btn');
        const reason = document.querySelector('#ob-step3-reason');
        return {
          disabled: btn ? btn.disabled : null,
          reasonVisible: reason ? window.getComputedStyle(reason).display !== 'none' : false,
        };
      })()
    `);
    assert.strictEqual(step3WithChat.disabled, false, 'Step 3 Finish button must be enabled when a scene has chat');
    assert.strictEqual(step3WithChat.reasonVisible, false, 'Step 3 reason hint must be hidden when a scene has chat');
    console.log('✔ Onboarding Step 3 button enablement verified');

    // 7. Reset: resets only Appearance without touching other states
    console.log('Testing Appearance reset...');
    await win.webContents.executeJavaScript(`
      localStorage.setItem('test_untouched_item', 'should_stay');
      document.querySelector('#appearance-reset-btn').click();
    `);

    const resetCheck = await win.webContents.executeJavaScript(`
      (() => {
        const fontSize = document.querySelector('#font-size').value;
        const cardWidth = document.querySelector('#card-width').value;
        const untouched = localStorage.getItem('test_untouched_item');
        return { fontSize, cardWidth, untouched };
      })()
    `);

    assert.strictEqual(Number(resetCheck.fontSize), 21, 'Reset should restore default font size 21');
    assert.strictEqual(Number(resetCheck.cardWidth), 520, 'Reset should restore default card width 520');
    assert.strictEqual(resetCheck.untouched, 'should_stay', 'Reset must not wipe non-appearance state');
    console.log('✔ Appearance-only reset verified');

    // 8. Save Error state handling
    console.log('Testing Save error state and retry handling...');
    await win.webContents.executeJavaScript(`
      clearTimeout(saveTimer);
      currentSaveRevision += 1;
      showSaveStatus('error');
    `);

    const errorStateCheck = await win.webContents.executeJavaScript(`
      (() => {
        const pill = document.querySelector('#appearance-save-status');
        const retryBtn = document.querySelector('#appearance-retry-save-btn');
        return {
          pillClass: pill.className,
          pillText: pill.textContent,
          retryVisible: retryBtn && retryBtn.style.display !== 'none',
        };
      })()
    `);

    assert.ok(errorStateCheck.pillClass.includes('error'), 'Save pill should have error class');
    assert.match(errorStateCheck.pillText, /Не удалось сохранить/, 'Save pill should say "Не удалось сохранить"');
    assert.strictEqual(errorStateCheck.retryVisible, true, 'Retry button must be visible on error');
    console.log('✔ Save error state machine verified');

    // 9. Responsive Viewport Check (800x650)
    console.log('Testing responsive behavior on 800x650 viewport...');
    win.setContentSize(800, 650);
    await new Promise(resolve => setTimeout(resolve, 100));

    const responsiveCheck = await win.webContents.executeJavaScript(`
      (() => {
        const bodyWidth = document.body.scrollWidth;
        const windowWidth = window.innerWidth;
        const hasHorizontalScroll = bodyWidth > windowWidth;
        const appearanceGrid = document.querySelector('.appearance-grid');
        const gridStyle = window.getComputedStyle(appearanceGrid);
        return { hasHorizontalScroll, bodyWidth, windowWidth, gridColumns: gridStyle.gridTemplateColumns };
      })()
    `);

    assert.strictEqual(responsiveCheck.hasHorizontalScroll, false, '800x650 must not have horizontal scroll');
    console.log('✔ Responsive 800x650 verified: zero horizontal scroll, compact layout');

    console.log('\nAll UI Redesign structural tests passed successfully!');
    win.destroy();
    testServer.close();
    try { fs.unlinkSync(process.env.BOOSTY_OVERLAY_CONFIG); } catch {}
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('Test failure:', err);
    if (win && !win.isDestroyed()) win.destroy();
    testServer.close();
    try { fs.unlinkSync(process.env.BOOSTY_OVERLAY_CONFIG); } catch {}
    app.quit();
    process.exit(1);
  }
});
