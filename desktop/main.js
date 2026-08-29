const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let mainWindow;
let localServer;
let obsSyncTimer;
let lastObsResult = { ok: false, idle: true };
let currentObs = null;
let currentObsConnecting = null;
let currentObsPassword = '';
let sceneCollectionChanging = false;
let lastObsState = { ok: false, connected: false, scenes: [] };

let refreshTimer = null;
let refreshInFlight = false;
let refreshPending = false;

let userMutationQueue = Promise.resolve();

function enqueueUserMutation(task) {
  if (sceneCollectionChanging) {
    return Promise.resolve({ ok: false, paused: true, error: 'Коллекция сцен OBS переключается...' });
  }
  const next = userMutationQueue.catch(() => {}).then(() => task());
  userMutationQueue = next.catch(() => {});
  return next;
}

function scheduleObsRefresh(delay = 60) {
  if (sceneCollectionChanging) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (refreshInFlight) {
      refreshPending = true;
      return;
    }
    refreshInFlight = true;
    try {
      const state = await fetchActualObsState(currentObsPassword);
      lastObsState = state;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('obs-state-changed', state);
      }
    } catch {} finally {
      refreshInFlight = false;
      if (refreshPending) {
        refreshPending = false;
        scheduleObsRefresh(10);
      }
    }
  }, delay);
}

function obsWebSocketConfigPath() {
  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.config', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
  }
  return path.join(app.getPath('appData'), 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
}

