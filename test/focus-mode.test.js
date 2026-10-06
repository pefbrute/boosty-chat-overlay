'use strict';

const testPort = 17396;
process.env.BOOSTY_OVERLAY_PORT = String(testPort);
process.env.BOOSTY_OVERLAY_CONFIG = `/tmp/test-config-focus-${process.pid}.json`;
process.env.UI_AUDIT_MODE = '1';

const fs = require('node:fs');
fs.writeFileSync(process.env.BOOSTY_OVERLAY_CONFIG, JSON.stringify({
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
  cardWidth: 520,
  borderRadius: 10,
  cardPadding: 10,
  messageGap: 10,
  avatarSize: 42,
}));

const { server: testServer } = require('../server.js');
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const assert = require('node:assert');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// Mock IPC handlers
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
ipcMain.handle('get-obs-connection-config', () => ({ host: '127.0.0.1', port: 4455, password: '' }));
ipcMain.handle('set-obs-connection-config', () => ({ ok: true }));

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 850,
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

    console.log('=== Running Focus Mode (Appearance) Integration Tests ===');

    // 1. Switch to Appearance view and ensure clean default preference
    await win.webContents.executeJavaScript(`
      localStorage.removeItem('boosty_appearance_ui_mode');
      if (typeof initAppearanceUiMode === 'function') initAppearanceUiMode();
      showView('appearance');
    `);

    // 2. Default mode is 'basic'
    const initialMode = await win.webContents.executeJavaScript(`
      (() => {
        const col = document.querySelector('#appearance-settings-col');
        const basicBtn = document.querySelector('#mode-btn-basic');
        const advancedBtn = document.querySelector('#mode-btn-advanced');
        const hasBasicClass = col?.classList.contains('mode-basic');
        const basicActive = basicBtn?.classList.contains('active');
        const advancedActive = advancedBtn?.classList.contains('active');
        return { hasBasicClass, basicActive, advancedActive };
      })()
    `);

    assert.strictEqual(initialMode.hasBasicClass, true, '#appearance-settings-col must have .mode-basic by default');
    assert.strictEqual(initialMode.basicActive, true, '#mode-btn-basic must be active by default');
    assert.strictEqual(initialMode.advancedActive, false, '#mode-btn-advanced must not be active');
    console.log('✔ Default mode is Basic (Focus Mode)');

    // 3. DOM Visibility in Basic Mode: advanced-only elements are hidden, basic-only are visible
    const basicVisibility = await win.webContents.executeJavaScript(`
      (() => {
        const presetCard = document.querySelector('.preset-card');
        const basicSizeCard = document.querySelector('#basic-size-card');
        const basicMessagesCard = document.querySelector('#basic-messages-card');
        const advMessagesCard = document.querySelector('#advanced-messages-card');
        const textCard = document.querySelector('#appearance-settings-col .settings-group-card.advanced-only');
        const moreBtn = document.querySelector('#basic-more-settings-btn');
        const backBtn = document.querySelector('#advanced-back-to-basic-btn');

        return {
          presetCardHidden: window.getComputedStyle(presetCard).display === 'none',
          basicSizeVisible: window.getComputedStyle(basicSizeCard).display !== 'none',
          basicMessagesVisible: window.getComputedStyle(basicMessagesCard).display !== 'none',
          advMessagesHidden: window.getComputedStyle(advMessagesCard).display === 'none',
          textCardHidden: window.getComputedStyle(textCard).display === 'none',
          moreBtnVisible: window.getComputedStyle(moreBtn).display !== 'none',
          backBtnHidden: window.getComputedStyle(backBtn).display === 'none',
        };
      })()
    `);

    assert.strictEqual(basicVisibility.presetCardHidden, true, 'Presets bar must be hidden in Basic mode');
    assert.strictEqual(basicVisibility.basicSizeVisible, true, 'Basic size card must be visible in Basic mode');
    assert.strictEqual(basicVisibility.basicMessagesVisible, true, 'Basic messages card must be visible in Basic mode');
    assert.strictEqual(basicVisibility.advMessagesHidden, true, 'Advanced messages card must be hidden in Basic mode');
    assert.strictEqual(basicVisibility.textCardHidden, true, 'Text settings card must be hidden in Basic mode');
    assert.strictEqual(basicVisibility.moreBtnVisible, true, 'More settings button must be visible in Basic mode');
    assert.strictEqual(basicVisibility.backBtnHidden, true, 'Back button must be hidden in Basic mode');
    console.log('✔ DOM element visibility in Basic mode passed');

    // 4. Mode Switcher: Click Advanced
    await win.webContents.executeJavaScript(`
      document.querySelector('#mode-btn-advanced').click();
    `);

    const advancedVisibility = await win.webContents.executeJavaScript(`
      (() => {
        const col = document.querySelector('#appearance-settings-col');
        const presetCard = document.querySelector('.preset-card');
        const basicSizeCard = document.querySelector('#basic-size-card');
        const advMessagesCard = document.querySelector('#advanced-messages-card');
        const storedMode = localStorage.getItem('boosty_appearance_ui_mode');

        return {
          hasAdvClass: col?.classList.contains('mode-advanced'),
          presetCardVisible: window.getComputedStyle(presetCard).display !== 'none',
          basicSizeHidden: window.getComputedStyle(basicSizeCard).display === 'none',
          advMessagesVisible: window.getComputedStyle(advMessagesCard).display !== 'none',
          storedMode,
        };
      })()
    `);

    assert.strictEqual(advancedVisibility.hasAdvClass, true, '#appearance-settings-col must have .mode-advanced');
    assert.strictEqual(advancedVisibility.presetCardVisible, true, 'Presets bar must be visible in Advanced mode');
    assert.strictEqual(advancedVisibility.basicSizeHidden, true, 'Basic size card must be hidden in Advanced mode');
    assert.strictEqual(advancedVisibility.advMessagesVisible, true, 'Advanced messages card must be visible in Advanced mode');
    assert.strictEqual(advancedVisibility.storedMode, 'advanced', 'Mode preference must be saved to localStorage');
    console.log('✔ Mode switch to Advanced passed');

    // 5. Progressive Disclosure: Click "Back to basic"
    await win.webContents.executeJavaScript(`
      document.querySelector('#advanced-back-to-basic-btn').click();
    `);

    const switchedBack = await win.webContents.executeJavaScript(`
      (() => {
        const col = document.querySelector('#appearance-settings-col');
        const storedMode = localStorage.getItem('boosty_appearance_ui_mode');
        return {
          hasBasicClass: col?.classList.contains('mode-basic'),
          storedMode,
        };
      })()
    `);

    assert.strictEqual(switchedBack.hasBasicClass, true, 'Should switch back to .mode-basic');
    assert.strictEqual(switchedBack.storedMode, 'basic', 'Should persist basic mode');
    console.log('✔ Back to Basic button passed');

    // 6. Basic Controls -> Config Update: Stepper
    await win.webContents.executeJavaScript(`
      document.querySelector('#basic-max-msgs-dec').click();
    `);

    const stepperCheck = await win.webContents.executeJavaScript(`
      (() => {
        const basicVal = document.querySelector('#basic-max-messages-val')?.textContent;
        const advVal = document.querySelector('#max-messages')?.value;
        const advValDisplay = document.querySelector('#max-messages-val')?.textContent;
        return { basicVal, advVal, advValDisplay };
      })()
    `);

    assert.strictEqual(stepperCheck.basicVal, '5', 'Stepper decrements to 5');
    assert.strictEqual(stepperCheck.advVal, '5', 'Underlying input synced to 5');
    assert.strictEqual(stepperCheck.advValDisplay, '5', 'Label display synced to 5');
    console.log('✔ Stepper decrement and two-way sync passed');

    // 7. Basic Controls -> Duration Pills
    await win.webContents.executeJavaScript(`
      document.querySelector('.duration-pill-btn[data-duration="15"]').click();
    `);

    const durationCheck = await win.webContents.executeJavaScript(`
      (() => {
        const basicDisplay = document.querySelector('#basic-duration-display')?.textContent;
        const advVal = document.querySelector('#duration')?.value;
        const activePill = document.querySelector('.duration-pill-btn.active')?.getAttribute('data-duration');
        return { basicDisplay, advVal, activePill };
      })()
    `);

    assert.strictEqual(durationCheck.basicDisplay, '15 сек.', 'Duration display should be 15 сек.');
    assert.strictEqual(durationCheck.advVal, '15', 'Canonical duration input updated to 15');
    assert.strictEqual(durationCheck.activePill, '15', 'Pill 15 should be active');
    console.log('✔ Duration pill click and two-way sync passed');

    // 8. Basic Controls -> Duration Pill "Всегда" (0)
    await win.webContents.executeJavaScript(`
      document.querySelector('.duration-pill-btn[data-duration="0"]').click();
    `);

    const alwaysCheck = await win.webContents.executeJavaScript(`
      (() => {
        const basicDisplay = document.querySelector('#basic-duration-display')?.textContent;
        const alwaysShowChecked = document.querySelector('#always-show')?.checked;
        const activePill = document.querySelector('.duration-pill-btn.active')?.getAttribute('data-duration');
        return { basicDisplay, alwaysShowChecked, activePill };
      })()
    `);

    assert.strictEqual(alwaysCheck.basicDisplay, 'Всегда');
    assert.strictEqual(alwaysCheck.alwaysShowChecked, true);
    assert.strictEqual(alwaysCheck.activePill, '0');
    console.log('✔ Duration "Всегда" passed');

    // 9. Size Presets: Click "Компактный"
    await win.webContents.executeJavaScript(`
      document.querySelector('#size-btn-compact').click();
    `);

    const sizeCheck = await win.webContents.executeJavaScript(`
      (() => {
        const cardWidth = document.querySelector('#card-width')?.value;
        const fontSize = document.querySelector('#font-size')?.value;
        const authorFontSize = document.querySelector('#author-font-size')?.value;
        const cardPadding = document.querySelector('#card-padding')?.value;
        const messageGap = document.querySelector('#message-gap')?.value;
        const sizeBadge = document.querySelector('#size-status-badge')?.textContent;
        const activeSizeBtn = document.querySelector('.size-preset-btn.active')?.getAttribute('data-size');
        return { cardWidth, fontSize, authorFontSize, cardPadding, messageGap, sizeBadge, activeSizeBtn };
      })()
    `);

    assert.strictEqual(Number(sizeCheck.cardWidth), 380, 'Card width 380');
    assert.strictEqual(Number(sizeCheck.fontSize), 16, 'Font size 16');
    assert.strictEqual(Number(sizeCheck.authorFontSize), 13, 'Author font size 13');
    assert.strictEqual(Number(sizeCheck.cardPadding), 8, 'Card padding 8');
    assert.strictEqual(Number(sizeCheck.messageGap), 6, 'Message gap 6');
    assert.strictEqual(sizeCheck.sizeBadge, 'Компактный', 'Badge shows Компактный');
    assert.strictEqual(sizeCheck.activeSizeBtn, 'compact', 'Compact button is active');
    console.log('✔ Size preset "Компактный" application and mapping passed');

    // 10. Reverse Sync: Modify fontSize in Advanced -> Size preset becomes Custom
    await win.webContents.executeJavaScript(`
      setAppearanceUiMode('advanced');
      const fontInput = document.querySelector('#font-size');
      fontInput.value = '19';
      fontInput.dispatchEvent(new Event('input'));
    `);

    const customSizeCheck = await win.webContents.executeJavaScript(`
      (() => {
        const sizeBadge = document.querySelector('#size-status-badge')?.textContent;
        const sizeBadgeClass = document.querySelector('#size-status-badge')?.className;
        const hasActiveSizeBtn = Boolean(document.querySelector('.size-preset-btn.active'));
        return { sizeBadge, sizeBadgeClass, hasActiveSizeBtn };
      })()
    `);

    assert.strictEqual(customSizeCheck.sizeBadge, 'Пользовательский', 'Size badge should become Пользовательский');
    assert.ok(customSizeCheck.sizeBadgeClass.includes('custom'), 'Size badge should have .custom class');
    assert.strictEqual(customSizeCheck.hasActiveSizeBtn, false, 'No size preset button should be active');
    console.log('✔ Custom size detection on manual slider adjustment passed');

    // 11. Profile application & Size Sync
    await win.webContents.executeJavaScript(`
      document.querySelector('#profile-btn-content').click();
    `);

    const profileCheck = await win.webContents.executeJavaScript(`
      (() => {
        const profileBadge = document.querySelector('#profile-status-badge')?.textContent;
        const sizeBadge = document.querySelector('#size-status-badge')?.textContent;
        const activeSizeBtn = document.querySelector('.size-preset-btn.active')?.getAttribute('data-size');
        const basicMessagesVal = document.querySelector('#basic-max-messages-val')?.textContent;
        const basicDuration = document.querySelector('#basic-duration-display')?.textContent;
        return { profileBadge, sizeBadge, activeSizeBtn, basicMessagesVal, basicDuration };
      })()
    `);

    assert.strictEqual(profileCheck.profileBadge, 'Просмотр контента', 'Profile should be Просмотр контента');
    assert.strictEqual(profileCheck.sizeBadge, 'Компактный', 'Profile content size is compact');
    assert.strictEqual(profileCheck.activeSizeBtn, 'compact', 'Compact size button active');
    assert.strictEqual(profileCheck.basicMessagesVal, '3', 'Content profile max messages is 3');
    assert.strictEqual(profileCheck.basicDuration, '12 сек.', 'Content profile duration is 12 сек.');
    console.log('✔ Profile application updates both profile and size preset cleanly');

    // 12. Manual adjustment transitions Profile to Custom while keeping Size preset
    await win.webContents.executeJavaScript(`
      document.querySelector('#basic-max-msgs-inc').click();
    `);

    const customProfileCheck = await win.webContents.executeJavaScript(`
      (() => {
        const profileBadge = document.querySelector('#profile-status-badge')?.textContent;
        const sizeBadge = document.querySelector('#size-status-badge')?.textContent;
        const activeSizeBtn = document.querySelector('.size-preset-btn.active')?.getAttribute('data-size');
        return { profileBadge, sizeBadge, activeSizeBtn };
      })()
    `);

    assert.strictEqual(customProfileCheck.profileBadge, 'Пользовательский', 'Profile should become Пользовательский after changing message count');
    assert.strictEqual(customProfileCheck.sizeBadge, 'Компактный', 'Size preset remains Компактный');
    assert.strictEqual(customProfileCheck.activeSizeBtn, 'compact', 'Compact button remains active');
    console.log('✔ Profile transitions to Custom without breaking size preset');

    console.log('\nAll Focus Mode integration tests passed successfully!');
    app.exit(0);
  } catch (err) {
    console.error('\n✖ Focus Mode test failed:', err);
    app.exit(1);
  }
});
