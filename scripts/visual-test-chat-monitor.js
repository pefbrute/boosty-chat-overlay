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
    await mainWindow.waitForSelector('#dash-open-chat-monitor-btn', { state: 'visible', timeout: 5000 });
    console.log('✓ Main dashboard ready with chat monitor button');

    // Click "Открыть окно чата" on dashboard to test the real integration button!
    console.log('Opening Chat Monitor window via dashboard button...');
    const windowPromise = electronApp.waitForEvent('window', { timeout: 10000 });
    await mainWindow.click('#dash-open-chat-monitor-btn');

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
        author: { name: 'Alex_Stream', role: 'streamer' },
        publishedAt: '18:30:12',
        text: 'Всем привет! Начинаем стрим по графике.',
      });
      app.handleIncomingMessage({
        id: 'msg-norm-2',
        author: { name: 'Mod_Dmitry', role: 'moderator' },
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
        author: { name: 'Kira' },
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
