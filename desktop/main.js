const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let mainWindow;
let localServer;
let obsSyncTimer;
let lastObsResult = { ok: false, idle: true };
let obsQueue = Promise.resolve();
let sceneCollectionChanging = false;

function enqueueObs(task) {
  if (sceneCollectionChanging) {
    return Promise.resolve({ ok: false, paused: true, error: 'Scene collection is changing' });
  }
  obsQueue = obsQueue.then(task, task);
  return obsQueue;
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
      { id: 'chrome', name: 'Chrome', command: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), extensionsUrl: 'chrome://extensions/' },
      { id: 'chrome', name: 'Chrome', command: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), extensionsUrl: 'chrome://extensions/' },
      { id: 'firefox', name: 'Firefox', command: path.join(programFiles, 'Mozilla Firefox', 'firefox.exe'), extensionsUrl: 'about:debugging#/runtime/this-firefox' },
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

function prepareBrowserExtension(browserId) {
  const browser = installedBrowsers().find(candidate => candidate.id === browserId);
  if (!browser) return { ok: false, error: 'Выбранный браузер не найден' };
  const extensionDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'extension')
    : path.join(__dirname, '..', 'extension');
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

function obsTargetFile() {
  return path.join(app.getPath('userData'), 'obs-target.json');
}

function readObsTargetState() {
  try {
    const raw = JSON.parse(fs.readFileSync(obsTargetFile(), 'utf8'));
    let targetScenes = [];
    if (Array.isArray(raw.targetScenes)) {
      targetScenes = raw.targetScenes.filter(item => item && (item.sceneUuid || item.sceneName));
    } else if (raw.sceneName) {
      targetScenes = [{ sceneName: raw.sceneName, sceneUuid: '' }];
    }
    return {
      sceneCollectionName: typeof raw.sceneCollectionName === 'string' ? raw.sceneCollectionName : '',
      targetScenes,
      inputUuid: typeof raw.inputUuid === 'string' ? raw.inputUuid : '',
    };
  } catch {
    return {
      sceneCollectionName: '',
      targetScenes: [],
      inputUuid: '',
    };
  }
}

function writeObsTargetState(state) {
  fs.mkdirSync(path.dirname(obsTargetFile()), { recursive: true });
  fs.writeFileSync(obsTargetFile(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function isOurOverlayUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === '127.0.0.1' && parsed.port === '17369' && parsed.pathname === '/overlay/';
  } catch {
    return false;
  }
}

async function createObsClient(password = '') {
  const { OBSWebSocket } = require('obs-websocket-js');
  const obs = new OBSWebSocket();
  const localConfig = readObsWebSocketConfig();
  if (localConfig && !localConfig.config.server_enabled) {
    localConfig.config.server_enabled = true;
    fs.writeFileSync(localConfig.file, `${JSON.stringify(localConfig.config, null, 2)}\n`, { mode: 0o600 });
    return { obs, restartRequired: true };
  }
  const port = Number(localConfig?.config?.server_port || 4455);
  const localPassword = localConfig?.config?.auth_required ? localConfig.config.server_password : '';

  obs.on('CurrentSceneCollectionChanging', () => {
    sceneCollectionChanging = true;
  });
  obs.on('CurrentSceneCollectionChanged', () => {
    sceneCollectionChanging = false;
  });

  await obs.connect(`ws://127.0.0.1:${port}`, String(password || localPassword || ''));
  return { obs, restartRequired: false };
}

async function findOurBrowserInput(obs, savedInputUuid) {
  const inputList = await obs.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] }));
  const inputs = inputList.inputs || [];

  // 1. Try saved inputUuid hint
  if (savedInputUuid) {
    const candidate = inputs.find(item => item.inputUuid === savedInputUuid);
    if (candidate) {
      const settings = await obs.call('GetInputSettings', { inputUuid: candidate.inputUuid }).catch(() => null);
      if (settings?.inputSettings?.url && isOurOverlayUrl(settings.inputSettings.url)) {
        return candidate;
      }
    }
  }

  // 2. Search for browser source named 'Boosty Chat'
  for (const item of inputs) {
    if (item.inputName === 'Boosty Chat') {
      const settings = await obs.call('GetInputSettings', { inputUuid: item.inputUuid }).catch(() => null);
      if (settings?.inputSettings?.url && isOurOverlayUrl(settings.inputSettings.url)) {
        return item;
      }
    }
  }

  // 3. Search for any browser source matching our URL
  for (const item of inputs) {
    const settings = await obs.call('GetInputSettings', { inputUuid: item.inputUuid }).catch(() => null);
    if (settings?.inputSettings?.url && isOurOverlayUrl(settings.inputSettings.url)) {
      return item;
    }
  }

  return null;
}

