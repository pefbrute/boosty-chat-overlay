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

  // --- Application Information ---
  ipcMain.handle('get-app-version', () => {
    if (app && typeof app.getVersion === 'function') {
      return app.getVersion();
    }
    return '0.4.0';
  });
}

module.exports = {
  registerIpcHandlers,
};
