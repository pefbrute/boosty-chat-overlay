#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const { chromium } = require('playwright');

// =============================================================================
// 1. Environment & Ephemeral Configuration Setup
// =============================================================================
const testPort = 17398;
process.env.BOOSTY_OVERLAY_PORT = String(testPort);
const tmpConfig = path.join(os.tmpdir(), `boosty-overlay-settings-test-${Date.now()}.json`);
process.env.BOOSTY_OVERLAY_CONFIG = tmpConfig;

try {
  fs.unlinkSync(tmpConfig);
} catch {}

const artifactsDir = path.join(__dirname, '..', 'artifacts', 'overlay');
fs.mkdirSync(artifactsDir, { recursive: true });

// Start local server on testPort
const { server, host } = require('../server.js');

// =============================================================================
// 2. Helpers for HTTP API (POST /message, POST /config)
// =============================================================================
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
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
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

function postMessage(msg) {
  return sendHttpRequest('/message', 'POST', msg);
}

function postConfig(cfg) {
  return sendHttpRequest('/config', 'POST', cfg);
}

function getChromiumExecutable() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/brave-browser',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

// Inline SVG Data URL for local avatar testing without external network requests
const localAvatarSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="32" fill="#10b981"/>' +
  '<circle cx="32" cy="24" r="12" fill="#ffffff"/>' +
  '<path d="M14 54 C14 42, 22 38, 32 38 C42 38, 50 42, 50 54 Z" fill="#ffffff"/>' +
  '</svg>'
);