function readObsWebSocketConfig() {
  try {
    const file = obsWebSocketConfigPath();
    return { file, config: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return null;
  }
}

function browserCandidates() {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || '';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || '';
    return [
      { id: 'brave', name: 'Brave', command: path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), extensionsUrl: 'brave://extensions/' },
      { id: 'brave', name: 'Brave', command: path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), extensionsUrl: 'brave://extensions/' },
      { id: 'brave', name: 'Brave', command: path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), extensionsUrl: 'brave://extensions/' },
      { id: 'chrome', name: 'Chrome', command: path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'), extensionsUrl: 'chrome://extensions/' },
      { id: 'chrome', name: 'Chrome', command: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), extensionsUrl: 'chrome://extensions/' },
      { id: 'chrome', name: 'Chrome', command: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), extensionsUrl: 'chrome://extensions/' },
      { id: 'edge', name: 'Edge', command: path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), extensionsUrl: 'edge://extensions/' },
      { id: 'edge', name: 'Edge', command: path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), extensionsUrl: 'edge://extensions/' },
      { id: 'yandex', name: 'Yandex', command: path.join(local, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe'), extensionsUrl: 'browser://extensions/' },
      { id: 'firefox', name: 'Firefox', command: path.join(programFiles, 'Mozilla Firefox', 'firefox.exe'), extensionsUrl: 'about:debugging#/runtime/this-firefox' },
      { id: 'firefox', name: 'Firefox', command: path.join(local, 'Mozilla Firefox', 'firefox.exe'), extensionsUrl: 'about:debugging#/runtime/this-firefox' },
    ];
  }
  if (process.platform === 'darwin') {
    return [
      { id: 'brave', name: 'Brave', command: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', extensionsUrl: 'brave://extensions/' },
      { id: 'chrome', name: 'Chrome', command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', extensionsUrl: 'chrome://extensions/' },
      { id: 'chromium', name: 'Chromium', command: '/Applications/Chromium.app/Contents/MacOS/Chromium', extensionsUrl: 'chrome://extensions/' },
      { id: 'firefox', name: 'Firefox', command: '/Applications/Firefox.app/Contents/MacOS/firefox', extensionsUrl: 'about:debugging#/runtime/this-firefox' },
    ];
  }
  return [
    { id: 'brave', name: 'Brave', command: '/usr/bin/brave-browser', extensionsUrl: 'brave://extensions/' },
    { id: 'brave', name: 'Brave', command: '/usr/bin/brave', extensionsUrl: 'brave://extensions/' },
    { id: 'chrome', name: 'Chrome', command: '/usr/bin/google-chrome', extensionsUrl: 'chrome://extensions/' },
    { id: 'chromium', name: 'Chromium', command: '/usr/bin/chromium', extensionsUrl: 'chrome://extensions/' },
    { id: 'chromium', name: 'Chromium', command: '/usr/bin/chromium-browser', extensionsUrl: 'chrome://extensions/' },
    { id: 'firefox', name: 'Firefox', command: '/usr/bin/firefox', extensionsUrl: 'about:debugging#/runtime/this-firefox' },
  ];
}

function installedBrowsers() {
  const seen = new Set();
  return browserCandidates().filter(candidate => {
    if (seen.has(candidate.id) || !fs.existsSync(candidate.command)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function getExtensionDir() {
  if (!app.isPackaged) {
    return path.join(__dirname, '..', 'extension');
  }
  const resourceDir = path.join(process.resourcesPath, 'extension');
  if (fs.existsSync(resourceDir)) return resourceDir;
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'extension');
}

function prepareBrowserExtension(browserId) {
  const browser = installedBrowsers().find(candidate => candidate.id === browserId);
  if (!browser) return { ok: false, error: 'Выбранный браузер не найден' };
  const extensionDir = getExtensionDir();
  clipboard.writeText(browser.extensionsUrl);
  shell.showItemInFolder(path.join(extensionDir, 'manifest.json'));
  return {
    ok: true,
    browser: browser.name,
    managerUrl: browser.extensionsUrl,
    extensionDir,
    firefox: browser.id === 'firefox',
  };
}

function openPreferredBrowser(url, browserId) {
  const browsers = installedBrowsers();
  const browser = browsers.find(candidate => candidate.id === browserId) || browsers[0];
  if (!browser) return shell.openExternal(url).then(() => ({ ok: true, browser: 'системный' }));
  const child = spawn(browser.command, [url], { detached: true, stdio: 'ignore' });
  child.unref();
  return Promise.resolve({ ok: true, browser: browser.name });
}

function isOurOverlayUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === '127.0.0.1' && parsed.port === '17369' && parsed.pathname === '/overlay/';
  } catch {
    return false;
  }
}

async function getConnectedObs(password = '') {
  const localConfig = readObsWebSocketConfig();
  if (localConfig && !localConfig.config.server_enabled) {
    localConfig.config.server_enabled = true;
    fs.writeFileSync(localConfig.file, `${JSON.stringify(localConfig.config, null, 2)}\n`, { mode: 0o600 });
    return { obs: null, restartRequired: true };
  }
  const port = Number(localConfig?.config?.server_port || 4455);
  const localPassword = localConfig?.config?.auth_required ? localConfig.config.server_password : '';
  const effectivePassword = String(password || localPassword || '');

  if (currentObs && currentObsPassword === effectivePassword) {
    return { obs: currentObs, restartRequired: false };
  }

  if (currentObsConnecting) {
    return currentObsConnecting;
  }

  currentObsConnecting = (async () => {
    try {
      if (currentObs) {
        await currentObs.disconnect().catch(() => {});
        currentObs = null;
      }
      const { OBSWebSocket } = require('obs-websocket-js');
      const obs = new OBSWebSocket();

      // Scenes
      obs.on('SceneCreated', () => scheduleObsRefresh(60));
      obs.on('SceneRemoved', () => scheduleObsRefresh(60));
      obs.on('SceneNameChanged', () => scheduleObsRefresh(60));
      obs.on('SceneListChanged', () => scheduleObsRefresh(60));

      // Scene Items
      obs.on('SceneItemCreated', () => scheduleObsRefresh(60));
      obs.on('SceneItemRemoved', () => scheduleObsRefresh(60));
      obs.on('SceneItemEnableStateChanged', () => scheduleObsRefresh(60));

      // Inputs
      obs.on('InputCreated', () => scheduleObsRefresh(60));
      obs.on('InputRemoved', () => scheduleObsRefresh(60));
      obs.on('InputNameChanged', () => scheduleObsRefresh(60));
      obs.on('InputSettingsChanged', () => scheduleObsRefresh(60));

      // Scene Collections
      obs.on('CurrentSceneCollectionChanging', () => {
        sceneCollectionChanging = true;
        clearTimeout(refreshTimer);
      });
      obs.on('CurrentSceneCollectionChanged', () => {
        sceneCollectionChanging = false;
        scheduleObsRefresh(50);
      });

      // Connection
      obs.on('ConnectionClosed', () => {
        if (currentObs === obs) currentObs = null;
        lastObsState = { ok: false, connected: false, scenes: [] };
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('obs-state-changed', lastObsState);
        }
      });

      await obs.connect(`ws://127.0.0.1:${port}`, effectivePassword);
      currentObs = obs;
      currentObsPassword = effectivePassword;
      return { obs, restartRequired: false };
    } catch (err) {
      currentObs = null;
      throw err;
    } finally {
      currentObsConnecting = null;
    }
  })();

  return currentObsConnecting;
}

async function fetchActualObsState(password = '') {
  try {
    const connection = await getConnectedObs(password);
    if (connection.restartRequired) {
      return { ok: false, connected: false, restartRequired: true, scenes: [] };
    }
    const obs = connection.obs;

    const [collectionData, sceneListData, inputListData] = await Promise.all([
      obs.call('GetSceneCollectionList').catch(() => ({ currentSceneCollectionName: '' })),
      obs.call('GetSceneList'),
      obs.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] })),
    ]);

    const currentCollection = collectionData.currentSceneCollectionName || '';
    const inputs = inputListData.inputs || [];

    let ourInput = null;
    for (const input of inputs) {
      const settings = await obs.call('GetInputSettings', { inputUuid: input.inputUuid }).catch(() => null);
      if (settings?.inputSettings?.url && isOurOverlayUrl(settings.inputSettings.url)) {
        ourInput = {
          inputUuid: input.inputUuid,
          inputName: input.inputName,
          url: settings.inputSettings.url,
        };
        break;
      }
    }

    const rawScenes = sceneListData.scenes || [];
    const userScenes = rawScenes.filter(s => s.sceneName !== 'Boosty Chat Overlay');

    const scenesWithStatus = await Promise.all(userScenes.map(async s => {
      let hasChat = false;
      let sceneItemId = null;
      let sceneItemEnabled = true;

      try {
        const items = await obs.call('GetSceneItemList', { sceneUuid: s.sceneUuid });
        for (const item of (items.sceneItems || [])) {
          if (ourInput && item.sourceUuid === ourInput.inputUuid) {
            hasChat = true;
            sceneItemId = item.sceneItemId;
            sceneItemEnabled = item.sceneItemEnabled !== false;
            break;
          }
        }
      } catch {}

      return {
        sceneUuid: s.sceneUuid,
        sceneName: s.sceneName,
        hasChat,
        sceneItemId,
        sceneItemEnabled,
      };
    }));

    return {
      ok: true,
      connected: true,
      currentCollection,
      scenes: scenesWithStatus,
      ourInput,
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      scenes: [],
      error: error?.message || String(error),
    };
  }
}

