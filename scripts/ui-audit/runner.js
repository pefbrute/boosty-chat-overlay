'use strict';

// 1. ISOLATE ENVIRONMENT VARIABLES BEFORE ANY REQUIRE OF SERVER.JS
const auditPort = 17388;
const tmpConfigFile = `/tmp/boosty-chat-overlay-ui-audit-${process.pid}.json`;

process.env.BOOSTY_OVERLAY_PORT = String(auditPort);
process.env.BOOSTY_OVERLAY_CONFIG = tmpConfigFile;
process.env.UI_AUDIT_MODE = '1';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain } = require('electron');
const { CANONICAL_STATES, ALL_STATES, findStateById, FIXTURE_BROWSERS } = require('./states');
const { buildManifest } = require('./manifest');
const { generateContactSheetHtml } = require('./contact-sheet');
const { generateReadme, createArchive } = require('./archive');
const { getOverlayBackgroundInjectionScript } = require('./overlay-wrapper');

// Disable hardware acceleration for deterministic headless rendering
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// Initialize temporary clean config
fs.writeFileSync(tmpConfigFile, JSON.stringify({
  durationSeconds: 0,
  maxMessages: 6,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
}, null, 2));

// Start isolated server
const { server: auditServer } = require('../../server.js');

// Parse CLI flags passed from capture.js
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const hasFlag = flag => args.includes(flag);

const scopeArg = getArg('--scope') || 'all';
const stateArg = getArg('--state') || null;
const isInteractive = hasFlag('--interactive');
const outDirArg = getArg('--out-dir') || null;

// Determine target directory
const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const timestampFolder = nowStr.replace('T', '_');
const projectRoot = path.resolve(__dirname, '..', '..');
const artifactsBaseDir = path.join(projectRoot, 'artifacts', 'ui-audit');
const targetDir = outDirArg || path.join(artifactsBaseDir, timestampFolder);
const screenshotsDir = path.join(targetDir, 'screenshots');
const zipPath = path.join(artifactsBaseDir, `ui-audit-${timestampFolder}.zip`);

// Ensure directories exist
fs.mkdirSync(screenshotsDir, { recursive: true });

// Determine which states to capture
let statesToCapture = [];
if (stateArg) {
  const found = findStateById(stateArg);
  if (!found) {
    console.error(`✖ State "${stateArg}" not found in registry.`);
    cleanupAndExit(1);
  }
  // Targeted capture: exactly 1 state
  const customWidth = Number(getArg('--width')) || found.width;
  const customHeight = Number(getArg('--height')) || found.height;
  const customFilename = (customWidth !== found.width || customHeight !== found.height)
    ? found.filename.replace(/\d+x\d+/, `${customWidth}x${customHeight}`)
    : found.filename;

  statesToCapture = [{
    ...found,
    index: 1,
    width: customWidth,
    height: customHeight,
    filename: customFilename,
  }];
} else if (scopeArg && scopeArg !== 'all') {
  statesToCapture = CANONICAL_STATES.filter(s => s.section === scopeArg);
  if (!statesToCapture.length) {
    console.error(`✖ No states found for scope "${scopeArg}".`);
    cleanupAndExit(1);
  }
} else {
  // Default: strictly the 10 canonical states in 01 -> 10 order
  statesToCapture = CANONICAL_STATES;
}

// Global cleanup tracking
let desktopWin = null;
let overlayWin = null;
let cleanedUp = false;

function cleanupAndExit(code = 0) {
  if (cleanedUp) return;
  cleanedUp = true;

  try { if (desktopWin && !desktopWin.isDestroyed()) desktopWin.destroy(); } catch {}
  try { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy(); } catch {}
  try { if (fs.existsSync(tmpConfigFile)) fs.unlinkSync(tmpConfigFile); } catch {}

  try {
    auditServer.close(() => {
      app.quit();
      process.exit(code);
    });
  } catch {
    app.quit();
    process.exit(code);
  }
}

// Register exit & signal traps
process.on('SIGINT', () => {
  console.log('\n[UI Audit] Interrupted (SIGINT), cleaning up...');
  cleanupAndExit(130);
});
process.on('SIGTERM', () => {
  console.log('\n[UI Audit] Terminated (SIGTERM), cleaning up...');
  cleanupAndExit(143);
});
process.on('uncaughtException', err => {
  console.error('\n[UI Audit] Uncaught exception:', err);
  cleanupAndExit(1);
});

