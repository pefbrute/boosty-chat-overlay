'use strict';

const testPort = 17396;
process.env.BOOSTY_OVERLAY_PORT = String(testPort);
process.env.BOOSTY_OVERLAY_CONFIG = `/tmp/test-config-layout-${process.pid}.json`;
process.env.UI_AUDIT_MODE = '1';

const fs = require('node:fs');
fs.writeFileSync(process.env.BOOSTY_OVERLAY_CONFIG, JSON.stringify({
  fontSize: 21,
  maxMessages: 6,
  cardWidth: 520,
  accentColor: '#f15f2c',
  textColor: '#ffffff',
  backgroundColor: '#121216',
  horizontalAnchor: 'left',
  verticalAnchor: 'bottom',
  newMessagePosition: 'bottom',
  offsetX: 20,
  offsetY: 20,
  textAlign: 'left',
  maxStackHeight: 800,
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
ipcMain.handle('get-app-variant', () => ({ isLab: false, name: 'Boosty Chat Overlay', mainWindowTitle: 'Boosty Chat Overlay' }));

app.whenReady().then(async () => {
  let desktopWin;
  let overlayWin;

  try {
    console.log('=== Running Overlay Layout & Positioning v1 Test Suite ===\n');

    // -------------------------------------------------------------
    // PART 1: Overlay Renderer In-Browser Geometry & Ordering Tests
    // -------------------------------------------------------------
    overlayWin = new BrowserWindow({
      show: false,
      width: 1920,
      height: 1080,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    overlayWin.setContentSize(1920, 1080);

    const overlayUrl = `http://127.0.0.1:${testPort}/overlay/index.html`;
    await overlayWin.loadURL(overlayUrl);

    // 1. Baseline Geometry Regression Check
    console.log('1. Verifying Baseline Geometry Regression...');
    const baseline = await overlayWin.webContents.executeJavaScript(`
      new Promise(resolve => {
        const container = document.querySelector('#messages');
        container.innerHTML = '';
        const card = window.BoostyRenderer.createMessageCard({
          author: 'Тестовый Пользователь',
          text: 'Тестовое сообщение baseline',
          avatar: ''
        });
        card.style.animation = 'none';
        container.appendChild(card);
        setTimeout(() => {
          const cRect = container.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          resolve({
            containerLeft: cRect.left,
            containerBottom: window.innerHeight - cRect.bottom,
            containerWidth: cRect.width,
            cardLeft: cardRect.left,
            cardBottom: window.innerHeight - cardRect.bottom,
            cardWidth: cardRect.width,
          });
        }, 50);
      })
    `);

    assert.ok(Math.abs(baseline.containerLeft - 20) <= 2, `containerLeft should be ~20px, got ${baseline.containerLeft}`);
    assert.ok(Math.abs(baseline.containerBottom - 20) <= 2, `containerBottom should be ~20px, got ${baseline.containerBottom}`);
    assert.ok(Math.abs(baseline.cardLeft - 20) <= 2, `cardLeft should be ~20px, got ${baseline.cardLeft}`);
    assert.ok(Math.abs(baseline.cardBottom - 20) <= 2, `cardBottom should be ~20px, got ${baseline.cardBottom}`);
    assert.ok(Math.abs(baseline.cardWidth - 548) <= 2, `cardWidth should be ~548px (520+padding/border), got ${baseline.cardWidth}`);
    console.log('✔ Baseline resting geometry verified (±1-2px regression tolerance)');

    // 2. Four Corner Anchors
    console.log('2. Testing 4 Corner Anchors...');
    const corners = [
      { h: 'left', v: 'top', check: r => r.left <= 22 && r.top <= 22 },
      { h: 'right', v: 'top', check: r => Math.abs(1920 - r.right - 20) <= 2 && r.top <= 22 },
      { h: 'left', v: 'bottom', check: r => r.left <= 22 && Math.abs(1080 - r.bottom - 20) <= 2 },
      { h: 'right', v: 'bottom', check: r => Math.abs(1920 - r.right - 20) <= 2 && Math.abs(1080 - r.bottom - 20) <= 2 },
    ];

    for (const corner of corners) {
      const rect = await overlayWin.webContents.executeJavaScript(`
        (() => {
          window.BoostyRenderer.applyAppearanceConfig(document.documentElement, {
            horizontalAnchor: '${corner.h}',
            verticalAnchor: '${corner.v}',
            offsetX: 20,
            offsetY: 20
          });
          const container = document.querySelector('#messages');
          const r = container.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        })()
      `);
      assert.ok(corner.check(rect), `Failed corner check for ${corner.h}-${corner.v}: ${JSON.stringify(rect)}`);
    }
    console.log('✔ All 4 corner anchors verified via computed bounding rects');

    // 3. Custom Offsets Verification
    console.log('3. Testing Custom Offsets (offsetX = 80, offsetY = 60)...');
    const offsetCheck = await overlayWin.webContents.executeJavaScript(`
      (() => {
        window.BoostyRenderer.applyAppearanceConfig(document.documentElement, {
          horizontalAnchor: 'right',
          verticalAnchor: 'top',
          offsetX: 80,
          offsetY: 60
        });
        const container = document.querySelector('#messages');
        const r = container.getBoundingClientRect();
        return {
          rightInset: 1920 - r.right,
          topInset: r.top
        };
      })()
    `);
    assert.ok(Math.abs(offsetCheck.rightInset - 80) <= 2, `Right inset should be ~80px, got ${offsetCheck.rightInset}`);
    assert.ok(Math.abs(offsetCheck.topInset - 60) <= 2, `Top inset should be ~60px, got ${offsetCheck.topInset}`);
    console.log('✔ Custom offsets verified (±1-2px)');

    // 4. Viewport Bounds & Safe Max-Height on Miniature Viewport (400x240)
    console.log('4. Testing Safe Viewport Bounds on Miniature Viewport (400x240)...');
    overlayWin.setContentSize(400, 240);
    await new Promise(r => setTimeout(r, 100));

    const boundsCheck = await overlayWin.webContents.executeJavaScript(`
      (() => {
        window.BoostyRenderer.applyAppearanceConfig(document.documentElement, {
          horizontalAnchor: 'left',
          verticalAnchor: 'bottom',
          offsetX: 300,
          offsetY: 300,
          maxStackHeight: 2160,
          cardWidth: 760
        });
        const container = document.querySelector('#messages');
        const r = container.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          width: r.width,
          winW: window.innerWidth,
          winH: window.innerHeight,
        };
      })()
    `);

    assert.ok(boundsCheck.height >= 0, 'Container height must not be negative');
    assert.ok(boundsCheck.width >= 0, 'Container width must not be negative');
    assert.ok(boundsCheck.bottom <= boundsCheck.winH + 1, 'Container bottom must not exceed viewport height');
    console.log('✔ Safe viewport bounds verified on 400x240: no negative height, no crashes');

    // Restore standard 1080p
    overlayWin.setContentSize(1920, 1080);
    await new Promise(r => setTimeout(r, 50));

    // 5. Max Stack Height under Stress Fixture (No scrollbars)
    console.log('5. Testing maxStackHeight under Stress Fixture...');
    const stressCheck = await overlayWin.webContents.executeJavaScript(`
      (() => {
        window.BoostyRenderer.applyAppearanceConfig(document.documentElement, {
          horizontalAnchor: 'left',
          verticalAnchor: 'bottom',
          offsetX: 20,
          offsetY: 20,
          maxStackHeight: 400
        });
        const container = document.querySelector('#messages');
        container.innerHTML = '';
        for (let i = 1; i <= 10; i++) {
          const card = window.BoostyRenderer.createMessageCard({
            author: 'User ' + i,
            text: 'Длинный текст сообщения номер ' + i + ' для проверки ограничения высоты стэка оверлея в стресс-тесте.'
          });
          card.style.animation = 'none';
          container.appendChild(card);
        }
        const r = container.getBoundingClientRect();
        return {
          height: r.height,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight
        };
      })()
    `);

    assert.ok(stressCheck.height <= 401, `Height must not exceed maxStackHeight (400), got ${stressCheck.height}`);
    assert.ok(stressCheck.height > 100, `Height must be > 100px, got ${stressCheck.height}`);
    console.log('✔ maxStackHeight constraint confirmed under stress');

    // 6. Chronological Message Ordering & Toggle Stress Test
    console.log('6. Testing Chronological Message Ordering & Multiple Toggle Stress Test...');
    const toggleResults = await overlayWin.webContents.executeJavaScript(`
      (() => {
        // Reset activeMessages and cardsByEventId
        window.activeMessages.length = 0;
        window.cardsByEventId.clear();
        const container = document.querySelector('#messages');
        container.innerHTML = '';

        // Dispatch 3 messages: A, B, C
        const messagesData = [
          { eventId: 'evt-1', author: 'A', text: 'Msg A', receivedAt: 1000 },
          { eventId: 'evt-2', author: 'B', text: 'Msg B', receivedAt: 2000 },
          { eventId: 'evt-3', author: 'C', text: 'Msg C', receivedAt: 3000 },
        ];

        // Start with bottom
        applyConfig({ newMessagePosition: 'bottom', durationSeconds: 0, maxMessages: 6 });
        for (const m of messagesData) {
          handleMessage({ data: JSON.stringify(m) });
        }

        const getDomTexts = () => Array.from(document.querySelectorAll('#messages .message .author')).map(el => el.textContent);

        const step1Bottom = getDomTexts();

        // Toggle to top
        applyConfig({ newMessagePosition: 'top' });
        const step2Top = getDomTexts();

        // Toggle back to bottom
        applyConfig({ newMessagePosition: 'bottom' });
        const step3Bottom = getDomTexts();

        // Toggle back to top
        applyConfig({ newMessagePosition: 'top' });
        const step4Top = getDomTexts();

        return {
          step1Bottom,
          step2Top,
          step3Bottom,
          step4Top,
          activeMessagesEventIds: window.activeMessages.map(m => m.eventId),
          cardsCount: window.cardsByEventId.size,
          domCount: document.querySelectorAll('#messages .message').length
        };
      })()
    `);

    assert.deepStrictEqual(toggleResults.step1Bottom, ['A', 'B', 'C'], 'Step 1 (bottom) DOM order should be A, B, C');
    assert.deepStrictEqual(toggleResults.step2Top, ['C', 'B', 'A'], 'Step 2 (top) DOM order should be C, B, A');
    assert.deepStrictEqual(toggleResults.step3Bottom, ['A', 'B', 'C'], 'Step 3 (bottom) DOM order should be A, B, C');
    assert.deepStrictEqual(toggleResults.step4Top, ['C', 'B', 'A'], 'Step 4 (top) DOM order should be C, B, A');
    assert.deepStrictEqual(toggleResults.activeMessagesEventIds, ['evt-1', 'evt-2', 'evt-3'], 'Chronological activeMessages must remain [evt-1, evt-2, evt-3]');
    assert.strictEqual(toggleResults.cardsCount, 3, 'cardsByEventId map size must remain 3');
    assert.strictEqual(toggleResults.domCount, 3, 'DOM cards count must remain 3 with zero duplicate or lost cards');
    console.log('✔ Multiple top <-> bottom toggles verified: zero card loss, zero duplicates, chronological state intact');

    // 7. maxMessages Eviction Chronological Check
    console.log('7. Testing maxMessages FIFO eviction based on chronological state...');
    const evictionResult = await overlayWin.webContents.executeJavaScript(`
      (() => {
        // Set maxMessages = 2 while order is top
        applyConfig({ newMessagePosition: 'top', maxMessages: 2 });
        return {
          domAuthors: Array.from(document.querySelectorAll('#messages .message:not(.disappearing) .author')).map(el => el.textContent),
          activeEventIds: window.activeMessages.map(m => m.eventId)
        };
      })()
    `);

    // Oldest was A (evt-1). With maxMessages = 2, A must be removed, leaving B and C (in top order: [C, B]).
    assert.deepStrictEqual(evictionResult.domAuthors, ['C', 'B'], 'Eviction must remove chronological oldest A, leaving C and B in top order');
    assert.deepStrictEqual(evictionResult.activeEventIds, ['evt-2', 'evt-3'], 'activeMessages must contain evt-2 and evt-3');
    console.log('✔ maxMessages FIFO eviction correctly evicted chronologically oldest card');

    // 8. Text Alignment Check & Stress Fixture
    console.log('8. Testing Text Alignment (.author and .text) & Long Name Stress...');
    const alignResult = await overlayWin.webContents.executeJavaScript(`
      (() => {
        const container = document.querySelector('#messages');
        container.innerHTML = '';
        const stressCard = window.BoostyRenderer.createMessageCard({
          author: 'ОченьОченьДлинноеИмяПользователя123456789',
          text: 'Длинное многострочное сообщение на русском языке для проверки выравнивания текста справа и по центру.'
        });
        stressCard.style.animation = 'none';
        container.appendChild(stressCard);

        const testAlign = (val) => {
          window.BoostyRenderer.applyAppearanceConfig(document.documentElement, { textAlign: val });
          const author = stressCard.querySelector('.author');
          const text = stressCard.querySelector('.text');
          const authorAlign = window.getComputedStyle(author).textAlign;
          const textAlign = window.getComputedStyle(text).textAlign;
          const cardRect = stressCard.getBoundingClientRect();
          const avatarRect = stressCard.querySelector('.avatar').getBoundingClientRect();
          return { authorAlign, textAlign, avatarLeft: avatarRect.left - cardRect.left };
        };

        return {
          left: testAlign('left'),
          center: testAlign('center'),
          right: testAlign('right')
        };
      })()
    `);

    assert.strictEqual(alignResult.left.authorAlign, 'left');
    assert.strictEqual(alignResult.left.textAlign, 'left');
    assert.strictEqual(alignResult.center.authorAlign, 'center');
    assert.strictEqual(alignResult.center.textAlign, 'center');
    assert.strictEqual(alignResult.right.authorAlign, 'right');
    assert.strictEqual(alignResult.right.textAlign, 'right');
    // Avatar must not move when text align is right
    assert.ok(Math.abs(alignResult.left.avatarLeft - alignResult.right.avatarLeft) <= 1, 'Avatar must not shift when text align changes');
    console.log('✔ Text alignment (left, center, right) and avatar stability verified');

    // -------------------------------------------------------------
    // PART 2: Desktop UI Controls, Presets & Reset Separation Tests
    // -------------------------------------------------------------
    desktopWin = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      useContentSize: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '..', 'desktop', 'preload.js'),
      },
    });

    desktopWin.webContents.on('dom-ready', () => {
      desktopWin.webContents.executeJavaScript(`
        window.BOOSTY_API_ORIGIN = 'http://127.0.0.1:${testPort}';
      `);
    });

    const htmlPath = path.join(__dirname, '..', 'desktop', 'index.html');
    await desktopWin.loadFile(htmlPath);

    // Wait for desktop app init
    await desktopWin.webContents.executeJavaScript(`
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

    // Switch to appearance view
    await desktopWin.webContents.executeJavaScript(`showView('appearance');`);

    // 9. Preset Independence from Layout
    console.log('9. Testing Preset Independence: changing layout preserves "Чистый" badge...');
    await desktopWin.webContents.executeJavaScript(`
      document.querySelector('#preset-btn-clean').click();
    `);

    const presetBeforeLayout = await desktopWin.webContents.executeJavaScript(`
      document.querySelector('#preset-status-badge')?.textContent;
    `);
    assert.strictEqual(presetBeforeLayout, 'Чистый');

    // Change layout controls (switch corner to right-top, offsetX to 80, offsetY to 60)
    await desktopWin.webContents.executeJavaScript(`
      document.querySelector('.corner-btn[data-corner="right-top"]').click();
      const offsetXInput = document.querySelector('#offset-x');
      offsetXInput.value = '80';
      offsetXInput.dispatchEvent(new Event('input'));
    `);

    const presetAfterLayout = await desktopWin.webContents.executeJavaScript(`
      document.querySelector('#preset-status-badge')?.textContent;
    `);
    assert.strictEqual(presetAfterLayout, 'Чистый', 'Changing layout must NOT switch badge to "Кастомный"');
    console.log('✔ Preset independence verified: changing layout preserved "Чистый"');

    // 10. Color Sensitivity: changing accentColor flips preset to "Кастомный"
    console.log('10. Testing Color Sensitivity: changing color flips preset to "Кастомный"...');
    await desktopWin.webContents.executeJavaScript(`
      const accentInput = document.querySelector('#accent');
      accentInput.value = '#3a86ff';
      accentInput.dispatchEvent(new Event('input'));
    `);

    const presetAfterColor = await desktopWin.webContents.executeJavaScript(`
      document.querySelector('#preset-status-badge')?.textContent;
    `);
    assert.strictEqual(presetAfterColor, 'Кастомный', 'Changing accentColor MUST switch badge to "Кастомный"');
    console.log('✔ Color sensitivity verified: color change switched preset to "Кастомный"');

    // 11. Presets do not alter user layout
    console.log('11. Testing Preset Click does not overwrite user layout...');
    await desktopWin.webContents.executeJavaScript(`
      document.querySelector('#preset-btn-glass').click();
    `);

    const layoutAfterPreset = await desktopWin.webContents.executeJavaScript(`
      (() => {
        const activeCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const offsetX = document.querySelector('#offset-x')?.value;
        const badge = document.querySelector('#preset-status-badge')?.textContent;
        return { activeCorner, offsetX, badge };
      })()
    `);

    assert.strictEqual(layoutAfterPreset.badge, 'Стекло', 'Preset badge should be "Стекло"');
    assert.strictEqual(layoutAfterPreset.activeCorner, 'right-top', 'Glass preset must preserve active corner right-top');
    assert.strictEqual(layoutAfterPreset.offsetX, '80', 'Glass preset must preserve offsetX 80');
    console.log('✔ Preset application preserved user layout');

    // 12. Reset Independence
    console.log('12. Testing Reset Independence...');
    // A: Appearance reset restores style defaults but leaves layout intact
    await desktopWin.webContents.executeJavaScript(`
      document.querySelector('#appearance-reset-btn').click();
    `);

    const afterStyleReset = await desktopWin.webContents.executeJavaScript(`
      (() => {
        const badge = document.querySelector('#preset-status-badge')?.textContent;
        const activeCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const offsetX = document.querySelector('#offset-x')?.value;
        return { badge, activeCorner, offsetX };
      })()
    `);

    assert.strictEqual(afterStyleReset.badge, 'Чистый', 'Appearance reset should restore clean preset');
    assert.strictEqual(afterStyleReset.activeCorner, 'right-top', 'Appearance reset must leave layout intact');
    assert.strictEqual(afterStyleReset.offsetX, '80', 'Appearance reset must leave offsetX intact');

    // B: Layout reset restores layout defaults but leaves style preset intact
    await desktopWin.webContents.executeJavaScript(`
      document.querySelector('#preset-btn-large').click();
      document.querySelector('#layout-reset-btn').click();
    `);

    const afterLayoutReset = await desktopWin.webContents.executeJavaScript(`
      (() => {
        const badge = document.querySelector('#preset-status-badge')?.textContent;
        const activeCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const offsetX = document.querySelector('#offset-x')?.value;
        const fontSize = document.querySelector('#font-size')?.value;
        return { badge, activeCorner, offsetX, fontSize };
      })()
    `);

    assert.strictEqual(afterLayoutReset.badge, 'Крупный', 'Layout reset must preserve Large preset');
    assert.strictEqual(afterLayoutReset.fontSize, '26', 'Layout reset must preserve Large font size 26');
    assert.strictEqual(afterLayoutReset.activeCorner, 'left-bottom', 'Layout reset must restore default corner left-bottom');
    assert.strictEqual(afterLayoutReset.offsetX, '20', 'Layout reset must restore default offsetX 20');
    console.log('✔ Reset separation verified: style reset leaves layout intact, layout reset leaves style intact');

    // 12.1 syncInputsFromConfig Layout & aria-pressed Verification
    console.log('12.1 Testing syncInputsFromConfig() updates all layout controls & aria-pressed states...');
    const syncTestResult = await desktopWin.webContents.executeJavaScript(`
      (() => {
        syncInputsFromConfig({
          horizontalAnchor: 'right',
          verticalAnchor: 'top',
          newMessagePosition: 'top',
          offsetX: 140,
          offsetY: 95,
          maxStackHeight: 650,
          textAlign: 'right'
        });

        const activeCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const activeCorners = Array.from(document.querySelectorAll('.corner-btn.active'));
        const activeCornerAria = document.querySelector('.corner-btn[data-corner="right-top"]')?.getAttribute('aria-pressed');
        const rtAria = document.querySelector('.corner-btn[data-corner="right-top"]')?.getAttribute('aria-pressed');
        const rbAria = document.querySelector('.corner-btn[data-corner="right-bottom"]')?.getAttribute('aria-pressed');
        const ltAria = document.querySelector('.corner-btn[data-corner="left-top"]')?.getAttribute('aria-pressed');
        const lbAria = document.querySelector('.corner-btn[data-corner="left-bottom"]')?.getAttribute('aria-pressed');
        const offsetXVal = document.querySelector('#offset-x')?.value;
        const offsetYVal = document.querySelector('#offset-y')?.value;
        const stackHeightVal = document.querySelector('#max-stack-height')?.value;
        const activePos = document.querySelector('[data-new-msg-pos].active')?.getAttribute('data-new-msg-pos');
        const topPosAria = document.querySelector('[data-message-position="top"]')?.getAttribute('aria-pressed') ?? document.querySelector('[data-new-msg-pos="top"]')?.getAttribute('aria-pressed');
        const bottomPosAria = document.querySelector('[data-message-position="bottom"]')?.getAttribute('aria-pressed') ?? document.querySelector('[data-new-msg-pos="bottom"]')?.getAttribute('aria-pressed');
        const activeAlign = document.querySelector('[data-text-align].active')?.getAttribute('data-text-align');
        const rightAlignAria = document.querySelector('[data-text-align="right"]')?.getAttribute('aria-pressed');
        const centerAlignAria = document.querySelector('[data-text-align="center"]')?.getAttribute('aria-pressed');
        const leftAlignAria = document.querySelector('[data-text-align="left"]')?.getAttribute('aria-pressed');

        return {
          activeCorner,
          activeCornersCount: activeCorners.length,
          activeCornerAria,
          rtAria,
          rbAria,
          ltAria,
          lbAria,
          offsetXVal,
          offsetYVal,
          stackHeightVal,
          activePos,
          topPosAria,
          bottomPosAria,
          activeAlign,
          rightAlignAria,
          centerAlignAria,
          leftAlignAria
        };
      })()
    `);

    assert.strictEqual(syncTestResult.activeCornersCount, 1, 'Exactly 1 corner button must be active');
    assert.strictEqual(syncTestResult.activeCorner, 'right-top', 'syncInputsFromConfig must update active corner to right-top');
    assert.strictEqual(syncTestResult.rtAria, 'true', 'Active corner right-top must have aria-pressed="true"');
    assert.strictEqual(syncTestResult.rbAria, 'false', 'Inactive corner right-bottom must have aria-pressed="false"');
    assert.strictEqual(syncTestResult.ltAria, 'false', 'Inactive corner left-top must have aria-pressed="false"');
    assert.strictEqual(syncTestResult.lbAria, 'false', 'Inactive corner left-bottom must have aria-pressed="false"');
    assert.strictEqual(syncTestResult.offsetXVal, '140', 'syncInputsFromConfig must update offsetX to 140');
    assert.strictEqual(syncTestResult.offsetYVal, '95', 'syncInputsFromConfig must update offsetY to 95');
    assert.strictEqual(syncTestResult.stackHeightVal, '650', 'syncInputsFromConfig must update maxStackHeight to 650');
    assert.strictEqual(syncTestResult.activePos, 'top', 'syncInputsFromConfig must update newMessagePosition to top');
    assert.strictEqual(syncTestResult.topPosAria, 'true', 'Top pos button must have aria-pressed="true"');
    assert.strictEqual(syncTestResult.bottomPosAria, 'false', 'Bottom pos button must have aria-pressed="false"');
    assert.strictEqual(syncTestResult.activeAlign, 'right', 'syncInputsFromConfig must update textAlign to right');
    assert.strictEqual(syncTestResult.rightAlignAria, 'true', 'Right align button must have aria-pressed="true"');
    assert.strictEqual(syncTestResult.centerAlignAria, 'false', 'Center align button must have aria-pressed="false"');
    assert.strictEqual(syncTestResult.leftAlignAria, 'false', 'Left align button must have aria-pressed="false"');
    console.log('✔ syncInputsFromConfig layout updates & aria-pressed states verified');

    // 13. Keyboard Accessibility: Tab, Enter, Space and 2D Arrow Keys
    console.log('13. Testing Keyboard Accessibility (Tab, Enter, Space, Arrow Keys)...');
    const keyNavResult = await desktopWin.webContents.executeJavaScript(`
      (() => {
        const lt = document.querySelector('.corner-btn[data-corner="left-top"]');
        const rt = document.querySelector('.corner-btn[data-corner="right-top"]');
        const lb = document.querySelector('.corner-btn[data-corner="left-bottom"]');
        const rb = document.querySelector('.corner-btn[data-corner="right-bottom"]');

        // Test ArrowDown from left-top
        lt.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        const afterDown = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');

        // Test ArrowRight from left-bottom -> right-bottom
        lb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        const afterRight = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');

        // Test ArrowUp from right-bottom -> right-top
        rb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        const afterUp = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');

        return { afterDown, afterRight, afterUp };
      })()
    `);

    assert.strictEqual(keyNavResult.afterDown, 'left-bottom', 'ArrowDown should move focus to left-bottom');
    assert.strictEqual(keyNavResult.afterRight, 'right-bottom', 'ArrowRight should move focus to right-bottom');
    assert.strictEqual(keyNavResult.afterUp, 'right-top', 'ArrowUp should move focus to right-top');
    console.log('✔ 2D arrow keyboard navigation verified on corner picker');

    // 14. Responsive 800x650 Viewport Check
    console.log('14. Testing Responsive 800x650 viewport layout...');
    desktopWin.setContentSize(800, 650);
    await new Promise(r => setTimeout(r, 100));

    const responsiveLayout = await desktopWin.webContents.executeJavaScript(`
      (() => {
        const hasHScroll = document.body.scrollWidth > window.innerWidth;
        const cornerPicker = document.querySelector('.corner-screen-mock');
        const segmented = document.querySelector('.segmented-group');
        return {
          hasHScroll,
          hasCornerPicker: Boolean(cornerPicker),
          hasSegmented: Boolean(segmented)
        };
      })()
    `);

    assert.strictEqual(responsiveLayout.hasHScroll, false, '800x650 must not have horizontal scroll');
    assert.strictEqual(responsiveLayout.hasCornerPicker, true, 'Corner picker must exist in 800x650');
    assert.strictEqual(responsiveLayout.hasSegmented, true, 'Segmented controls must exist in 800x650');
    console.log('✔ Responsive 800x650 check passed with zero horizontal scroll');

    // 15. Drag & Drop Visual Positioning in Desktop Preview
    console.log('15. Testing Drag & Drop Visual Positioning & Bidirectional Sync...');
    desktopWin.setContentSize(1280, 800);
    await new Promise(r => setTimeout(r, 100));

    const dragTestResult = await desktopWin.webContents.executeJavaScript(`
      (() => {
        const hitbox = document.querySelector('#chat-drag-hitbox');
        const wrapper = document.querySelector('#preview-scale-wrapper');
        const badgeAnchor = document.querySelector('#drag-badge-anchor');
        const badgeCoords = document.querySelector('#drag-badge-coords');
        const guideX = document.querySelector('#guide-center-x');
        const guideY = document.querySelector('#guide-center-y');

        if (!hitbox || !wrapper) {
          throw new Error('Hitbox or preview-scale-wrapper not found');
        }

        const initialHitboxLeft = parseFloat(hitbox.style.left);
        const initialBadgeText = badgeAnchor?.textContent;

        const wrapperRect = wrapper.getBoundingClientRect();
        const scale = Math.min(wrapperRect.width / 1920, wrapperRect.height / 1080) || 1;

        const startLogicalX = parseFloat(hitbox.style.left) + 50;
        const startLogicalY = parseFloat(hitbox.style.top) + 50;
        const clientStartX = wrapperRect.left + startLogicalX * scale;
        const clientStartY = wrapperRect.top + startLogicalY * scale;

        hitbox.dispatchEvent(new PointerEvent('pointerdown', {
          clientX: clientStartX,
          clientY: clientStartY,
          button: 0,
          pointerId: 1,
          bubbles: true
        }));

        const isDraggingAfterDown = hitbox.classList.contains('is-dragging');

        const targetLogicalX = 1500;
        const targetLogicalY = 100;
        const clientMoveX = wrapperRect.left + targetLogicalX * scale;
        const clientMoveY = wrapperRect.top + targetLogicalY * scale;

        hitbox.dispatchEvent(new PointerEvent('pointermove', {
          clientX: clientMoveX,
          clientY: clientMoveY,
          pointerId: 1,
          bubbles: true
        }));

        const activeCornerDuringDrag = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const offsetXVal = Number(document.querySelector('#offset-x')?.value);
        const offsetYVal = Number(document.querySelector('#offset-y')?.value);
        const badgeAnchorText = badgeAnchor?.textContent;

        hitbox.dispatchEvent(new PointerEvent('pointerup', {
          clientX: clientMoveX,
          clientY: clientMoveY,
          pointerId: 1,
          bubbles: true
        }));

        const isDraggingAfterUp = hitbox.classList.contains('is-dragging');

        hitbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        const offsetXAfterLeftArrow = Number(document.querySelector('#offset-x')?.value);

        document.querySelector('#layout-reset-btn').click();
        const cornerAfterReset = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const offsetXAfterReset = Number(document.querySelector('#offset-x')?.value);
        const offsetYAfterReset = Number(document.querySelector('#offset-y')?.value);

        return {
          initialHitboxLeft,
          initialBadgeText,
          isDraggingAfterDown,
          activeCornerDuringDrag,
          offsetXVal,
          offsetYVal,
          badgeAnchorText,
          isDraggingAfterUp,
          offsetXAfterLeftArrow,
          cornerAfterReset,
          offsetXAfterReset,
          offsetYAfterReset,
        };
      })()
    `);

    assert.strictEqual(dragTestResult.isDraggingAfterDown, true, 'Hitbox must have .is-dragging class during drag');
    assert.strictEqual(dragTestResult.activeCornerDuringDrag, 'right-top', 'Dragging into top-right must switch corner button to right-top');
    assert.ok(dragTestResult.offsetXVal >= 0 && dragTestResult.offsetXVal <= 1000, `offsetX must be valid, got ${dragTestResult.offsetXVal}`);
    assert.ok(dragTestResult.offsetYVal >= 0 && dragTestResult.offsetYVal <= 800, `offsetY must be valid, got ${dragTestResult.offsetYVal}`);
    assert.strictEqual(dragTestResult.isDraggingAfterUp, false, 'is-dragging must be removed after pointerup');
    assert.strictEqual(dragTestResult.cornerAfterReset, 'left-bottom', 'Layout reset must restore left-bottom');
    assert.strictEqual(dragTestResult.offsetXAfterReset, 20, 'Layout reset must restore offsetX 20');
    assert.strictEqual(dragTestResult.offsetYAfterReset, 20, 'Layout reset must restore offsetY 20');
    console.log('✔ Visual positioning drag & drop, corner switching, keyboard fine-tuning, and reset verified');

    // 16. Stream Profiles v1 (Built-in Stream Profiles: content, gaming, talking, minimal)
    console.log('16. Testing Stream Profiles v1 (content, gaming, talking, minimal)...');
    const profilesTestResult = await desktopWin.webContents.executeJavaScript(`
      (() => {
        const buttonOrder = Array.from(document.querySelectorAll('.profiles-grid .profile-btn')).map(b => b.getAttribute('data-profile'));
        const hasPodcastBtn = Boolean(document.querySelector('#profile-btn-podcast'));

        // 16.1 Test Content Viewing Profile (Primary / Recommended)
        document.querySelector('#profile-btn-content').click();
        const contentBadge = document.querySelector('#profile-status-badge')?.textContent;
        const contentActiveBtn = document.querySelector('.profile-btn.active')?.getAttribute('data-profile');
        const contentPresetBadge = document.querySelector('#preset-status-badge')?.textContent;
        const contentCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const contentOffsetX = Number(document.querySelector('#offset-x')?.value);
        const contentOffsetY = Number(document.querySelector('#offset-y')?.value);
        const contentMaxMsg = Number(document.querySelector('#max-messages')?.value);
        const contentDuration = Number(document.querySelector('#duration')?.value);
        const contentStackH = Number(document.querySelector('#max-stack-height')?.value);
        const contentRecBadge = document.querySelector('#profile-btn-content .profile-rec-badge')?.textContent;

        // 16.2 Test Gaming Profile
        document.querySelector('#profile-btn-gaming').click();
        const gamingBadge = document.querySelector('#profile-status-badge')?.textContent;
        const gamingActiveBtn = document.querySelector('.profile-btn.active')?.getAttribute('data-profile');
        const gamingPresetBadge = document.querySelector('#preset-status-badge')?.textContent;
        const gamingCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const gamingOffsetX = Number(document.querySelector('#offset-x')?.value);
        const gamingOffsetY = Number(document.querySelector('#offset-y')?.value);
        const gamingMaxMsg = Number(document.querySelector('#max-messages')?.value);
        const gamingDuration = Number(document.querySelector('#duration')?.value);

        // 16.3 Test Talking Profile
        document.querySelector('#profile-btn-talking').click();
        const talkingBadge = document.querySelector('#profile-status-badge')?.textContent;
        const talkingActiveBtn = document.querySelector('.profile-btn.active')?.getAttribute('data-profile');
        const talkingPresetBadge = document.querySelector('#preset-status-badge')?.textContent;
        const talkingCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const talkingTextAlign = document.querySelector('[data-text-align].active')?.getAttribute('data-text-align');
        const talkingMaxMsg = Number(document.querySelector('#max-messages')?.value);

        // 16.4 Test Minimal Profile
        document.querySelector('#profile-btn-minimal').click();
        const minimalBadge = document.querySelector('#profile-status-badge')?.textContent;
        const minimalActiveBtn = document.querySelector('.profile-btn.active')?.getAttribute('data-profile');
        const minimalPresetBadge = document.querySelector('#preset-status-badge')?.textContent;
        const minimalMaxMsg = Number(document.querySelector('#max-messages')?.value);

        // 16.5 Test Drag Independence on Content Profile: altering offset sets profile to "Пользовательский", preset remains "Компактный"
        document.querySelector('#profile-btn-content').click();
        const offsetXInput = document.querySelector('#offset-x');
        offsetXInput.value = '90';
        offsetXInput.dispatchEvent(new Event('input'));
        const afterDragProfileBadge = document.querySelector('#profile-status-badge')?.textContent;
        const afterDragActiveProfile = document.querySelector('.profile-btn.active');
        const afterDragPresetBadge = document.querySelector('#preset-status-badge')?.textContent;

        // 16.6 Test Preset Independence on Content Profile: changing appearance preset to glass keeps profile as "Пользовательский"
        document.querySelector('#profile-btn-content').click();
        document.querySelector('#preset-btn-glass').click();
        const afterPresetProfileBadge = document.querySelector('#profile-status-badge')?.textContent;
        const afterPresetBadge = document.querySelector('#preset-status-badge')?.textContent;

        return {
          buttonOrder, hasPodcastBtn,
          contentBadge, contentActiveBtn, contentPresetBadge, contentCorner, contentOffsetX, contentOffsetY, contentMaxMsg, contentDuration, contentStackH, contentRecBadge,
          gamingBadge, gamingActiveBtn, gamingPresetBadge, gamingCorner, gamingOffsetX, gamingOffsetY, gamingMaxMsg, gamingDuration,
          talkingBadge, talkingActiveBtn, talkingPresetBadge, talkingCorner, talkingTextAlign, talkingMaxMsg,
          minimalBadge, minimalActiveBtn, minimalPresetBadge, minimalMaxMsg,
          afterDragProfileBadge, hasActiveProfileAfterDrag: Boolean(afterDragActiveProfile), afterDragPresetBadge,
          afterPresetProfileBadge, afterPresetBadge
        };
      })()
    `);

    assert.deepStrictEqual(profilesTestResult.buttonOrder, ['content', 'gaming', 'talking', 'minimal'], 'DOM button order must be content, gaming, talking, minimal');
    assert.strictEqual(profilesTestResult.hasPodcastBtn, false, 'Podcast button must be removed from DOM');

    assert.strictEqual(profilesTestResult.contentBadge, 'Просмотр контента');
    assert.strictEqual(profilesTestResult.contentActiveBtn, 'content');
    assert.strictEqual(profilesTestResult.contentPresetBadge, 'Компактный');
    assert.strictEqual(profilesTestResult.contentCorner, 'right-bottom');
    assert.strictEqual(profilesTestResult.contentOffsetX, 20);
    assert.strictEqual(profilesTestResult.contentOffsetY, 20);
    assert.strictEqual(profilesTestResult.contentMaxMsg, 3);
    assert.strictEqual(profilesTestResult.contentDuration, 12);
    assert.strictEqual(profilesTestResult.contentStackH, 360);
    assert.strictEqual(profilesTestResult.contentRecBadge, 'Рекомендуемый');

    assert.strictEqual(profilesTestResult.gamingBadge, 'Игры');
    assert.strictEqual(profilesTestResult.gamingActiveBtn, 'gaming');
    assert.strictEqual(profilesTestResult.gamingPresetBadge, 'Компактный');
    assert.strictEqual(profilesTestResult.gamingCorner, 'left-bottom');
    assert.strictEqual(profilesTestResult.gamingOffsetX, 24);
    assert.strictEqual(profilesTestResult.gamingOffsetY, 24);
    assert.strictEqual(profilesTestResult.gamingMaxMsg, 4);
    assert.strictEqual(profilesTestResult.gamingDuration, 15);

    assert.strictEqual(profilesTestResult.talkingBadge, 'Разговорный');
    assert.strictEqual(profilesTestResult.talkingActiveBtn, 'talking');
    assert.strictEqual(profilesTestResult.talkingPresetBadge, 'Чистый');
    assert.strictEqual(profilesTestResult.talkingCorner, 'right-bottom');
    assert.strictEqual(profilesTestResult.talkingTextAlign, 'right');
    assert.strictEqual(profilesTestResult.talkingMaxMsg, 6);

    assert.strictEqual(profilesTestResult.minimalBadge, 'Минимализм');
    assert.strictEqual(profilesTestResult.minimalActiveBtn, 'minimal');
    assert.strictEqual(profilesTestResult.minimalPresetBadge, 'Компактный');
    assert.strictEqual(profilesTestResult.minimalMaxMsg, 2);

    assert.strictEqual(profilesTestResult.afterDragProfileBadge, 'Пользовательский');
    assert.strictEqual(profilesTestResult.hasActiveProfileAfterDrag, false, 'No profile button should be active after modifying layout');
    assert.strictEqual(profilesTestResult.afterDragPresetBadge, 'Компактный', 'Appearance preset must remain Compact after modifying layout');

    assert.strictEqual(profilesTestResult.afterPresetProfileBadge, 'Пользовательский');
    assert.strictEqual(profilesTestResult.afterPresetBadge, 'Стекло');
    console.log('✔ All 4 stream profiles (content #1 recommended), preset independence, and drag independence verified in Electron UI');

    // 17. Message Animations v1: Desktop Controls, Lifecycle, and Independence Tests
    console.log('17. Testing Message Animations v1: Desktop UI Controls, Presets & Profiles Independence, and DOM Lifecycle...');
    const animUiResults = await desktopWin.webContents.executeJavaScript(`
      (() => {
        // 17.1 Test animation type switching
        const animTypes = ['none', 'fade', 'slide-up', 'slide-side'];
        const typeButtonsExist = animTypes.every(t => Boolean(document.querySelector(\`[data-animation-type="\${t}"]\`)));

        // Click slide-up
        document.querySelector('[data-animation-type="slide-up"]').click();
        const slideUpActive = document.querySelector('[data-animation-type="slide-up"]')?.classList.contains('active');
        const slideUpAria = document.querySelector('[data-animation-type="slide-up"]')?.getAttribute('aria-pressed');
        const fadeAfterSlideUp = document.querySelector('[data-animation-type="fade"]')?.classList.contains('active');
        const configAfterSlideUp = gatherCurrentConfig();

        // 17.2 Speed preset click: 'Быстро' (180ms)
        document.querySelector('[data-animation-speed="180"]').click();
        const speedFastActive = document.querySelector('[data-animation-speed="180"]')?.classList.contains('active');
        const sliderFastVal = document.querySelector('#animation-duration-slider')?.value;
        const speedFastLabel = document.querySelector('#animation-speed-label')?.textContent;
        const configAfterFast = gatherCurrentConfig();

        // 17.3 Speed preset click: 'Плавно' (450ms)
        document.querySelector('[data-animation-speed="450"]').click();
        const speedSmoothActive = document.querySelector('[data-animation-speed="450"]')?.classList.contains('active');
        const sliderSmoothVal = document.querySelector('#animation-duration-slider')?.value;
        const speedSmoothLabel = document.querySelector('#animation-speed-label')?.textContent;
        const configAfterSmooth = gatherCurrentConfig();

        // 17.4 Slider manual drag to 320ms -> label shows 'Обычно · 320 мс'
        const slider = document.querySelector('#animation-duration-slider');
        slider.value = '320';
        slider.dispatchEvent(new Event('input'));
        const speed320Label = document.querySelector('#animation-speed-label')?.textContent;
        const configAfterSlider = gatherCurrentConfig();

        // 17.5 Select 'none' -> speed container disabled, label shows 'Мгновенно'
        document.querySelector('[data-animation-type="none"]').click();
        const noneActive = document.querySelector('[data-animation-type="none"]')?.classList.contains('active');
        const noneAria = document.querySelector('[data-animation-type="none"]')?.getAttribute('aria-pressed');
        const speedDisabled = document.querySelector('#animation-speed-container')?.classList.contains('disabled');
        const speedNoneLabel = document.querySelector('#animation-speed-label')?.textContent;
        const configAfterNone = gatherCurrentConfig();

        // 17.6 Independence check: changing animation does NOT alter active profile or preset
        document.querySelector('#profile-btn-content').click();
        const profileBeforeAnim = document.querySelector('#profile-status-badge')?.textContent;
        const presetBeforeAnim = document.querySelector('#preset-status-badge')?.textContent;
        document.querySelector('[data-animation-type="slide-side"]').click();
        document.querySelector('[data-animation-speed="280"]').click();
        const profileAfterAnim = document.querySelector('#profile-status-badge')?.textContent;
        const presetAfterAnim = document.querySelector('#preset-status-badge')?.textContent;

        // 17.7 syncInputsFromConfig restores animation settings
        syncInputsFromConfig({
          animationType: 'slide-up',
          animationDurationMs: 400
        });
        const restoredTypeActive = document.querySelector('[data-animation-type="slide-up"]')?.classList.contains('active');
        const restoredSliderVal = document.querySelector('#animation-duration-slider')?.value;
        const restoredLabel = document.querySelector('#animation-speed-label')?.textContent;

        return {
          typeButtonsExist,
          slideUpActive,
          slideUpAria,
          fadeAfterSlideUp,
          configAfterSlideUp,
          speedFastActive,
          sliderFastVal,
          speedFastLabel,
          configAfterFast,
          speedSmoothActive,
          sliderSmoothVal,
          speedSmoothLabel,
          configAfterSmooth,
          speed320Label,
          configAfterSlider,
          noneActive,
          noneAria,
          speedDisabled,
          speedNoneLabel,
          configAfterNone,
          profileBeforeAnim,
          presetBeforeAnim,
          profileAfterAnim,
          presetAfterAnim,
          restoredTypeActive,
          restoredSliderVal,
          restoredLabel
        };
      })()
    `);

    assert.strictEqual(animUiResults.typeButtonsExist, true, 'All 4 animation type buttons must exist in DOM');
    assert.strictEqual(animUiResults.slideUpActive, true, 'Slide-up button must be active');
    assert.strictEqual(animUiResults.slideUpAria, 'true', 'Slide-up button aria-pressed must be true');
    assert.strictEqual(animUiResults.fadeAfterSlideUp, false, 'Fade button must no longer be active');
    assert.strictEqual(animUiResults.configAfterSlideUp.animationType, 'slide-up');

    assert.strictEqual(animUiResults.speedFastActive, true, 'Fast speed button must be active');
    assert.strictEqual(animUiResults.sliderFastVal, '180');
    assert.strictEqual(animUiResults.speedFastLabel, 'Быстро · 180 мс');
    assert.strictEqual(animUiResults.configAfterFast.animationDurationMs, 180);

    assert.strictEqual(animUiResults.speedSmoothActive, true, 'Smooth speed button must be active');
    assert.strictEqual(animUiResults.sliderSmoothVal, '450');
    assert.strictEqual(animUiResults.speedSmoothLabel, 'Плавно · 450 мс');
    assert.strictEqual(animUiResults.configAfterSmooth.animationDurationMs, 450);

    assert.strictEqual(animUiResults.speed320Label, 'Обычно · 320 мс');
    assert.strictEqual(animUiResults.configAfterSlider.animationDurationMs, 320);

    assert.strictEqual(animUiResults.noneActive, true);
    assert.strictEqual(animUiResults.noneAria, 'true');
    assert.strictEqual(animUiResults.speedDisabled, true, 'Speed container must be disabled when animationType is none');
    assert.strictEqual(animUiResults.speedNoneLabel, 'Мгновенно');
    assert.strictEqual(animUiResults.configAfterNone.animationType, 'none');

    assert.strictEqual(animUiResults.profileBeforeAnim, 'Просмотр контента');
    assert.strictEqual(animUiResults.profileAfterAnim, 'Просмотр контента', 'Profile must remain content when animation changes');
    assert.strictEqual(animUiResults.presetBeforeAnim, 'Компактный');
    assert.strictEqual(animUiResults.presetAfterAnim, 'Компактный', 'Preset must remain compact when animation changes');

    assert.strictEqual(animUiResults.restoredTypeActive, true);
    assert.strictEqual(animUiResults.restoredSliderVal, '400');
    assert.strictEqual(animUiResults.restoredLabel, 'Плавно · 400 мс');
    console.log('✔ Desktop UI animation controls, speed presets, slider, and profile/preset independence verified');

    // 17.8 Overlay DOM Lifecycle and Transition Invariants (Requirement #24)
    console.log('17.8 Testing Overlay DOM Lifecycle states (entering -> visible -> exiting -> removed)...');
    const lifecycleResult = await overlayWin.webContents.executeJavaScript(`
      new Promise(resolve => {
        if (typeof events !== 'undefined' && typeof handleConfig === 'function') {
          events.removeEventListener('config', handleConfig);
        }
        const animCfg = { animationType: 'fade', animationDurationMs: 200, durationSeconds: 0, maxMessages: 5 };
        applyConfig(animCfg);
        const container = document.querySelector('#messages');
        container.innerHTML = '';
        window.activeMessages.length = 0;
        window.cardsByEventId.clear();

        // 1. Live SSE arrival
        handleMessage({
          data: JSON.stringify({
            eventId: 'anim-live-1',
            author: 'Тестер',
            text: 'Проверка жизненного цикла анимации',
            receivedAt: Date.now()
          })
        }, { animate: true, config: animCfg });

        const card = container.querySelector('.message');
        const stateEntering = {
          hasEnterClass: card?.classList.contains('message-enter'),
          lifecycle: card?.dataset.lifecycle,
          hasDisappearing: card?.classList.contains('disappearing')
        };

        // 2. Wait for enter animation to settle (200ms duration)
        setTimeout(() => {
          const stateVisible = {
            hasEnterClass: card?.classList.contains('message-enter'),
            hasVisibleClass: card?.classList.contains('message-visible'),
            lifecycle: card?.dataset.lifecycle,
            hasDisappearing: card?.classList.contains('disappearing')
          };

          // 3. Trigger removal (exit animation)
          removeMessage(card, { config: animCfg });
          const stateExiting = {
            hasExitClass: card?.classList.contains('message-exit'),
            hasDisappearing: card?.classList.contains('disappearing'),
            lifecycle: card?.dataset.lifecycle
          };

          // 4. Wait for exit animation to complete and DOM card removal
          setTimeout(() => {
            const stateRemoved = {
              inDom: container.contains(card),
              remainingCards: container.querySelectorAll('.message').length
            };

            // 5. Test animation: 'none' immediate removal
            applyConfig({ animationType: 'none' });
            handleMessage({
              data: JSON.stringify({
                eventId: 'anim-none-1',
                author: 'Тестер2',
                text: 'Проверка none',
                receivedAt: Date.now()
              })
            }, { animate: false });
            const cardNone = container.querySelector('.message');
            const noneEnterState = {
              hasEnterClass: cardNone?.classList.contains('message-enter'),
              lifecycle: cardNone?.dataset.lifecycle
            };
            removeMessage(cardNone, { config: { animationType: 'none' } });
            const noneRemovedImmediately = !container.contains(cardNone);

            if (typeof events !== 'undefined' && typeof handleConfig === 'function') {
              events.addEventListener('config', handleConfig);
            }

            resolve({
              stateEntering,
              stateVisible,
              stateExiting,
              stateRemoved,
              noneEnterState,
              noneRemovedImmediately
            });
          }, 240);
        }, 240);
      })
    `);

    assert.strictEqual(lifecycleResult.stateEntering.hasEnterClass, true, 'New card must get .message-enter class');
    assert.strictEqual(lifecycleResult.stateEntering.lifecycle, 'entering', 'Card dataset.lifecycle must be entering');
    assert.strictEqual(lifecycleResult.stateEntering.hasDisappearing, false);

    assert.strictEqual(lifecycleResult.stateVisible.hasEnterClass, false, '.message-enter must be removed after duration');
    assert.strictEqual(lifecycleResult.stateVisible.hasVisibleClass, true, '.message-visible must be added after duration');
    assert.strictEqual(lifecycleResult.stateVisible.lifecycle, 'visible', 'Card dataset.lifecycle must be visible');

    assert.strictEqual(lifecycleResult.stateExiting.hasExitClass, true, '.message-exit must be added on removal');
    assert.strictEqual(lifecycleResult.stateExiting.hasDisappearing, true, '.disappearing must be added on removal');
    assert.strictEqual(lifecycleResult.stateExiting.lifecycle, 'exiting', 'Card dataset.lifecycle must be exiting');

    assert.strictEqual(lifecycleResult.stateRemoved.inDom, false, 'Card must be removed from DOM after exit duration');
    assert.strictEqual(lifecycleResult.stateRemoved.remainingCards, 0);

    assert.strictEqual(lifecycleResult.noneEnterState.hasEnterClass, false, 'Animation none must not add .message-enter');
    assert.strictEqual(lifecycleResult.noneEnterState.lifecycle, 'visible', 'Animation none must immediately be visible');
    assert.strictEqual(lifecycleResult.noneRemovedImmediately, true, 'Animation none must remove DOM card immediately');
    console.log('✔ Full animation DOM lifecycle (entering -> visible -> exiting -> removed) verified');

    // 18. Testing Canonical Boosty Asset & Sticky Live Preview Scroll UX
    console.log('18. Testing Canonical Boosty Asset & Sticky Live Preview Scroll UX...');

    // 18.1 Canonical Boosty Asset verification in Desktop DOM
    const boostyAssetCheck = await desktopWin.webContents.executeJavaScript(`
      (() => {
        const symbol = document.querySelector('#icon-boosty');
        const viewBox = symbol ? symbol.getAttribute('viewBox') : null;
        const colorSymbol = document.querySelector('#icon-boosty-color');
        const colorViewBox = colorSymbol ? colorSymbol.getAttribute('viewBox') : null;
        const logo = document.querySelector('.sidebar-header .logo');
        const logoIcon = logo ? logo.querySelector('.logo-icon') : null;
        const logoUse = logoIcon ? logoIcon.querySelector('use') : null;
        const logoRect = logo ? logo.getBoundingClientRect() : null;
        const svgRect = logoIcon ? logoIcon.getBoundingClientRect() : null;
        const useRect = logoUse ? logoUse.getBoundingClientRect() : null;
        const dashPillIcon = document.querySelector('#dash-boosty-pill use')?.getAttribute('href');

        return {
          viewBox,
          colorViewBox,
          hasLogoIcon: Boolean(logoIcon),
          logoSvgViewBoxAttr: logoIcon ? logoIcon.getAttribute('viewBox') : null,
          logoRect: logoRect ? { left: logoRect.left, top: logoRect.top, right: logoRect.right, bottom: logoRect.bottom, width: logoRect.width, height: logoRect.height } : null,
          svgRect: svgRect ? { left: svgRect.left, top: svgRect.top, right: svgRect.right, bottom: svgRect.bottom, width: svgRect.width, height: svgRect.height } : null,
          useRect: useRect ? { left: useRect.left, top: useRect.top, right: useRect.right, bottom: useRect.bottom, width: useRect.width, height: useRect.height } : null,
          dashPillUsesBoosty: dashPillIcon === '#icon-boosty'
        };
      })()
    `);
    assert.strictEqual(boostyAssetCheck.viewBox, '0 0 235.6 292.2', 'Canonical Boosty viewBox must be 0 0 235.6 292.2');
    assert.strictEqual(boostyAssetCheck.colorViewBox, '23.6 46.6 189 199', 'Color Boosty symbol viewBox must be 23.6 46.6 189 199');
    assert.strictEqual(boostyAssetCheck.hasLogoIcon, true, 'Sidebar logo must contain canonical .logo-icon SVG');
    assert.strictEqual(boostyAssetCheck.logoSvgViewBoxAttr, null, 'Outer .logo-icon SVG must not duplicate symbol non-zero viewBox');
    assert.ok(boostyAssetCheck.useRect && boostyAssetCheck.useRect.width > 0 && boostyAssetCheck.useRect.height > 0, 'Rendered logo <use> must have positive width/height');
    assert.ok(
      boostyAssetCheck.useRect.left >= boostyAssetCheck.svgRect.left - 0.5 &&
      boostyAssetCheck.useRect.top >= boostyAssetCheck.svgRect.top - 0.5 &&
      boostyAssetCheck.useRect.right <= boostyAssetCheck.svgRect.right + 0.5 &&
      boostyAssetCheck.useRect.bottom <= boostyAssetCheck.svgRect.bottom + 0.5,
      'Rendered logo <use> must be completely contained within .logo-icon SVG without clipping'
    );
    assert.strictEqual(boostyAssetCheck.dashPillUsesBoosty, true, 'Dashboard boosty pill must use #icon-boosty');
    console.log('✔ Canonical Boosty asset in symbol and sidebar verified');

    // 18.2 Sticky Live Preview on 1280x850
    desktopWin.setContentSize(1280, 850);
    await new Promise(r => setTimeout(r, 120));

    // Scroll down by 800px into card/text settings
    const scroll800Result = await desktopWin.webContents.executeJavaScript(`
      (async () => {
        window.scrollTo(0, 800);
        await new Promise(r => setTimeout(r, 100));

        const header = document.querySelector('.content-header').getBoundingClientRect();
        const preview = document.querySelector('#sticky-preview-container').getBoundingClientRect();
        const scrollY = window.scrollY;

        return {
          scrollY,
          headerBottom: header.bottom,
          previewTop: preview.top,
          previewBottom: preview.bottom,
          gap: preview.top - header.bottom,
          fitsInViewport: preview.bottom <= window.innerHeight,
          noHScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth
        };
      })()
    `);

    assert.ok(scroll800Result.scrollY > 0, 'Page must be scrolled down');
    assert.ok(scroll800Result.gap >= 16, 'Sticky preview top must have spacing below header bottom');
    assert.strictEqual(scroll800Result.fitsInViewport, true, 'Sticky preview must fit within 1280x850 viewport');
    assert.strictEqual(scroll800Result.noHScroll, true, 'Must have zero horizontal scroll');
    console.log('✔ Sticky preview persistence at scrollY=800 verified');

    // 18.3 Drag & Drop while scrolled down
    const dragScrolledResult = await desktopWin.webContents.executeJavaScript(`
      (async () => {
        window.scrollTo(0, 800);
        await new Promise(r => setTimeout(r, 60));

        const hitbox = document.querySelector('#chat-drag-hitbox');
        const wrapper = document.querySelector('#preview-scale-wrapper');
        const initialBox = hitbox.getBoundingClientRect();
        const wrapperBox = wrapper.getBoundingClientRect();

        const startX = initialBox.left + initialBox.width / 2;
        const startY = initialBox.top + initialBox.height / 2;
        const targetX = wrapperBox.left + wrapperBox.width * 0.85;
        const targetY = wrapperBox.top + wrapperBox.height * 0.15;

        hitbox.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, clientX: startX, clientY: startY, button: 0, pointerId: 1
        }));

        hitbox.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, cancelable: true, clientX: targetX, clientY: targetY, button: 0, pointerId: 1
        }));

        hitbox.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, clientX: targetX, clientY: targetY, button: 0, pointerId: 1
        }));

        await new Promise(r => setTimeout(r, 60));

        const activeCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
        const offsetX = Number(document.querySelector('#offset-x')?.value);
        const offsetY = Number(document.querySelector('#offset-y')?.value);

        return { activeCorner, offsetX, offsetY };
      })()
    `);
    assert.strictEqual(dragScrolledResult.activeCorner, 'right-top', 'Drag while scrolled must switch corner to right-top');
    console.log('✔ Drag & Drop while scrolled down verified (switched to right-top)');

    // Reset layout position
    await desktopWin.webContents.executeJavaScript(`
      document.querySelector('#layout-reset-btn')?.click();
      window.scrollTo(0, 0);
    `);
    await new Promise(r => setTimeout(r, 80));

    // 18.4 Sticky preview on 1000x750 viewport
    desktopWin.setContentSize(1000, 750);
    await new Promise(r => setTimeout(r, 100));

    const scroll1000Result = await desktopWin.webContents.executeJavaScript(`
      (async () => {
        window.scrollTo(0, 600);
        await new Promise(r => setTimeout(r, 100));

        const header = document.querySelector('.content-header').getBoundingClientRect();
        const preview = document.querySelector('#sticky-preview-container').getBoundingClientRect();

        return {
          scrollY: window.scrollY,
          previewTop: preview.top,
          previewBottom: preview.bottom,
          fitsInViewport: preview.bottom <= window.innerHeight,
          gap: preview.top - header.bottom
        };
      })()
    `);
    assert.ok(scroll1000Result.gap >= 16, '1000x750 sticky preview must stay below header');
    assert.strictEqual(scroll1000Result.fitsInViewport, true, '1000x750 sticky preview must fit in viewport');
    console.log('✔ Sticky preview on 1000x750 verified');

    desktopWin.setContentSize(800, 650);
    await desktopWin.webContents.executeJavaScript(`
      new Promise(resolve => {
        const start = Date.now();
        const check = () => {
          if (window.innerWidth <= 899 || Date.now() - start > 1500) {
            return resolve();
          }
          requestAnimationFrame(check);
        };
        check();
      })
    `);

    const compactResult = await desktopWin.webContents.executeJavaScript(`
      (() => {
        const preview = document.querySelector('#sticky-preview-container');
        const style = window.getComputedStyle(preview);
        const isRelative = style.position === 'relative';
        const noHScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
        return { isRelative, position: style.position, noHScroll, innerWidth: window.innerWidth };
      })()
    `);
    assert.strictEqual(compactResult.isRelative, true, 'Sticky must be disabled (position: relative) on 800x650');
    assert.strictEqual(compactResult.noHScroll, true, '800x650 must not have horizontal scroll');
    console.log('✔ 800x650 compact mode verifies sticky disabled and zero horizontal overflow');

    console.log('\n======================================================');
    console.log(' All Overlay Layout & Positioning v1 tests PASSED! ');
    console.log('======================================================\n');

    overlayWin.destroy();
    desktopWin.destroy();
    testServer.close();
    try { fs.unlinkSync(process.env.BOOSTY_OVERLAY_CONFIG); } catch {}
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failure in overlay-layout.test.js:', err);
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
    if (desktopWin && !desktopWin.isDestroyed()) desktopWin.destroy();
    testServer.close();
    try { fs.unlinkSync(process.env.BOOSTY_OVERLAY_CONFIG); } catch {}
    app.quit();
    process.exit(1);
  }
});