async function findUniqueInputName(obs) {
  const allInputs = await obs.call('GetInputList').catch(() => ({ inputs: [] }));
  const existingNames = new Set((allInputs.inputs || []).map(i => i.inputName));

  const base = 'Boosty Chat';
  if (!existingNames.has(base)) return base;

  let suffix = 1;
  while (existingNames.has(`${base} (Overlay${suffix === 1 ? '' : ' ' + suffix})`)) {
    suffix++;
  }
  return `${base} (Overlay${suffix === 1 ? '' : ' ' + suffix})`;
}

async function addSceneTarget(password = '', sceneIdentifier = '') {
  return enqueueUserMutation(async () => {
    try {
      const connection = await getConnectedObs(password);
      if (connection.restartRequired) return { ok: false, restartRequired: true };
      const obs = connection.obs;

      const sceneListData = await obs.call('GetSceneList');
      const rawScenes = sceneListData.scenes || [];
      const targetScene = rawScenes.find(s => s.sceneUuid === sceneIdentifier || s.sceneName === sceneIdentifier);
      if (!targetScene) {
        return { ok: false, error: 'Выбранная сцена не найдена в OBS' };
      }

      const inputListData = await obs.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] }));
      let ourInput = null;
      for (const input of (inputListData.inputs || [])) {
        const settings = await obs.call('GetInputSettings', { inputUuid: input.inputUuid }).catch(() => null);
        if (settings?.inputSettings?.url && isOurOverlayUrl(settings.inputSettings.url)) {
          ourInput = input;
          break;
        }
      }

      const inputSettings = {
        url: `http://127.0.0.1:17369/overlay/?v=${app.getVersion()}`,
        width: 900,
        height: 700,
        shutdown: false,
        restart_when_active: false,
      };

      let inputUuid;
      if (ourInput) {
        inputUuid = ourInput.inputUuid;
        await obs.call('SetInputSettings', { inputUuid, inputSettings, overlay: true }).catch(() => {});
        const items = await obs.call('GetSceneItemList', { sceneUuid: targetScene.sceneUuid });
        const exists = (items.sceneItems || []).some(item => item.sourceUuid === inputUuid);
        if (!exists) {
          await obs.call('CreateSceneItem', {
            sceneUuid: targetScene.sceneUuid,
            sourceUuid: inputUuid,
            sceneItemEnabled: true,
          });
        }
      } else {
        const inputName = await findUniqueInputName(obs);
        const created = await obs.call('CreateInput', {
          sceneUuid: targetScene.sceneUuid,
          inputName,
          inputKind: 'browser_source',
          inputSettings,
          sceneItemEnabled: true,
        });
        inputUuid = created.inputUuid;
      }

      scheduleObsRefresh(0);
      return { ok: true, addedScene: targetScene.sceneName, inputUuid };
    } catch (error) {
      scheduleObsRefresh(0);
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

async function removeSceneTarget(password = '', sceneIdentifier = '') {
  return enqueueUserMutation(async () => {
    try {
      const connection = await getConnectedObs(password);
      if (connection.restartRequired) return { ok: false, restartRequired: true };
      const obs = connection.obs;

      const sceneListData = await obs.call('GetSceneList');
      const rawScenes = sceneListData.scenes || [];
      const targetScene = rawScenes.find(s => s.sceneUuid === sceneIdentifier || s.sceneName === sceneIdentifier);
      if (!targetScene) {
        return { ok: true, removedScene: sceneIdentifier };
      }

      const inputListData = await obs.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] }));
      let ourInput = null;
      for (const input of (inputListData.inputs || [])) {
        const settings = await obs.call('GetInputSettings', { inputUuid: input.inputUuid }).catch(() => null);
        if (settings?.inputSettings?.url && isOurOverlayUrl(settings.inputSettings.url)) {
          ourInput = input;
          break;
        }
      }

      const items = await obs.call('GetSceneItemList', { sceneUuid: targetScene.sceneUuid });
      for (const item of (items.sceneItems || [])) {
        if ((ourInput && item.sourceUuid === ourInput.inputUuid) || item.sourceName === 'Boosty Chat' || item.sourceName === 'Boosty Chat Overlay') {
          await obs.call('RemoveSceneItem', {
            sceneUuid: targetScene.sceneUuid,
            sceneItemId: item.sceneItemId,
          });
        }
      }

      scheduleObsRefresh(0);
      return { ok: true, removedScene: targetScene.sceneName };
    } catch (error) {
      scheduleObsRefresh(0);
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

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
  process.env.BOOSTY_OVERLAY_CONFIG = path.join(app.getPath('userData'), 'overlay-settings.json');
  localServer = require('../server.js').server;
  createWindow();
  setTimeout(() => scheduleObsRefresh(100), 500);
  obsSyncTimer = setInterval(() => scheduleObsRefresh(0), 2500);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  clearInterval(obsSyncTimer);
  clearTimeout(refreshTimer);
  localServer?.close();
});

ipcMain.handle('open-url', (_event, url, browserId) => {
  const allowed = [
    'https://boosty.to/',
    'http://127.0.0.1:17369/',
  ];
  if (!allowed.some(prefix => url.startsWith(prefix))) throw new Error('URL is not allowed');
  return openPreferredBrowser(url, browserId);
});

ipcMain.handle('copy-overlay-url', () => {
  clipboard.writeText('http://127.0.0.1:17369/overlay/');
  return true;
});

ipcMain.handle('list-browsers', () => installedBrowsers().map(({ id, name }) => ({ id, name })));
ipcMain.handle('prepare-browser-extension', (_event, browserId) => prepareBrowserExtension(browserId));
ipcMain.handle('list-obs-scenes', (_event, password) => fetchActualObsState(password));
ipcMain.handle('add-obs-scene', (_event, password, sceneIdentifier) => addSceneTarget(password, sceneIdentifier));
ipcMain.handle('remove-obs-scene', (_event, password, sceneIdentifier) => removeSceneTarget(password, sceneIdentifier));
ipcMain.handle('get-obs-status', () => lastObsState);

