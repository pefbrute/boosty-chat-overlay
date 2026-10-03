'use strict';

/**
 * Electron UI Visual QA Runner using Playwright
 *
 * Launches the real Electron application with an isolated test configuration,
 * exercises all key viewports, UI views, Status Hub deterministic states,
 * stress cases, and interactive flows, capturing high-fidelity screenshots
 * into artifacts/ui/ and checking DOM/layout constraints for visual regressions.
 */

const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const projectRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(projectRoot, 'artifacts', 'ui');
const testPort = 17397;
const tmpConfigFile = path.join('/tmp', `boosty-visual-qa-${process.pid}.json`);

// Clean initial config
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

// Ensure artifacts output directory exists
fs.mkdirSync(artifactsDir, { recursive: true });

async function runVisualQa() {
  console.log('========================================');
  console.log('       Electron UI Visual QA            ');
  console.log('========================================\n');

  let electronApp = null;
  const consoleErrors = [];
  const pageErrors = [];
  const layoutIssues = [];
  const screenshots = [];
  const statesChecked = [];

  try {
    // 1. Launch real Electron application
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

    const win = await electronApp.firstWindow();
    const bw = await electronApp.browserWindow(win);

    // Listen to console and page errors
    win.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore benign Electron internal warning about CSP in dev/sandbox
        if (!text.includes('Electron Security Warning')) {
          consoleErrors.push({ type: 'console.error', text, location: msg.location() });
        }
      }
    });

    win.on('pageerror', err => {
      pageErrors.push({ message: err.message, stack: err.stack });
    });

    // Wait until application is initialized
    await win.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 15000 });
    await win.evaluate(() => document.fonts.ready);
    console.log('✓ Dashboard loaded');

    // Layout Verification Helper
    async function verifyLayout(stepName) {
      const issues = await win.evaluate(() => {
        const detected = [];
        const docEl = document.documentElement;
        const body = document.body;

        // 1. Horizontal scroll overflow check
        if (docEl.scrollWidth > window.innerWidth + 2) {
          detected.push(`Horizontal overflow: doc scrollWidth (${docEl.scrollWidth}px) > window.innerWidth (${window.innerWidth}px)`);
        }
        if (body.scrollWidth > window.innerWidth + 2) {
          detected.push(`Horizontal overflow: body scrollWidth (${body.scrollWidth}px) > window.innerWidth (${window.innerWidth}px)`);
        }

        // 2. Status Hub Pill checks (when on dashboard)
        const dashboard = document.querySelector('#view-dashboard');
        const isDashboardActive = dashboard && window.getComputedStyle(dashboard).display !== 'none';

        if (isDashboardActive) {
          const pills = [
            document.querySelector('#dash-obs-pill'),
            document.querySelector('#dash-ext-pill'),
            document.querySelector('#dash-boosty-pill'),
            document.querySelector('#dash-overlay-pill'),
          ].filter(Boolean);

          pills.forEach((p, idx) => {
            const rect = p.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
              detected.push(`Status pill [${idx}] has invalid dimensions: ${rect.width}x${rect.height}`);
            }
            if (rect.right > window.innerWidth + 2) {
              detected.push(`Status pill [${idx}] overflows right edge: right=${rect.right}, innerWidth=${window.innerWidth}`);
            }
          });
        }

        // 3. Interactive buttons check
        const visibleButtons = Array.from(document.querySelectorAll('button')).filter(b => {
          const style = window.getComputedStyle(b);
          return style.display !== 'none' && style.visibility !== 'hidden' && b.offsetParent !== null;
        });

        visibleButtons.forEach(btn => {
          const rect = btn.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            detected.push(`Visible button has zero dimensions: id="${btn.id}", text="${btn.textContent.trim()}"`);
          }
        });

        return detected;
      });

      if (issues.length > 0) {
        layoutIssues.push({ step: stepName, issues });
        console.warn(`  ⚠ Layout issues at "${stepName}":`, issues);
      }
      return issues.length === 0;
    }

    // Helper to capture a named screenshot
    async function captureScreenshot(filename) {
      const filePath = path.join(artifactsDir, filename);
      await win.screenshot({ path: filePath });
      screenshots.push(filename);
      return filePath;
    }

    // Helper to apply state through UI test hook
    async function applyState(mockState) {
      await win.evaluate(async state => {
        if (window.__BOOSTY_UI_TEST__ && window.__BOOSTY_UI_TEST__.setState) {
          await window.__BOOSTY_UI_TEST__.setState(state);
        }
      }, mockState);
      await win.evaluate(() => document.fonts.ready);
      await win.waitForTimeout(60);
    }

    // =========================================================================
    // 2. Multi-Viewport Responsive Tests (Dashboard Default State)
    // =========================================================================
    console.log('\n--- Multi-Viewport Responsive Verification ---');

    // Ensure dashboard view is active with healthy baseline state for multi-viewport tests
    await applyState({
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
    });

    const viewports = [
      { width: 1280, height: 850, name: 'dashboard-1280x850.png' },
      { width: 1000, height: 750, name: 'dashboard-1000x750.png' },
      { width: 800, height: 650, name: 'dashboard-800x650.png' },
    ];

    for (const vp of viewports) {
      await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: vp.width, h: vp.height });
      await win.setViewportSize({ width: vp.width, height: vp.height });
      await win.waitForTimeout(100);
      await verifyLayout(`Viewport ${vp.width}x${vp.height}`);
      await captureScreenshot(vp.name);
      console.log(`✓ ${vp.width}x${vp.height} verified -> ${vp.name}`);
    }

    // Return to standard 1280x850 for state tests
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 1280, h: 850 });
    await win.setViewportSize({ width: 1280, height: 850 });
    await win.waitForTimeout(60);

    // =========================================================================
    // 3. Status Hub Deterministic Scenarios
    // =========================================================================
    console.log('\n--- Status Hub Deterministic Scenarios ---');

    // 3.1 All Ready
    await applyState({
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
    });
    await verifyLayout('state-all-ready');
    await captureScreenshot('state-all-ready.png');
    statesChecked.push('all-ready');

    const allReadyCheck = await win.evaluate(() => {
      const banner = document.querySelector('#readiness-status');
      const title = document.querySelector('#readiness-title')?.textContent || '';
      const primaryRepairBtns = document.querySelectorAll('#main-action-actions button.primary');
      const overlayPill = document.querySelector('#dash-overlay-pill');
      return {
        isReadyBanner: banner?.classList.contains('ready'),
        titleMatches: title.includes('Готово к стриму'),
        repairCount: primaryRepairBtns.length,
        overlayPillReady: overlayPill?.classList.contains('ready'),
      };
    });
    if (!allReadyCheck.isReadyBanner || !allReadyCheck.titleMatches || allReadyCheck.repairCount !== 0) {
      throw new Error(`state-all-ready validation failed: ${JSON.stringify(allReadyCheck)}`);
    }
    console.log('✓ All Ready state verified -> state-all-ready.png');

    // 3.2 OBS Offline
    await applyState({
      view: 'dashboard',
      health: { extensionConnected: true, boostyConnected: true },
      obs: { ok: false, connected: false },
    });
    await verifyLayout('state-obs-offline');
    await captureScreenshot('state-obs-offline.png');
    statesChecked.push('obs-offline');

    const obsOfflineCheck = await win.evaluate(() => {
      const btn = document.querySelector('#dash-obs-launch-btn');
      const style = btn ? window.getComputedStyle(btn) : null;
      return {
        btnVisible: style && style.display !== 'none',
        btnText: btn?.textContent || '',
      };
    });
    if (!obsOfflineCheck.btnVisible || !obsOfflineCheck.btnText.includes('Запустить')) {
      throw new Error(`state-obs-offline CTA check failed: ${JSON.stringify(obsOfflineCheck)}`);
    }
    console.log('✓ OBS offline state verified (CTA "Запустить OBS") -> state-obs-offline.png');

    // 3.3 OBS Restart Required
    await applyState({
      view: 'dashboard',
      health: { extensionConnected: true, boostyConnected: true },
      obs: { ok: false, connected: false, restartRequired: true },
    });
    await verifyLayout('state-obs-restart-required');
    await captureScreenshot('state-obs-restart-required.png');
    statesChecked.push('obs-restart-required');
    console.log('✓ OBS restart required state verified -> state-obs-restart-required.png');

    // 3.4 Extension Offline
    await applyState({
      view: 'dashboard',
      health: { extensionConnected: false, boostyConnected: false },
      obs: { ok: true, connected: true },
    });
    await verifyLayout('state-extension-offline');
    await captureScreenshot('state-extension-offline.png');
    statesChecked.push('extension-offline');

    const extOfflineCheck = await win.evaluate(() => {
      const btn = document.querySelector('#dash-ext-fix-btn');
      const style = btn ? window.getComputedStyle(btn) : null;
      return {
        btnVisible: style && style.display !== 'none',
        btnText: btn?.textContent || '',
      };
    });
    if (!extOfflineCheck.btnVisible || !extOfflineCheck.btnText.includes('Настроить')) {
      throw new Error(`state-extension-offline CTA check failed: ${JSON.stringify(extOfflineCheck)}`);
    }
    console.log('✓ Extension offline state verified (CTA "Настроить") -> state-extension-offline.png');

    // 3.5 Extension Outdated
    await applyState({
      view: 'dashboard',
      health: {
        extensionConnected: true,
        extensionVersion: '0.2.0',
        isOutdated: true,
        bundledExtensionVersion: '0.4.0',
        boostyConnected: true,
      },
      obs: { ok: true, connected: true },
    });
    await verifyLayout('state-extension-outdated');
    await captureScreenshot('state-extension-outdated.png');
    statesChecked.push('extension-outdated');
    console.log('✓ Extension outdated state verified -> state-extension-outdated.png');

    // 3.6 Stream Missing
    await applyState({
      view: 'dashboard',
      health: { extensionConnected: true, boostyConnected: false },
      obs: { ok: true, connected: true },
    });
    await verifyLayout('state-stream-missing');
    await captureScreenshot('state-stream-missing.png');
    statesChecked.push('stream-missing');

    const streamMissingCheck = await win.evaluate(() => {
      const btn = document.querySelector('#dash-boosty-open-btn');
      const style = btn ? window.getComputedStyle(btn) : null;
      return {
        btnVisible: style && style.display !== 'none',
        btnText: btn?.textContent || '',
      };
    });
    if (!streamMissingCheck.btnVisible || !streamMissingCheck.btnText.includes('Открыть')) {
      throw new Error(`state-stream-missing CTA check failed: ${JSON.stringify(streamMissingCheck)}`);
    }
    console.log('✓ Stream missing state verified (CTA "Открыть Boosty") -> state-stream-missing.png');

    // 3.7 Overlay Missing
    await applyState({
      view: 'dashboard',
      health: { extensionConnected: true, boostyConnected: true },
      obs: {
        ok: true,
        connected: true,
        scenes: [{ sceneUuid: 's1', sceneName: 'Игровая', hasChat: false }],
      },
    });
    await verifyLayout('state-overlay-missing');
    await captureScreenshot('state-overlay-missing.png');
    statesChecked.push('overlay-missing');

    const overlayMissingCheck = await win.evaluate(() => {
      const btn = document.querySelector('#dash-overlay-action-btn');
      const style = btn ? window.getComputedStyle(btn) : null;
      return {
        btnVisible: style && style.display !== 'none',
        btnText: btn?.textContent || '',
      };
    });
    if (!overlayMissingCheck.btnVisible || !overlayMissingCheck.btnText.includes('Добавить')) {
      throw new Error(`state-overlay-missing CTA check failed: ${JSON.stringify(overlayMissingCheck)}`);
    }
    console.log('✓ Overlay missing state verified (CTA "Добавить в сцену") -> state-overlay-missing.png');

    // =========================================================================
    // 4. Long-Content Stress Scenario
    // =========================================================================
    console.log('\n--- Long-Content Stress Scenario ---');
    await applyState({
      view: 'dashboard',
      health: {
        extensionConnected: true,
        boostyConnected: true,
        boostyTabUrl: 'https://boosty.to/very-long-channel-name-with-extra-segments-and-many-parameters-testing-text-overflow-and-visual-stability',
        receivedMessages: 9999,
      },
      obs: {
        ok: true,
        connected: true,
        scenes: [{
          sceneUuid: 's1',
          sceneName: 'Очень длинное название сцены OBS которое потенциально ломает карточку интерфейса и вызывает горизонтальный скролл',
          hasChat: true,
        }],
      },
    });
    await verifyLayout('state-long-content');
    await captureScreenshot('state-long-content.png');
    statesChecked.push('long-content');
    console.log('✓ Long content stress verified (zero horizontal scroll) -> state-long-content.png');

    // =========================================================================
    // 5. Primary Views & Interactive Flows
    // =========================================================================
    console.log('\n--- Primary Views & Interactive Flows ---');

    // 5.1 Appearance View & Preset interaction
    await applyState({ view: 'appearance' });
    await win.waitForFunction(() => {
      const el = document.querySelector('#view-appearance');
      return el && window.getComputedStyle(el).display !== 'none';
    });
    await verifyLayout('appearance-view');

    // Click "Large" preset
    await win.evaluate(() => {
      document.querySelector('#preset-btn-large')?.click();
    });
    const largeFontSize = await win.evaluate(() => document.querySelector('#font-size')?.value);
    if (Number(largeFontSize) !== 26) {
      throw new Error(`Preset click failed: expected fontSize 26, got ${largeFontSize}`);
    }
    await captureScreenshot('appearance.png');
    statesChecked.push('appearance');
    console.log('✓ Appearance view & preset click verified -> appearance.png');

    // 5.2 Onboarding View
    await applyState({ view: 'onboarding', step: 1 });
    await win.waitForFunction(() => {
      const el = document.querySelector('#onboarding-view');
      return el && window.getComputedStyle(el).display !== 'none';
    });
    await verifyLayout('onboarding-view');
    await captureScreenshot('onboarding.png');
    statesChecked.push('onboarding');
    console.log('✓ Onboarding view verified -> onboarding.png');

    // Return to dashboard
    await applyState({ view: 'dashboard' });

    // 5.3 Modal Interaction (Open & Close Extension Setup Modal)
    await win.evaluate(() => {
      if (typeof openExtensionModal === 'function') openExtensionModal('setup');
    });
    const isModalOpen = await win.evaluate(() => {
      const modal = document.querySelector('#dash-ext-modal');
      return modal && window.getComputedStyle(modal).display === 'flex';
    });
    if (!isModalOpen) throw new Error('Extension modal failed to open');
    await captureScreenshot('modal-extension-setup.png');
    statesChecked.push('modal-setup');

    // Close modal
    await win.evaluate(() => {
      document.querySelector('#modal-close-btn')?.click();
    });
    const isModalClosed = await win.evaluate(() => {
      const modal = document.querySelector('#dash-ext-modal');
      return modal && window.getComputedStyle(modal).display === 'none';
    });
    if (!isModalClosed) throw new Error('Extension modal failed to close');
    console.log('✓ Modal open/close interaction verified -> modal-extension-setup.png');

    // 5.4 Keyboard Tab Navigation check
    await win.evaluate(() => document.body.focus());
    await win.keyboard.press('Tab');
    await win.keyboard.press('Tab');
    await win.keyboard.press('Tab');

    const activeElemTag = await win.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName.toUpperCase() : 'NONE';
    });
    const interactiveTags = ['BUTTON', 'A', 'INPUT', 'SELECT'];
    if (!interactiveTags.includes(activeElemTag)) {
      console.warn(`  Notice: Active element after Tab is "${activeElemTag}"`);
    } else {
      console.log(`✓ Keyboard Tab navigation verified (activeElement: <${activeElemTag}>)`);
    }

    // =========================================================================
    // 6. Final Summary and Reports
    // =========================================================================
    const passed = consoleErrors.length === 0 && pageErrors.length === 0 && layoutIssues.length === 0;

    // Save console and page errors
    fs.writeFileSync(
      path.join(artifactsDir, 'console-errors.json'),
      JSON.stringify({ consoleErrors, pageErrors }, null, 2)
    );

    // Save visual QA report
    const visualReport = {
      passed,
      timestamp: new Date().toISOString(),
      screenshots,
      statesChecked,
      consoleErrorsCount: consoleErrors.length,
      pageErrorsCount: pageErrors.length,
      layoutIssuesCount: layoutIssues.length,
      layoutIssues,
    };

    fs.writeFileSync(
      path.join(artifactsDir, 'visual-report.json'),
      JSON.stringify(visualReport, null, 2)
    );

    console.log('\n========================================');
    console.log('       Visual QA Verification Results   ');
    console.log('========================================');
    console.log(`✓ Total screenshots: ${screenshots.length}`);
    console.log(`✓ States checked: ${statesChecked.join(', ')}`);
    console.log(`✓ Console errors: ${consoleErrors.length}`);
    console.log(`✓ Page errors: ${pageErrors.length}`);
    console.log(`✓ Layout issues: ${layoutIssues.length}`);
    console.log(`✓ Report saved: artifacts/ui/visual-report.json`);
    console.log('========================================');

    if (!passed) {
      if (layoutIssues.length > 0) {
        console.error('FAIL: Layout bounds/overflow issues detected:', layoutIssues);
      }
      if (consoleErrors.length > 0 || pageErrors.length > 0) {
        console.error('FAIL: Uncaught console or page errors detected:', { consoleErrors, pageErrors });
      }
      process.exitCode = 1;
    } else {
      console.log('PASS: Electron UI Visual QA passed cleanly.\n');
      process.exitCode = 0;
    }
  } catch (err) {
    console.error('\n✖ Fatal error in Visual QA Runner:', err);
    process.exitCode = 1;
  } finally {
    if (electronApp) {
      try {
        await electronApp.close();
      } catch (closeErr) {
        console.error('Error closing Electron app:', closeErr);
      }
    }
    try {
      fs.unlinkSync(tmpConfigFile);
    } catch {}
  }
}

if (require.main === module) {
  runVisualQa();
}

module.exports = { runVisualQa };