async function migrateLegacyProxyScene(obs, targetScenes = []) {
  try {
    const legacySceneName = 'Boosty Chat Overlay';
    const sceneList = await obs.call('GetSceneList');
    const legacyScene = (sceneList.scenes || []).find(s => s.sceneName === legacySceneName);
    if (!legacyScene) return;

    for (const target of targetScenes) {
      try {
        const query = target.sceneUuid ? { sceneUuid: target.sceneUuid } : { sceneName: target.sceneName };
        const items = await obs.call('GetSceneItemList', query);
        for (const item of (items.sceneItems || []).filter(i => i.sourceName === legacySceneName)) {
          await obs.call('RemoveSceneItem', {
            sceneUuid: target.sceneUuid,
            sceneItemId: item.sceneItemId,
          });
        }
      } catch {}
    }

    const legacyItems = await obs.call('GetSceneItemList', { sceneUuid: legacyScene.sceneUuid }).catch(() => ({ sceneItems: [] }));
    const foreignItems = (legacyItems.sceneItems || []).filter(i => i.sourceName !== 'Boosty Chat');
    if (foreignItems.length === 0) {
      await obs.call('RemoveScene', { sceneUuid: legacyScene.sceneUuid }).catch(() => {});
    }
  } catch {}
}

async function listObsScenes(password = '') {
  return enqueueObs(async () => {
    let obs;
    try {
      const connection = await createObsClient(password);
      obs = connection.obs;
      if (connection.restartRequired) return { ok: false, restartRequired: true, scenes: [] };

      const [sceneListData, collectionListData] = await Promise.all([
        obs.call('GetSceneList'),
        obs.call('GetSceneCollectionList').catch(() => ({ currentSceneCollectionName: '' })),
      ]);

      const currentCollection = collectionListData.currentSceneCollectionName || '';
      const state = readObsTargetState();

      const ourInput = await findOurBrowserInput(obs, state.inputUuid);
      const inputUuid = ourInput ? ourInput.inputUuid : '';
      if (inputUuid && inputUuid !== state.inputUuid) {
        state.inputUuid = inputUuid;
        writeObsTargetState(state);
      }

      const rawScenes = sceneListData.scenes || [];
      const userScenes = rawScenes.filter(s => s.sceneName !== 'Boosty Chat Overlay');

      const scenesWithStatus = await Promise.all(userScenes.map(async s => {
        let hasChat = false;
        try {
          const items = await obs.call('GetSceneItemList', { sceneUuid: s.sceneUuid });
          hasChat = (items.sceneItems || []).some(item =>
            (inputUuid && item.sourceUuid === inputUuid) || item.sourceName === 'Boosty Chat'
          );
        } catch {}

        const isTargeted = state.targetScenes.some(t =>
          (t.sceneUuid && t.sceneUuid === s.sceneUuid) ||
          (t.sceneName && t.sceneName === s.sceneName)
        );

        return {
          sceneUuid: s.sceneUuid,
          sceneName: s.sceneName,
          hasChat,
          isTargeted,
        };
      }));

      let updatedTargets = false;
      for (const target of state.targetScenes) {
        const found = userScenes.find(s => s.sceneUuid === target.sceneUuid);
        if (found && found.sceneName !== target.sceneName) {
          target.sceneName = found.sceneName;
          updatedTargets = true;
        }
      }
      if (updatedTargets) writeObsTargetState(state);

      return {
        ok: true,
        currentCollection,
        configuredCollection: state.sceneCollectionName,
        collectionMismatch: Boolean(state.sceneCollectionName && currentCollection && state.sceneCollectionName !== currentCollection),
        scenes: scenesWithStatus,
        targetScenes: state.targetScenes,
      };
    } catch (error) {
      return { ok: false, scenes: [], error: error?.message || String(error) };
    } finally {
      await obs?.disconnect().catch(() => {});
    }
  });
}

