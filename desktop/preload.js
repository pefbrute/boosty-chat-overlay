const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boostyOverlay', {
  copyOverlayUrl: () => ipcRenderer.invoke('copy-overlay-url'),
  listObsScenes: password => ipcRenderer.invoke('list-obs-scenes', password),
  connectObs: (password, sceneName) => ipcRenderer.invoke('connect-obs', password, sceneName),
  getObsStatus: () => ipcRenderer.invoke('get-obs-status'),
  listBrowsers: () => ipcRenderer.invoke('list-browsers'),
  prepareBrowserExtension: browserId => ipcRenderer.invoke('prepare-browser-extension', browserId),
  openUrl: (url, browserId) => ipcRenderer.invoke('open-url', url, browserId),
});
