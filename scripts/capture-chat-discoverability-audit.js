'use strict';

/**
 * Capture script for Chat Monitor Discoverability UX Audit Pack
 *
 * Captures all required screenshots into artifacts/chat-discoverability-audit/:
 * 1. 01-home-default.png
 * 2. 02-home-ready.png
 * 3. 03-home-chat-action.png
 * 4. 04-sidebar.png
 * 5. 05-chat-monitor.png
 * 6. 06-chat-monitor-empty.png
 * 7. 07-onboarding-final.png
 * 8. 08-settings.png
 * 9. 09-advanced.png
 * 10. 10-home-800x650.png
 * 11. 11-home-1280x850.png
 * 12. 12-home-lab.png
 */

const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'artifacts', 'chat-discoverability-audit');
const testPort = 17399;
const tmpConfigFile = path.join('/tmp', `boosty-audit-pack-${process.pid}.json`);

fs.writeFileSync(tmpConfigFile, JSON.stringify({
  durationSeconds: 20,
  maxMessages: 6,
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

fs.mkdirSync(outDir, { recursive: true });

async function runAuditCapture() {
  console.log('=== Chat Monitor Discoverability: Capturing UX Audit Pack ===\n');

  let electronApp = null;

  try {
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
      },
    });

    const firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');

    const bw = await electronApp.browserWindow(firstWindow);
    await bw.evaluate((b) => {
      b.setContentSize(1280, 850);
      b.center();
    });
    await firstWindow.setViewportSize({ width: 1280, height: 850 });
    await firstWindow.waitForTimeout(300);

    const applyState = async (state) => {
      await firstWindow.evaluate((s) => window.__BOOSTY_UI_TEST__.applyState(s), state);
      await firstWindow.waitForTimeout(200);
    };

    const readyMock = {
      view: 'dashboard',
      health: {
        extensionConnected: true,
        extensionVersion: '0.4.0',
        isOutdated: false,
        boostyConnected: true,
        boostyTabUrl: 'https://boosty.to/streamer_live',
        receivedMessages: 42,
      },
      obs: {
        ok: true,
        connected: true,
        scenes: [{ sceneUuid: 's1', sceneName: 'Основная сцена', hasChat: true }],
      },
    };

    // 1. 01-home-default.png: Initial startup state (checking/connecting)
    console.log('Capturing 01-home-default.png...');
    await applyState({ view: 'dashboard' });
    await firstWindow.screenshot({ path: path.join(outDir, '01-home-default.png') });

    // 2. 02-home-ready.png: All Ready state (Everything green & active)
    console.log('Capturing 02-home-ready.png...');
    await applyState(readyMock);
    await firstWindow.waitForTimeout(150);
    await firstWindow.screenshot({ path: path.join(outDir, '02-home-ready.png') });

    // 3. 03-home-chat-action.png: Detailed close-up crop of the region containing "Открыть окно чата"
    console.log('Capturing 03-home-chat-action.png...');
    const footerBar = await firstWindow.$('.dashboard-footer-bar');
    const heroCard = await firstWindow.$('#main-action-card');
    if (footerBar && heroCard) {
      const footerBox = await footerBar.boundingBox();
      const heroBox = await heroCard.boundingBox();
      if (footerBox && heroBox) {
        // Capture context including bottom of action card and full footer bar
        const clipY = Math.max(0, heroBox.y + heroBox.height * 0.4);
        const clipHeight = (footerBox.y + footerBox.height + 24) - clipY;
        await firstWindow.screenshot({
          path: path.join(outDir, '03-home-chat-action.png'),
          clip: {
            x: Math.max(0, footerBox.x - 20),
            y: clipY,
            width: footerBox.width + 40,
            height: clipHeight,
          },
        });
      } else {
        await footerBar.screenshot({ path: path.join(outDir, '03-home-chat-action.png') });
      }
    }

    // 4. 04-sidebar.png: Sidebar in its entirety
    console.log('Capturing 04-sidebar.png...');
    const sidebar = await firstWindow.$('#app-sidebar');
    if (sidebar) {
      await sidebar.screenshot({ path: path.join(outDir, '04-sidebar.png') });
    }

    // 7. 07-onboarding-final.png: Step 4 of Onboarding ("Всё готово к стриму!")
    console.log('Capturing 07-onboarding-final.png...');
    await applyState({
      view: 'onboarding',
      step: 4,
      health: {
        extensionConnected: true,
        boostyConnected: true,
        extensionVersion: '0.4.0',
        appVersion: '0.4.0',
      },
      obs: {
        ok: true,
        connected: true,
        scenes: [{ sceneName: 'Основная сцена' }],
      },
    });
    await firstWindow.waitForTimeout(200);
    await firstWindow.screenshot({ path: path.join(outDir, '07-onboarding-final.png') });

    // 8. 08-settings.png: Раздел «Настройка»
    console.log('Capturing 08-settings.png...');
    await applyState({ view: 'setup' });
    await firstWindow.waitForTimeout(200);
    await firstWindow.screenshot({ path: path.join(outDir, '08-settings.png') });

    // 9. 09-advanced.png: Раздел «Дополнительно»
    console.log('Capturing 09-advanced.png...');
    await applyState({ view: 'extra' });
    await firstWindow.waitForTimeout(200);
    await firstWindow.screenshot({ path: path.join(outDir, '09-advanced.png') });

    // 10. 10-home-800x650.png: Main dashboard at compact 800x650 viewport
    console.log('Capturing 10-home-800x650.png...');
    await firstWindow.click('#nav-dashboard');
    await applyState(readyMock);
    await bw.evaluate((b) => b.setContentSize(800, 650));
    await firstWindow.setViewportSize({ width: 800, height: 650 });
    await firstWindow.waitForTimeout(200);
    await firstWindow.screenshot({ path: path.join(outDir, '10-home-800x650.png') });

    // 11. 11-home-1280x850.png: Main dashboard at standard 1280x850 viewport
    console.log('Capturing 11-home-1280x850.png...');
    await bw.evaluate((b) => b.setContentSize(1280, 850));
    await firstWindow.setViewportSize({ width: 1280, height: 850 });
    await firstWindow.waitForTimeout(200);
    await firstWindow.screenshot({ path: path.join(outDir, '11-home-1280x850.png') });

    // Now open Chat Monitor window to capture 05 and 06
    console.log('Opening Chat Monitor window...');
    await firstWindow.waitForSelector('#dash-open-chat-monitor-btn', { state: 'visible', timeout: 5000 });
    const windowPromise = electronApp.waitForEvent('window', { timeout: 10000 });
    await firstWindow.click('#dash-open-chat-monitor-btn');
    const chatMonitorPage = await windowPromise;
    await chatMonitorPage.waitForLoadState('domcontentloaded');
    await chatMonitorPage.waitForSelector('.monitor-layout', { timeout: 10000 });
    await chatMonitorPage.waitForTimeout(400);

    const chatBw = await electronApp.browserWindow(chatMonitorPage);
    await chatBw.evaluate((b) => {
      b.setContentSize(420, 680);
      b.center();
    });
    await chatMonitorPage.setViewportSize({ width: 420, height: 680 });
    await chatMonitorPage.waitForTimeout(200);

    // 6. 06-chat-monitor-empty.png: Chat Monitor in empty / waiting state
    console.log('Capturing 06-chat-monitor-empty.png...');
    await chatMonitorPage.screenshot({ path: path.join(outDir, '06-chat-monitor-empty.png') });

    // 5. 05-chat-monitor.png: Chat Monitor with active messages, roles, and tech issues
    console.log('Capturing 05-chat-monitor.png...');
    await chatMonitorPage.evaluate(() => {
      const app = window.__chatMonitorApp;
      if (!app) return;
      app.clearView();
      const now = Date.now();
      const messages = [
        {
          id: 'aud-1',
          author: { name: 'Viewer_Max', role: 'user' },
          text: 'Всем привет! Картинка отличная, стрим начался вовремя!',
          publishedAt: '20:10:02',
          receivedAt: now - 30000,
        },
        {
          id: 'aud-2',
          author: { name: 'Mod_Dmitry', role: 'moderator' },
          text: 'Добро пожаловать на трансляцию! Не забываем ставить лайки.',
          publishedAt: '20:10:22',
          receivedAt: now - 25000,
        },
        {
          id: 'aud-3',
          author: { name: 'Kira_Stream', role: 'user' },
          text: '@Alex_Stream звук кажется немного отстаёт от видео',
          publishedAt: '20:11:05',
          technicalIssue: true,
          technicalIssueType: 'audio_sync',
          technicalIssueConfidence: 'HIGH',
          receivedAt: now - 15000,
        },
        {
          id: 'aud-4',
          author: { name: 'Alex_Stream', role: 'streamer' },
          text: 'Спасибо за отзыв, сейчас подправлю смещение звука в OBS!',
          reply: { author: 'Kira_Stream', text: '@Alex_Stream звук кажется немного отстаёт от видео' },
          publishedAt: '20:11:30',
          receivedAt: now - 5000,
        },
      ];
      for (const msg of messages) {
        app.handleIncomingMessage(msg);
      }
    });
    await chatMonitorPage.waitForTimeout(300);
    await chatMonitorPage.screenshot({ path: path.join(outDir, '05-chat-monitor.png') });

    // Close electron
    await electronApp.close();
    electronApp = null;

    // 12. 12-home-lab.png: Launch in --lab mode to capture Lab-specific header badge
    console.log('Capturing 12-home-lab.png (Lab mode)...');
    const labApp = await electron.launch({
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        path.join(projectRoot, 'desktop', 'main.js'),
        '--lab',
      ],
      env: {
        ...process.env,
        BOOSTY_OVERLAY_PORT: String(testPort + 1),
        BOOSTY_OVERLAY_CONFIG: tmpConfigFile,
        BOOSTY_OVERLAY_UI_TEST: '1',
      },
    });

    const labWindow = await labApp.firstWindow();
    await labWindow.waitForLoadState('domcontentloaded');
    const labBw = await labApp.browserWindow(labWindow);
    await labBw.evaluate((b) => {
      b.setContentSize(1280, 850);
      b.center();
    });
    await labWindow.setViewportSize({ width: 1280, height: 850 });
    await labWindow.waitForTimeout(300);
    await labWindow.evaluate((s) => window.__BOOSTY_UI_TEST__.applyState(s), readyMock);
    await labWindow.waitForTimeout(200);
    await labWindow.screenshot({ path: path.join(outDir, '12-home-lab.png') });
    await labApp.close();

    console.log('\n✓ All 12 audit screenshots captured successfully in artifacts/chat-discoverability-audit/\n');
  } catch (err) {
    console.error('Error during audit capture:', err);
    if (electronApp) {
      await electronApp.close().catch(() => {});
    }
    process.exit(1);
  } finally {
    if (fs.existsSync(tmpConfigFile)) {
      fs.unlinkSync(tmpConfigFile);
    }
  }
}

runAuditCapture();