async function addSceneTarget(password = '', sceneIdentifier = '') {
  return enqueueObs(async () => {
    let obs;
    try {
      const connection = await createObsClient(password);
      obs = connection.obs;
      if (connection.restartRequired) return { ok: false, restartRequired: true };

      const [sceneListData, collectionListData] = await Promise.all([
        obs.call('GetSceneList'),
        obs.call('GetSceneCollectionList').catch(() => ({ currentSceneCollectionName: '' })),
      ]);

      const currentCollection = collectionListData.currentSceneCollectionName || '';
      const rawScenes = sceneListData.scenes || [];
      const targetScene = rawScenes.find(s => s.sceneUuid === sceneIdentifier || s.sceneName === sceneIdentifier);
      if (!targetScene) {
        return { ok: false, error: 'Выбранная сцена не найдена в OBS' };
      }

      const state = readObsTargetState();
      state.sceneCollectionName = currentCollection;

      if (!state.targetScenes.some(t => t.sceneUuid === targetScene.sceneUuid)) {
        state.targetScenes.push({
          sceneUuid: targetScene.sceneUuid,
          sceneName: targetScene.sceneName,
        });
        writeObsTargetState(state);
      }

      let ourInput = await findOurBrowserInput(obs, state.inputUuid);
      const inputSettings = {
        url: `http://127.0.0.1:17369/overlay/?v=${app.getVersion()}`,
        width: 900,
        height: 700,
        shutdown: false,
        restart_when_active: false,
      };

      if (!ourInput) {
        const created = await obs.call('CreateInput', {
          sceneUuid: targetScene.sceneUuid,
          inputName: 'Boosty Chat',
          inputKind: 'browser_source',
          inputSettings,
          sceneItemEnabled: true,
        });
        state.inputUuid = created.inputUuid || '';
        writeObsTargetState(state);
      } else {
        state.inputUuid = ourInput.inputUuid;
        writeObsTargetState(state);

        await obs.call('SetInputSettings', {
          inputUuid: ourInput.inputUuid,
          inputSettings,
          overlay: true,
        }).catch(() => {});

        const items = await obs.call('GetSceneItemList', { sceneUuid: targetScene.sceneUuid });
        const exists = (items.sceneItems || []).some(item =>
          item.sourceUuid === ourInput.inputUuid || item.sourceName === ourInput.inputName
        );
        if (!exists) {
          await obs.call('CreateSceneItem', {
            sceneUuid: targetScene.sceneUuid,
            sourceUuid: ourInput.inputUuid,
            sceneItemEnabled: true,
          });
        }
      }

      await migrateLegacyProxyScene(obs, state.targetScenes);

      lastObsResult = {
        ok: true,
        addedScene: targetScene.sceneName,
        targetScenes: state.targetScenes,
      };
      return lastObsResult;
    } catch (error) {
      lastObsResult = { ok: false, error: error?.message || String(error) };
      return lastObsResult;
    } finally {
      await obs?.disconnect().catch(() => {});
    }
  });
}

async function removeSceneTarget(password = '', sceneIdentifier = '') {
  return enqueueObs(async () => {
    const state = readObsTargetState();
    state.targetScenes = state.targetScenes.filter(t =>
      t.sceneUuid !== sceneIdentifier && t.sceneName !== sceneIdentifier
    );
    writeObsTargetState(state);

    let obs;
    try {
      const connection = await createObsClient(password);
      obs = connection.obs;
      if (connection.restartRequired) return { ok: false, restartRequired: true };

      const sceneListData = await obs.call('GetSceneList');
      const rawScenes = sceneListData.scenes || [];
      const targetScene = rawScenes.find(s => s.sceneUuid === sceneIdentifier || s.sceneName === sceneIdentifier);
      if (!targetScene) {
        return { ok: true, removedScene: sceneIdentifier, targetScenes: state.targetScenes };
      }

      const ourInput = await findOurBrowserInput(obs, state.inputUuid);
      const items = await obs.call('GetSceneItemList', { sceneUuid: targetScene.sceneUuid });
      for (const item of (items.sceneItems || [])) {
        if ((ourInput && item.sourceUuid === ourInput.inputUuid) || item.sourceName === 'Boosty Chat' || item.sourceName === 'Boosty Chat Overlay') {
          await obs.call('RemoveSceneItem', {
            sceneUuid: targetScene.sceneUuid,
            sceneItemId: item.sceneItemId,
          });
        }
      }

      lastObsResult = {
        ok: true,
        removedScene: targetScene.sceneName,
        targetScenes: state.targetScenes,
      };
      return lastObsResult;
    } catch (error) {
      lastObsResult = { ok: false, error: error?.message || String(error) };
      return lastObsResult;
    } finally {
      await obs?.disconnect().catch(() => {});
    }
  });
}

