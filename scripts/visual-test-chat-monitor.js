'use strict';

/**
 * Chat Monitor Visual QA Runner using Playwright & Electron
 *
 * Exercises all 8 canonical states of Chat Monitor:
 * 1. empty / waiting
 * 2. normal messages
 * 3. long messages
 * 4. reply + mention + emoji
 * 5. many messages / scroll
 * 6. paused
 * 7. new messages indicator
 * 8. minimum window size (340x400)
 *
 * Saves screenshots to artifacts/chat-monitor/ and verifies layout constraints.
 */

const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const projectRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(projectRoot, 'artifacts', 'chat-monitor');
const testPort = 17398;
const tmpConfigFile = path.join('/tmp', `boosty-monitor-qa-${process.pid}.json`);

fs.writeFileSync(tmpConfigFile, JSON.stringify({
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
}, null, 2));

fs.mkdirSync(artifactsDir, { recursive: true });

async function runVisualQa() {
  console.log('========================================');
  console.log('      Chat Monitor Visual QA            ');
  console.log('========================================\n');

  let electronApp = null;
  const consoleErrors = [];
  const pageErrors = [];
  const screenshots = [];

  try {
    process.stdout.write('Launching Electron application... ');
    electronApp = await electron.launch({
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        path.join(projectRoot, 'desktop', 'main.js'),
      ],
      env: {
        ...process.env,
        BOOSTY_OVERLAY_PORT: String(testPort),
        BOOSTY_OVERLAY_CONFIG: tmpConfigFile,
        BOOSTY_OVERLAY_UI_TEST: '1',
        UI_AUDIT_MODE: '1',
      },
    });
    console.log('✓ App launched');

    const mainWindow = await electronApp.firstWindow();

    // Wait until main window is initialized
    await mainWindow.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 15000 });
    console.log('✓ Main application ready');

    // Ensure dashboard view is active
    await mainWindow.evaluate(() => {
      const onboardingView = document.querySelector('#onboarding-view');
      const mainAppShell = document.querySelector('#main-app-shell');
      if (onboardingView) onboardingView.style.display = 'none';
      if (mainAppShell) mainAppShell.style.display = 'grid';
      const dashView = document.querySelector('#view-dashboard');
      if (dashView) dashView.style.display = 'block';
    });
    await mainWindow.waitForSelector('#nav-chat', { state: 'visible', timeout: 5000 });
    console.log('✓ Main dashboard ready with sidebar chat button');

    // Click "Чат" in sidebar to test the real integration button!
    console.log('Opening Chat Monitor window via sidebar button...');
    const windowPromise = electronApp.waitForEvent('window', { timeout: 10000 });
    await mainWindow.click('#nav-chat');

    const monitorWin = await windowPromise;
    console.log('✓ Chat Monitor window opened');

    // Monitor listeners for errors
    monitorWin.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('Electron Security Warning')) {
          consoleErrors.push({ type: 'console.error', text, location: msg.location() });
        }
      }
    });

    monitorWin.on('pageerror', err => {
      pageErrors.push({ message: err.message, stack: err.stack });
    });

    await monitorWin.waitForSelector('.monitor-layout', { timeout: 10000 });
    await monitorWin.evaluate(() => document.fonts.ready);

    // Helper: set bounds
    async function setSize(w, h) {
      const bw = await electronApp.browserWindow(monitorWin);
      await bw.evaluate((win, [width, height]) => {
        win.setSize(width, height);
      }, [w, h]);
      await monitorWin.waitForTimeout(150);
    }

    // Helper: capture screenshot
    async function capture(name) {
      const p = path.join(artifactsDir, name);
      await monitorWin.screenshot({ path: p });
      screenshots.push(p);
      console.log(`  ✓ Captured ${name}`);
    }

    // 1. Empty / Waiting state (380x600)
    console.log('\n[Scenario 1] Empty / Waiting state');
    await setSize(380, 600);
    await capture('01-empty-waiting.png');

    // 2. Normal messages
    console.log('\n[Scenario 2] Normal messages');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      app.clearView();
      app.handleIncomingMessage({
        id: 'msg-norm-1',
        author: {
          name: 'Alex_Stream',
          role: 'streamer',
          avatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23f15f2c"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">A</text></svg>',
        },
        publishedAt: '18:30:12',
        text: 'Всем привет! Начинаем стрим по графике.',
      });
      app.handleIncomingMessage({
        id: 'msg-norm-2',
        author: {
          name: 'Mod_Dmitry',
          role: 'moderator',
          avatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%233b82f6"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">M</text></svg>',
        },
        publishedAt: '18:30:45',
        text: 'Правила чата в описании, не спамим.',
      });
      app.handleIncomingMessage({
        id: 'msg-norm-3',
        author: { name: 'Viewer_Gamer' },
        publishedAt: '18:31:02',
        text: 'Привет! Какая сегодня игра?',
      });
    });
    await monitorWin.waitForTimeout(100);
    await capture('02-normal-messages.png');

    // 3. Long messages & long username
    console.log('\n[Scenario 3] Long messages & long username');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      app.handleIncomingMessage({
        id: 'msg-long-1',
        author: { name: 'SuperMegaUltraLongNicknameWithoutAnySpacesToTestWordBreakConstraint123456789' },
        publishedAt: '18:31:30',
        text: 'Это очень длинное сообщение, которое должно корректно переноситься на новую строку, не ломая вертикальный ритм и не вызывая горизонтального скролла на тёмном фоне монитора чата стримера.',
      });
      app.handleIncomingMessage({
        id: 'msg-long-2',
        author: { name: 'DevTester' },
        publishedAt: '18:31:55',
        text: 'ДлинноеСловоБезПробеловКотороеДолжноРазрыватьсяПоПравилуOverflowWrapAnywhereБезВылезанияЗаГраницыКонтейнера',
      });
    });
    await monitorWin.waitForTimeout(100);
    await capture('03-long-messages.png');

    // 4. Reply + Mention + Custom & Unicode Emoji
    console.log('\n[Scenario 4] Reply + Mention + Emoji');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      app.handleIncomingMessage({
        id: 'msg-rich-1',
        author: {
          name: 'Kira',
          avatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%238b5cf6"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">K</text></svg>',
        },
        publishedAt: '18:32:15',
        text: 'Ответ на вопрос @Alex_Stream',
        reply: {
          author: 'Alex_Stream',
          text: 'Всем привет! Начинаем стрим по графике.',
        },
        segments: [
          { type: 'text', text: 'Круто, ' },
          { type: 'mention', displayName: 'Alex_Stream' },
          { type: 'text', text: '! Ждали этот стрим ' },
          { type: 'emoji', id: ':boosty_fire:', url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text y="20" font-size="20">🔥</text></svg>', alt: ':fire:' },
          { type: 'text', text: ' ❤️ 🎮' },
        ],
      });
    });
    await monitorWin.waitForTimeout(100);
    await capture('04-reply-mention-emoji.png');

    // 5. Many messages / scroll
    console.log('\n[Scenario 5] Many messages & vertical scrolling');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      for (let i = 1; i <= 15; i++) {
        app.handleIncomingMessage({
          id: `msg-bulk-${i}`,
          author: { name: `User_${i}` },
          publishedAt: `18:33:${String(i).padStart(2, '0')}`,
          text: `Сообщение в потоке #${i} — проверка плотности строк и плавного вертикального скролла.`,
        });
      }
    });
    await monitorWin.waitForTimeout(100);
    await capture('05-many-messages-scroll.png');

    // 6. Paused state
    console.log('\n[Scenario 6] Paused state with accumulated queue');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      app.pause();
      // Send 4 messages while paused
      app.handleIncomingMessage({ id: 'paused-1', author: 'PausedUser1', text: 'Сообщение в очереди 1' });
      app.handleIncomingMessage({ id: 'paused-2', author: 'PausedUser2', text: 'Сообщение в очереди 2' });
      app.handleIncomingMessage({ id: 'paused-3', author: 'PausedUser3', text: 'Сообщение в очереди 3' });
      app.handleIncomingMessage({ id: 'paused-4', author: 'PausedUser4', text: 'Сообщение в очереди 4' });
    });
    await monitorWin.waitForTimeout(100);
    await capture('06-paused.png');

    // Resume for next scenario
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (app) app.resume();
    });
    await monitorWin.waitForTimeout(100);

    // 7. New messages indicator (scrolled up)
    console.log('\n[Scenario 7] Scrolled up with "Новые сообщения ↓" indicator');
    await monitorWin.evaluate(() => {
      const container = document.querySelector('#chat-container');
      const app = window.__chatMonitorApp;
      if (container && app) {
        // Scroll to top
        container.scrollTop = 50;
        container.dispatchEvent(new Event('scroll'));

        // Send 3 new messages while user is looking at top
        app.handleIncomingMessage({ id: 'unread-1', author: 'LiveFan1', text: 'Свежее сообщение внизу #1' });
        app.handleIncomingMessage({ id: 'unread-2', author: 'LiveFan2', text: 'Свежее сообщение внизу #2' });
        app.handleIncomingMessage({ id: 'unread-3', author: 'LiveFan3', text: 'Свежее сообщение внизу #3' });
      }
    });
    await monitorWin.waitForTimeout(100);
    await capture('07-new-messages-indicator.png');

    // 8. Minimum window size (340x400)
    console.log('\n[Scenario 8] Minimum window size (340x400)');
    await setSize(340, 400);
    // Scroll down to show dense content
    await monitorWin.evaluate(() => {
      const btn = document.querySelector('#btn-scroll-bottom');
      if (btn) btn.click();
    });
    await monitorWin.waitForTimeout(150);

    // Check no horizontal scrollbar at minimum size
    const hasHorizontalScroll = await monitorWin.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const container = document.querySelector('#chat-container');
      return (
        doc.scrollWidth > doc.clientWidth ||
        body.scrollWidth > body.clientWidth ||
        (container && container.scrollWidth > container.clientWidth)
      );
    });

    if (hasHorizontalScroll) {
      console.error('❌ Horizontal scroll detected at 340px width!');
    } else {
      console.log('✓ Zero horizontal scroll at minimum window width (340px)');
    }

    await capture('08-minimum-window-size.png');

    // 9. Compact mode (Scenario 9)
    console.log('\n[Scenario 9] Compact mode');
    await setSize(380, 600);
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (app) app.setCompactMode(true);
    });
    await monitorWin.waitForTimeout(150);
    await capture('09-compact-mode.png');

    // Turn off compact mode for attention testing
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (app) app.setCompactMode(false);
    });

    // 10. Important message highlights (Scenario 10)
    console.log('\n[Scenario 10] Important message highlights (mention, reply, both)');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      app.clearView();
      app.setFilter('all');
      app.handleIncomingMessage({
        id: 'attn-1',
        author: { name: 'Gamer_One' },
        publishedAt: '19:00:10',
        text: 'Обычное сообщение без упоминаний и ответов.',
      });
      app.handleIncomingMessage({
        id: 'attn-2',
        author: { name: 'Support_Hero' },
        publishedAt: '19:00:25',
        text: 'Привет @Alex_Stream! Как настройка нового оверлея?',
        segments: [
          { type: 'text', text: 'Привет ' },
          { type: 'mention', displayName: 'Alex_Stream' },
          { type: 'text', text: '! Как настройка нового оверлея?' },
        ],
      });
      app.handleIncomingMessage({
        id: 'attn-3',
        author: { name: 'Dmitry_K' },
        publishedAt: '19:00:40',
        text: 'Вот ответ на вопрос по стриму.',
        reply: {
          author: 'Alex_Stream',
          text: 'Всем привет! Начинаем стрим по графике.',
        },
      });
      app.handleIncomingMessage({
        id: 'attn-4',
        author: { name: 'Pro_Mod', role: 'moderator' },
        publishedAt: '19:01:05',
        text: 'Ответ @Alex_Stream: чат модерируется в штатном режиме.',
        reply: {
          author: 'Alex_Stream',
          text: 'Модераторы на месте?',
        },
        segments: [
          { type: 'text', text: 'Ответ ' },
          { type: 'mention', displayName: 'Alex_Stream' },
          { type: 'text', text: ': чат модерируется в штатном режиме.' },
        ],
      });
    });
    await monitorWin.waitForTimeout(150);
    await capture('10-important-highlight.png');

    // 11. Filter "Важное" (Scenario 11)
    console.log('\n[Scenario 11] Filter "Важное"');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (app) app.setFilter('important');
    });
    await monitorWin.waitForTimeout(150);
    await capture('11-filter-important.png');

    // 12. Filter "Упоминания" (Scenario 12)
    console.log('\n[Scenario 12] Filter "Упоминания"');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (app) app.setFilter('mentions');
    });
    await monitorWin.waitForTimeout(150);
    await capture('12-filter-mentions.png');

    // 13. Search results (Scenario 13)
    console.log('\n[Scenario 13] Search results');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      app.setFilter('all');
      app.openSearchPanel();
      const input = document.querySelector('#search-input');
      if (input) input.value = 'оверлея';
      app.setSearchQuery('оверлея');
    });
    await monitorWin.waitForTimeout(150);
    await capture('13-search-results.png');

    // 14. Search no results (Scenario 14)
    console.log('\n[Scenario 14] Search no results state');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      const input = document.querySelector('#search-input');
      if (input) input.value = 'несуществующий_запрос_12345';
      app.setSearchQuery('несуществующий_запрос_12345');
    });
    await monitorWin.waitForTimeout(150);
    await capture('14-search-no-results.png');

    // 15. Unread counters & Badges (Scenario 15)
    console.log('\n[Scenario 15] Unread counters & Badges');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      const container = document.querySelector('#chat-container');
      if (!app || !container) return;
      app.closeSearchPanel();
      app.setFilter('all');

      // Add enough bulk messages so scrollHeight > clientHeight
      for (let i = 1; i <= 12; i++) {
        app.handleIncomingMessage({
          id: `seed-unread-${i}`,
          author: { name: `User_${i}` },
          publishedAt: `19:04:${String(i).padStart(2, '0')}`,
          text: `История чата перед новыми важными сообщениями #${i}`,
        });
      }

      // Scroll up towards top
      container.scrollTop = 50;
      container.dispatchEvent(new Event('scroll'));

      // Simulate incoming mention & reply while user is reading history above
      app.handleIncomingMessage({
        id: 'unread-attn-1',
        author: { name: 'Unread_Fan' },
        publishedAt: '19:05:00',
        text: 'Срочный вопрос @Alex_Stream!',
        segments: [
          { type: 'text', text: 'Срочный вопрос ' },
          { type: 'mention', displayName: 'Alex_Stream' },
          { type: 'text', text: '!' },
        ],
      });
      app.handleIncomingMessage({
        id: 'unread-attn-2',
        author: { name: 'Reply_Fan' },
        publishedAt: '19:05:15',
        text: 'Новый ответ на ваше сообщение',
        reply: {
          author: 'Alex_Stream',
          text: 'Ждём всех на трансляции!',
        },
      });
    });
    await monitorWin.waitForTimeout(150);
    await capture('15-unread-counters.png');

    // 16. Message Lab: Composer (Scenario 16)
    console.log('\n[Scenario 16] Message Lab: Composer open');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      const lab = app.getMessageLab();
      if (lab) {
        lab.open();
        lab.switchTab('composer');
      }
    });
    await monitorWin.waitForTimeout(250);
    await capture('lab-01-composer.png');

    // 17. Message Lab: Reply, Mention, Custom Emoji configured (Scenario 17)
    console.log('\n[Scenario 17] Message Lab: Reply & Mention filled');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      const lab = app.getMessageLab();
      if (!lab) return;

      const authorInput = document.querySelector('#lab-author');
      const roleSelect = document.querySelector('#lab-role');
      const textInput = document.querySelector('#lab-text');
      const mentionInput = document.querySelector('#lab-mention');
      const replyModeSelect = document.querySelector('#lab-reply-mode');
      const replyAuthorInput = document.querySelector('#lab-reply-author');
      const replyTextInput = document.querySelector('#lab-reply-text');
      const emojiUrlInput = document.querySelector('#lab-emoji-url');
      const emojiAltInput = document.querySelector('#lab-emoji-alt');

      if (authorInput) authorInput.value = 'QA_Specialist';
      if (roleSelect) roleSelect.value = 'moderator';
      if (textInput) textInput.value = 'Привет @Alex_Stream! Проверяем отображение реплая и кастомного эмодзи :sparkles:';
      if (mentionInput) mentionInput.value = 'Alex_Stream';
      if (replyModeSelect) {
        replyModeSelect.value = 'manual';
        replyModeSelect.dispatchEvent(new Event('change'));
      }
      if (replyAuthorInput) replyAuthorInput.value = 'Alex_Stream';
      if (replyTextInput) replyTextInput.value = 'Как качество звука и картинки?';
      if (emojiUrlInput) emojiUrlInput.value = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="%23fbbf24"/></svg>';
      if (emojiAltInput) emojiAltInput.value = ':star:';
    });
    await monitorWin.waitForTimeout(250);
    await capture('lab-02-reply-mention.png');

    // 18. Message Lab: Presets & Scenarios tab (Scenario 18)
    console.log('\n[Scenario 18] Message Lab: Presets & Scenarios tab');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      const lab = app.getMessageLab();
      if (lab) {
        lab.switchTab('presets');
      }
    });
    await monitorWin.waitForTimeout(250);
    await capture('lab-03-presets-scenarios.png');

    // Close lab drawer after visual scenarios
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      const lab = app.getMessageLab();
      if (lab) lab.close();
    });
    await monitorWin.waitForTimeout(200);

    // 19. Boosty Chat Monitor Lab Mode (Scenario 19)
    console.log('\n[Scenario 19] Boosty Chat Monitor Lab Mode (LAB badge in header)');
    await monitorWin.evaluate(() => {
      const badge = document.querySelector('#monitor-lab-badge');
      if (badge) badge.style.display = 'inline-flex';
      document.title = 'Boosty Chat Monitor — Lab';
    });
    await monitorWin.waitForTimeout(200);
    await capture('lab-04-window-header-badge.png');

    // 20. Autoscroll after burst (Scenario 20)
    console.log('\n[Scenario 20] Autoscroll after burst of 15 messages (unfocused window)');
    const burstMetrics = await monitorWin.evaluate(async () => {
      const app = window.__chatMonitorApp;
      const container = document.querySelector('#chat-container');
      if (!app || !container) return null;

      app.clearView();
      document.hasFocus = () => false;

      for (let i = 1; i <= 15; i++) {
        app.handleIncomingMessage({
          id: `burst-visual-${i}`,
          author: { name: `StreamerFan_${i}`, role: i === 15 ? 'moderator' : null },
          text: `Тестовое сообщение #${i} в серии автопрокрутки — проверка фиксации низа чата!`,
          publishedAt: `19:45:${String(i).padStart(2, '0')}`,
          receivedAt: Date.now(),
          source: 'message_lab',
          qaSynthetic: true,
        });
        await new Promise(r => setTimeout(r, 20));
      }

      const distFromBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
      return {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        distFromBottom,
        followLatest: app.isFollowLatest(),
        isScrolledUp: app.isScrolledUp(),
      };
    });

    if (!burstMetrics || burstMetrics.distFromBottom > 60 || !burstMetrics.followLatest) {
      throw new Error(`Autoscroll after burst failed: ${JSON.stringify(burstMetrics)}`);
    }
    console.log(`  ✓ Burst autoscroll verified: scrollTop=${burstMetrics.scrollTop}, scrollHeight=${burstMetrics.scrollHeight}, dist=${burstMetrics.distFromBottom}`);
    await monitorWin.waitForTimeout(200);
    await capture('autoscroll-after-burst.png');

    // 21. Tech Issue 01: Single warning message (HIGH confidence, badge + calm highlight, no banner)
    console.log('\n[Scenario 21] Tech Issue 01: Single warning message');
    await setSize(390, 600);
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      document.hasFocus = () => false;
      app.clearView();
      app.setFilter('all');
      const now = Date.now();
      app.handleIncomingMessage({
        id: 'tech01-1',
        author: { name: 'Viewer_Max' },
        publishedAt: '20:10:02',
        receivedAt: now,
        text: 'Отличное начало стрима, смотрим!',
      });
      app.handleIncomingMessage({
        id: 'tech01-2',
        author: { name: 'AudioWatcher' },
        publishedAt: '20:10:15',
        receivedAt: now + 1000,
        text: 'Ребята, кажется звук отстаёт от видео на пару секунд',
      });
      app.handleIncomingMessage({
        id: 'tech01-3',
        author: { name: 'Mod_Dmitry', role: 'moderator' },
        publishedAt: '20:10:22',
        receivedAt: now + 2000,
        text: 'Сейчас проверим настройки OBS.',
      });
    });
    await monitorWin.waitForTimeout(150);
    await capture('tech-01-single-warning.png');

    // 22. Tech Issue 02: Multi-user probable alert (2 unique users -> sticky Probable banner)
    console.log('\n[Scenario 22] Tech Issue 02: Multi-user probable alert');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      const now = Date.now();
      app.handleIncomingMessage({
        id: 'tech02-1',
        author: { name: 'Kira_Stream' },
        publishedAt: '20:10:30',
        receivedAt: now + 3000,
        text: 'Да, точно рассинхрон, звук позже видео идёт!',
      });
    });
    await monitorWin.waitForTimeout(150);
    await capture('tech-02-multi-user-alert.png');

    // 23. Tech Issue 03: Filter "Техпроблемы" active
    console.log('\n[Scenario 23] Tech Issue 03: Filter "Техпроблемы" active');
    await monitorWin.evaluate(() => {
      const btnShow = document.querySelector('#btn-tech-show');
      if (btnShow) btnShow.click();
    });
    await monitorWin.waitForTimeout(150);
    await capture('tech-03-filter.png');

    // 24. Tech Issue 04: Critical audio alert (3+ unique users -> Critical banner)
    console.log('\n[Scenario 24] Tech Issue 04: Critical audio missing alert (3 unique viewers)');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      document.hasFocus = () => false;
      app.clearView();
      app.setFilter('all');
      const now = Date.now();
      app.handleIncomingMessage({
        id: 'tech04-0',
        author: { name: 'Alex_Stream', role: 'streamer' },
        publishedAt: '20:15:00',
        receivedAt: now,
        text: 'Переключил сцену, как меня слышно?',
      });
      app.handleIncomingMessage({
        id: 'tech04-1',
        author: { name: 'Viewer_One' },
        publishedAt: '20:15:05',
        receivedAt: now + 1000,
        text: 'НЕТ ЗВУКА вообще!',
      });
      app.handleIncomingMessage({
        id: 'tech04-2',
        author: { name: 'Viewer_Two' },
        publishedAt: '20:15:08',
        receivedAt: now + 2000,
        text: 'Звук пропал после переключения сцены',
      });
      app.handleIncomingMessage({
        id: 'tech04-3',
        author: { name: 'Viewer_One' },
        publishedAt: '20:15:11',
        receivedAt: now + 3000,
        text: 'Без звука сидим, микрофон выключен',
      });
      app.handleIncomingMessage({
        id: 'tech04-4',
        author: { name: 'Viewer_Three' },
        publishedAt: '20:15:14',
        receivedAt: now + 4000,
        text: '@Alex_Stream не слышно тебя совсем!',
        segments: [
          { type: 'mention', displayName: 'Alex_Stream' },
          { type: 'text', text: ' не слышно тебя совсем!' },
        ],
      });
    });
    await monitorWin.waitForTimeout(150);
    await capture('tech-04-critical-audio.png');

    // Verify zero horizontal overflow at 340px width with banner + 5 filter tabs + badges
    await setSize(340, 460);
    const hasTechHorizontalOverflow = await monitorWin.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const container = document.querySelector('#chat-container');
      const banner = document.querySelector('#tech-issue-banner');
      return (
        doc.scrollWidth > doc.clientWidth ||
        body.scrollWidth > body.clientWidth ||
        (container && container.scrollWidth > container.clientWidth) ||
        (banner && banner.scrollWidth > banner.clientWidth)
      );
    });
    if (hasTechHorizontalOverflow) {
      throw new Error('Horizontal overflow detected at 340px width with Tech Issue Banner active!');
    }
    console.log('  ✓ Verified zero horizontal overflow at 340px width with Tech Issue Banner active');
    await setSize(390, 600);

    // 25. Tech Issue 05: False-positive exclusions (no badges, no highlight, no banner)
    console.log('\n[Scenario 25] Tech Issue 05: False-positive exclusions');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      app.clearView();
      app.setFilter('all');
      const now = Date.now();
      const samples = [
        { author: 'CinemaFan', text: 'В этом видео нет звука у автора ролика, так задумано' },
        { author: 'LoreMaster', text: 'У героя тихо голос записан в оригинальной озвучке' },
        { author: 'StoryViewer', text: 'Там по сюжету экран чёрный в конце главы' },
        { author: 'GamerPro', text: 'В игре всё тормозит на этой локации у всех' },
        { author: 'MobileUser', text: 'У меня на телефоне звук пропал, сейчас перезайду' },
        { author: 'RPG_Fan', text: 'Персонаж лагает в катсцене, смешной баг движка' },
      ];
      samples.forEach((s, idx) => {
        app.handleIncomingMessage({
          id: `tech05-${idx + 1}`,
          author: { name: s.author },
          publishedAt: `20:20:0${idx + 1}`,
          receivedAt: now + idx * 1000,
          text: s.text,
        });
      });
    });
    await monitorWin.waitForTimeout(150);
    await capture('tech-05-false-positive.png');

    // 26. User Context 01: Basic panel open (user-context-01-basic.png)
    console.log('\n[Scenario 26] User Context 01: Basic panel open for viewer');
    await setSize(390, 600);
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      app.clearView();
      app.setFilter('all');
      const now = Date.now();
      app.handleIncomingMessage({
        id: 'uc-1',
        author: { name: 'ViewerAlice' },
        publishedAt: '20:30:01',
        receivedAt: now,
        text: 'Всем отличного стрима и хорошего настроения! 🎮',
      });
      app.handleIncomingMessage({
        id: 'uc-2',
        author: { name: 'ViewerBob' },
        publishedAt: '20:30:10',
        receivedAt: now + 1000,
        text: 'Привет Алиса! Рады видеть в чате.',
      });
      app.handleIncomingMessage({
        id: 'uc-3',
        author: { name: 'ViewerAlice' },
        publishedAt: '20:30:25',
        receivedAt: now + 2000,
        text: 'Спасибо, ждала начало трансляции весь день!',
      });
      app.openUserContext({ author: { name: 'ViewerAlice' } });
    });
    await monitorWin.waitForTimeout(200);
    await capture('user-context-01-basic.png');

    // 27. User Context 02: Rich history with tags: mention, reply, tech issue (user-context-02-tech-history.png)
    console.log('\n[Scenario 27] User Context 02: Rich history with mention, reply, and tech issue');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      const now = Date.now();
      app.handleIncomingMessage({
        id: 'uc-4',
        author: { name: 'ViewerAlice' },
        publishedAt: '20:31:05',
        receivedAt: now + 3000,
        text: '@Alex_Stream ты какую игру планируешь дальше проходить?',
        segments: [
          { type: 'mention', displayName: 'Alex_Stream' },
          { type: 'text', text: ' ты какую игру планируешь дальше проходить?' },
        ],
      });
      app.handleIncomingMessage({
        id: 'uc-mod',
        author: { name: 'ModMike', role: 'moderator' },
        publishedAt: '20:31:12',
        receivedAt: now + 3500,
        text: 'В расписании канала указан следующий проект.',
      });
      app.handleIncomingMessage({
        id: 'uc-5',
        author: { name: 'ViewerAlice' },
        publishedAt: '20:31:25',
        receivedAt: now + 4000,
        text: 'Спасибо за подсказку, сейчас посмотрю!',
        reply: { author: 'ModMike', text: 'В расписании канала указан следующий проект.' },
      });
      app.handleIncomingMessage({
        id: 'uc-6',
        author: { name: 'ViewerAlice' },
        publishedAt: '20:32:00',
        receivedAt: now + 5000,
        text: 'Ой, звук пропал на стриме',
      });
      app.handleIncomingMessage({
        id: 'uc-7',
        author: { name: 'ViewerAlice' },
        publishedAt: '20:32:15',
        receivedAt: now + 6000,
        text: 'А нет, это в игре тишина была, всё нормально)',
      });
      app.renderUserContext(true);
    });
    await monitorWin.waitForTimeout(200);
    await capture('user-context-02-tech-history.png');

    // 28. User Context 03: Search filter within user messages (user-context-03-search.png)
    console.log('\n[Scenario 28] User Context 03: Search within user context');
    await monitorWin.evaluate(() => {
      const input = document.querySelector('#user-context-search-input');
      if (input) {
        input.value = 'звук';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await monitorWin.waitForTimeout(200);
    await capture('user-context-03-search.png');

    // Clear search for next scenarios
    await monitorWin.evaluate(() => {
      const clearBtn = document.querySelector('#btn-user-context-search-clear');
      if (clearBtn) clearBtn.click();
    });
    await monitorWin.waitForTimeout(100);

    // 29. User Context 04: Long history pagination button (user-context-04-long-history.png)
    console.log('\n[Scenario 29] User Context 04: Long history pagination button (+10)');
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      const now = Date.now();
      for (let i = 8; i <= 24; i++) {
        app.handleIncomingMessage({
          id: `uc-${i}`,
          author: { name: 'ViewerAlice' },
          publishedAt: `20:35:${String(i).padStart(2, '0')}`,
          receivedAt: now + i * 1000,
          text: `Сообщение #${i} от Алисы для проверки пагинации истории`,
        });
      }
      app.openUserContext({ author: { name: 'ViewerAlice' } });
      const ucBody = document.querySelector('#user-context-body');
      if (ucBody) ucBody.scrollTop = 0;
    });
    await monitorWin.waitForTimeout(200);
    await capture('user-context-04-long-history.png');

    // 30. User Context 05: Responsive layout at min-width 340px (user-context-05-min-width.png)
    console.log('\n[Scenario 30] User Context 05: Responsive layout at min-width 340px');
    await setSize(340, 480);
    await monitorWin.waitForTimeout(200);
    const hasUcHorizontalOverflow = await monitorWin.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const panel = document.querySelector('#user-context-panel');
      const ucBody = document.querySelector('#user-context-body');
      return (
        doc.scrollWidth > doc.clientWidth ||
        body.scrollWidth > body.clientWidth ||
        (panel && panel.scrollWidth > panel.clientWidth) ||
        (ucBody && ucBody.scrollWidth > ucBody.clientWidth)
      );
    });
    if (hasUcHorizontalOverflow) {
      throw new Error('Horizontal overflow detected at 340px width with User Context Panel active!');
    }
    console.log('  ✓ Verified zero horizontal overflow at 340px width with User Context Panel active');
    await capture('user-context-05-min-width.png');

    // Close user context panel and restore normal size
    await monitorWin.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (app) app.closeUserContext();
    });
    await setSize(390, 600);
    await monitorWin.waitForTimeout(150);

    console.log('\n========================================');
    console.log(`Visual QA completed: ${screenshots.length} screenshots saved`);
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Page errors: ${pageErrors.length}`);
    console.log('========================================\n');

    fs.writeFileSync(
      path.join(artifactsDir, 'console-errors.json'),
      JSON.stringify({ consoleErrors, pageErrors, timestamp: new Date().toISOString() }, null, 2)
    );

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(`Visual QA failed with ${consoleErrors.length} console errors and ${pageErrors.length} page errors`);
    }

  } finally {
    if (electronApp) {
      await electronApp.close();
    }
    try {
      if (fs.existsSync(tmpConfigFile)) fs.unlinkSync(tmpConfigFile);
    } catch {}
  }
}

runVisualQa().catch(err => {
  console.error('Visual QA run failed:', err);
  process.exit(1);
});