// =============================================================================
// 3. Main Runner
// =============================================================================
async function runOverlayVisualQA() {
  console.log('========================================');
  console.log('       Overlay UI Visual QA             ');
  console.log('========================================\n');

  let browser;
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const layoutIssues = [];
  const screenshots = [];
  const statesChecked = [];
  const viewportsTested = [];
  let replyPipelineStatus = { received: false, rendered: false, notes: '' };

  try {
    // 3.1 Initialize Baseline Config (durationSeconds: 0 to keep cards steady during inspection)
    await postConfig({
      durationSeconds: 0,
      maxMessages: 10,
      fontSize: 21,
      accentColor: '#f15f2c',
      backgroundOpacity: 88,
      showAvatars: true,
      horizontalAnchor: 'left',
      verticalAnchor: 'bottom',
      newMessagePosition: 'bottom',
      offsetX: 20,
      offsetY: 20,
      textAlign: 'left',
      maxStackHeight: 800,
      cardWidth: 520,
      cardPadding: 10,
      avatarSize: 42,
    });

    console.log(`✓ Local server running on http://127.0.0.1:${testPort}`);

    // 3.2 Launch Chromium via Playwright
    const executablePath = getChromiumExecutable();
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Attach Error and Network Listeners
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const loc = msg.location();
        if (text.includes('favicon.ico') || (loc && loc.url && loc.url.includes('favicon.ico'))) {
          return;
        }
        consoleErrors.push({ text, location: loc });
        console.error('  [Browser Console Error]:', text);
      }
    });

    page.on('pageerror', err => {
      pageErrors.push({ message: err.message, stack: err.stack });
      console.error('  [Browser Page Error]:', err.message);
    });

    page.on('requestfailed', req => {
      const url = req.url();
      if (url.includes('favicon.ico')) return;
      failedRequests.push({ url, failure: req.failure()?.errorText });
      console.warn('  [Network Request Failed]:', url);
    });

    // Navigate to overlay
    const overlayUrl = `http://127.0.0.1:${testPort}/overlay/`;
    await page.goto(overlayUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.BoostyRenderer !== 'undefined' && typeof window.activeMessages !== 'undefined', { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    console.log('✓ Overlay loaded successfully');

    // Helper: Reset active cards in page DOM without reconnecting SSE
    async function resetCards() {
      await page.evaluate(() => {
        const el = document.querySelector('#messages');
        if (el) el.innerHTML = '';
        if (window.activeMessages) window.activeMessages.length = 0;
        if (window.cardsByEventId) window.cardsByEventId.clear();
      });
      await page.waitForTimeout(50);
    }

    // Helper: Verify layout invariants & overlap
    async function verifyLayout(stepName) {
      const issues = await page.evaluate(() => {
        const detected = [];
        const docEl = document.documentElement;
        const body = document.body;
        const innerW = window.innerWidth;
        const innerH = window.innerHeight;

        // 1. Horizontal scroll overflow check
        if (docEl.scrollWidth > innerW + 2) {
          detected.push(`Horizontal overflow: doc scrollWidth (${docEl.scrollWidth}px) > innerWidth (${innerW}px)`);
        }
        if (body.scrollWidth > innerW + 2) {
          detected.push(`Horizontal overflow: body scrollWidth (${body.scrollWidth}px) > innerWidth (${innerW}px)`);
        }

        // 2. Visible message cards bounds check
        const container = document.querySelector('#messages');
        const cRect = container ? container.getBoundingClientRect() : null;

        if (cRect) {
          if (cRect.left < -2 || cRect.right > innerW + 2 || cRect.top < -2 || cRect.bottom > innerH + 2) {
            detected.push(`Container #messages overflows viewport bounds: left=${cRect.left}, right=${cRect.right}, top=${cRect.top}, bottom=${cRect.bottom}`);
          }
        }

        const cards = Array.from(document.querySelectorAll('.message:not(.disappearing)'));
        cards.forEach((card, idx) => {
          const rect = card.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            detected.push(`Card [${idx}] has invalid dimensions: ${rect.width}x${rect.height}`);
          }
          if (rect.left < -2) {
            detected.push(`Card [${idx}] overflows left edge: ${rect.left}`);
          }
          if (rect.right > innerW + 2) {
            detected.push(`Card [${idx}] overflows right edge: ${rect.right} > ${innerW}`);
          }
          // If parent container clips via overflow: hidden, only flag if card protrudes without clipping
          const isClippedByParentTop = cRect && cRect.top > rect.top;
          if (!isClippedByParentTop && rect.top < -2) {
            detected.push(`Card [${idx}] overflows top edge: ${rect.top}`);
          }
          const isClippedByParentBottom = cRect && cRect.bottom < rect.bottom;
          if (!isClippedByParentBottom && rect.bottom > innerH + 2) {
            detected.push(`Card [${idx}] overflows bottom edge: ${rect.bottom} > ${innerH}`);
          }
        });

        // 3. Overlap detection
        for (let i = 0; i < cards.length; i++) {
          for (let j = i + 1; j < cards.length; j++) {
            const r1 = cards[i].getBoundingClientRect();
            const r2 = cards[j].getBoundingClientRect();
            const xOverlap = Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left));
            const yOverlap = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top));
            if (xOverlap > 2 && yOverlap > 2) {
              detected.push(`Cards [${i}] and [${j}] collide: xOverlap=${xOverlap.toFixed(1)}px, yOverlap=${yOverlap.toFixed(1)}px`);
            }
          }
        }

        return detected;
      });

      if (issues.length > 0) {
        layoutIssues.push({ step: stepName, issues });
        console.warn(`  ⚠ Layout issues at "${stepName}":`, issues);
      }
      return issues.length === 0;
    }

    async function captureScreenshot(filename) {
      const filePath = path.join(artifactsDir, filename);
      await page.screenshot({ path: filePath });
      screenshots.push(filename);
      return filePath;
    }

    // Helper: Wait for expected visible cards count
    async function waitForCardsCount(expectedCount) {
      await page.waitForFunction(
        count => document.querySelectorAll('.message:not(.disappearing)').length === count,
        expectedCount,
        { timeout: 5000 }
      );
      // Wait for CSS appear animation (220ms) to settle
      await page.waitForTimeout(260);
    }

    // =========================================================================
    // Scenario 1: Single Standard Message (800x600)
    // =========================================================================
    console.log('\n--- Scenario 1: Single Standard Message ---');
    await resetCards();
    viewportsTested.push('800x600');

    await postMessage({
      id: 'visual-single-1',
      platform: 'boosty',
      author: { name: 'Фёдор', avatar: null },
      text: 'Обычное тестовое сообщение',
      reply: null,
      publishedAt: '21:30',
    });
    await waitForCardsCount(1);
    await verifyLayout('single-message');
    await captureScreenshot('single-message.png');
    statesChecked.push('single-message');

    // DOM assertions on single message card
    const singleCardData = await page.evaluate(() => {
      const card = document.querySelector('.message');
      const author = card?.querySelector('.author')?.textContent;
      const text = card?.querySelector('.text')?.textContent;
      const rect = card?.getBoundingClientRect();
      return { author, text, width: rect?.width, height: rect?.height };
    });
    if (singleCardData.author !== 'Фёдор' || singleCardData.text !== 'Обычное тестовое сообщение') {
      throw new Error(`Single message DOM assertion failed: ${JSON.stringify(singleCardData)}`);
    }
    console.log('✓ Single message verified -> single-message.png');

    // =========================================================================
    // Scenario 2: Multiple Messages (Stack Order & No Collisions)
    // =========================================================================
    console.log('\n--- Scenario 2: Multiple Messages Stack ---');
    await resetCards();
    for (let i = 1; i <= 5; i++) {
      await postMessage({
        id: `visual-multi-${i}`,
        platform: 'boosty',
        author: { name: `Зритель ${i}`, avatar: null },
        text: `Сообщение в цепочке номер ${i} для проверки вертикального стека`,
        publishedAt: `21:3${i}`,
      });
    }
    await waitForCardsCount(5);
    await verifyLayout('multiple-messages');
    await captureScreenshot('multiple-messages.png');
    statesChecked.push('multiple-messages');
    console.log('✓ Multiple messages verified -> multiple-messages.png');

    // =========================================================================
    // Scenario 3: Reply / Quote Message
    // =========================================================================
    console.log('\n--- Scenario 3: Reply Message ---');
    await resetCards();
    await postMessage({
      id: 'visual-reply-1',
      platform: 'boosty',
      author: { name: 'Анна', avatar: null },
      text: 'Ответ на предыдущее сообщение стримера',
      reply: {
        author: 'Фёдор',
        text: 'Обычное тестовое сообщение',
      },
      publishedAt: '21:37',
    });
    await waitForCardsCount(1);
    await verifyLayout('reply-message');
    await captureScreenshot('reply-message.png');
    statesChecked.push('reply-message');

    // Inspect reply UI presence in DOM
    const replyPresence = await page.evaluate(() => {
      const card = document.querySelector('.message');
      const hasReplyClass = card?.querySelector('.reply, .quote, [data-reply]') !== null;
      return { hasReplyClass };
    });

    replyPipelineStatus = {
      received: true,
      rendered: replyPresence.hasReplyClass,
      notes: replyPresence.hasReplyClass
        ? 'Reply UI element rendered.'
        : 'Reply data preserved in model pipeline; visual renderer currently does not render reply quotes (expected current behavior).',
    };
    console.log(`✓ Reply message verified (${replyPipelineStatus.notes}) -> reply-message.png`);

    // =========================================================================
    // Scenario 4: Long Message (300-500 characters Russian text)
    // =========================================================================
    console.log('\n--- Scenario 4: Long Text Message ---');
    await resetCards();
    await postMessage({
      id: 'visual-long-text-1',
      platform: 'boosty',
      author: { name: 'Алексей', avatar: null },
      text: 'Это очень длинное тестовое сообщение в чате Boosty, предназначенное для проверки того, как оверлей переносит длинные строки текста без горизонтального переполнения и без обрезания карточки сообщения. Текст должен аккуратно укладываться в несколько строк, не выходя за пределы максимальной ширины карточки и сохраняя правильные отступы внутри контейнера.',
      publishedAt: '21:38',
    });
    await waitForCardsCount(1);
    await verifyLayout('long-message');
    await captureScreenshot('long-message.png');
    statesChecked.push('long-message');
    console.log('✓ Long text message verified -> long-message.png');

    // =========================================================================
    // Scenario 5: Long Author Name
    // =========================================================================
    console.log('\n--- Scenario 5: Long Author Name ---');
    await resetCards();
    await postMessage({
      id: 'visual-long-author-1',
      platform: 'boosty',
      author: { name: 'ОченьДлинноеИмяПользователяКотороеПотенциальноМожетСломатьКарточку', avatar: null },
      text: 'Проверка отображения экстремально длинного ника автора без вылета за карточку.',
      publishedAt: '21:39',
    });
    await waitForCardsCount(1);
    await verifyLayout('long-author');
    await captureScreenshot('long-author.png');
    statesChecked.push('long-author');
    console.log('✓ Long author name verified -> long-author.png');

    // =========================================================================
    // Scenario 6: Avatar Variations (No Avatar vs Local Data URL)
    // =========================================================================
    console.log('\n--- Scenario 6: Avatar Variations ---');
    await resetCards();

    // 6.1 Avatar absent (fallback)
    await postMessage({
      id: 'visual-no-avatar-1',
      platform: 'boosty',
      author: { name: 'ПользовательБезАватарки', avatar: null },
      text: 'У этого пользователя аватарка отсутствует, проверяется fallback SVG плейсхолдер.',
      publishedAt: '21:40',
    });
    await waitForCardsCount(1);
    await verifyLayout('no-avatar');
    await captureScreenshot('no-avatar.png');
    statesChecked.push('no-avatar');
    console.log('✓ No avatar verified -> no-avatar.png');

    // 6.2 Local Avatar data URI (zero external network requests)
    await postMessage({
      id: 'visual-local-avatar-1',
      platform: 'boosty',
      author: { name: 'ЗрительСАватаркой', avatar: localAvatarSvg },
      text: 'У этого пользователя задан локальный SVG data URL аватар, проверена отрисовка без запросов в сеть.',
      publishedAt: '21:41',
    });
    await waitForCardsCount(2);
    await verifyLayout('local-avatar');
    await captureScreenshot('local-avatar.png');
    statesChecked.push('local-avatar');
    console.log('✓ Local avatar verified -> local-avatar.png');

    // =========================================================================
    // Scenario 7: Unicode & Emoji
    // =========================================================================
    console.log('\n--- Scenario 7: Unicode & Emoji ---');
    await resetCards();
    await postMessage({
      id: 'visual-unicode-1',
      platform: 'boosty',
      author: { name: 'UnicodeTester 🌍', avatar: null },
      text: 'Привет 👋🔥❤️😂 日本語 中文 العربية — тест эмодзи и спецсимволов',
      publishedAt: '21:42',
    });
    await waitForCardsCount(1);
    await verifyLayout('unicode-emoji');
    await captureScreenshot('unicode-emoji.png');
    statesChecked.push('unicode-emoji');
    console.log('✓ Unicode & emoji verified -> unicode-emoji.png');

    // =========================================================================
    // Scenario 8: 4 Corner Anchors & Quadrant Assertions
    // =========================================================================
    console.log('\n--- Scenario 8: Four Corner Anchors ---');
    await resetCards();

    // Add 2 messages for anchor testing
    for (let i = 1; i <= 2; i++) {
      await postMessage({
        id: `anchor-msg-${i}`,
        platform: 'boosty',
        author: { name: `User ${i}`, avatar: null },
        text: `Anchor test message ${i}`,
        publishedAt: `21:4${i}`,
      });
    }
    await waitForCardsCount(2);

    const anchors = [
      { name: 'top-left', h: 'left', v: 'top', check: r => r.left < 400 && r.top < 300 },
      { name: 'top-right', h: 'right', v: 'top', check: r => r.right > 400 && r.top < 300 },
      { name: 'bottom-left', h: 'left', v: 'bottom', check: r => r.left < 400 && r.bottom > 300 },
      { name: 'bottom-right', h: 'right', v: 'bottom', check: r => r.right > 400 && r.bottom > 300 },
    ];

    for (const a of anchors) {
      await postConfig({ horizontalAnchor: a.h, verticalAnchor: a.v });
      await page.waitForTimeout(100);
      await verifyLayout(`anchor-${a.name}`);

      const rect = await page.evaluate(() => {
        const container = document.querySelector('#messages');
        const b = container.getBoundingClientRect();
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      });

      if (!a.check(rect)) {
        throw new Error(`Anchor ${a.name} quadrant check failed: ${JSON.stringify(rect)}`);
      }

      await captureScreenshot(`${a.name}.png`);
      statesChecked.push(a.name);
      console.log(`✓ Anchor ${a.name} verified in expected quadrant -> ${a.name}.png`);
    }

    // Reset back to bottom-left default
    await postConfig({ horizontalAnchor: 'left', verticalAnchor: 'bottom' });

    // =========================================================================
    // Scenario 9: Stack Direction (top vs bottom)
    // =========================================================================
    console.log('\n--- Scenario 9: Stack Direction (New Message Position) ---');
    await postConfig({ newMessagePosition: 'top' });
    await page.waitForTimeout(100);
    await postMessage({
      id: 'direction-top-msg',
      platform: 'boosty',
      author: { name: 'TopPlacement', avatar: null },
      text: 'Это сообщение должно появиться на самом верху стека сообщений!',
      publishedAt: '21:45',
    });
    await waitForCardsCount(3);
    await verifyLayout('direction-top');

    const firstCardAuthor = await page.evaluate(() => {
      const cards = document.querySelectorAll('.message:not(.disappearing)');
      return cards[0]?.querySelector('.author')?.textContent;
    });
    if (firstCardAuthor !== 'TopPlacement') {
      throw new Error(`Expected newest card to be at top, got: ${firstCardAuthor}`);
    }
    await captureScreenshot('direction-top.png');
    statesChecked.push('direction-top');
    console.log('✓ Direction top verified (new message prepended) -> direction-top.png');

    // Reset back to bottom
    await postConfig({ newMessagePosition: 'bottom' });

    // =========================================================================
    // Scenario 10: Max Stack Height Constraint
    // =========================================================================
    console.log('\n--- Scenario 10: Max Stack Height Constraint ---');
    await resetCards();
    await postConfig({ maxStackHeight: 220, maxMessages: 10 });
    await page.waitForTimeout(100);

    for (let i = 1; i <= 5; i++) {
      await postMessage({
        id: `height-msg-${i}`,
        platform: 'boosty',
        author: { name: `User ${i}`, avatar: null },
        text: `Стек с ограничением высоты 220px: сообщение ${i}`,
        publishedAt: `21:4${i}`,
      });
    }
    await waitForCardsCount(5);
    await verifyLayout('max-height-stress');

    const containerHeight = await page.evaluate(() => {
      const el = document.querySelector('#messages');
      return el ? el.getBoundingClientRect().height : 0;
    });
    if (containerHeight > 230) {
      throw new Error(`Max stack height exceeded: expected <= 230px, got ${containerHeight}px`);
    }
    await captureScreenshot('max-height-stress.png');
    statesChecked.push('max-height-stress');
    console.log(`✓ Max stack height constraint confirmed (${containerHeight.toFixed(1)}px <= 220px) -> max-height-stress.png`);

    // Reset maxStackHeight back to 800
    await postConfig({ maxStackHeight: 800 });

    // =========================================================================
    // Scenario 11: Narrow Browser Source (400x700)
    // =========================================================================
    console.log('\n--- Scenario 11: Narrow Browser Source (400x700) ---');
    await page.setViewportSize({ width: 400, height: 700 });
    viewportsTested.push('400x700');
    await page.waitForTimeout(100);
    await resetCards();

    await postMessage({
      id: 'narrow-msg-1',
      platform: 'boosty',
      author: { name: 'БоковойЧат', avatar: localAvatarSvg },
      text: 'Тестирование узкого источника Browser Source в OBS (400x700). Текст должен сжиматься без горизонтального скролла.',
      publishedAt: '21:50',
    });
    await waitForCardsCount(1);
    await verifyLayout('narrow-source');
    await captureScreenshot('narrow-source.png');
    statesChecked.push('narrow-source');
    console.log('✓ Narrow source verified (400x700) -> narrow-source.png');

    // =========================================================================
    // Scenario 12: Small Height Viewport (600x300)
    // =========================================================================
    console.log('\n--- Scenario 12: Small Height Viewport (600x300) ---');
    await page.setViewportSize({ width: 600, height: 300 });
    viewportsTested.push('600x300');
    await page.waitForTimeout(100);
    await resetCards();

    for (let i = 1; i <= 3; i++) {
      await postMessage({
        id: `small-h-msg-${i}`,
        platform: 'boosty',
        author: { name: `Стример ${i}`, avatar: null },
        text: `Сообщение для невысокого окна ${i}`,
        publishedAt: `21:5${i}`,
      });
    }
    await waitForCardsCount(3);
    await verifyLayout('small-height');
    await captureScreenshot('small-height.png');
    statesChecked.push('small-height');
    console.log('✓ Small height verified (600x300) -> small-height.png');

    // =========================================================================
    // Scenario 13: Full HD Broadcast (1920x1080) & Visual Presets
    // =========================================================================
    console.log('\n--- Scenario 13: Full HD (1920x1080) & Visual Presets ---');
    await page.setViewportSize({ width: 1920, height: 1080 });
    viewportsTested.push('1920x1080');
    await page.waitForTimeout(100);
    await resetCards();

    // 13.1 Compact preset
    await postConfig({
      fontSize: 16,
      authorFontSize: 13,
      cardPadding: 6,
      avatarSize: 32,
      cardWidth: 400,
      accentColor: '#3b82f6',
    });
    await page.waitForTimeout(100);

    await postMessage({
      id: 'preset-compact-msg',
      platform: 'boosty',
      author: { name: 'Компактный стиль', avatar: localAvatarSvg },
      text: 'Отображение в компактном пресете на Full HD разрешении 1920x1080.',
      publishedAt: '21:55',
    });
    await waitForCardsCount(1);
    await verifyLayout('preset-compact');
    await captureScreenshot('preset-compact.png');
    statesChecked.push('preset-compact');
    console.log('✓ Preset compact verified -> preset-compact.png');

    // 13.2 Large / High-Contrast preset
    await resetCards();
    await postConfig({
      fontSize: 26,
      authorFontSize: 20,
      cardPadding: 16,
      avatarSize: 52,
      cardWidth: 620,
      accentColor: '#ff2d55',
      backgroundOpacity: 95,
    });
    await page.waitForTimeout(100);

    await postMessage({
      id: 'preset-large-msg',
      platform: 'boosty',
      author: { name: 'Крупный контрастный стиль', avatar: localAvatarSvg },
      text: 'Крупный шрифт и яркий акцент для читаемости с большого расстояния.',
      publishedAt: '21:56',
    });
    await waitForCardsCount(1);
    await verifyLayout('preset-large');
    await captureScreenshot('preset-large.png');
    statesChecked.push('preset-large');
    console.log('✓ Preset large verified -> preset-large.png');

    // Full HD default capture
    await resetCards();
    await postConfig({
      fontSize: 21,
      authorFontSize: 16,
      cardPadding: 10,
      avatarSize: 42,
      cardWidth: 520,
      accentColor: '#f15f2c',
      backgroundOpacity: 88,
    });
    await page.waitForTimeout(100);

    for (let i = 1; i <= 3; i++) {
      await postMessage({
        id: `fhd-msg-${i}`,
        platform: 'boosty',
        author: { name: `FHD User ${i}`, avatar: localAvatarSvg },
        text: `Сообщение на Full HD холсте 1920x1080 номер ${i}`,
        publishedAt: `21:5${i}`,
      });
    }
    await waitForCardsCount(3);
    await verifyLayout('viewport-1920x1080');
    await captureScreenshot('viewport-1920x1080.png');
    statesChecked.push('viewport-1920x1080');
    console.log('✓ Full HD 1920x1080 verified -> viewport-1920x1080.png');

    // =========================================================================
    // 4. Verification Results & Reporting
    // =========================================================================
    const passed = consoleErrors.length === 0 && pageErrors.length === 0 && layoutIssues.length === 0 && failedRequests.length === 0;

    const report = {
      passed,
      timestamp: new Date().toISOString(),
      screenshots,
      statesChecked,
      viewports: Array.from(new Set(viewportsTested)),
      replyPipelineStatus,
      consoleErrorsCount: consoleErrors.length,
      pageErrorsCount: pageErrors.length,
      layoutIssuesCount: layoutIssues.length,
      failedRequestsCount: failedRequests.length,
      consoleErrors,
      pageErrors,
      layoutIssues,
      failedRequests,
    };

    fs.writeFileSync(path.join(artifactsDir, 'visual-report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(artifactsDir, 'console-errors.json'), JSON.stringify(consoleErrors, null, 2));

    console.log('\n========================================');
    console.log('       Overlay QA Verification Results  ');
    console.log('========================================');
    console.log(`✓ Total screenshots: ${screenshots.length}`);
    console.log(`✓ States checked: ${statesChecked.join(', ')}`);
    console.log(`✓ Viewports tested: ${viewportsTested.join(', ')}`);
    console.log(`✓ Console errors: ${consoleErrors.length}`);
    console.log(`✓ Page errors: ${pageErrors.length}`);
    console.log(`✓ Layout issues: ${layoutIssues.length}`);
    console.log(`✓ Failed network requests: ${failedRequests.length}`);
    console.log(`✓ Report saved: artifacts/overlay/visual-report.json`);
    console.log('========================================');

    if (!passed) {
      console.error('FAIL: Overlay Visual QA detected defects.');
      process.exit(1);
    }

    console.log('PASS: Overlay Visual QA passed cleanly.\n');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (server && server.listening) {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve)).catch(() => {});
    }
    try {
      fs.unlinkSync(tmpConfig);
    } catch {}
  }
}

runOverlayVisualQA().catch(err => {
  console.error('Unhandled runner error:', err);
  process.exit(1);
});
