const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let mainWindow;
let localServer;
let obsSyncTimer;
let obsSyncInProgress = false;
let lastObsResult = { ok: false, idle: true };

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

function readObsTarget() {
  try {
    return JSON.parse(fs.readFileSync(obsTargetFile(), 'utf8')).sceneName || '';
  } catch {
    return '';
  }
}

function writeObsTarget(sceneName) {
  fs.writeFileSync(obsTargetFile(), `${JSON.stringify({ sceneName }, null, 2)}\n`, { mode: 0o600 });
}

async function connectObsClient(password = '') {
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
  await obs.connect(`ws://127.0.0.1:${port}`, String(password || localPassword || ''));
  return { obs, restartRequired: false };
}

async function listObsScenes(password = '') {
  let obs;
  try {
    const connection = await connectObsClient(password);
    obs = connection.obs;
    if (connection.restartRequired) return { ok: false, restartRequired: true, scenes: [] };
    const result = await obs.call('GetSceneList');
    const scenes = result.scenes
      .map(scene => scene.sceneName)
      .filter(sceneName => sceneName !== 'Boosty Chat Overlay');
    const storedTarget = readObsTarget();
    return {
      ok: true,
      scenes,
      selectedScene: scenes.includes(storedTarget) ? storedTarget : '',
    };
  } catch (error) {
    return { ok: false, scenes: [], error: error?.message || String(error) };
  } finally {
    await obs?.disconnect().catch(() => {});
  }
}

async function ensureObsOverlay(password = '', requestedSceneName = '') {
  if (obsSyncInProgress) return lastObsResult;
  obsSyncInProgress = true;
  let obs;
  try {
    const connection = await connectObsClient(password);
    obs = connection.obs;
    if (connection.restartRequired) {
      lastObsResult = { ok: false, restartRequired: true };
      return lastObsResult;
    }
    const scenes = await obs.call('GetSceneList');
    const overlaySceneName = 'Boosty Chat Overlay';
    const storedTarget = readObsTarget();
    const targetSceneName = requestedSceneName || storedTarget;
    if (!targetSceneName) {
      lastObsResult = { ok: false, needsSceneSelection: true };
      return lastObsResult;
    }
    if (targetSceneName === overlaySceneName || !scenes.scenes.some(scene => scene.sceneName === targetSceneName)) {
      lastObsResult = { ok: false, needsSceneSelection: true, error: 'Выбранная сцена больше не существует' };
      return lastObsResult;
    }
    writeObsTarget(targetSceneName);

    if (!scenes.scenes.some(scene => scene.sceneName === overlaySceneName)) {
      await obs.call('CreateScene', { sceneName: overlaySceneName });
    }

    const inputName = 'Boosty Chat';
    const inputSettings = {
      url: `http://127.0.0.1:17369/overlay/?v=${app.getVersion()}`,
      width: 900,
      height: 700,
      shutdown: false,
      restart_when_active: false,
    };
    const inputs = await obs.call('GetInputList');
    const existing = inputs.inputs.find(input => input.inputName === inputName);
    if (existing) {
      await obs.call('SetInputSettings', { inputName, inputSettings, overlay: true });
      const overlayItems = await obs.call('GetSceneItemList', { sceneName: overlaySceneName });
      if (!overlayItems.sceneItems.some(item => item.sourceName === inputName)) {
        await obs.call('CreateSceneItem', { sceneName: overlaySceneName, sourceName: inputName, sceneItemEnabled: true });
      }
    } else {
      await obs.call('CreateInput', {
        sceneName: overlaySceneName,
        inputName,
        inputKind: 'browser_source',
        inputSettings,
        sceneItemEnabled: true,
      });
    }

    const targetItems = await obs.call('GetSceneItemList', { sceneName: targetSceneName });
    if (!targetItems.sceneItems.some(item => item.sourceName === overlaySceneName)) {
      await obs.call('CreateSceneItem', {
        sceneName: targetSceneName,
        sourceName: overlaySceneName,
        sceneItemEnabled: true,
      });
    }
    for (const item of targetItems.sceneItems.filter(item => item.sourceName === inputName)) {
      await obs.call('RemoveSceneItem', { sceneName: targetSceneName, sceneItemId: item.sceneItemId });
    }
    for (const scene of scenes.scenes) {
      if (scene.sceneName === targetSceneName || scene.sceneName === overlaySceneName) continue;
      const items = await obs.call('GetSceneItemList', { sceneName: scene.sceneName });
      for (const item of items.sceneItems.filter(item =>
        item.sourceName === overlaySceneName || item.sourceName === inputName)) {
        await obs.call('RemoveSceneItem', { sceneName: scene.sceneName, sceneItemId: item.sceneItemId });
      }
    }
    lastObsResult = {
      ok: true,
      sceneName: overlaySceneName,
      addedToScene: targetSceneName,
      existed: Boolean(existing),
      automatic: !requestedSceneName,
    };
    return lastObsResult;
  } catch (error) {
    lastObsResult = { ok: false, unavailable: true, error: error?.message || String(error) };
    return lastObsResult;
  } finally {
    obsSyncInProgress = false;
    await obs?.disconnect().catch(() => {});
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 680,
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
  setTimeout(() => ensureObsOverlay(), 1500);
  obsSyncTimer = setInterval(() => ensureObsOverlay(), 10_000);
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
ipcMain.handle('connect-obs', (_event, password, sceneName) => ensureObsOverlay(password, sceneName));
ipcMain.handle('get-obs-status', () => lastObsResult);
