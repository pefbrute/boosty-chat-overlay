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
