const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boostyOverlay', {
  apiOrigin: `http://127.0.0.1:${process.env.BOOSTY_OVERLAY_PORT || 17369}`,
  copyOverlayUrl: () => ipcRenderer.invoke('copy-overlay-url'),
  listObsScenes: password => ipcRenderer.invoke('list-obs-scenes', password),
  addObsScene: (password, sceneIdentifier) => ipcRenderer.invoke('add-obs-scene', password, sceneIdentifier),
  removeObsScene: (password, sceneIdentifier) => ipcRenderer.invoke('remove-obs-scene', password, sceneIdentifier),
  fitObsOverlay: password => ipcRenderer.invoke('fit-obs-overlay', password),
  refreshObsOverlay: () => ipcRenderer.invoke('refresh-obs-overlay'),
  getObsStatus: () => ipcRenderer.invoke('get-obs-status'),
  onObsStateChanged: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('obs-state-changed', handler);
    return () => ipcRenderer.removeListener('obs-state-changed', handler);
  },
  listBrowsers: () => ipcRenderer.invoke('list-browsers'),
  prepareBrowserExtension: browserId => ipcRenderer.invoke('prepare-browser-extension', browserId),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder'),
  openBrowserExtensionsPage: browserId => ipcRenderer.invoke('open-browser-extensions-page', browserId),
  copyExtensionsUrl: browserId => ipcRenderer.invoke('copy-extensions-url', browserId),
  launchObs: () => ipcRenderer.invoke('launch-obs'),
  hasObsExecutable: () => ipcRenderer.invoke('has-obs-executable'),
  openUrl: (url, browserId) => ipcRenderer.invoke('open-url', url, browserId),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  exportConnectivityDiagnostic: () => ipcRenderer.invoke('export-connectivity-diagnostic'),
});

if (process.env.UI_AUDIT_MODE === '1' || process.env.BOOSTY_OVERLAY_UI_TEST === '1') {
  contextBridge.exposeInMainWorld('boostyAudit', {
    onApplyState: callback => {
      ipcRenderer.on('audit:apply-state', async (_event, state) => {
        try {
          await callback(state);
          ipcRenderer.send('audit:state-ready', { ok: true, id: state.id });
        } catch (err) {
          ipcRenderer.send('audit:state-ready', { ok: false, id: state.id, error: err?.message || String(err) });
        }
      });
    },
    notifyReady: () => {
      ipcRenderer.send('audit:page-loaded');
    },
  });
}
