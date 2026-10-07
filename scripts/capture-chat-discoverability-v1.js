'use strict';

/**
 * Capture script for Chat Monitor Discoverability UX v1 Verification
 *
 * Captures the 5 required discoverability screenshots into artifacts/chat-discoverability-audit/:
 * 1. discoverability-01-sidebar-chat.png (1280x850: Home with visible sidebar "Чат ↗")
 * 2. discoverability-02-sidebar-chat-compact.png (800x650: Compact Home with sidebar chat icon visible & centered)
 * 3. discoverability-03-onboarding-chat-cta.png (Onboarding Step 4 with "Открыть чат" primary CTA)
 * 4. discoverability-04-chat-autostart-setting.png (Setup view showing "Чат стримера" card and checkbox)
 * 5. discoverability-05-home-cleaned.png (Home view showing cleaned footer bar without the old chat button)
 */

const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'artifacts', 'chat-discoverability-audit');
const testPort = 17397;
const tmpConfigFile = path.join('/tmp', `boosty-discoverability-v1-${process.pid}.json`);

fs.writeFileSync(tmpConfigFile, JSON.stringify({
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
  autoOpenChatMonitor: false,
}, null, 2));

fs.mkdirSync(outDir, { recursive: true });

async function runCapture() {
  console.log('=== Capturing Chat Monitor Discoverability UX v1 Screenshots ===\n');

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
    const setSize = async (w, h) => {
      await bw.evaluate((b, { width, height }) => {
        b.setContentSize(width, height);
        b.center();
      }, { width: w, height: h });
      await firstWindow.setViewportSize({ width: w, height: h });
      await firstWindow.waitForTimeout(200);
    };

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

    // 1. discoverability-01-sidebar-chat.png: 1280x850 Home view with sidebar item "Чат ↗"
    console.log('Capturing discoverability-01-sidebar-chat.png (1280x850)...');
    await setSize(1280, 850);
    await applyState(readyMock);
    await firstWindow.screenshot({ path: path.join(outDir, 'discoverability-01-sidebar-chat.png') });

    // 2. discoverability-02-sidebar-chat-compact.png: 800x650 Compact Home view with sidebar chat icon
    console.log('Capturing discoverability-02-sidebar-chat-compact.png (800x650)...');
    await setSize(800, 650);
    await applyState(readyMock);
    await firstWindow.screenshot({ path: path.join(outDir, 'discoverability-02-sidebar-chat-compact.png') });

    // 3. discoverability-03-onboarding-chat-cta.png: Onboarding Step 4 with "Открыть чат" CTA
    console.log('Capturing discoverability-03-onboarding-chat-cta.png (1280x850)...');
    await setSize(1280, 850);
    await applyState({
      view: 'onboarding',
      step: 4,
      health: {
        extensionConnected: true,
        boostyConnected: true,
      },
      obs: {
        connected: true,
        scenes: [{ sceneUuid: 's1', sceneName: 'Основная сцена', hasChat: true }],
      },
    });
    await firstWindow.screenshot({ path: path.join(outDir, 'discoverability-03-onboarding-chat-cta.png') });

    // 4. discoverability-04-chat-autostart-setting.png: Setup view showing "Чат стримера" card
    console.log('Capturing discoverability-04-chat-autostart-setting.png (1280x850)...');
    await setSize(1280, 850);
    await applyState({
      view: 'setup',
      config: {
        autoOpenChatMonitor: false,
      },
    });
    await firstWindow.screenshot({ path: path.join(outDir, 'discoverability-04-chat-autostart-setting.png') });

    // 5. discoverability-05-home-cleaned.png: Close-up of cleaned Home footer
    console.log('Capturing discoverability-05-home-cleaned.png (1280x850)...');
    await setSize(1280, 850);
    await applyState(readyMock);
    const footerBar = await firstWindow.$('.dashboard-footer-bar');
    const heroCard = await firstWindow.$('#main-action-card');
    if (footerBar && heroCard) {
      const footerBox = await footerBar.boundingBox();
      const heroBox = await heroCard.boundingBox();
      if (footerBox && heroBox) {
        const clipY = Math.max(0, heroBox.y + heroBox.height * 0.4);
        const clipHeight = (footerBox.y + footerBox.height + 24) - clipY;
        await firstWindow.screenshot({
          path: path.join(outDir, 'discoverability-05-home-cleaned.png'),
          clip: {
            x: Math.max(0, footerBox.x - 20),
            y: clipY,
            width: footerBox.width + 40,
            height: clipHeight,
          },
        });
      } else {
        await footerBar.screenshot({ path: path.join(outDir, 'discoverability-05-home-cleaned.png') });
      }
    }

    console.log('\n✓ All 5 discoverability screenshots captured successfully!');
  } finally {
    if (electronApp) {
      await electronApp.close();
    }
    try {
      if (fs.existsSync(tmpConfigFile)) fs.unlinkSync(tmpConfigFile);
    } catch {}
  }
}

runCapture().catch((err) => {
  console.error('Fatal error during capture:', err);
  process.exit(1);
});