async function syncObsTargets(password = '') {
  if (sceneCollectionChanging) return lastObsResult;
  return enqueueObs(async () => {
    const state = readObsTargetState();
    if (!state.targetScenes || state.targetScenes.length === 0) {
      lastObsResult = { ok: true, idle: true, targetScenes: [] };
      return lastObsResult;
    }

    let obs;
    try {
      const connection = await createObsClient(password);
      obs = connection.obs;
      if (connection.restartRequired) {
        lastObsResult = { ok: false, restartRequired: true };
        return lastObsResult;
      }

      const [sceneListData, collectionListData] = await Promise.all([
        obs.call('GetSceneList'),
        obs.call('GetSceneCollectionList').catch(() => ({ currentSceneCollectionName: '' })),
      ]);

      const currentCollection = collectionListData.currentSceneCollectionName || '';
      if (state.sceneCollectionName && currentCollection && state.sceneCollectionName !== currentCollection) {
        lastObsResult = {
          ok: false,
          collectionMismatch: true,
          currentCollection,
          configuredCollection: state.sceneCollectionName,
        };
        return lastObsResult;
      }

      const rawScenes = sceneListData.scenes || [];
      const ourInput = await findOurBrowserInput(obs, state.inputUuid);
      if (ourInput && ourInput.inputUuid !== state.inputUuid) {
        state.inputUuid = ourInput.inputUuid;
        writeObsTargetState(state);
      }

      for (const target of state.targetScenes) {
        const actualScene = rawScenes.find(s =>
          (target.sceneUuid && s.sceneUuid === target.sceneUuid) ||
          (target.sceneName && s.sceneName === target.sceneName)
        );
        if (!actualScene) continue;

        if (actualScene.sceneName !== target.sceneName) {
          target.sceneName = actualScene.sceneName;
          writeObsTargetState(state);
        }

        if (ourInput) {
          const items = await obs.call('GetSceneItemList', { sceneUuid: actualScene.sceneUuid });
          const hasItem = (items.sceneItems || []).some(item =>
            item.sourceUuid === ourInput.inputUuid || item.sourceName === ourInput.inputName
          );
          if (!hasItem) {
            await obs.call('CreateSceneItem', {
              sceneUuid: actualScene.sceneUuid,
              sourceUuid: ourInput.inputUuid,
              sceneItemEnabled: true,
            });
          }
        }
      }

      await migrateLegacyProxyScene(obs, state.targetScenes);

      lastObsResult = {
        ok: true,
        targetScenes: state.targetScenes,
      };
      return lastObsResult;
    } catch (error) {
      lastObsResult = { ok: false, unavailable: true, error: error?.message || String(error) };
      return lastObsResult;
    } finally {
      await obs?.disconnect().catch(() => {});
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
  setTimeout(() => syncObsTargets(), 1500);
  obsSyncTimer = setInterval(() => syncObsTargets(), 10_000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  clearInterval(obsSyncTimer);
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
ipcMain.handle('list-obs-scenes', (_event, password) => listObsScenes(password));
ipcMain.handle('add-obs-scene', (_event, password, sceneIdentifier) => addSceneTarget(password, sceneIdentifier));
ipcMain.handle('remove-obs-scene', (_event, password, sceneIdentifier) => removeSceneTarget(password, sceneIdentifier));
ipcMain.handle('get-obs-status', () => lastObsResult);

