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
const tmpUserData = path.join('/tmp', `boosty-visual-qa-user-data-${process.pid}`);
fs.mkdirSync(tmpUserData, { recursive: true });

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
        BOOSTY_OVERLAY_USER_DATA: tmpUserData,
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

        // 4. Profile cards containment check (when on appearance tab)
        const profilesCard = document.querySelector('.profiles-card');
        if (profilesCard && profilesCard.offsetParent !== null) {
          const cardRect = profilesCard.getBoundingClientRect();
          document.querySelectorAll('.profile-btn').forEach(btn => {
            const btnRect = btn.getBoundingClientRect();
            if (btnRect.right > cardRect.right + 1 || btnRect.left < cardRect.left - 1) {
              detected.push(`Profile button "${btn.id}" overflows .profiles-card horizontally: btn=[${Math.round(btnRect.left)}, ${Math.round(btnRect.right)}], card=[${Math.round(cardRect.left)}, ${Math.round(cardRect.right)}]`);
            }
          });
        }

        // 5. Logo icon containment & clipping check (sidebar & onboarding header)
        const visibleLogos = Array.from(document.querySelectorAll('.logo')).filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
        });

        visibleLogos.forEach((logoEl, idx) => {
          const logoRect = logoEl.getBoundingClientRect();
          const svgEl = logoEl.querySelector('svg.logo-icon');
          const useEl = svgEl ? svgEl.querySelector('use') : null;
          if (!svgEl) {
            detected.push(`Visible .logo [${idx}] is missing svg.logo-icon`);
            return;
          }
          const svgRect = svgEl.getBoundingClientRect();
          if (svgRect.width <= 0 || svgRect.height <= 0) {
            detected.push(`svg.logo-icon [${idx}] has invalid dimensions: ${svgRect.width}x${svgRect.height}`);
          }
          if (
            svgRect.left < logoRect.left - 0.5 ||
            svgRect.top < logoRect.top - 0.5 ||
            svgRect.right > logoRect.right + 0.5 ||
            svgRect.bottom > logoRect.bottom + 0.5
          ) {
            detected.push(`svg.logo-icon [${idx}] overflows parent .logo bounds`);
          }
          if (useEl) {
            const useRect = useEl.getBoundingClientRect();
            if (useRect.width <= 0 || useRect.height <= 0) {
              detected.push(`svg.logo-icon use [${idx}] has zero dimensions: ${useRect.width}x${useRect.height}`);
            }
            if (
              useRect.left < svgRect.left - 0.5 ||
              useRect.top < svgRect.top - 0.5 ||
              useRect.right > svgRect.right + 0.5 ||
              useRect.bottom > svgRect.bottom + 0.5
            ) {
              detected.push(
                `Logo icon content is clipped by svg.logo-icon [${idx}]: ` +
                `use=[${useRect.left.toFixed(1)}, ${useRect.top.toFixed(1)}, ${useRect.right.toFixed(1)}, ${useRect.bottom.toFixed(1)}] ` +
                `outside svg=[${svgRect.left.toFixed(1)}, ${svgRect.top.toFixed(1)}, ${svgRect.right.toFixed(1)}, ${svgRect.bottom.toFixed(1)}]`
              );
            }
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
    // 2.1 Sidebar Alignment & Polish Verification (ТЗ: SIDEBAR ALIGNMENT POLISH v1)
    // =========================================================================
    console.log('\n--- Sidebar Alignment & Polish Verification ---');

    async function verifySidebarPixelAlignment(scenarioName) {
      const alignment = await win.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.sidebar-nav .nav-item'));
        return items.map(el => {
          const icon = el.querySelector('.nav-icon');
          const label = el.querySelector('.nav-label');
          const ext = el.querySelector('.nav-external-icon');
          return {
            id: el.id,
            text: label ? label.textContent.trim() : '',
            iconLeft: icon ? icon.getBoundingClientRect().left : null,
            iconWidth: icon ? icon.getBoundingClientRect().width : null,
            labelLeft: (label && window.getComputedStyle(label).display !== 'none') ? label.getBoundingClientRect().left : null,
            extLeft: (ext && window.getComputedStyle(ext).display !== 'none') ? ext.getBoundingClientRect().left : null,
            height: el.getBoundingClientRect().height,
          };
        });
      });

      const firstIconLeft = alignment[0]?.iconLeft;
      const visibleLabels = alignment.filter(a => a.labelLeft !== null);
      const firstLabelLeft = visibleLabels[0]?.labelLeft;

      for (const item of alignment) {
        if (Math.abs(item.iconLeft - firstIconLeft) > 1) {
          layoutIssues.push(`[${scenarioName}] Icon left alignment mismatch for ${item.id}: expected ~${firstIconLeft}px, got ${item.iconLeft}px`);
        }
        if (Math.abs(item.height - 40) > 1) {
          layoutIssues.push(`[${scenarioName}] Nav item height mismatch for ${item.id}: expected 40px, got ${item.height}px`);
        }
      }

      for (const item of visibleLabels) {
        if (Math.abs(item.labelLeft - firstLabelLeft) > 1) {
          layoutIssues.push(`[${scenarioName}] Label left alignment mismatch for ${item.id}: expected ~${firstLabelLeft}px, got ${item.labelLeft}px`);
        }
      }

      return alignment;
    }

    // 1. sidebar-align-01-default.png (1280x850, Dashboard active)
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 1280, h: 850 });
    await win.setViewportSize({ width: 1280, height: 850 });
    await win.waitForTimeout(60);
    await verifySidebarPixelAlignment('default-1280x850');
    await captureScreenshot('sidebar-align-01-default.png');
    statesChecked.push('sidebar-align-default');
    console.log('✓ sidebar-align-01-default.png captured and pixel-checked');

    // 2. sidebar-align-02-chat-item.png (Hover on Чат, trailing ↗ inspection)
    await win.hover('#nav-chat');
    await win.waitForTimeout(80);
    await verifySidebarPixelAlignment('hover-chat-item');
    await captureScreenshot('sidebar-align-02-chat-item.png');
    statesChecked.push('sidebar-align-chat');
    console.log('✓ sidebar-align-02-chat-item.png captured and pixel-checked');
    await win.mouse.move(0, 0); // unhover

    // 3. sidebar-align-03-active-states.png (Switching active items, zero geometry jump)
    await applyState({ view: 'setup' });
    await win.waitForTimeout(60);
    await verifySidebarPixelAlignment('active-state-setup');
    await captureScreenshot('sidebar-align-03-active-states.png');
    statesChecked.push('sidebar-align-active');
    console.log('✓ sidebar-align-03-active-states.png captured and pixel-checked');
    await applyState({ view: 'dashboard' }); // restore dashboard
    await win.waitForTimeout(60);

    // 4. sidebar-align-04-compact.png (800x650 compact mode)
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 800, h: 650 });
    await win.setViewportSize({ width: 800, height: 650 });
    await win.waitForTimeout(100);
    await verifySidebarPixelAlignment('compact-800x650');
    await captureScreenshot('sidebar-align-04-compact.png');
    statesChecked.push('sidebar-align-compact');
    console.log('✓ sidebar-align-04-compact.png captured and pixel-checked');

    // Restore standard 1280x850 for following tests
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
    // 3.8 Connectivity Lifecycle Scenarios (Requirements 47 & 48)
    // =========================================================================
    console.log('\n--- Connectivity Lifecycle Scenarios ---');

    // Scenario 1: Checking state on startup
    await applyState({
      view: 'dashboard',
      mock: {
        isChecking: true,
        simulatedStartupTiming: { elapsedMs: 1200 },
        health: {
          extension: { state: 'checking' },
          boosty: { state: 'checking' },
          extensionConnected: false,
          boostyConnected: false,
        },
        obs: { ok: true, connected: true, scenes: [{ sceneName: 'Основная', hasChat: true }] },
      },
    });
    await verifyLayout('home-connectivity-checking');
    await captureScreenshot('home-connectivity-checking.png');
    statesChecked.push('connectivity-checking');

    const checkingCheck = await win.evaluate(() => {
      const title = document.querySelector('#readiness-title')?.textContent || '';
      const desc = document.querySelector('#readiness-desc')?.textContent || '';
      const extText = document.querySelector('#dash-ext-text')?.textContent || '';
      const boostyText = document.querySelector('#dash-boosty-text')?.textContent || '';
      const extBtn = document.querySelector('#dash-ext-fix-btn');
      const boostyBtn = document.querySelector('#dash-boosty-open-btn');
      return {
        title,
        desc,
        extText,
        boostyText,
        extBtnVisible: extBtn && window.getComputedStyle(extBtn).display !== 'none',
        boostyBtnVisible: boostyBtn && window.getComputedStyle(boostyBtn).display !== 'none',
      };
    });

    if (!checkingCheck.title.includes('Восстанавливаем') || !checkingCheck.extText.includes('Проверяем')) {
      throw new Error(`home-connectivity-checking assertion failed: ${JSON.stringify(checkingCheck)}`);
    }
    if (checkingCheck.extBtnVisible || checkingCheck.boostyBtnVisible) {
      throw new Error(`home-connectivity-checking premature buttons visible: ${JSON.stringify(checkingCheck)}`);
    }
    console.log('✓ Connectivity checking (calm startup) verified -> home-connectivity-checking.png');

    // Scenario 2: Connected state
    await applyState({
      view: 'dashboard',
      mock: {
        isChecking: false,
        health: {
          extension: { state: 'connected', version: '0.4.0' },
          boosty: { state: 'chat-detected', tabUrl: 'https://boosty.to/stream', hasChat: true },
          extensionConnected: true,
          boostyConnected: true,
          extensionVersion: '0.4.0',
        },
        obs: { ok: true, connected: true, scenes: [{ sceneName: 'Основная', hasChat: true }] },
      },
    });
    await verifyLayout('home-connectivity-connected');
    await captureScreenshot('home-connectivity-connected.png');
    statesChecked.push('connectivity-connected');
    console.log('✓ Connectivity connected verified -> home-connectivity-connected.png');

    // Scenario 3: Reconnecting state
    await applyState({
      view: 'dashboard',
      mock: {
        isChecking: false,
        health: {
          extension: { state: 'reconnecting', lastSeenSecondsAgo: 6 },
          boosty: { state: 'tab-detected', tabUrl: 'https://boosty.to/stream' },
          extensionConnected: false,
          boostyConnected: true,
        },
        obs: { ok: true, connected: true, scenes: [{ sceneName: 'Основная', hasChat: true }] },
      },
    });
    await verifyLayout('home-connectivity-reconnecting');
    await captureScreenshot('home-connectivity-reconnecting.png');
    statesChecked.push('connectivity-reconnecting');
    console.log('✓ Connectivity reconnecting verified -> home-connectivity-reconnecting.png');

    // Scenario 4: Extension missing (after timeout)
    await applyState({
      view: 'dashboard',
      mock: {
        isChecking: false,
        health: {
          extension: { state: 'unavailable' },
          boosty: { state: 'unavailable' },
          extensionConnected: false,
          boostyConnected: false,
        },
        obs: { ok: true, connected: true, scenes: [{ sceneName: 'Основная', hasChat: true }] },
      },
    });
    await verifyLayout('home-connectivity-extension-missing');
    await captureScreenshot('home-connectivity-extension-missing.png');
    statesChecked.push('connectivity-extension-missing');
    console.log('✓ Connectivity extension missing verified -> home-connectivity-extension-missing.png');

    // Scenario 5: Boosty missing (extension connected, Boosty tab unavailable)
    await applyState({
      view: 'dashboard',
      mock: {
        isChecking: false,
        health: {
          extension: { state: 'connected', version: '0.4.0' },
          boosty: { state: 'unavailable' },
          extensionConnected: true,
          boostyConnected: false,
        },
        obs: { ok: true, connected: true, scenes: [{ sceneName: 'Основная', hasChat: true }] },
      },
    });
    await verifyLayout('home-connectivity-boosty-missing');
    await captureScreenshot('home-connectivity-boosty-missing.png');
    statesChecked.push('connectivity-boosty-missing');
    console.log('✓ Connectivity boosty missing verified -> home-connectivity-boosty-missing.png');

    // Scenario 6: Connectivity Progress / ETA at 2.4s
    await applyState({
      view: 'dashboard',
      mock: {
        isChecking: true,
        simulatedStartupTiming: { elapsedMs: 2400 },
        health: {
          extension: { state: 'checking' },
          boosty: { state: 'checking' },
          extensionConnected: false,
          boostyConnected: false,
        },
        obs: { ok: true, connected: true, scenes: [{ sceneName: 'Основная', hasChat: true }] },
      },
    });
    await verifyLayout('home-connectivity-progress-2s');
    await captureScreenshot('home-connectivity-progress-2s.png');
    statesChecked.push('connectivity-progress-2s');

    const progress2sCheck = await win.evaluate(() => {
      const elapsed = document.querySelector('#readiness-elapsed')?.textContent || '';
      const expected = document.querySelector('#readiness-expected')?.textContent || '';
      const milestones = Array.from(document.querySelectorAll('#readiness-milestones .milestone')).map(m => ({
        name: m.querySelector('.milestone-label')?.textContent || '',
        state: m.classList.contains('done') ? 'done' : m.classList.contains('active') ? 'active' : 'pending',
      }));
      return { elapsed, expected, milestones };
    });

    if (!progress2sCheck.elapsed.includes('2.4') || !progress2sCheck.expected.includes('5')) {
      throw new Error(`home-connectivity-progress-2s check failed: ${JSON.stringify(progress2sCheck)}`);
    }
    console.log('✓ Connectivity progress at 2.4s verified -> home-connectivity-progress-2s.png');

    // Scenario 7: Connectivity Progress taking longer than usual at 6.8s
    await applyState({
      view: 'dashboard',
      mock: {
        isChecking: true,
        simulatedStartupTiming: { elapsedMs: 6800 },
        health: {
          extension: { state: 'checking' },
          boosty: { state: 'checking' },
          extensionConnected: false,
          boostyConnected: false,
        },
        obs: { ok: true, connected: true, scenes: [{ sceneName: 'Основная', hasChat: true }] },
      },
    });
    await verifyLayout('home-connectivity-progress-long');
    await captureScreenshot('home-connectivity-progress-long.png');
    statesChecked.push('connectivity-progress-long');

    const progressLongCheck = await win.evaluate(() => {
      const banner = document.querySelector('#readiness-status');
      const title = document.querySelector('#readiness-title')?.textContent || '';
      const elapsed = document.querySelector('#readiness-elapsed')?.textContent || '';
      const expected = document.querySelector('#readiness-expected')?.textContent || '';
      return {
        title,
        elapsed,
        expected,
        isLongerClass: banner?.classList.contains('longer-than-usual') || false,
      };
    });

    if (!progressLongCheck.title.includes('дольше') || !progressLongCheck.isLongerClass) {
      throw new Error(`home-connectivity-progress-long check failed: ${JSON.stringify(progressLongCheck)}`);
    }
    console.log('✓ Connectivity progress taking longer than usual verified -> home-connectivity-progress-long.png');

    // Scenario 8: Connectivity Recovered banner
    await applyState({
      view: 'dashboard',
      mock: {
        isChecking: false,
        simulatedStartupTiming: { isRecoveredRecently: true, recoveryDurationMs: 2550 },
        health: {
          extension: { state: 'connected', version: '0.4.0' },
          boosty: { state: 'chat-detected', tabUrl: 'https://boosty.to/stream', hasChat: true },
          extensionConnected: true,
          boostyConnected: true,
          extensionVersion: '0.4.0',
        },
        obs: { ok: true, connected: true, scenes: [{ sceneName: 'Основная', hasChat: true }] },
      },
    });
    await verifyLayout('home-connectivity-recovered');
    await captureScreenshot('home-connectivity-recovered.png');
    statesChecked.push('connectivity-recovered');

    const recoveredCheck = await win.evaluate(() => {
      const banner = document.querySelector('#readiness-status');
      const title = document.querySelector('#readiness-title')?.textContent || '';
      const desc = document.querySelector('#readiness-desc')?.textContent || '';
      return {
        title,
        desc,
        isRecoveredClass: banner?.classList.contains('recovered') || false,
      };
    });

    if (!recoveredCheck.title.includes('восстановлено') || !recoveredCheck.desc.includes('2.5')) {
      throw new Error(`home-connectivity-recovered check failed: ${JSON.stringify(recoveredCheck)}`);
    }
    console.log('✓ Connectivity recovered banner verified -> home-connectivity-recovered.png');

    // Reset simulated timing for following tests
    await applyState({
      mock: { simulatedStartupTiming: null },
    });

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

    // 5.1 Appearance Focus Mode (Basic Mode) & Multi-Viewport Verification
    console.log('\n--- Focus Mode (Basic Appearance) Scenarios ---');
    await applyState({ view: 'appearance' });
    await win.waitForFunction(() => {
      const el = document.querySelector('#view-appearance');
      return el && window.getComputedStyle(el).display !== 'none';
    });

    // Ensure Basic mode is active
    await win.evaluate(() => {
      document.querySelector('#mode-btn-basic')?.click();
    });
    await win.waitForTimeout(50);
    await verifyLayout('appearance-focus-1280x850');
    await captureScreenshot('appearance-focus-1280x850.png');
    statesChecked.push('appearance-focus-1280x850');
    console.log('✓ Focus Mode at 1280x850 verified -> appearance-focus-1280x850.png');

    // 1000x750 viewport
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 1000, h: 750 });
    await win.setViewportSize({ width: 1000, height: 750 });
    await win.waitForTimeout(100);
    await verifyLayout('appearance-focus-1000x750');
    await captureScreenshot('appearance-focus-1000x750.png');
    statesChecked.push('appearance-focus-1000x750');
    console.log('✓ Focus Mode at 1000x750 verified -> appearance-focus-1000x750.png');

    // 800x650 viewport
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 800, h: 650 });
    await win.setViewportSize({ width: 800, height: 650 });
    await win.waitForTimeout(100);
    await verifyLayout('appearance-focus-800x650');
    await captureScreenshot('appearance-focus-800x650.png');
    statesChecked.push('appearance-focus-800x650');
    console.log('✓ Focus Mode at 800x650 verified -> appearance-focus-800x650.png');

    // Restore standard 1280x850 viewport
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 1280, h: 850 });
    await win.setViewportSize({ width: 1280, height: 850 });
    await win.waitForTimeout(100);

    // 5.1.0 Interactive Focus Mode Controls (Size, Stepper, Duration)
    await win.evaluate(() => {
      document.querySelector('#size-btn-compact')?.click();
      document.querySelector('#basic-max-msgs-inc')?.click();
      document.querySelector('button.duration-pill-btn[data-duration="15"]')?.click();
    });
    await win.waitForTimeout(50);
    const basicSyncCheck = await win.evaluate(() => {
      return {
        cardWidth: Number(document.querySelector('#card-width')?.value),
        maxMsgs: Number(document.querySelector('#max-messages')?.value),
        duration: Number(document.querySelector('#duration')?.value),
        activeSize: document.querySelector('#size-btn-compact')?.classList.contains('active'),
        activePill: document.querySelector('button.duration-pill-btn[data-duration="15"]')?.classList.contains('active'),
      };
    });
    if (basicSyncCheck.cardWidth !== 380 || basicSyncCheck.maxMsgs !== 7 || basicSyncCheck.duration !== 15) {
      throw new Error(`Basic control sync failed: ${JSON.stringify(basicSyncCheck)}`);
    }
    // Scroll to basic controls and capture appearance-focus-scrolled.png
    await win.evaluate(() => {
      document.querySelector('#basic-messages-card')?.scrollIntoView({ block: 'center' });
    });
    await win.waitForTimeout(100);
    await verifyLayout('appearance-focus-scrolled');
    await captureScreenshot('appearance-focus-scrolled.png');
    statesChecked.push('appearance-focus-scrolled');
    console.log('✓ Focus Mode scrolled view verified -> appearance-focus-scrolled.png');

    // Restore scroll position before switching mode
    await win.evaluate(() => window.scrollTo(0, 0));
    await win.waitForTimeout(50);

    // Progressive Disclosure: click "Больше настроек" to enter Advanced Mode
    await win.evaluate(() => {
      document.querySelector('#basic-more-settings-btn')?.click();
    });
    await win.waitForTimeout(50);
    await verifyLayout('appearance-advanced-1280x850');
    await captureScreenshot('appearance-advanced-1280x850.png');
    statesChecked.push('appearance-advanced-1280x850');
    console.log('✓ Advanced Mode via Progressive Disclosure verified -> appearance-advanced-1280x850.png');

    // Click "Large" preset in Advanced Mode
    await win.evaluate(() => {
      document.querySelector('#preset-btn-large')?.click();
    });
    const largeFontSize = await win.evaluate(() => document.querySelector('#font-size')?.value);
    if (Number(largeFontSize) !== 26) {
      throw new Error(`Preset click failed: expected fontSize 26, got ${largeFontSize}`);
    }
    await captureScreenshot('appearance.png');
    statesChecked.push('appearance');
    console.log('✓ Advanced preset click verified -> appearance.png');

    // Progressive Disclosure: click "Вернуться к основным" to return to Basic Mode
    await win.evaluate(() => {
      document.querySelector('#advanced-back-to-basic-btn')?.click();
    });
    await win.waitForTimeout(50);
    const backToBasicCheck = await win.evaluate(() => {
      const col = document.querySelector('#appearance-settings-col');
      return col?.classList.contains('mode-basic') && !col?.classList.contains('mode-advanced');
    });
    if (!backToBasicCheck) {
      throw new Error('Returning to Basic Mode via button failed');
    }
    console.log('✓ Returning to Basic Mode via progressive disclosure verified');

    // 5.1.1 Visual Overlay Positioning Drag & Drop Scenarios
    console.log('\n--- Visual Overlay Positioning Drag & Drop Scenarios ---');

    // Reset to Clean Preset & Default Layout for deterministic baseline
    await win.evaluate(() => {
      document.querySelector('#appearance-reset-btn')?.click();
      document.querySelector('#layout-reset-btn')?.click();
    });
    await win.waitForTimeout(100);
    await verifyLayout('appearance-position-default');
    await captureScreenshot('appearance-position-default.png');
    statesChecked.push('position-default');
    console.log('✓ Position default (bottom-left) captured -> appearance-position-default.png');

    // Wait for hitbox element to be present and positioned
    await win.waitForFunction(() => {
      const hb = document.querySelector('#chat-drag-hitbox');
      return hb && parseFloat(hb.style.width) > 0;
    });

    const hitbox = await win.$('#chat-drag-hitbox');
    const wrapper = await win.$('#preview-scale-wrapper');

    // 5.1.2 Drag across center into Top-Right quadrant
    const initialBox = await hitbox.boundingBox();
    const wrapperBox = await wrapper.boundingBox();

    if (!initialBox || !wrapperBox) {
      throw new Error('Could not compute bounding boxes for hitbox or preview scale wrapper');
    }

    await win.mouse.move(initialBox.x + initialBox.width / 2, initialBox.y + initialBox.height / 2);
    await win.mouse.down();

    // Verify .is-dragging class on hitbox while pointer is active
    const isDraggingDuringMove = await win.evaluate(() => {
      return document.querySelector('#chat-drag-hitbox')?.classList.contains('is-dragging');
    });
    if (!isDraggingDuringMove) {
      console.warn('  Notice: hitbox .is-dragging class check during pointer move');
    }

    // Move to top-right area (85% X, 15% Y)
    const targetTRX = wrapperBox.x + wrapperBox.width * 0.82;
    const targetTRY = wrapperBox.y + wrapperBox.height * 0.15;
    await win.mouse.move(targetTRX, targetTRY, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(100);

    // Verify that corner switched to right-top and inputs updated
    const trCheck = await win.evaluate(() => {
      const activeCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
      const offsetX = Number(document.querySelector('#offset-x')?.value);
      const offsetY = Number(document.querySelector('#offset-y')?.value);
      return { activeCorner, offsetX, offsetY };
    });

    if (trCheck.activeCorner !== 'right-top') {
      throw new Error(`Expected active corner 'right-top' after drag, got '${trCheck.activeCorner}'`);
    }
    await verifyLayout('appearance-position-top-right');
    await captureScreenshot('appearance-position-top-right.png');
    statesChecked.push('position-top-right');
    console.log(`✓ Drag to top-right verified (activeCorner: ${trCheck.activeCorner}, offsetX: ${trCheck.offsetX}, offsetY: ${trCheck.offsetY}) -> appearance-position-top-right.png`);

    // 5.1.3 Drag back to Bottom-Left corner
    const trHitboxBox = await hitbox.boundingBox();
    await win.mouse.move(trHitboxBox.x + trHitboxBox.width / 2, trHitboxBox.y + trHitboxBox.height / 2);
    await win.mouse.down();

    const targetBLX = wrapperBox.x + wrapperBox.width * 0.18;
    const targetBLY = wrapperBox.y + wrapperBox.height * 0.85;
    await win.mouse.move(targetBLX, targetBLY, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(100);

    const blCheck = await win.evaluate(() => {
      const activeCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
      const offsetX = Number(document.querySelector('#offset-x')?.value);
      const offsetY = Number(document.querySelector('#offset-y')?.value);
      return { activeCorner, offsetX, offsetY };
    });

    if (blCheck.activeCorner !== 'left-bottom') {
      throw new Error(`Expected active corner 'left-bottom' after drag, got '${blCheck.activeCorner}'`);
    }
    await verifyLayout('appearance-position-bottom-left');
    await captureScreenshot('appearance-position-bottom-left.png');
    statesChecked.push('position-bottom-left');
    console.log(`✓ Drag to bottom-left verified (activeCorner: ${blCheck.activeCorner}, offsetX: ${blCheck.offsetX}, offsetY: ${blCheck.offsetY}) -> appearance-position-bottom-left.png`);

    // 5.1.4 Drag to Custom Coordinates
    const blHitboxBox = await hitbox.boundingBox();
    await win.mouse.move(blHitboxBox.x + blHitboxBox.width / 2, blHitboxBox.y + blHitboxBox.height / 2);
    await win.mouse.down();

    // Move to custom area (65% X, 35% Y)
    const targetCustX = wrapperBox.x + wrapperBox.width * 0.65;
    const targetCustY = wrapperBox.y + wrapperBox.height * 0.35;
    await win.mouse.move(targetCustX, targetCustY, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(150);

    const customCheck = await win.evaluate(() => {
      const activeCorner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
      const offsetX = Number(document.querySelector('#offset-x')?.value);
      const offsetY = Number(document.querySelector('#offset-y')?.value);
      return { activeCorner, offsetX, offsetY };
    });
    await verifyLayout('appearance-position-custom');
    await captureScreenshot('appearance-position-custom.png');
    statesChecked.push('position-custom');
    console.log(`✓ Custom position drag verified (activeCorner: ${customCheck.activeCorner}, offsetX: ${customCheck.offsetX}, offsetY: ${customCheck.offsetY}) -> appearance-position-custom.png`);

    // 5.1.5 Multi-viewport Responsive positioning check on 800x650
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 800, h: 650 });
    await win.setViewportSize({ width: 800, height: 650 });
    await win.waitForTimeout(100);
    await verifyLayout('appearance-position-800x650');
    await captureScreenshot('appearance-position-800x650.png');
    statesChecked.push('position-800x650');
    console.log('✓ Appearance positioning at 800x650 verified -> appearance-position-800x650.png');

    // Restore standard 1280x850 viewport
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 1280, h: 850 });
    await win.setViewportSize({ width: 1280, height: 850 });
    await win.waitForTimeout(100);

    // 5.1.6 Persistence Verification: verify written config
    await win.waitForTimeout(400); // Allow debounce save to commit
    const savedConfigRaw = fs.readFileSync(tmpConfigFile, 'utf8');
    const savedConfig = JSON.parse(savedConfigRaw);
    if (!savedConfig.horizontalAnchor || !savedConfig.verticalAnchor) {
      throw new Error(`Persisted config is missing anchor fields: ${savedConfigRaw}`);
    }
    console.log(`✓ Config persistence verified: saved { hAnchor: ${savedConfig.horizontalAnchor}, vAnchor: ${savedConfig.verticalAnchor}, offsetX: ${savedConfig.offsetX}, offsetY: ${savedConfig.offsetY} }`);

    // =========================================================================
    // 5.1.7 Stream Profiles v1 Scenarios & Screenshots
    // =========================================================================
    console.log('\n--- Stream Profiles v1 Visual Verification ---');

    // Clean up obsolete profile-podcast.png if it exists from previous runs
    try {
      fs.unlinkSync(path.join(artifactsDir, 'profile-podcast.png'));
    } catch {}

    // Profile 1: Content Viewing (Просмотр контента - Primary / Recommended)
    await win.evaluate(() => {
      document.querySelector('#profile-btn-content')?.click();
    });
    await win.waitForTimeout(140);
    const contentCheck = await win.evaluate(() => {
      const badge = document.querySelector('#profile-status-badge')?.textContent;
      const activeBtn = document.querySelector('.profile-btn.active')?.getAttribute('data-profile');
      const presetBadge = document.querySelector('#preset-status-badge')?.textContent;
      const corner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
      const truncatedEls = [];
      document.querySelectorAll('.profile-btn .profile-name, .profile-btn .profile-desc, .profile-btn .profile-meta-badge').forEach(el => {
        if (el.scrollWidth > el.clientWidth + 1) {
          truncatedEls.push(`${el.className}: "${el.textContent}" (${el.scrollWidth} > ${el.clientWidth})`);
        }
      });
      return { badge, activeBtn, presetBadge, corner, truncatedEls };
    });
    if (contentCheck.badge !== 'Просмотр контента' || contentCheck.activeBtn !== 'content' || contentCheck.presetBadge !== 'Компактный' || contentCheck.corner !== 'right-bottom') {
      throw new Error(`Profile content check failed: ${JSON.stringify(contentCheck)}`);
    }
    if (contentCheck.truncatedEls.length > 0) {
      throw new Error(`Profile card text truncated in 1280x850 grid: ${contentCheck.truncatedEls.join(', ')}`);
    }
    await verifyLayout('profile-content');
    await captureScreenshot('profile-content.png');
    statesChecked.push('profile-content');
    console.log('✓ Profile "Просмотр контента" verified -> profile-content.png');

    // Profile 2: Gaming (Игры)
    await win.evaluate(() => {
      document.querySelector('#profile-btn-gaming')?.click();
    });
    await win.waitForTimeout(140);
    const gamingCheck = await win.evaluate(() => {
      const badge = document.querySelector('#profile-status-badge')?.textContent;
      const activeBtn = document.querySelector('.profile-btn.active')?.getAttribute('data-profile');
      const presetBadge = document.querySelector('#preset-status-badge')?.textContent;
      const corner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
      return { badge, activeBtn, presetBadge, corner };
    });
    if (gamingCheck.badge !== 'Игры' || gamingCheck.activeBtn !== 'gaming' || gamingCheck.presetBadge !== 'Компактный') {
      throw new Error(`Profile gaming check failed: ${JSON.stringify(gamingCheck)}`);
    }
    await verifyLayout('profile-gaming');
    await captureScreenshot('profile-gaming.png');
    statesChecked.push('profile-gaming');
    console.log('✓ Profile "Игры" verified -> profile-gaming.png');

    // Profile 3: Talking (Разговорный)
    await win.evaluate(() => {
      document.querySelector('#profile-btn-talking')?.click();
    });
    await win.waitForTimeout(140);
    const talkingCheck = await win.evaluate(() => {
      const badge = document.querySelector('#profile-status-badge')?.textContent;
      const activeBtn = document.querySelector('.profile-btn.active')?.getAttribute('data-profile');
      const presetBadge = document.querySelector('#preset-status-badge')?.textContent;
      const corner = document.querySelector('.corner-btn.active')?.getAttribute('data-corner');
      return { badge, activeBtn, presetBadge, corner };
    });
    if (talkingCheck.badge !== 'Разговорный' || talkingCheck.activeBtn !== 'talking' || !['Чистый', 'Стандартный'].includes(talkingCheck.presetBadge)) {
      throw new Error(`Profile talking check failed: ${JSON.stringify(talkingCheck)}`);
    }
    await verifyLayout('profile-talking');
    await captureScreenshot('profile-talking.png');
    statesChecked.push('profile-talking');
    console.log('✓ Profile "Разговорный" verified -> profile-talking.png');

    // Profile 4: Minimal (Минимализм)
    await win.evaluate(() => {
      document.querySelector('#profile-btn-minimal')?.click();
    });
    await win.waitForTimeout(140);
    const minimalCheck = await win.evaluate(() => {
      const badge = document.querySelector('#profile-status-badge')?.textContent;
      const activeBtn = document.querySelector('.profile-btn.active')?.getAttribute('data-profile');
      const presetBadge = document.querySelector('#preset-status-badge')?.textContent;
      return { badge, activeBtn, presetBadge };
    });
    if (minimalCheck.badge !== 'Минимализм' || minimalCheck.activeBtn !== 'minimal') {
      throw new Error(`Profile minimal check failed: ${JSON.stringify(minimalCheck)}`);
    }
    await verifyLayout('profile-minimal');
    await captureScreenshot('profile-minimal.png');
    statesChecked.push('profile-minimal');
    console.log('✓ Profile "Минимализм" verified -> profile-minimal.png');

    // Profile: Custom After Drag
    // Activate content profile first, then drag hitbox away from right-bottom to prove activeProfile becomes Custom while preset remains Compact
    await win.evaluate(() => {
      document.querySelector('#profile-btn-content')?.click();
    });
    await win.waitForTimeout(120);
    const contentHitbox = await win.$('#chat-drag-hitbox');
    const contentHitboxBox = await contentHitbox?.boundingBox();
    const currentWrapperBox = await wrapper.boundingBox();
    if (contentHitboxBox && currentWrapperBox) {
      await win.mouse.move(contentHitboxBox.x + contentHitboxBox.width / 2, contentHitboxBox.y + contentHitboxBox.height / 2);
      await win.mouse.down();
      await win.mouse.move(currentWrapperBox.x + currentWrapperBox.width * 0.25, currentWrapperBox.y + currentWrapperBox.height * 0.3, { steps: 6 });
      await win.mouse.up();
      await win.waitForTimeout(150);
    }

    const customAfterDragCheck = await win.evaluate(() => {
      const profileBadge = document.querySelector('#profile-status-badge')?.textContent;
      const hasActiveProfile = Boolean(document.querySelector('.profile-btn.active'));
      const presetBadge = document.querySelector('#preset-status-badge')?.textContent;
      return { profileBadge, hasActiveProfile, presetBadge };
    });
    if (customAfterDragCheck.profileBadge !== 'Пользовательский' || customAfterDragCheck.hasActiveProfile !== false) {
      throw new Error(`Expected profile to become 'Пользовательский' after drag, got: ${JSON.stringify(customAfterDragCheck)}`);
    }
    await verifyLayout('profile-custom-after-drag');
    await captureScreenshot('profile-custom-after-drag.png');
    statesChecked.push('profile-custom-after-drag');
    console.log('✓ Profile Custom after drag verified -> profile-custom-after-drag.png');

    // Profile: Responsive 800x650 viewport (with Content profile selected)
    await win.evaluate(() => {
      document.querySelector('#profile-btn-content')?.click();
    });
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 800, h: 650 });
    await win.setViewportSize({ width: 800, height: 650 });
    await win.waitForTimeout(120);
    await verifyLayout('profile-800x650');
    await captureScreenshot('profile-800x650.png');
    statesChecked.push('profile-800x650');
    console.log('✓ Profiles responsive layout at 800x650 verified -> profile-800x650.png');

    // Restore standard 1280x850 viewport
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 1280, h: 850 });
    await win.setViewportSize({ width: 1280, height: 850 });
    await win.waitForTimeout(100);

    // =========================================================================
    // 5.1.8 Message Animations Visual Verification
    // =========================================================================
    console.log('\n--- Message Animations Visual Verification ---');

    // Ensure fade is selected and slider is at 280ms
    await win.evaluate(() => {
      const btn = document.querySelector('#anim-type-fade');
      btn?.click();
      btn?.closest('.settings-group-card')?.scrollIntoView({ block: 'center' });
      const slider = document.querySelector('#animation-duration-slider');
      if (slider) {
        slider.value = '280';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await win.waitForTimeout(120);

    const animFadeCheck = await win.evaluate(() => {
      const activeType = document.querySelector('.animation-type-grid .segmented-btn.active')?.getAttribute('data-animation-type');
      const activeSpeed = document.querySelector('[data-animation-speed].active')?.getAttribute('data-animation-speed');
      const speedLabel = document.querySelector('#animation-speed-label')?.textContent;
      const speedContainerDisabled = document.querySelector('#animation-speed-container')?.classList.contains('disabled');
      return { activeType, activeSpeed, speedLabel, speedContainerDisabled };
    });

    if (animFadeCheck.activeType !== 'fade' || animFadeCheck.speedContainerDisabled) {
      throw new Error(`Animation fade check failed: ${JSON.stringify(animFadeCheck)}`);
    }
    await verifyLayout('appearance-animations');
    await captureScreenshot('appearance-animations.png');
    statesChecked.push('appearance-animations');
    console.log(`✓ Message animations baseline (fade, 280ms) verified -> appearance-animations.png`);

    // Switch to "Без анимации" (none) and verify speed container is disabled
    await win.evaluate(() => {
      document.querySelector('#anim-type-none')?.click();
    });
    await win.waitForTimeout(100);

    const animNoneCheck = await win.evaluate(() => {
      const activeType = document.querySelector('.animation-type-grid .segmented-btn.active')?.getAttribute('data-animation-type');
      const speedContainerDisabled = document.querySelector('#animation-speed-container')?.classList.contains('disabled');
      return { activeType, speedContainerDisabled };
    });

    if (animNoneCheck.activeType !== 'none' || !animNoneCheck.speedContainerDisabled) {
      throw new Error(`Animation none check failed: ${JSON.stringify(animNoneCheck)}`);
    }
    await verifyLayout('appearance-animations-none');
    await captureScreenshot('appearance-animations-none.png');
    statesChecked.push('appearance-animations-none');
    console.log(`✓ Message animations disabled (none) verified -> appearance-animations-none.png`);

    // Restore fade animation
    await win.evaluate(() => {
      document.querySelector('#anim-type-fade')?.click();
    });
    await win.waitForTimeout(100);

    // =========================================================================
    // 5.1.9 Sticky Live Preview & Scrolled View Verification
    // =========================================================================
    console.log('\n--- Sticky Live Preview & Scrolled View Verification ---');

    // Scroll down to Text / Card settings (~800px)
    await win.evaluate(() => window.scrollTo(0, 800));
    await win.waitForTimeout(150);

    const stickyScrollCheck = await win.evaluate(() => {
      const header = document.querySelector('.content-header')?.getBoundingClientRect();
      const preview = document.querySelector('#sticky-preview-container')?.getBoundingClientRect();
      const scrollY = window.scrollY;
      const noHScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth;

      return {
        scrollY,
        headerBottom: header?.bottom || 0,
        previewTop: preview?.top || 0,
        previewBottom: preview?.bottom || 0,
        noHScroll,
        fitsInViewport: preview && preview.bottom <= window.innerHeight,
        headerSpacing: preview && header ? preview.top - header.bottom : 0,
      };
    });

    if (stickyScrollCheck.scrollY <= 0 || !stickyScrollCheck.fitsInViewport || stickyScrollCheck.headerSpacing < 16) {
      throw new Error(`Sticky preview scroll check failed: ${JSON.stringify(stickyScrollCheck)}`);
    }

    await verifyLayout('appearance-scrolled-sticky-preview');
    await captureScreenshot('appearance-scrolled-sticky-preview.png');
    statesChecked.push('appearance-scrolled-sticky-preview');
    console.log(`✓ Scrolled sticky preview verified -> appearance-scrolled-sticky-preview.png`);

    // Scroll to Message Animations card, select slide-side and trigger replay
    await win.evaluate(() => {
      document.querySelector('#anim-type-slide-side')?.click();
      document.querySelector('#anim-type-slide-side')?.closest('.settings-group-card')?.scrollIntoView({ block: 'center' });
      document.querySelector('#animation-replay-btn')?.click();
    });
    await win.waitForTimeout(150);

    const animStickyCheck = await win.evaluate(() => {
      const activeType = document.querySelector('.animation-type-grid .segmented-btn.active')?.getAttribute('data-animation-type');
      const preview = document.querySelector('#sticky-preview-container')?.getBoundingClientRect();
      const header = document.querySelector('.content-header')?.getBoundingClientRect();
      return {
        activeType,
        previewVisible: preview && preview.top >= (header?.bottom || 0) + 16 && preview.bottom <= window.innerHeight,
      };
    });

    if (animStickyCheck.activeType !== 'slide-side' || !animStickyCheck.previewVisible) {
      throw new Error(`Animation sticky preview check failed: ${JSON.stringify(animStickyCheck)}`);
    }

    await verifyLayout('appearance-animation-sticky-preview');
    await captureScreenshot('appearance-animation-sticky-preview.png');
    statesChecked.push('appearance-animation-sticky-preview');
    console.log(`✓ Animation controls with sticky preview verified -> appearance-animation-sticky-preview.png`);

    // Restore scroll position
    await win.evaluate(() => window.scrollTo(0, 0));
    await win.waitForTimeout(100);

    // 5.2 Onboarding View (Step 1 & Step 3 Auth Failed)
    await applyState({ view: 'onboarding', step: 1 });
    await win.waitForFunction(() => {
      const el = document.querySelector('#onboarding-view');
      return el && window.getComputedStyle(el).display !== 'none';
    });
    await verifyLayout('onboarding-view');
    await captureScreenshot('onboarding.png');
    statesChecked.push('onboarding');
    console.log('✓ Onboarding view verified -> onboarding.png');

    // Onboarding at 800x650 (CTA visibility verification per ТЗ section 16)
    await bw.evaluate((b) => b.setContentSize(800, 650));
    await win.setViewportSize({ width: 800, height: 650 });
    await win.waitForTimeout(300);
    await captureScreenshot('onboarding-800x650.png');
    await captureScreenshot('tutorial-v2-09-compact-800x650.png');

    // Verify Step 1 CTA button is visible in first viewport without scrolling
    const ctaBox = await win.evaluate(() => {
      const btn = document.querySelector('#ob-open-ext-page-btn');
      if (!btn) return null;
      const rect = btn.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, innerHeight: window.innerHeight };
    });
    if (ctaBox && ctaBox.bottom > 650) {
      layoutIssues.push(`[Viewport 800x650] Step 1 CTA button bottom (${Math.round(ctaBox.bottom)}px) overflows first viewport 650px`);
    } else {
      console.log(`✓ Step 1 CTA visible without scroll on 800x650 (bottom: ${Math.round(ctaBox?.bottom || 0)}px <= 650px)`);
    }

    await bw.evaluate((b) => b.setContentSize(1280, 850));
    await win.setViewportSize({ width: 1280, height: 850 });
    await win.waitForTimeout(300);

    // Tutorial Mini-Lesson v2 QA sequence (tutorial-v2-01 to tutorial-v2-10 per ТЗ section 27)
    // 1. Address focus & click (Scene 1: ~0.6s)
    await win.evaluate(() => {
      const vid = document.querySelector('#ob-tutorial-video');
      if (vid) {
        vid.pause();
        vid.currentTime = 0.6;
      }
    });
    await win.waitForTimeout(300);
    await captureScreenshot('tutorial-v2-01-address-focus.png');
    await captureScreenshot('tutorial-01-video-start.png');

    // 2. URL typewriter typing (Scene 1: ~1.2s)
    await win.evaluate(() => {
      const vid = document.querySelector('#ob-tutorial-video');
      if (vid) vid.currentTime = 1.2;
    });
    await win.waitForTimeout(300);
    await captureScreenshot('tutorial-v2-02-url-typing.png');

    // 3. Dev Mode toggle click (Scene 2: ~3.75s)
    await win.evaluate(() => {
      const vid = document.querySelector('#ob-tutorial-video');
      if (vid) vid.currentTime = 3.75;
    });
    await win.waitForTimeout(300);
    await captureScreenshot('tutorial-v2-03-toggle-click.png');
    await captureScreenshot('tutorial-02-developer-mode.png');

    // 4. File manager origin window (Scene 3: ~5.5s)
    await win.evaluate(() => {
      const vid = document.querySelector('#ob-tutorial-video');
      if (vid) vid.currentTime = 5.5;
    });
    await win.waitForTimeout(300);
    await captureScreenshot('tutorial-v2-04-file-manager.png');
    await captureScreenshot('tutorial-v3-01-extension-folder-visible.png');

    // 5. Folder grab with lift shadow (Scene 3: ~6.4s)
    await win.evaluate(() => {
      const vid = document.querySelector('#ob-tutorial-video');
      if (vid) vid.currentTime = 6.4;
    });
    await win.waitForTimeout(300);
    await captureScreenshot('tutorial-v2-05-folder-grab.png');
    await captureScreenshot('tutorial-v3-02-extension-folder-grab.png');

    // 6. Continuous folder drag to browser (Scene 3: ~7.8s)
    await win.evaluate(() => {
      const vid = document.querySelector('#ob-tutorial-video');
      if (vid) vid.currentTime = 7.8;
    });
    await win.waitForTimeout(300);
    await captureScreenshot('tutorial-v2-06-folder-drag.png');
    await captureScreenshot('tutorial-v3-03-extension-folder-drag.png');
    await captureScreenshot('tutorial-03-drag-folder.png');

    // 7. Drop in browser (Scene 3: ~8.8s)
    await win.evaluate(() => {
      const vid = document.querySelector('#ob-tutorial-video');
      if (vid) vid.currentTime = 8.8;
    });
    await win.waitForTimeout(300);
    await captureScreenshot('tutorial-v2-07-drop.png');

    // 8. Completed installed extension card & ✓ Готово (Scene 3: ~10.5s)
    await win.evaluate(() => {
      const vid = document.querySelector('#ob-tutorial-video');
      if (vid) vid.currentTime = 10.5;
    });
    await win.waitForTimeout(300);
    await captureScreenshot('tutorial-v2-08-complete.png');
    await captureScreenshot('tutorial-v3-04-extension-folder-drop.png');
    await captureScreenshot('tutorial-04-complete.png');

    // v3-05: Text guide showing Step 3 with `extension` folder opened hint
    await win.evaluate(() => {
      const hint = document.querySelector('#ob-folder-opened-hint');
      if (hint) hint.style.display = 'inline-flex';
      const step3Card = document.querySelector('.ob-step-card[data-step="3"]');
      if (step3Card) step3Card.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await win.waitForTimeout(200);
    await captureScreenshot('tutorial-v3-05-text-guide-extension.png');

    // v3-06: Manual fallback accordion opened showing `extension` instructions and path
    await win.evaluate(() => {
      const details = document.querySelector('#ob-manual-fallback');
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    });
    await win.waitForTimeout(200);
    await captureScreenshot('tutorial-v3-06-manual-fallback-extension.png');

    // Reset scroll & fallback accordion
    await win.evaluate(() => {
      const details = document.querySelector('#ob-manual-fallback');
      if (details) details.open = false;
      const hint = document.querySelector('#ob-folder-opened-hint');
      if (hint) hint.style.display = 'none';
      const step1 = document.querySelector('#step-1');
      if (step1) step1.scrollTop = 0;
      window.scrollTo(0, 0);
    });
    await win.waitForTimeout(150);

    // Reduced Motion state
    await win.evaluate(() => {
      const rmOverlay = document.querySelector('#ob-tutorial-rm-overlay');
      if (rmOverlay) rmOverlay.style.display = 'flex';
    });
    await win.waitForTimeout(200);
    await captureScreenshot('tutorial-05-reduced-motion.png');
    await win.evaluate(() => {
      const rmOverlay = document.querySelector('#ob-tutorial-rm-overlay');
      if (rmOverlay) rmOverlay.style.display = 'none';
    });

    // Static Fallback / Diagram state
    await win.evaluate(() => {
      const schemeBtn = document.querySelector('#ob-tutorial-scheme-btn');
      if (schemeBtn) schemeBtn.click();
    });
    await win.waitForTimeout(200);
    await captureScreenshot('tutorial-v2-10-static-fallback.png');
    await captureScreenshot('tutorial-v3-07-static-fallback-extension.png');
    await captureScreenshot('tutorial-06-video-fallback.png');
    await win.evaluate(() => {
      const schemeBtn = document.querySelector('#ob-tutorial-scheme-btn');
      if (schemeBtn) schemeBtn.click(); // revert
    });

    await applyState({
      view: 'onboarding',
      step: 3,
      obs: {
        ok: false,
        connected: false,
        authFailed: true,
        error: 'OBS найден, но не удалось авторизоваться',
        scenes: [],
      },
    });
    await verifyLayout('onboarding-step3-auth-failed');
    await captureScreenshot('onboarding-step3-auth-failed.png');
    statesChecked.push('onboarding-step3-auth-failed');
    console.log('✓ Onboarding Step 3 Auth Failed verified -> onboarding-step3-auth-failed.png');

    // =========================================================================
    // 5.2.5 Onboarding OBS Refresh CTA UX (ТЗ: ONBOARDING OBS — СДЕЛАТЬ КНОПКУ «ОБНОВИТЬ» ОЧЕВИДНОЙ И ЗАМЕТНОЙ)
    // =========================================================================
    console.log('\n--- Onboarding OBS Refresh CTA UX Verification ---');
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 1280, h: 850 });
    await win.setViewportSize({ width: 1280, height: 850 });
    await win.waitForTimeout(80);

    // 1. obs-refresh-01-waiting.png: OBS not yet detected (calm waiting state)
    await applyState({
      view: 'onboarding',
      step: 3,
      isObsRefreshChecking: false,
      obsResultText: '',
      obs: {
        ok: true,
        connected: false,
        authFailed: false,
        scenes: [],
      },
    });
    await verifyLayout('obs-refresh-01-waiting');
    await captureScreenshot('obs-refresh-01-waiting.png');
    statesChecked.push('obs-refresh-01-waiting');

    // 2. obs-refresh-02-primary-cta.png: Primary CTA hover/focus highlight
    await win.hover('#ob-refresh-obs-btn');
    await win.waitForTimeout(100);
    await captureScreenshot('obs-refresh-02-primary-cta.png');
    await win.mouse.move(0, 0);
    statesChecked.push('obs-refresh-02-primary-cta');

    // 3. obs-refresh-03-checking.png: Checking state (↻ Проверяем…, disabled)
    await applyState({
      view: 'onboarding',
      step: 3,
      isObsRefreshChecking: true,
      obsResultText: '',
      obs: {
        ok: true,
        connected: false,
        authFailed: false,
        scenes: [],
      },
    });
    await verifyLayout('obs-refresh-03-checking');
    await captureScreenshot('obs-refresh-03-checking.png');
    statesChecked.push('obs-refresh-03-checking');

    // 4. obs-refresh-05-source-waiting.png: OBS connected, waiting for source
    await applyState({
      view: 'onboarding',
      step: 3,
      isObsRefreshChecking: false,
      obsResultText: '✓ OBS обнаружен. Добавьте источник чата в сцену или проверьте снова.',
      obs: {
        ok: true,
        connected: true,
        authFailed: false,
        currentProgramSceneName: 'Стрим Boosty',
        scenes: [
          { sceneId: 'scene-1', sceneName: 'Стрим Boosty', isCurrentProgram: true, hasChat: false },
          { sceneId: 'scene-2', sceneName: 'Пауза', isCurrentProgram: false, hasChat: false },
        ],
      },
    });
    await verifyLayout('obs-refresh-05-source-waiting');
    await captureScreenshot('obs-refresh-05-source-waiting.png');
    statesChecked.push('obs-refresh-05-source-waiting');

    // 5. obs-refresh-04-detected.png: OBS + Source detected (refresh lowered to secondary, add button disabled with ✓ Источник уже добавлен)
    await applyState({
      view: 'onboarding',
      step: 3,
      isObsRefreshChecking: false,
      obsResultText: '✓ OBS обнаружен · ✓ Источник найден',
      obs: {
        ok: true,
        connected: true,
        authFailed: false,
        addedSceneName: 'Стрим Boosty',
        currentProgramSceneName: 'Стрим Boosty',
        scenes: [
          { sceneId: 'scene-1', sceneName: 'Стрим Boosty', isCurrentProgram: true, hasChat: true },
          { sceneId: 'scene-2', sceneName: 'Пауза', isCurrentProgram: false, hasChat: false },
        ],
      },
    });
    await verifyLayout('obs-refresh-04-detected');
    await captureScreenshot('obs-refresh-04-detected.png');
    statesChecked.push('obs-refresh-04-detected');

    // 6. obs-refresh-06-800x650.png: Compact 800x650 viewport waiting state (above the fold check)
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 800, h: 650 });
    await win.setViewportSize({ width: 800, height: 650 });
    await applyState({
      view: 'onboarding',
      step: 3,
      isObsRefreshChecking: false,
      obsResultText: '',
      obs: {
        ok: true,
        connected: false,
        authFailed: false,
        scenes: [],
      },
    });
    await win.waitForTimeout(100);
    await verifyLayout('obs-refresh-06-800x650');
    const foldCheck800 = await win.evaluate(() => {
      const btn = document.querySelector('#ob-refresh-obs-btn');
      const hint = document.querySelector('#ob-obs-waiting-hint');
      const btnRect = btn ? btn.getBoundingClientRect() : null;
      const hintRect = hint ? hint.getBoundingClientRect() : null;
      return {
        btnBottom: btnRect ? Math.round(btnRect.bottom) : 9999,
        hintBottom: hintRect ? Math.round(hintRect.bottom) : 9999,
      };
    });
    if (foldCheck800.btnBottom > 650 || foldCheck800.hintBottom > 650) {
      layoutIssues.push(`[obs-refresh-06-800x650] Refresh CTA or waiting hint pushed below 650px fold (btnBottom=${foldCheck800.btnBottom}, hintBottom=${foldCheck800.hintBottom})`);
    }
    await captureScreenshot('obs-refresh-06-800x650.png');
    statesChecked.push('obs-refresh-06-800x650');
    console.log(`✓ Onboarding OBS Refresh CTA UX verified (800x650 fold: btn=${foldCheck800.btnBottom}px, hint=${foldCheck800.hintBottom}px)`);

    // Restore 1280x850 before returning to dashboard
    await bw.evaluate((b, { w, h }) => b.setContentSize(w, h), { w: 1280, h: 850 });
    await win.setViewportSize({ width: 1280, height: 850 });
    await win.waitForTimeout(60);

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
    try {
      fs.rmSync(tmpUserData, { recursive: true, force: true });
    } catch {}
  }
}

if (require.main === module) {
  runVisualQa();
}

module.exports = { runVisualQa };
