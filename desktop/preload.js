const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boostyOverlay', {
  copyOverlayUrl: () => ipcRenderer.invoke('copy-overlay-url'),
  listObsScenes: password => ipcRenderer.invoke('list-obs-scenes', password),
  addObsScene: (password, sceneIdentifier) => ipcRenderer.invoke('add-obs-scene', password, sceneIdentifier),
  removeObsScene: (password, sceneIdentifier) => ipcRenderer.invoke('remove-obs-scene', password, sceneIdentifier),
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
});
