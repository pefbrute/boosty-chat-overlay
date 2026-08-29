const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..', '..');

ipcMain.handle('list-browsers', () => [{ id: 'chrome', name: 'Chrome' }]);
ipcMain.handle('list-obs-scenes', () => ({
  ok: true,
  connected: true,
  scenes: [
    { sceneUuid: 'uuid-1', sceneName: 'Gaming', hasChat: true },
    { sceneUuid: 'uuid-2', sceneName: 'Just Chatting', hasChat: false },
    { sceneUuid: 'uuid-3', sceneName: 'BRB', hasChat: false },
  ]
}));
ipcMain.handle('get-obs-status', () => ({ ok: true, connected: true, scenes: [] }));
ipcMain.handle('copy-overlay-url', () => true);
ipcMain.handle('has-obs-executable', () => true);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 940,
    height: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(ROOT_DIR, 'desktop', 'preload.js'),
    }
  });

  await win.loadFile(path.join(ROOT_DIR, 'desktop', 'index.html'));
  await new Promise(r => setTimeout(r, 600));

  const results = await win.webContents.executeJavaScript(`
    new Promise(async (resolve) => {
      const sampleObsState = {
        ok: true,
        connected: true,
        scenes: [
          { sceneUuid: 'uuid-1', sceneName: 'Gaming', hasChat: true },
          { sceneUuid: 'uuid-2', sceneName: 'Just Chatting', hasChat: false },
          { sceneUuid: 'uuid-3', sceneName: 'BRB', hasChat: false },
        ]
      };

      window.fetch = async (url) => ({
        json: async () => ({
          ok: true,
          appVersion: '0.4.0',
          extensionVersion: '0.4.0',
          isOutdated: false,
          extensionConnected: true,
          boostyConnected: true,
          receivedMessages: 42,
        })
      });

      // Warm-up initial render
      await refreshStatus();
      renderObsUi(sampleObsState);

      // Now attach observer to measure purely STEADY-STATE IDLE
      let addedNodes = 0;
      let removedNodes = 0;
      let attributeMutations = 0;
      let characterDataMutations = 0;
      let totalRecords = 0;

      const observer = new MutationObserver(records => {
        totalRecords += records.length;
        for (const rec of records) {
          if (rec.type === 'childList') {
            addedNodes += rec.addedNodes.length;
            removedNodes += rec.removedNodes.length;
          } else if (rec.type === 'attributes') {
            attributeMutations++;
          } else if (rec.type === 'characterData') {
            characterDataMutations++;
          }
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      // Simulate 60 seconds of idle steady polling (40 refreshStatus + 24 renderObsUi calls with unchanged state)
      for (let i = 0; i < 40; i++) {
        await refreshStatus();
      }
      for (let i = 0; i < 24; i++) {
        renderObsUi(sampleObsState);
      }

      setTimeout(() => {
        resolve({
          simulatedDurationSec: 60,
          refreshStatusCycles: 40,
          obsRenderCycles: 24,
          totalMutationRecords: totalRecords,
          addedNodes,
          removedNodes,
          attributeMutations,
          characterDataMutations,
          domMutationsPerMinute: totalRecords,
          domMutationsPerHour: totalRecords * 60,
        });
      }, 50);
    });
  `);

  console.log('=== STEADY-STATE IDLE DOM MUTATIONS (60s) ===');
  console.log(JSON.stringify(results, null, 2));

  app.quit();
});