// Helper: Post message to audit server
function postChatMessage(msg) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(msg);
    const req = http.request({
      host: '127.0.0.1',
      port: auditPort,
      path: '/message',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(JSON.parse(body || '{}')));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Helper: Post config to audit server
function postConfig(cfg) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(cfg);
    const req = http.request({
      host: '127.0.0.1',
      port: auditPort,
      path: '/config',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(JSON.parse(body || '{}')));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

app.whenReady().then(async () => {
  console.log('Boosty Chat Overlay — UI Audit');
  console.log(`Port: ${auditPort} | Output: ${targetDir}\n`);

  const results = [];
  let failuresCount = 0;

  try {
    // 1. Create Desktop window
    desktopWin = new BrowserWindow({
      show: isInteractive,
      width: 1280,
      height: 800,
      frame: false,
      backgroundColor: '#111116',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      },
    });

    // State-aware dynamic mock for OBS
    let currentAuditObsMock = { ok: false, connected: false, scenes: [] };

    // Override mock browser list, OBS status and API origin
    ipcMain.handle('list-browsers', () => FIXTURE_BROWSERS);
    ipcMain.handle('list-obs-scenes', () => currentAuditObsMock);
    ipcMain.handle('get-obs-status', () => currentAuditObsMock);
    ipcMain.handle('copy-overlay-url', () => true);
    ipcMain.handle('get-app-version', () => '0.4.0');

    desktopWin.webContents.on('dom-ready', () => {
      desktopWin.webContents.executeJavaScript(`
        window.BOOSTY_API_ORIGIN = 'http://127.0.0.1:${auditPort}';
      `);
    });

    const desktopHtmlPath = path.join(__dirname, '..', '..', 'desktop', 'index.html');
    await desktopWin.loadFile(desktopHtmlPath);
    await desktopWin.webContents.executeJavaScript(`
      new Promise(resolve => {
        if (window.__APP_INITIALIZED__) return resolve();
        const interval = setInterval(() => {
          if (window.__APP_INITIALIZED__) {
            clearInterval(interval);
            resolve();
          }
        }, 30);
      })
    `);

    // 2. Create Overlay window
    overlayWin = new BrowserWindow({
      show: isInteractive,
      width: 1920,
      height: 1080,
      frame: false,
      backgroundColor: '#000000',
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false,
      },
    });

    // Total count of scheduled captures
    const total = statesToCapture.length;

    for (let i = 0; i < total; i++) {
      const state = statesToCapture[i];
      const progressPrefix = `[${i + 1}/${total}] ${state.section} / ${state.id} / ${state.width}x${state.height}`;

      try {
        let winToCapture;
        if (state.type === 'desktop') {
          winToCapture = desktopWin;
          desktopWin.setContentSize(state.width, state.height);

          // Update dynamic OBS mock before applying state
          if (state.mock && state.mock.obs) {
            currentAuditObsMock = { ...state.mock.obs };
          } else {
            currentAuditObsMock = { ok: false, connected: false, scenes: [] };
          }

          // Render acknowledgment promise
          const renderAckPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              cleanupHandler();
              reject(new Error(`Timeout waiting for render acknowledgment for state: ${state.id}`));
            }, 6000);

            function onReady(_event, data) {
              if (data && data.id === state.id) {
                clearTimeout(timeout);
                cleanupHandler();
                if (data.ok) resolve();
                else reject(new Error(data.error || 'Failed to render state'));
              }
            }

            function cleanupHandler() {
              ipcMain.removeListener('audit:state-ready', onReady);
            }

            ipcMain.on('audit:state-ready', onReady);
          });

          // Dispatch apply-state to renderer
          desktopWin.webContents.send('audit:apply-state', state);
          await renderAckPromise;

          // Wait for CSS animations (fadeIn 250ms) and GPU painting to fully settle
          await new Promise(r => setTimeout(r, 320));

          // Validate rendered DOM state against expectations
          if (state.expected) {
            const renderState = await desktopWin.webContents.executeJavaScript('window.__UI_AUDIT_RENDER_STATE__');
            if (state.expected.view && renderState.view !== state.expected.view) {
              throw new Error(`Expected view "${state.expected.view}" but rendered "${renderState.view}"`);
            }
            if (state.expected.step !== undefined && renderState.step !== state.expected.step) {
              throw new Error(`Expected step ${state.expected.step} but rendered ${renderState.step}`);
            }
            if (state.expected.obsConnected !== undefined && renderState.obsConnected !== state.expected.obsConnected) {
              throw new Error(`Expected obsConnected ${state.expected.obsConnected} but rendered ${renderState.obsConnected}`);
            }
            if (state.expected.extensionConnected !== undefined && renderState.extensionConnected !== state.expected.extensionConnected) {
              throw new Error(`Expected extensionConnected ${state.expected.extensionConnected} but rendered ${renderState.extensionConnected}`);
            }
            if (state.expected.boostyConnected !== undefined && renderState.boostyConnected !== state.expected.boostyConnected) {
              throw new Error(`Expected boostyConnected ${state.expected.boostyConnected} but rendered ${renderState.boostyConnected}`);
            }
            if (state.expected.bannerVisible !== undefined && renderState.bannerVisible !== state.expected.bannerVisible) {
              throw new Error(`Expected bannerVisible ${state.expected.bannerVisible} but rendered ${renderState.bannerVisible}`);
            }
            if (state.expected.activePreset !== undefined && renderState.activePreset !== state.expected.activePreset) {
              throw new Error(`Expected activePreset "${state.expected.activePreset}" but rendered "${renderState.activePreset}"`);
            }
          }

        } else if (state.type === 'overlay') {
          winToCapture = overlayWin;
          overlayWin.setContentSize(state.width, state.height);

          // Apply config to server
          if (state.mock.config) {
            await postConfig(state.mock.config);
          }

          // Load real overlay URL
          await overlayWin.loadURL(`http://127.0.0.1:${auditPort}/overlay/`);

          // Inject the 4-zone test canvas directly behind the chat messages
          await overlayWin.webContents.executeJavaScript(getOverlayBackgroundInjectionScript());

          // Wait for overlay EventSource connection to be ready
          await overlayWin.webContents.executeJavaScript(`
            new Promise((resolve) => {
              if (typeof events !== 'undefined' && events.readyState === 1) {
                resolve();
              } else if (typeof events !== 'undefined') {
                events.onopen = () => resolve();
                setTimeout(resolve, 800);
              } else {
                setTimeout(resolve, 400);
              }
            })
          `);

          // Post messages for this state
          if (Array.isArray(state.mock.messages)) {
            for (const msg of state.mock.messages) {
              await postChatMessage(msg);
            }
          }

          // Wait for messages to be rendered into the DOM
          const expectedCount = Array.isArray(state.mock.messages) ? state.mock.messages.length : 0;
          await overlayWin.webContents.executeJavaScript(`
            new Promise((resolve) => {
              const start = Date.now();
              function check() {
                const count = document.querySelectorAll('#messages .message').length;
                if (count >= ${expectedCount} || Date.now() - start > 2000) {
                  resolve(count);
                } else {
                  setTimeout(check, 50);
                }
              }
              check();
            })
          `);

          // Wait for CSS animations (appear 220ms) to settle
          await new Promise(r => setTimeout(r, 350));
        }

        // Take snapshot via capturePage
        let nativeImage = await winToCapture.webContents.capturePage({
          x: 0,
          y: 0,
          width: state.width,
          height: state.height,
        });

        // Ensure pixel-exact dimensions
        let size = nativeImage.getSize();
        if (size.width !== state.width || size.height !== state.height) {
          nativeImage = nativeImage.resize({ width: state.width, height: state.height, quality: 'best' });
          size = nativeImage.getSize();
        }

        if (size.width !== state.width || size.height !== state.height) {
          throw new Error(`Image size mismatch: got ${size.width}x${size.height}, expected ${state.width}x${state.height}`);
        }

        const pngBuffer = nativeImage.toPNG();
        const filePath = path.join(screenshotsDir, state.filename);
        fs.writeFileSync(filePath, pngBuffer);

        results.push({ ...state, status: 'success' });
        console.log(`${progressPrefix} ✔`);
      } catch (err) {
        failuresCount++;
        console.error(`${progressPrefix} ✖ (${err.message})`);
        results.push({ ...state, status: 'failed', error: err.message });
      }
    }

    // Generate bundle metadata
    console.log('\nGenerating manifest ✔');
    const manifest = buildManifest({
      appVersion: '0.4.0',
      platform: process.platform,
      screenshots: results,
      timestamp: new Date().toISOString(),
    });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    console.log('Generating contact sheet ✔');
    const contactSheetHtml = generateContactSheetHtml({ manifest });
    fs.writeFileSync(path.join(targetDir, 'contact-sheet.html'), contactSheetHtml);

    console.log('Generating README ✔');
    const readme = generateReadme({ manifest });
    fs.writeFileSync(path.join(targetDir, 'README.md'), readme);

    console.log('Creating ZIP ✔');
    createArchive(targetDir, zipPath);

    console.log('\nDone.');
    console.log(`Screenshots: ${results.filter(r => r.status === 'success').length}/${total}`);
    if (failuresCount > 0) {
      console.log(`Failed: ${failuresCount}`);
    }
    console.log(`Directory: ${targetDir}`);
    console.log(`Bundle:    ${zipPath}\n`);

    if (isInteractive) {
      console.log('[UI Audit] Interactive mode: keeping window open. Close window or press Ctrl+C to exit.');
      return; // Do not cleanup yet
    }

    cleanupAndExit(failuresCount > 0 ? 1 : 0);
  } catch (globalErr) {
    console.error('Fatal runner error:', globalErr);
    cleanupAndExit(1);
  }
});
