const { app, BrowserWindow, clipboard, ipcMain } = require('electron');
const path = require('node:path');
const { createObsService } = require('./obs/service.js');
const { createBrowserManager } = require('./browser/manager.js');
const { createUpdateChecker } = require('./main/update-checker.js');
const { registerIpcHandlers } = require('./main/ipc.js');

let mainWindow;
let localServer;
let localSseHub;

// --- Single Instance Lock (P1) ---
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.warn('[Boosty Overlay] Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  const browserManager = createBrowserManager({
    appModule: app,
  });

  const obsService = createObsService({
    appVersion: app.isReady() ? app.getVersion() : '0.4.0',
    overlayPort: Number(process.env.BOOSTY_OVERLAY_PORT || 17369),
    isServerReady: () => Boolean(localServer && localServer.listening),
    getOverlayClients: () => (localSseHub ? localSseHub.clientCount() : 0),
    onStateChange: state => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('obs-state-changed', state);
      }
    },
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 940,
      height: 700,
      minWidth: 760,
      minHeight: 560,
      backgroundColor: '#111116',
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      title: 'Boosty Chat Overlay',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  app.whenReady().then(() => {
    process.env.BOOSTY_OVERLAY_CONFIG = process.env.BOOSTY_OVERLAY_CONFIG || path.join(app.getPath('userData'), 'overlay-settings.json');

    // Deploy persistent extension on startup (P0)
    try {
      const deployRes = browserManager.deployExtension(false);
      console.log(`[Boosty Overlay] Persistent extension: ${deployRes.path} (v${deployRes.version}, deployed=${deployRes.deployed})`);
    } catch (deployErr) {
      console.error('[Boosty Overlay] Failed to deploy extension to userData:', deployErr);
    }

    const updateChecker = createUpdateChecker({
      currentVersion: app.getVersion(),
    });

    const serverModule = require('../server.js');
    localServer = serverModule.server;
    localSseHub = serverModule.sseHub;

    // Graceful port collision trap
    if (localServer) {
      localServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          const port = Number(process.env.BOOSTY_OVERLAY_PORT || 17369);
          console.error(`[Boosty Overlay] Port ${port} is already in use by another application!`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('server-port-conflict', { port });
          }
        }
      });
    }

    createWindow();

    registerIpcHandlers({
      ipcMain,
      browserManager,
      obsService,
      updateChecker,
      app,
      clipboard,
      overlayUrl: `http://127.0.0.1:${process.env.BOOSTY_OVERLAY_PORT || 17369}/overlay/`,
    });

    if (process.env.BOOSTY_OVERLAY_UI_TEST !== '1') {
      if (localServer && !localServer.listening) {
        localServer.once('listening', () => obsService.scheduleRefresh(50));
      }
      setTimeout(() => obsService.scheduleRefresh(100), 500);
      obsService.startPeriodicSync(15000);

      // Background check for updates (non-blocking)
      setTimeout(() => {
        updateChecker.checkForUpdates(false).catch(() => {});
      }, 4000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    obsService.destroy().catch(() => {});
    localServer?.close();
  });
}

if (process.env.UI_AUDIT_MODE === '1' || process.env.BOOSTY_OVERLAY_UI_TEST === '1') {
  // Disable animations and transitions in audit/test mode for absolute snapshot determinism
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-finish-load', () => {
      contents.insertCSS(`
        * {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
      `).catch(() => {});
    });
  });
}
