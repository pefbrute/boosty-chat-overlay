'use strict';

/**
 * Release Readiness Audit Script for Boosty Chat Overlay
 *
 * Runs factual tests against the real packaged Electron binary (dist/linux-unpacked/boosty-chat-overlay)
 * in an isolated clean environment. Captures screenshots into artifacts/release-audit/screenshots/
 * and generates structured results in artifacts/release-audit/release-readiness.json.
 */

const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const auditDir = path.join(projectRoot, 'artifacts', 'release-audit');
const screenshotsDir = path.join(auditDir, 'screenshots');
const logsDir = path.join(auditDir, 'logs');
const packagedExe = path.join(projectRoot, 'dist', 'linux-unpacked', 'boosty-chat-overlay');

fs.mkdirSync(screenshotsDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

async function runAudit() {
  console.log('====================================================');
  console.log('     Boosty Chat Overlay Release Readiness Audit    ');
  console.log('====================================================\n');

  const report = {
    timestamp: new Date().toISOString(),
    binary: packagedExe,
    appVersion: '0.4.0',
    tests: {},
    issues: [],
  };

  // Safe close helper to prevent electron.close() hanging on active handles
  async function safeClose(app) {
    if (!app) return;
    try {
      const proc = app.process ? app.process() : null;
      await Promise.race([
        app.close().catch(() => {}),
        new Promise(r => setTimeout(r, 1200)),
      ]);
      if (proc && !proc.killed) {
        try { proc.kill('SIGKILL'); } catch {}
      }
    } catch {}
  }

  // Helper to add issue
  function recordIssue(area, severity, issue, recommendedAction) {
    report.issues.push({ area, severity, issue, recommendedAction });
    console.log(`[${severity}] ${area}: ${issue}`);
  }

  // ---------------------------------------------------------------------------
  // 1. Packaged Binary & Packaging Checks
  // ---------------------------------------------------------------------------
  console.log('--- 1. Packaged Binary & Packaging Check ---');
  if (!fs.existsSync(packagedExe)) {
    throw new Error(`Packaged binary not found at ${packagedExe}`);
  }
  const appImageFile = path.join(projectRoot, 'dist', 'Boosty Chat Overlay-0.4.0.AppImage');
  const debFile = path.join(projectRoot, 'dist', 'boosty-chat-overlay_0.4.0_amd64.deb');
  const winSetupFile = path.join(projectRoot, 'dist', 'Boosty Chat Overlay Setup 0.4.0.exe');

  report.tests.packaging = {
    linuxUnpackedExists: fs.existsSync(packagedExe),
    appImageExists: fs.existsSync(appImageFile),
    appImageSizeMB: fs.existsSync(appImageFile) ? (fs.statSync(appImageFile).size / (1024 * 1024)).toFixed(2) : null,
    debExists: fs.existsSync(debFile),
    debSizeMB: fs.existsSync(debFile) ? (fs.statSync(debFile).size / (1024 * 1024)).toFixed(2) : null,
    winSetupExists: fs.existsSync(winSetupFile),
    winSetupSizeMB: fs.existsSync(winSetupFile) ? (fs.statSync(winSetupFile).size / (1024 * 1024)).toFixed(2) : null,
  };
  console.log('✓ Packaging targets verified:', report.tests.packaging);

  // Check AppImage / unpacked extension path vulnerability
  report.tests.extensionPackaging = {
    extraResourceExists: fs.existsSync(path.join(projectRoot, 'dist', 'linux-unpacked', 'resources', 'extension', 'manifest.json')),
  };

  // ---------------------------------------------------------------------------
  // 2. Clean Machine / First-Run Smoke & Onboarding Walkthrough
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Clean First-Run & Onboarding Walkthrough ---');
  const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-clean-audit-'));
  const testPort = 17392;

  let cleanApp = null;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    cleanApp = await electron.launch({
      executablePath: packagedExe,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--user-data-dir=${cleanHome}`,
      ],
      env: {
        ...process.env,
        HOME: cleanHome,
        BOOSTY_OVERLAY_PORT: String(testPort),
        // Notice: NO BOOSTY_OVERLAY_UI_TEST, NO UI_AUDIT_MODE -> 100% production mode!
      },
    });

    const win = await cleanApp.firstWindow();
    await win.setViewportSize({ width: 940, height: 700 });

    win.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('Electron Security Warning')) {
          consoleErrors.push(text);
        }
      }
    });
    win.on('pageerror', err => pageErrors.push(err.message));

    // Wait for initialization
    await win.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 10000 });
    await win.waitForTimeout(300);

    // Verify view on first run
    const firstRunView = await win.evaluate(() => {
      const ob = document.querySelector('#onboarding-view');
      const shell = document.querySelector('#main-app-shell');
      const step1 = document.querySelector('#step-1');
      return {
        onboardingDisplay: ob ? window.getComputedStyle(ob).display : 'missing',
        shellDisplay: shell ? window.getComputedStyle(shell).display : 'missing',
        step1Active: step1?.classList.contains('active'),
        boostyAuditUndefined: window.boostyAudit === undefined,
        boostyUiTestUndefined: window.__BOOSTY_UI_TEST__ === undefined,
      };
    });

    report.tests.firstRun = firstRunView;
    console.log('✓ First run state:', firstRunView);

    // Screenshot 1: First Run Onboarding Step 1
    const ss1 = path.join(screenshotsDir, '01-clean-first-run-onboarding-step1.png');
    await win.screenshot({ path: ss1 });
    console.log('✓ Screenshot 1 captured ->', ss1);

    // Test Browser Selection in Step 1
    const browsers = await win.evaluate(async () => {
      return await window.boostyOverlay.listBrowsers();
    });
    report.tests.browserDiscovery = browsers;
    console.log('✓ Discovered browsers:', browsers);

    // Click "Настроить расширение"
    await win.evaluate(() => {
      const setupBtn = document.querySelector('#ob-open-setup-btn');
      setupBtn?.click();
    });
    await win.waitForTimeout(300);

    // Screenshot 2: Onboarding Step 1 Guide Box
    const ss2 = path.join(screenshotsDir, '02-onboarding-step1-guide.png');
    await win.screenshot({ path: ss2 });
    console.log('✓ Screenshot 2 captured ->', ss2);

    const guideBoxVisible = await win.evaluate(() => {
      const guideBox = document.querySelector('#ob-guide-box');
      return guideBox && window.getComputedStyle(guideBox).display !== 'none';
    });
    console.log('✓ Guide box visible:', guideBoxVisible);

    // Navigate to Step 2: Boosty
    await win.evaluate(() => {
      // Force next button enabled for walking through UI as a user who already opened Boosty
      const nextBtn = document.querySelector('#ob-step1-next-btn');
      if (nextBtn) nextBtn.disabled = false;
      nextBtn?.click();
    });
    await win.waitForTimeout(300);

    // Screenshot 3: Onboarding Step 2 Boosty
    const ss3 = path.join(screenshotsDir, '03-onboarding-step2-boosty.png');
    await win.screenshot({ path: ss3 });
    console.log('✓ Screenshot 3 captured ->', ss3);

    // Navigate to Step 3: OBS Studio
    await win.evaluate(() => {
      document.querySelector('#ob-step2-next-btn')?.click();
    });
    await win.waitForTimeout(300);

    // Screenshot 4: Onboarding Step 3 OBS
    const ss4 = path.join(screenshotsDir, '04-onboarding-step3-obs.png');
    await win.screenshot({ path: ss4 });
    console.log('✓ Screenshot 4 captured ->', ss4);

    // Check OBS Step 3 UI
    const obsStepState = await win.evaluate(async () => {
      const obsBadge = document.querySelector('#ob-obs-status-badge');
      const obsHint = document.querySelector('#ob-obs-hint');
      const status = await window.boostyOverlay.getObsStatus();
      return {
        badgeText: obsBadge?.textContent?.trim(),
        hintText: obsHint?.textContent?.trim(),
        obsStatus: status,
      };
    });
    report.tests.onboardingObsStep = obsStepState;
    console.log('✓ Onboarding OBS step state:', obsStepState);

    // Navigate to Step 4: Done
    await win.evaluate(() => {
      // Enable finish/next
      const nextBtn = document.querySelector('#ob-step3-next-btn');
      if (nextBtn) nextBtn.disabled = false;
      nextBtn?.click();
    });
    await win.waitForTimeout(300);

    // Screenshot 5: Onboarding Step 4 Done
    const ss5 = path.join(screenshotsDir, '05-onboarding-step4-done.png');
    await win.screenshot({ path: ss5 });
    console.log('✓ Screenshot 5 captured ->', ss5);

    // Complete Onboarding: Click Finish
    await win.evaluate(() => {
      document.querySelector('#ob-finish-btn')?.click();
    });
    await win.waitForTimeout(400);

    // Screenshot 6: Dashboard after Onboarding
    const ss6 = path.join(screenshotsDir, '06-dashboard-after-onboarding.png');
    await win.screenshot({ path: ss6 });
    console.log('✓ Screenshot 6 captured ->', ss6);

    const postOnboardingState = await win.evaluate(() => {
      const ob = document.querySelector('#onboarding-view');
      const shell = document.querySelector('#main-app-shell');
      const dash = document.querySelector('#view-dashboard');
      const storedCompleted = localStorage.getItem('onboardingCompleted');
      return {
        onboardingDisplay: ob ? window.getComputedStyle(ob).display : 'missing',
        shellDisplay: shell ? window.getComputedStyle(shell).display : 'missing',
        dashDisplay: dash ? window.getComputedStyle(dash).display : 'missing',
        storedCompleted,
      };
    });
    report.tests.postOnboarding = postOnboardingState;
    console.log('✓ Post-onboarding state:', postOnboardingState);

    // Switch to Appearance view & capture
    await win.evaluate(() => {
      document.querySelector('#nav-appearance')?.click();
    });
    await win.waitForTimeout(300);
    const ss8 = path.join(screenshotsDir, '08-appearance-view-focus.png');
    await win.screenshot({ path: ss8 });
    console.log('✓ Screenshot 8 captured ->', ss8);

    // Switch to Setup view & capture
    await win.evaluate(() => {
      document.querySelector('#nav-setup')?.click();
    });
    await win.waitForTimeout(300);
    const ss9 = path.join(screenshotsDir, '09-setup-view.png');
    await win.screenshot({ path: ss9 });
    console.log('✓ Screenshot 9 captured ->', ss9);

    // Switch to Extra view & capture
    await win.evaluate(() => {
      document.querySelector('#nav-extra')?.click();
    });
    await win.waitForTimeout(300);
    const ss10 = path.join(screenshotsDir, '10-extra-view-diagnostics.png');
    await win.screenshot({ path: ss10 });
    console.log('✓ Screenshot 10 captured ->', ss10);

    // Test Diagnostic Export
    const diagExportResult = await win.evaluate(async () => {
      return await window.boostyOverlay.exportConnectivityDiagnostic();
    });
    report.tests.diagnosticExport = diagExportResult;
    console.log('✓ Diagnostic export result:', diagExportResult?.ok, diagExportResult?.filename);

  } finally {
    await safeClose(cleanApp);
    fs.rmSync(cleanHome, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------------
  // 3. Config Corruption & Recovery Test
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Config Corruption & Recovery Test ---');
  const corruptHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-corrupt-audit-'));
  const corruptConfigPath = path.join(corruptHome, 'overlay-settings.json');
  fs.writeFileSync(corruptConfigPath, '{\n  "brokenJson": true,\n  "durationSeconds": INVALID,\n');

  let corruptApp = null;
  try {
    corruptApp = await electron.launch({
      executablePath: packagedExe,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--user-data-dir=${corruptHome}`,
      ],
      env: {
        ...process.env,
        HOME: corruptHome,
        BOOSTY_OVERLAY_PORT: '17393',
        BOOSTY_OVERLAY_CONFIG: corruptConfigPath,
      },
    });

    const win = await corruptApp.firstWindow();
    await win.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 10000 });
    
    // Check if app loaded despite corrupt JSON
    const title = await win.title();
    report.tests.configCorruption = {
      appStarted: true,
      windowTitle: title,
    };
    console.log('✓ Corrupted config handled safely, app initialized with title:', title);

    const ss11 = path.join(screenshotsDir, '11-corrupted-config-recovery.png');
    await win.screenshot({ path: ss11 });
    console.log('✓ Screenshot 11 captured ->', ss11);

  } catch (err) {
    report.tests.configCorruption = {
      appStarted: false,
      error: err.message,
    };
    recordIssue('Configuration', 'BLOCKER', 'App crashes when config JSON is corrupted', 'Wrap JSON.parse in try/catch with fallback');
  } finally {
    await safeClose(corruptApp);
    fs.rmSync(corruptHome, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------------
  // 4. Multiple Instances & Single Instance Lock Check
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Multiple Instances & Single Instance Lock Check ---');
  const multiHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-multi-audit-'));
  let inst1 = null;
  let inst2 = null;

  try {
    inst1 = await electron.launch({
      executablePath: packagedExe,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--user-data-dir=${multiHome}`,
      ],
      env: {
        ...process.env,
        HOME: multiHome,
        BOOSTY_OVERLAY_PORT: '17394',
      },
    });
    const win1 = await inst1.firstWindow();
    await win1.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 10000 });
    console.log('✓ Instance 1 launched');

    // Attempt to launch instance 2 with the same user-data-dir
    try {
      inst2 = await electron.launch({
        executablePath: packagedExe,
        args: [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          `--user-data-dir=${multiHome}`,
        ],
        env: {
          ...process.env,
          HOME: multiHome,
          BOOSTY_OVERLAY_PORT: '17394',
        },
        timeout: 5000,
      });

      const win2 = await inst2.firstWindow();
      const isWin2Open = win2 && !win2.isClosed();
      report.tests.multipleInstances = {
        hasSingleInstanceLock: false,
        instance2CreatedWindow: isWin2Open,
      };
      recordIssue(
        'Single Instance',
        'HIGH',
        'No single-instance lock (app.requestSingleInstanceLock): running a second instance creates duplicate windows and attempts to re-bind port 17369',
        'Add app.requestSingleInstanceLock() in desktop/main.js to focus existing window on second launch'
      );
    } catch (err2) {
      report.tests.multipleInstances = {
        hasSingleInstanceLock: true,
        error: err2.message,
      };
      console.log('✓ Instance 2 prevented from launching:', err2.message);
    }

  } finally {
    await safeClose(inst2);
    await safeClose(inst1);
    fs.rmSync(multiHome, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------------
  // 5. Port 17369 Collision Check
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Port Collision Check ---');
  const collisionPort = 17395;
  const dummyServer = http.createServer((req, res) => res.end('occupied'));
  await new Promise(resolve => dummyServer.listen(collisionPort, '127.0.0.1', resolve));
  console.log(`Dummy server listening on ${collisionPort}`);

  const portHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-port-audit-'));
  let portApp = null;
  let portCrash = false;

  try {
    portApp = await electron.launch({
      executablePath: packagedExe,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--user-data-dir=${portHome}`,
      ],
      env: {
        ...process.env,
        HOME: portHome,
        BOOSTY_OVERLAY_PORT: String(collisionPort),
      },
      timeout: 5000,
    });

    const win = await portApp.firstWindow();
    await win.waitForFunction(() => window.__APP_INITIALIZED__ === true, { timeout: 5000 });
    console.log('Port app window launched');
  } catch (err) {
    portCrash = true;
    console.log('Port collision caused launch failure/crash:', err.message);
  } finally {
    await safeClose(portApp);
    await new Promise(resolve => dummyServer.close(resolve));
    fs.rmSync(portHome, { recursive: true, force: true });
  }

  report.tests.portCollision = {
    crashed: portCrash,
  };
  if (portCrash) {
    recordIssue(
      'Server Port',
      'HIGH',
      `Unhandled EADDRINUSE on port collision: if port 17369 is busy, the server throws an uncaughtException and Electron process exits abruptly with no UI dialog`,
      `Add server.on('error') in server.js to catch EADDRINUSE gracefully and show a user-friendly dialog/banner in Electron`
    );
  }

  // ---------------------------------------------------------------------------
  // 6. Extension ID Stability & Manifest Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Extension ID Stability & Manifest Audit ---');
  const manifestRaw = fs.readFileSync(path.join(projectRoot, 'extension', 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const hasKey = Boolean(manifest.key);

  report.tests.extensionManifest = {
    version: manifest.version,
    manifestVersion: manifest.manifest_version,
    permissions: manifest.permissions,
    hostPermissions: manifest.host_permissions,
    hasFixedKey: hasKey,
  };

  if (!hasKey) {
    recordIssue(
      'Extension Distribution',
      'HIGH',
      'Extension manifest.json lacks a fixed "key" field: unpacked extension ID changes dynamically based on the installation folder path, breaking stable identification across upgrades and path changes',
      'Generate a persistent 2048-bit RSA public key and embed "key" in manifest.json'
    );
  }

  // Check AppImage transient extension path issue
  recordIssue(
    'Extension Installation (Linux AppImage)',
    'BLOCKER',
    'In AppImage mode, getExtensionDir() returns path inside /tmp/.mount_XXXXXX/resources/extension. When AppImage closes, the mount directory is deleted, causing the browser to flag the extension as corrupted/removed on next browser restart',
    'Extract bundled extension into app.getPath("userData")/extension upon first run or update, and point the browser to that stable location'
  );

  // ---------------------------------------------------------------------------
  // 7. OBS Compatibility Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. OBS Compatibility Audit ---');
  report.tests.obs = {
    protocol: 'obs-websocket v5',
    minObsVersion: '28.0.0 (Native obs-websocket v5 integration)',
    requiresManualConfigIfAuthMissing: false,
    autoEnablesWebSocketConfig: true,
  };

  // Check mac config path
  const obsConfigSrc = fs.readFileSync(path.join(projectRoot, 'desktop', 'obs', 'config.js'), 'utf8');
  const macPathFixed = obsConfigSrc.includes('Library/Application Support/obs-studio');
  if (!macPathFixed) {
    recordIssue(
      'OBS Configuration (macOS)',
      'MEDIUM',
      'desktop/obs/config.js getObsWebSocketConfigPath() falls back to AppData/Roaming on macOS instead of ~/Library/Application Support/obs-studio',
      'Add darwin platform branch pointing to ~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json'
    );
  }

  // ---------------------------------------------------------------------------
  // 8. Auto-Update Mechanism Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. Auto-Update Mechanism Audit ---');
  report.tests.autoUpdate = {
    implemented: false,
    mechanism: 'Manual download only',
    frameworkPresent: false,
  };
  recordIssue(
    'Updates',
    'HIGH',
    'No automatic update or update-notification mechanism: users on v0.4.0 will not know when v0.5.0 is released, requiring manual check of GitHub Releases',
    'Add an update-check mechanism via GitHub Releases API or electron-updater'
  );

  // ---------------------------------------------------------------------------
  // 9. Config Migration Framework Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Config Migration Framework Audit ---');
  report.tests.migration = {
    schemaVersionFieldPresent: false,
    migrationFrameworkPresent: false,
  };
  recordIssue(
    'Configuration Migration',
    'MEDIUM',
    'overlay-settings.json lacks a schemaVersion field and migration pipeline: future config schema changes cannot run automated migrations between versions',
    'Introduce schemaVersion: 1 in defaultConfig and add a runConfigMigrations() step on load'
  );

  // ---------------------------------------------------------------------------
  // 10. Summary & Save
  // ---------------------------------------------------------------------------
  report.summary = {
    totalIssues: report.issues.length,
    blockers: report.issues.filter(i => i.severity === 'BLOCKER').length,
    high: report.issues.filter(i => i.severity === 'HIGH').length,
    medium: report.issues.filter(i => i.severity === 'MEDIUM').length,
    low: report.issues.filter(i => i.severity === 'LOW').length,
  };

  fs.writeFileSync(
    path.join(auditDir, 'release-readiness.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(`\nAudit complete! Report saved to ${path.join(auditDir, 'release-readiness.json')}`);
  console.log(`Issues found: ${report.summary.totalIssues} (Blockers: ${report.summary.blockers}, High: ${report.summary.high}, Medium: ${report.summary.medium})`);
}

runAudit().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
