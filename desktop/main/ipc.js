/**
 * Electron IPC Handler Registration Module.
 * Maps IPC channels from Renderer process to corresponding Main process services.
 *
 * @param {object} deps
 * @param {object} deps.ipcMain Electron ipcMain module or mock
 * @param {object} deps.browserManager BrowserManager service instance
 * @param {object} deps.obsService ObsService instance
 * @param {object} [deps.app] Electron app module (for getVersion)
 * @param {object} [deps.clipboard] Electron clipboard module
 * @param {string} [deps.overlayUrl='http://127.0.0.1:17369/overlay/']
 */
function registerIpcHandlers(deps = {}) {
  const {
    ipcMain,
    browserManager,
    obsService,
    app,
    clipboard = require('electron').clipboard,
    overlayUrl = 'http://127.0.0.1:17369/overlay/',
  } = deps;

  if (!ipcMain) {
    throw new Error('ipcMain is required to register IPC handlers');
  }

  // --- Browser & Extension Management ---
  ipcMain.handle('open-url', (_event, url, browserId) => {
    const allowed = [
      'https://boosty.to/',
      'http://127.0.0.1:17369/',
    ];
    if (!allowed.some(prefix => typeof url === 'string' && url.startsWith(prefix))) {
      throw new Error('URL is not allowed');
    }
    return browserManager.openPreferredBrowser(url, browserId);
  });

  ipcMain.handle('copy-overlay-url', () => {
    if (clipboard && typeof clipboard.writeText === 'function') {
      clipboard.writeText(overlayUrl);
    }
    return true;
  });

  ipcMain.handle('list-browsers', () => {
    return browserManager.listBrowsers();
  });

  ipcMain.handle('prepare-browser-extension', (_event, browserId) => {
    return browserManager.prepareBrowserExtension(browserId);
  });

  ipcMain.handle('open-extension-folder', () => {
    return browserManager.openExtensionFolder();
  });

  ipcMain.handle('open-browser-extensions-page', (_event, browserId) => {
    return browserManager.openBrowserExtensionsPage(browserId);
  });

  ipcMain.handle('copy-extensions-url', (_event, browserId) => {
    return browserManager.copyExtensionsUrl(browserId);
  });

  ipcMain.handle('copy-extension-path', () => {
    if (typeof browserManager.copyExtensionPath === 'function') {
      return browserManager.copyExtensionPath();
    }
    const extDir = browserManager.getExtensionDir();
    if (clipboard && typeof clipboard.writeText === 'function') {
      clipboard.writeText(extDir);
    }
    return { ok: true, extensionDir: extDir };
  });

  ipcMain.handle('get-extension-info', () => {
    const { EXPECTED_EXTENSION_ID } = require('../../core/constants');
    const persistentPath = browserManager.getExtensionDir();
    const bundledPath = typeof browserManager.getBundledExtensionDir === 'function'
      ? browserManager.getBundledExtensionDir()
      : persistentPath;
    const isTransient = typeof browserManager.isTransientPath === 'function'
      ? browserManager.isTransientPath(persistentPath)
      : false;
    return {
      persistentPath,
      bundledPath,
      extensionId: EXPECTED_EXTENSION_ID,
      isTransient,
    };
  });

  // --- Update Checker Channels ---
  const updateChecker = deps.updateChecker || null;

  ipcMain.handle('get-update-status', () => {
    if (updateChecker && typeof updateChecker.getStatus === 'function') {
      return updateChecker.getStatus();
    }
    return {
      state: 'idle',
      currentVersion: (app && typeof app.getVersion === 'function') ? app.getVersion() : '0.4.0',
      updateAvailable: false,
    };
  });

  ipcMain.handle('check-for-updates', async () => {
    if (updateChecker && typeof updateChecker.checkForUpdates === 'function') {
      return await updateChecker.checkForUpdates(true);
    }
    return {
      state: 'idle',
      currentVersion: (app && typeof app.getVersion === 'function') ? app.getVersion() : '0.4.0',
      updateAvailable: false,
    };
  });

  ipcMain.handle('open-release-url', async (_event, targetUrl) => {
    const defaultUrl = updateChecker?.getStatus?.()?.releaseUrl || 'https://github.com/pefbrute/boosty-chat-overlay/releases';
    const url = targetUrl || defaultUrl;
    if (updateChecker && typeof updateChecker.validateReleaseUrl === 'function') {
      if (!updateChecker.validateReleaseUrl(url)) {
        return { ok: false, error: 'Invalid release URL' };
      }
    }
    const shellMod = deps.shellModule || (() => {
      try { return require('electron').shell; } catch { return null; }
    })();
    if (shellMod && typeof shellMod.openExternal === 'function') {
      await shellMod.openExternal(url);
      return { ok: true };
    }
    return { ok: false, error: 'Shell module unavailable' };
  });

  // --- OBS Studio Management ---
  ipcMain.handle('launch-obs', () => {
    return obsService.launchObs();
  });

  ipcMain.handle('has-obs-executable', () => {
    return obsService.hasObsExecutable();
  });

  ipcMain.handle('list-obs-scenes', (_event, password) => {
    return obsService.listScenes(password);
  });

  ipcMain.handle('add-obs-scene', (_event, password, sceneIdentifier) => {
    return obsService.addScene(password, sceneIdentifier);
  });

  ipcMain.handle('remove-obs-scene', (_event, password, sceneIdentifier) => {
    return obsService.removeScene(password, sceneIdentifier);
  });

  ipcMain.handle('get-obs-status', () => {
    return obsService.getStatus();
  });

  ipcMain.handle('fit-obs-overlay', (_event, password) => {
    return obsService.fitOverlayToCanvas(password);
  });

  ipcMain.handle('refresh-obs-overlay', () => {
    return obsService.refreshOverlay();
  });

  // --- Application Information & Diagnostics ---
  ipcMain.handle('get-app-version', () => {
    if (app && typeof app.getVersion === 'function') {
      return app.getVersion();
    }
    return '0.4.0';
  });

  ipcMain.handle('export-connectivity-diagnostic', async () => {
    try {
      const http = require('node:http');
      const os = require('node:os');
      const port = Number(process.env.BOOSTY_OVERLAY_PORT || 17369);
      const diagnosticData = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/diagnostic`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ ok: false, error: 'Invalid diagnostic response' });
            }
          });
        });
        req.on('error', (err) => resolve({ ok: false, error: err.message }));
      });

      if (diagnosticData && typeof diagnosticData === 'object' && diagnosticData.ok) {
        const homedir = os.homedir();
        const maskPath = (p) => (typeof p === 'string' && homedir ? p.replace(homedir, '~') : p);
        const persistentExtDir = (browserManager && typeof browserManager.getExtensionDir === 'function')
          ? browserManager.getExtensionDir()
          : null;
        const { EXPECTED_EXTENSION_ID } = require('../../core/constants');

        diagnosticData.appVersion = (app && typeof app.getVersion === 'function') ? app.getVersion() : '0.4.0';
        diagnosticData.expectedExtensionId = EXPECTED_EXTENSION_ID;
        diagnosticData.detectedExtensionId = diagnosticData.health?.detectedExtensionId || diagnosticData.health?.extension?.extensionId || null;
        diagnosticData.detectedExtensionVersion = diagnosticData.health?.detectedExtensionVersion || diagnosticData.health?.extension?.version || null;
        diagnosticData.bundledExtensionVersion = diagnosticData.health?.bundledExtensionVersion || diagnosticData.appVersion;
        diagnosticData.persistentExtensionVersion = diagnosticData.health?.persistentExtensionVersion || diagnosticData.bundledExtensionVersion;
        diagnosticData.extensionMigrationRequired = Boolean(diagnosticData.health?.extensionMigrationRequired);
        diagnosticData.extensionBundledVersion = diagnosticData.bundledExtensionVersion;
        diagnosticData.extensionDetectedVersion = diagnosticData.detectedExtensionVersion;
        diagnosticData.extensionId = diagnosticData.detectedExtensionId || EXPECTED_EXTENSION_ID;
        diagnosticData.extensionPersistentPath = maskPath(persistentExtDir);
        diagnosticData.singleInstanceLock = true;
        diagnosticData.updateStatus = updateChecker ? updateChecker.getStatus() : null;
      }
      return diagnosticData;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = {
  registerIpcHandlers,
};
