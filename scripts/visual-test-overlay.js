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

// Inline SVG Data URLs for Boosty custom emoji testing (zero external network requests)
const emojiHeartSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">' +
  '<circle cx="28" cy="28" r="26" fill="#ff3b5c" opacity="0.18"/>' +
  '<path d="M28 46 C28 46 10 33.5 10 20.5 C10 14.5 14.8 10 20.5 10 C24.1 10 26.8 12 28 14.5 C29.2 12 31.9 10 35.5 10 C41.2 10 46 14.5 46 20.5 C46 33.5 28 46 28 46 Z" fill="#ff3b5c"/>' +
  '</svg>'
);

const emojiFireSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">' +
  '<circle cx="28" cy="28" r="26" fill="#f97316" opacity="0.18"/>' +
  '<path d="M29 8 C29 8 42 18 42 31 C42 40 35.5 47 28 47 C20.5 47 14 40 14 31 C14 24 19 18 22 15 C22 19 25 21 25 21 C24 14 29 8 29 8 Z" fill="#f97316"/>' +
  '<path d="M28 25 C28 25 35 30 35 36 C35 41 31.8 45 28 45 C24.2 45 21 41 21 36 C21 32 24 28 28 25 Z" fill="#fde047"/>' +
  '</svg>'
);

const emojiStarSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">' +
  '<circle cx="28" cy="28" r="26" fill="#eab308" opacity="0.18"/>' +
  '<polygon points="28,9 33.8,20.8 46.8,22.7 37.4,31.8 39.6,44.8 28,38.6 16.4,44.8 18.6,31.8 9.2,22.7 22.2,20.8" fill="#facc15" stroke="#ca8a04" stroke-width="1.5"/>' +
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
    // Scenario 3: Reply / Quote Scenarios
    // =========================================================================
    console.log('\n--- Scenario 3: Reply Message Scenarios ---');

    // 3.1 Short Reply
    await resetCards();
    await postMessage({
      id: 'visual-reply-1',
      platform: 'boosty',
      author: { name: 'Анна', avatar: null },
      text: 'Завтра в 19:00 по Москве, будем проходить финал!',
      reply: {
        author: 'Фёдор',
        text: 'Когда следующий стрим?',
      },
      publishedAt: '21:37',
    });
    await waitForCardsCount(1);
    await verifyLayout('reply-short');
    await captureScreenshot('reply-short.png');
    await captureScreenshot('reply-message.png');
    statesChecked.push('reply-short');

    // Inspect reply UI presence and DOM content
    const replyPresence = await page.evaluate(() => {
      const card = document.querySelector('.message');
      const hasReplyClass = card?.classList.contains('has-reply') || card?.querySelector('.reply, .quote, [data-reply], .message-reply') !== null;
      const authorText = card?.querySelector('.message-reply-author')?.textContent;
      const quoteText = card?.querySelector('.message-reply-text')?.textContent;
      return { hasReplyClass, authorText, quoteText };
    });

    if (!replyPresence.hasReplyClass || replyPresence.authorText !== 'Фёдор' || replyPresence.quoteText !== 'Когда следующий стрим?') {
      throw new Error(`Reply DOM verification failed: ${JSON.stringify(replyPresence)}`);
    }

    replyPipelineStatus = {
      received: true,
      rendered: true,
      notes: 'Reply UI element rendered successfully with author, quote text, and reply indicator.',
    };
    console.log(`✓ Reply short verified (${replyPipelineStatus.notes}) -> reply-short.png`);

    // 3.2 Long Reply Text (300-500 chars Russian text)
    await resetCards();
    await postMessage({
      id: 'visual-reply-long-text',
      platform: 'boosty',
      author: { name: 'Борис', avatar: null },
      text: 'Спасибо за подробный вопрос, обязательно разберём всё на трансляции!',
      reply: {
        author: 'АктивныйЗритель',
        text: 'Это очень длинное цитируемое сообщение из чата Boosty, содержащее более двухсот символов текста для проверки того, как оверлей применяет ограничение line-clamp и многоточие, не позволяя карточке раздуваться до половины экрана и сохраняя строгие отступы и границы.',
      },
      publishedAt: '21:38',
    });
    await waitForCardsCount(1);
    await verifyLayout('reply-long');
    await captureScreenshot('reply-long.png');
    statesChecked.push('reply-long');
    console.log('✓ Reply long text verified -> reply-long.png');

    // 3.3 Long Reply Author Name
    await resetCards();
    await postMessage({
      id: 'visual-reply-long-author',
      platform: 'boosty',
      author: { name: 'Модератор', avatar: null },
      text: 'Приветствуем в чате трансляции!',
      reply: {
        author: 'ОченьДлинныйНикПользователяКоторыйНеДолженСломатьВерсткуКарточки123456789',
        text: 'Проверка длинного никнейма в цитате',
      },
      publishedAt: '21:39',
    });
    await waitForCardsCount(1);
    await verifyLayout('reply-long-author');
    await captureScreenshot('reply-long-author.png');
    statesChecked.push('reply-long-author');
    console.log('✓ Reply long author verified -> reply-long-author.png');

    // 3.4 Multiple Messages Stack with Mixed Normal and Reply Cards
    await resetCards();
    await postMessage({
      id: 'visual-reply-multi-1',
      platform: 'boosty',
      author: { name: 'Иван', avatar: null },
      text: 'Первое обычное сообщение без ответа',
      publishedAt: '21:40',
    });
    await postMessage({
      id: 'visual-reply-multi-2',
      platform: 'boosty',
      author: { name: 'Анна', avatar: null },
      text: 'Ответ на вопрос про донаты и подписки',
      reply: {
        author: 'Максим',
        text: 'Как работают уровни подписки на Boosty?',
      },
      publishedAt: '21:41',
    });
    await postMessage({
      id: 'visual-reply-multi-3',
      platform: 'boosty',
      author: { name: 'Сергей', avatar: null },
      text: 'Третье обычное сообщение в стеке',
      publishedAt: '21:42',
    });
    await postMessage({
      id: 'visual-reply-multi-4',
      platform: 'boosty',
      author: { name: 'Елена', avatar: null },
      text: 'Ответ на вопрос про запись стрима',
      reply: {
        author: 'Ольга',
        text: 'Запись будет доступна для всех?',
      },
      publishedAt: '21:43',
    });
    await waitForCardsCount(4);
    await verifyLayout('reply-multiple-messages');
    await captureScreenshot('reply-multiple-messages.png');
    statesChecked.push('reply-multiple-messages');
    console.log('✓ Reply multiple messages stack verified -> reply-multiple-messages.png');

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
    // Scenario 7: Unicode & Custom Boosty Emoji + Mentions (Segments)
    // =========================================================================
    console.log('\n--- Scenario 7: Unicode, Custom Boosty Emoji & Mentions ---');
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

    // 7.1 Single Custom Boosty Emoji (emoji-single.png)
    await resetCards();
    await postMessage({
      id: 'visual-emoji-single',
      platform: 'boosty',
      author: { name: 'Дарья', avatar: localAvatarSvg },
      text: ':heart:',
      segments: [
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: emojiHeartSvg },
      ],
      publishedAt: '21:43',
    });
    await waitForCardsCount(1);
    await verifyLayout('emoji-single');
    await captureScreenshot('emoji-single.png');
    statesChecked.push('emoji-single');
    console.log('✓ Custom emoji single verified -> emoji-single.png');

    // 7.2 Multiple Custom Boosty Emojis in a Row (emoji-multiple.png)
    await resetCards();
    await postMessage({
      id: 'visual-emoji-multiple',
      platform: 'boosty',
      author: { name: 'Артём', avatar: localAvatarSvg },
      text: ':heart::fire::star:',
      segments: [
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: emojiHeartSvg },
        { type: 'emoji', id: ':fire:', alt: ':fire:', url: emojiFireSvg },
        { type: 'emoji', id: ':star:', alt: ':star:', url: emojiStarSvg },
      ],
      publishedAt: '21:44',
    });
    await waitForCardsCount(1);
    await verifyLayout('emoji-multiple');
    await captureScreenshot('emoji-multiple.png');
    statesChecked.push('emoji-multiple');
    console.log('✓ Custom emoji multiple verified -> emoji-multiple.png');

    // 7.3 Inline Custom Emoji with Text (emoji-inline-text.png)
    await resetCards();
    await postMessage({
      id: 'visual-emoji-inline-text',
      platform: 'boosty',
      author: { name: 'Екатерина', avatar: localAvatarSvg },
      text: 'Привет :heart: спасибо за отличный стрим :fire: и атмосферу!',
      segments: [
        { type: 'text', text: 'Привет ' },
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: emojiHeartSvg },
        { type: 'text', text: ' спасибо за отличный стрим ' },
        { type: 'emoji', id: ':fire:', alt: ':fire:', url: emojiFireSvg },
        { type: 'text', text: ' и атмосферу!' },
      ],
      publishedAt: '21:45',
    });
    await waitForCardsCount(1);
    await verifyLayout('emoji-inline-text');
    await captureScreenshot('emoji-inline-text.png');
    statesChecked.push('emoji-inline-text');
    console.log('✓ Custom emoji inline text verified -> emoji-inline-text.png');

    // 7.4 Mention Segment (mention.png)
    await resetCards();
    await postMessage({
      id: 'visual-mention-1',
      platform: 'boosty',
      author: { name: 'Стример Борис', avatar: localAvatarSvg },
      text: '@Иван_Про привет! Рад видеть тебя на трансляции, как дела?',
      segments: [
        { type: 'mention', userId: '12345', displayName: 'Иван_Про' },
        { type: 'text', text: ' привет! Рад видеть тебя на трансляции, как дела?' },
      ],
      publishedAt: '21:46',
    });
    await waitForCardsCount(1);
    await verifyLayout('mention');
    await captureScreenshot('mention.png');
    statesChecked.push('mention');
    console.log('✓ Mention verified -> mention.png');

    // 7.5 Mixed Mention and Custom Emoji (mention-and-emoji.png)
    await resetCards();
    await postMessage({
      id: 'visual-mention-and-emoji',
      platform: 'boosty',
      author: { name: 'Максим', avatar: localAvatarSvg },
      text: 'Привет :heart: @Стример_Борис лови :fire: :star: за крутой контент!',
      segments: [
        { type: 'text', text: 'Привет ' },
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: emojiHeartSvg },
        { type: 'text', text: ' ' },
        { type: 'mention', userId: '777', displayName: 'Стример_Борис' },
        { type: 'text', text: ' лови ' },
        { type: 'emoji', id: ':fire:', alt: ':fire:', url: emojiFireSvg },
        { type: 'text', text: ' ' },
        { type: 'emoji', id: ':star:', alt: ':star:', url: emojiStarSvg },
        { type: 'text', text: ' за крутой контент!' },
      ],
      publishedAt: '21:47',
    });
    await waitForCardsCount(1);
    await verifyLayout('mention-and-emoji');
    await captureScreenshot('mention-and-emoji.png');
    statesChecked.push('mention-and-emoji');

    // Assert DOM structure of mention-and-emoji card
    const mixedDomCheck = await page.evaluate(() => {
      const card = document.querySelector('.message');
      const emojis = Array.from(card?.querySelectorAll('img.message-emoji') || []);
      const mentions = Array.from(card?.querySelectorAll('.message-mention') || []);
      return {
        emojiCount: emojis.length,
        allEmojisLoaded: emojis.every(img => img.complete && img.getBoundingClientRect().width > 0 && img.getBoundingClientRect().height > 0),
        mentionCount: mentions.length,
        mentionText: mentions[0]?.textContent || '',
      };
    });
    if (mixedDomCheck.emojiCount !== 3 || !mixedDomCheck.allEmojisLoaded || mixedDomCheck.mentionCount !== 1 || mixedDomCheck.mentionText !== '@Стример_Борис') {
      throw new Error(`Mixed mention-and-emoji DOM check failed: ${JSON.stringify(mixedDomCheck)}`);
    }
    console.log('✓ Mixed mention and custom emoji verified -> mention-and-emoji.png');

    // 7.6 Long Message with Multiple Emojis and Mentions (emoji-long-message.png)
    await resetCards();
    await postMessage({
      id: 'visual-emoji-long-message',
      platform: 'boosty',
      author: { name: 'АктивныйЗритель', avatar: localAvatarSvg },
      text: '@Стример_Борис огромное спасибо за подробный разбор механик босса :fire: ! Мы всем чатом смотрели на одном дыхании :heart: и болели за каждую попытку :star: — обязательно сохрани эту запись на Boosty для подписчиков!',
      segments: [
        { type: 'mention', userId: '777', displayName: 'Стример_Борис' },
        { type: 'text', text: ' огромное спасибо за подробный разбор механик босса ' },
        { type: 'emoji', id: ':fire:', alt: ':fire:', url: emojiFireSvg },
        { type: 'text', text: ' ! Мы всем чатом смотрели на одном дыхании ' },
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: emojiHeartSvg },
        { type: 'text', text: ' и болели за каждую попытку ' },
        { type: 'emoji', id: ':star:', alt: ':star:', url: emojiStarSvg },
        { type: 'text', text: ' — обязательно сохрани эту запись на Boosty для подписчиков!' },
      ],
      publishedAt: '21:48',
    });
    await waitForCardsCount(1);
    await verifyLayout('emoji-long-message');
    await captureScreenshot('emoji-long-message.png');
    statesChecked.push('emoji-long-message');
    console.log('✓ Emoji long message verified -> emoji-long-message.png');

    // =========================================================================
    // Scenario 7B: Author Role Badges (streamer / moderator / normal)
    // =========================================================================
    console.log('\n--- Scenario 7B: Author Role Badges ---');

    // 7B.1 Streamer Role Badge (role-streamer.png)
    await resetCards();
    await postMessage({
      id: 'visual-role-streamer',
      platform: 'boosty',
      author: { name: 'Фёдор Стример', avatar: localAvatarSvg, role: 'streamer' },
      text: 'Всем привет! Начинаем наш вечерний стрим, сегодня проходим босса.',
      publishedAt: '21:49',
    });
    await waitForCardsCount(1);
    await verifyLayout('role-streamer');
    await captureScreenshot('role-streamer.png');
    statesChecked.push('role-streamer');

    const streamerDomCheck = await page.evaluate(() => {
      const badge = document.querySelector('.message .author-role.author-role--streamer');
      const rect = badge?.getBoundingClientRect();
      return {
        exists: Boolean(badge),
        ariaLabel: badge?.getAttribute('aria-label') || '',
        hasSvg: Boolean(badge?.querySelector('svg.author-role-icon path')),
        width: rect?.width || 0,
        height: rect?.height || 0,
      };
    });
    if (!streamerDomCheck.exists || streamerDomCheck.ariaLabel !== 'Стример' || !streamerDomCheck.hasSvg || streamerDomCheck.width <= 0) {
      throw new Error(`Streamer badge DOM check failed: ${JSON.stringify(streamerDomCheck)}`);
    }
    console.log('✓ Streamer role badge verified -> role-streamer.png');

    // 7B.2 Moderator Role Badge (role-moderator.png)
    await resetCards();
    await postMessage({
      id: 'visual-role-moderator',
      platform: 'boosty',
      author: { name: 'Модератор Иван', avatar: localAvatarSvg, role: 'moderator' },
      text: 'Напоминаю: в чате общаемся вежливо и без спойлеров к сюжету!',
      publishedAt: '21:50',
    });
    await waitForCardsCount(1);
    await verifyLayout('role-moderator');
    await captureScreenshot('role-moderator.png');
    statesChecked.push('role-moderator');

    const modDomCheck = await page.evaluate(() => {
      const badge = document.querySelector('.message .author-role.author-role--moderator');
      const rect = badge?.getBoundingClientRect();
      return {
        exists: Boolean(badge),
        ariaLabel: badge?.getAttribute('aria-label') || '',
        hasSvg: Boolean(badge?.querySelector('svg.author-role-icon path')),
        width: rect?.width || 0,
        height: rect?.height || 0,
      };
    });
    if (!modDomCheck.exists || modDomCheck.ariaLabel !== 'Модератор' || !modDomCheck.hasSvg || modDomCheck.width <= 0) {
      throw new Error(`Moderator badge DOM check failed: ${JSON.stringify(modDomCheck)}`);
    }
    console.log('✓ Moderator role badge verified -> role-moderator.png');

    // 7B.3 Normal User without Role Badge (role-normal-user.png)
    await resetCards();
    await postMessage({
      id: 'visual-role-normal',
      platform: 'boosty',
      author: { name: 'Алексей Зритель', avatar: localAvatarSvg, role: null },
      text: 'Отличный звук и картинка, всем приятного просмотра!',
      publishedAt: '21:51',
    });
    await waitForCardsCount(1);
    await verifyLayout('role-normal-user');
    await captureScreenshot('role-normal-user.png');
    statesChecked.push('role-normal-user');

    const normalRoleExists = await page.evaluate(() => Boolean(document.querySelector('.message .author-role')));
    if (normalRoleExists) {
      throw new Error('Normal user card must not contain .author-role element');
    }
    console.log('✓ Normal user (no badge) verified -> role-normal-user.png');

    // 7B.4 Long Author Name with Role Badge (role-long-author.png)
    await resetCards();
    await postMessage({
      id: 'visual-role-long-author',
      platform: 'boosty',
      author: {
        name: 'ОченьОченьОченьДлинныйНикнеймСтримераКоторыйДолженАккуратноОбрезатьсяМноготочием',
        avatar: localAvatarSvg,
        role: 'streamer',
      },
      text: 'Проверка того, что бейдж роли остаётся видимым, а длинный ник аккуратно обрезается с многоточием.',
      publishedAt: '21:52',
    });
    await waitForCardsCount(1);
    await verifyLayout('role-long-author');
    await captureScreenshot('role-long-author.png');
    statesChecked.push('role-long-author');
    console.log('✓ Role badge with long author name verified -> role-long-author.png');

    // 7B.5 Role Badge with Reply Quote (role-with-reply.png)
    await resetCards();
    await postMessage({
      id: 'visual-role-with-reply',
      platform: 'boosty',
      author: { name: 'Фёдор Стример', avatar: localAvatarSvg, role: 'streamer' },
      text: 'Да, запись эфира обязательно выйдет завтра утром в открытом доступе!',
      reply: {
        author: 'Дмитрий',
        text: 'Будет ли запись сегодняшнего стрима?',
      },
      publishedAt: '21:53',
    });
    await waitForCardsCount(1);
    await verifyLayout('role-with-reply');
    await captureScreenshot('role-with-reply.png');
    statesChecked.push('role-with-reply');
    console.log('✓ Role badge with reply verified -> role-with-reply.png');

    // 7B.6 Role Badges with Emoji, Mention & Multi-Role Stack (role-with-emoji-mention.png)
    await resetCards();
    await postMessage({
      id: 'visual-role-stack-1',
      platform: 'boosty',
      author: { name: 'Мария', avatar: localAvatarSvg, role: null },
      text: 'Всем привет :heart: удачного стрима!',
      segments: [
        { type: 'text', text: 'Всем привет ' },
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: emojiHeartSvg },
        { type: 'text', text: ' удачного стрима!' },
      ],
      publishedAt: '21:54',
    });
    await postMessage({
      id: 'visual-role-stack-2',
      platform: 'boosty',
      author: { name: 'Модератор Иван', avatar: localAvatarSvg, role: 'moderator' },
      text: '@Мария добро пожаловать в чат :star: !',
      segments: [
        { type: 'mention', userId: '101', displayName: 'Мария' },
        { type: 'text', text: ' добро пожаловать в чат ' },
        { type: 'emoji', id: ':star:', alt: ':star:', url: emojiStarSvg },
        { type: 'text', text: ' !' },
      ],
      publishedAt: '21:55',
    });
    await postMessage({
      id: 'visual-role-stack-3',
      platform: 'boosty',
      author: { name: 'Фёдор Стример', avatar: localAvatarSvg, role: 'streamer' },
      text: 'Спасибо @Мария :heart: :fire: погнали!',
      segments: [
        { type: 'text', text: 'Спасибо ' },
        { type: 'mention', userId: '101', displayName: 'Мария' },
        { type: 'text', text: ' ' },
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: emojiHeartSvg },
        { type: 'text', text: ' ' },
        { type: 'emoji', id: ':fire:', alt: ':fire:', url: emojiFireSvg },
        { type: 'text', text: ' погнали!' },
      ],
      publishedAt: '21:56',
    });
    await waitForCardsCount(3);
    await verifyLayout('role-with-emoji-mention');
    await captureScreenshot('role-with-emoji-mention.png');
    statesChecked.push('role-with-emoji-mention');
    console.log('✓ Role badges with emoji & mention stack verified -> role-with-emoji-mention.png');

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

    // 11.2 Narrow Reply Scenario
    await resetCards();
    await postMessage({
      id: 'narrow-reply-1',
      platform: 'boosty',
      author: { name: 'Стример', avatar: localAvatarSvg },
      text: 'Ответ в узком источнике Browser Source без горизонтального скролла и переполнений.',
      reply: {
        author: 'ЗрительШортсов',
        text: 'Как настроить вертикальный чат для компактной сцены?',
      },
      publishedAt: '21:51',
    });
    await waitForCardsCount(1);
    await verifyLayout('reply-narrow-source');
    await captureScreenshot('reply-narrow-source.png');
    statesChecked.push('reply-narrow-source');
    console.log('✓ Reply in narrow source verified (400x700) -> reply-narrow-source.png');

    // 11.3 Narrow Emoji & Mention Scenario (emoji-narrow-source.png)
    await resetCards();
    await postMessage({
      id: 'narrow-emoji-1',
      platform: 'boosty',
      author: { name: 'МобильныйЗритель', avatar: localAvatarSvg },
      text: 'Привет @Стример_Борис :heart: :fire: проверяем перенос строк со смайлами в узком окне OBS 400px :star: !',
      segments: [
        { type: 'text', text: 'Привет ' },
        { type: 'mention', userId: '777', displayName: 'Стример_Борис' },
        { type: 'text', text: ' ' },
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: emojiHeartSvg },
        { type: 'text', text: ' ' },
        { type: 'emoji', id: ':fire:', alt: ':fire:', url: emojiFireSvg },
        { type: 'text', text: ' проверяем перенос строк со смайлами в узком окне OBS 400px ' },
        { type: 'emoji', id: ':star:', alt: ':star:', url: emojiStarSvg },
        { type: 'text', text: ' !' },
      ],
      publishedAt: '21:52',
    });
    await waitForCardsCount(1);
    await verifyLayout('emoji-narrow-source');
    await captureScreenshot('emoji-narrow-source.png');
    statesChecked.push('emoji-narrow-source');
    console.log('✓ Emoji & mention in narrow source verified (400x700) -> emoji-narrow-source.png');

    // 11.4 Narrow Role Badges Scenario (role-narrow-source.png)
    await resetCards();
    await postMessage({
      id: 'narrow-role-1',
      platform: 'boosty',
      author: { name: 'Фёдор Стример', avatar: localAvatarSvg, role: 'streamer' },
      text: 'Стрим в узком вертикальном окне 400x700 :fire:',
      segments: [
        { type: 'text', text: 'Стрим в узком вертикальном окне 400x700 ' },
        { type: 'emoji', id: ':fire:', alt: ':fire:', url: emojiFireSvg },
      ],
      publishedAt: '21:53',
    });
    await postMessage({
      id: 'narrow-role-2',
      platform: 'boosty',
      author: { name: 'Модератор_С_Длинным_Никнеймом_В_Узком_Окне', avatar: localAvatarSvg, role: 'moderator' },
      text: '@Фёдор Стример бейдж модератора и длинный никнейм в 400px!',
      segments: [
        { type: 'mention', userId: '1', displayName: 'Фёдор Стример' },
        { type: 'text', text: ' бейдж модератора и длинный никнейм в 400px!' },
      ],
      publishedAt: '21:54',
    });
    await waitForCardsCount(2);
    await verifyLayout('role-narrow-source');
    await captureScreenshot('role-narrow-source.png');
    statesChecked.push('role-narrow-source');
    console.log('✓ Role badges in narrow source verified (400x700) -> role-narrow-source.png');

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
    // Scenario 14: Message Animations v1 Visual QA (Requirement #23)
    // =========================================================================
    console.log('\n--- Scenario 14: Message Animations Visual QA ---');
    await page.setViewportSize({ width: 800, height: 600 });
    viewportsTested.push('800x600');

    // 14.1 animation-none.png
    await resetCards();
    await postConfig({ animationType: 'none', animationDurationMs: 180, horizontalAnchor: 'left', verticalAnchor: 'bottom' });
    await postMessage({
      id: 'anim-none-msg',
      platform: 'boosty',
      author: { name: 'Алексей', avatar: localAvatarSvg },
      text: 'Сообщение в режиме без анимации (мгновенное появление и удаление).',
      publishedAt: '22:01',
    });
    await waitForCardsCount(1);
    await verifyLayout('animation-none');
    await captureScreenshot('animation-none.png');
    statesChecked.push('animation-none');
    console.log('✓ animation-none verified -> animation-none.png');

    // 14.2 animation-fade.png
    await resetCards();
    await postConfig({ animationType: 'fade', animationDurationMs: 280 });
    await postMessage({
      id: 'anim-fade-msg',
      platform: 'boosty',
      author: { name: 'Борис', avatar: localAvatarSvg },
      text: 'Сообщение с плавным появлением (opacity: 0 -> 1, без сдвига).',
      publishedAt: '22:02',
    });
    await waitForCardsCount(1);
    await verifyLayout('animation-fade');
    await captureScreenshot('animation-fade.png');
    statesChecked.push('animation-fade');
    console.log('✓ animation-fade verified -> animation-fade.png');

    // 14.3 animation-slide-up.png
    await resetCards();
    await postConfig({ animationType: 'slide-up', animationDurationMs: 280 });
    await postMessage({
      id: 'anim-slide-up-msg',
      platform: 'boosty',
      author: { name: 'Виктор', avatar: localAvatarSvg },
      text: 'Сообщение с аккуратным подъёмом снизу вверх (translateY: 16px -> 0).',
      publishedAt: '22:03',
    });
    await waitForCardsCount(1);
    await verifyLayout('animation-slide-up');
    await captureScreenshot('animation-slide-up.png');
    statesChecked.push('animation-slide-up');
    console.log('✓ animation-slide-up verified -> animation-slide-up.png');

    // 14.4 animation-slide-left-anchor.png (left anchor slide-side)
    await resetCards();
    await postConfig({ animationType: 'slide-side', animationDurationMs: 280, horizontalAnchor: 'left', verticalAnchor: 'bottom' });
    await postMessage({
      id: 'anim-slide-left-msg',
      platform: 'boosty',
      author: { name: 'Григорий', avatar: localAvatarSvg },
      text: 'Сообщение с левым якорем, слегка приезжающее слева (translateX: -16px -> 0).',
      publishedAt: '22:04',
    });
    await waitForCardsCount(1);
    await verifyLayout('animation-slide-left-anchor');
    await captureScreenshot('animation-slide-left-anchor.png');
    statesChecked.push('animation-slide-left-anchor');
    console.log('✓ animation-slide-left-anchor verified -> animation-slide-left-anchor.png');

    // 14.5 animation-slide-right-anchor.png (right anchor slide-side)
    await resetCards();
    await postConfig({ animationType: 'slide-side', animationDurationMs: 280, horizontalAnchor: 'right', verticalAnchor: 'bottom' });
    await postMessage({
      id: 'anim-slide-right-msg',
      platform: 'boosty',
      author: { name: 'Дмитрий', avatar: localAvatarSvg },
      text: 'Сообщение с правым якорем, слегка приезжающее справа (translateX: 16px -> 0).',
      publishedAt: '22:05',
    });
    await waitForCardsCount(1);
    await verifyLayout('animation-slide-right-anchor');
    await captureScreenshot('animation-slide-right-anchor.png');
    statesChecked.push('animation-slide-right-anchor');
    console.log('✓ animation-slide-right-anchor verified -> animation-slide-right-anchor.png');

    // Reset back to left anchor
    await postConfig({ horizontalAnchor: 'left' });

    // 14.6 animation-with-reply.png
    await resetCards();
    await postConfig({ animationType: 'fade', animationDurationMs: 280 });
    await postMessage({
      id: 'anim-reply-msg',
      platform: 'boosty',
      author: { name: 'Елена', avatar: localAvatarSvg },
      text: 'Карточка с ответом на цитату, анимированная целиком как единый блок.',
      reply: {
        author: 'Зритель',
        text: 'Анимация корректно применяется ко всей карточке целиком?',
      },
      publishedAt: '22:06',
    });
    await waitForCardsCount(1);
    await verifyLayout('animation-with-reply');
    await captureScreenshot('animation-with-reply.png');
    statesChecked.push('animation-with-reply');
    console.log('✓ animation-with-reply verified -> animation-with-reply.png');

    // 14.7 animation-with-emoji.png
    await resetCards();
    await postMessage({
      id: 'anim-emoji-msg',
      platform: 'boosty',
      author: { name: 'Фёдор Стример', avatar: localAvatarSvg, role: 'streamer' },
      text: 'Анимация с кастомными эмодзи :heart: :fire: и бейджем роли :star: !',
      segments: [
        { type: 'text', text: 'Анимация с кастомными эмодзи ' },
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: emojiHeartSvg },
        { type: 'text', text: ' ' },
        { type: 'emoji', id: ':fire:', alt: ':fire:', url: emojiFireSvg },
        { type: 'text', text: ' и бейджем роли ' },
        { type: 'emoji', id: ':star:', alt: ':star:', url: emojiStarSvg },
        { type: 'text', text: ' !' },
      ],
      publishedAt: '22:07',
    });
    await waitForCardsCount(1);
    await verifyLayout('animation-with-emoji');
    await captureScreenshot('animation-with-emoji.png');
    statesChecked.push('animation-with-emoji');
    console.log('✓ animation-with-emoji verified -> animation-with-emoji.png');

    // 14.8 animation-narrow-source.png (400x700 narrow source with slide-side)
    await resetCards();
    await page.setViewportSize({ width: 400, height: 700 });
    viewportsTested.push('400x700');
    await postConfig({ animationType: 'slide-side', horizontalAnchor: 'left' });
    await postMessage({
      id: 'anim-narrow-msg',
      platform: 'boosty',
      author: { name: 'МобильныйЧат', avatar: localAvatarSvg },
      text: 'Проверка анимации slide-side в узком источнике 400x700 без горизонтального скролла и переполнений.',
      publishedAt: '22:08',
    });
    await waitForCardsCount(1);
    await verifyLayout('animation-narrow-source');
    await captureScreenshot('animation-narrow-source.png');
    statesChecked.push('animation-narrow-source');
    console.log('✓ animation-narrow-source verified -> animation-narrow-source.png');

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
