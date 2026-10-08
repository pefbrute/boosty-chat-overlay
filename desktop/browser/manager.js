const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  deployPersistentExtension,
  isTransientMountPath,
  readExtensionManifest,
} = require('./extension-deployer.js');

const {
  SUPPORTED_BROWSERS,
  getBrowserMetadata,
  getExtensionsUrlForBrowser,
  getCleanExtensionsUrlForBrowser,
} = require('./metadata.js');

function extractExecFromDesktopFile(filePath, fsModule) {
  try {
    if (!fsModule || typeof fsModule.existsSync !== 'function' || !fsModule.existsSync(filePath)) {
      return null;
    }
    if (typeof fsModule.readFileSync !== 'function') return null;
    const content = fsModule.readFileSync(filePath, 'utf8');
    const match = content.match(/^Exec=([^\n\r]+)/m);
    if (!match) return null;
    let cmd = match[1].trim();
    cmd = cmd.replace(/%[a-zA-Z]/g, '').trim();
    const parts = cmd.split(/\s+/);
    const exe = parts[0];
    if (exe && fsModule.existsSync(exe)) {
      return exe;
    }
  } catch {}
  return null;
}

/**
 * Creates Browser Manager managing installed browser discovery,
 * opening URLs, and preparing the Boosty browser extension.
 *
 * @param {object} [options]
 * @param {string} [options.platform]
 * @param {object} [options.env]
 * @param {object} [options.fsModule]
 * @param {Function} [options.spawnFn]
 * @param {object} [options.shellModule]
 * @param {object} [options.clipboardModule]
 * @param {object} [options.appModule]
 * @param {string} [options.resourcesPath]
 * @param {string} [options.extensionDir]
 * @param {string} [options.userDataDir]
 * @param {string} [options.persistentExtensionDir]
 */
function createBrowserManager(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fsMod = options.fsModule || fs;
  const spawnFunc = options.spawnFn || spawn;

  const shellMod = options.shellModule || (() => {
    try {
      return require('electron').shell;
    } catch {
      return null;
    }
  })();

  const clipboardMod = options.clipboardModule || (() => {
    try {
      return require('electron').clipboard;
    } catch {
      return null;
    }
  })();

  const appMod = options.appModule || (() => {
    try {
      return require('electron').app;
    } catch {
      return null;
    }
  })();

  function getBrowserCandidates() {
    const candidates = [];
    const home = env.HOME || env.USERPROFILE || '';

    // Order of priority: Yandex as first-class, followed by Brave, Chrome, Edge, Chromium
    const browserKeys = ['yandex', 'brave', 'chrome', 'edge', 'chromium'];

    if (platform === 'win32') {
      const pathWin = path.win32 || path;
      const local = env.LOCALAPPDATA || '';
      const programFiles = env.PROGRAMFILES || '';
      const programFilesX86 = env['PROGRAMFILES(X86)'] || '';
      const envMap = {
        LOCALAPPDATA: local,
        PROGRAMFILES: programFiles,
        'PROGRAMFILES(X86)': programFilesX86,
      };

      for (const key of browserKeys) {
        const meta = SUPPORTED_BROWSERS[key];
        if (!meta) continue;
        for (const winEntry of meta.winCandidates || []) {
          const base = envMap[winEntry.envKey];
          if (base) {
            candidates.push({
              id: meta.id,
              name: meta.name,
              command: pathWin.join(base, ...winEntry.subpath),
              extensionsUrl: meta.extensionsUrl,
            });
          }
        }
      }
      return candidates;
    }

    if (platform === 'darwin') {
      for (const key of browserKeys) {
        const meta = SUPPORTED_BROWSERS[key];
        if (!meta) continue;
        for (const appPath of meta.darwinCandidates || []) {
          candidates.push({
            id: meta.id,
            name: meta.name,
            command: appPath,
            extensionsUrl: meta.extensionsUrl,
          });
        }
      }
      return candidates;
    }

    // Linux & other Unix platforms
    for (const key of browserKeys) {
      const meta = SUPPORTED_BROWSERS[key];
      if (!meta) continue;

      // 1. Check known binary commands
      for (const cmd of meta.linuxCandidates || []) {
        candidates.push({
          id: meta.id,
          name: meta.name,
          command: cmd,
          extensionsUrl: meta.extensionsUrl,
        });
      }

      // 2. Check desktop file entries for custom installs / flatpak / package managers
      const desktopCandidates = [...(meta.linuxDesktopEntries || [])];
      if (home) {
        desktopCandidates.push(path.join(home, '.local', 'share', 'applications', `${meta.id}-browser.desktop`));
        desktopCandidates.push(path.join(home, '.local', 'share', 'applications', `${meta.id}.desktop`));
      }

      for (const desktopPath of desktopCandidates) {
        const resolvedExe = extractExecFromDesktopFile(desktopPath, fsMod);
        if (resolvedExe) {
          candidates.push({
            id: meta.id,
            name: meta.name,
            command: resolvedExe,
            extensionsUrl: meta.extensionsUrl,
          });
        }
      }
    }

    return candidates;
  }

  function getInstalledBrowsers() {
    const seen = new Set();
    return getBrowserCandidates().filter(candidate => {
      if (seen.has(candidate.id) || !fsMod.existsSync(candidate.command)) return false;
      seen.add(candidate.id);
      return true;
    });
  }

  function getUserDataDir() {
    if (options.userDataDir) return options.userDataDir;
    if (appMod && typeof appMod.getPath === 'function') {
      try {
        return appMod.getPath('userData');
      } catch {}
    }
    const home = env.HOME || env.USERPROFILE || '';
    if (platform === 'win32') {
      return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'boosty-chat-overlay');
    }
    if (platform === 'darwin') {
      return path.join(home, 'Library', 'Application Support', 'boosty-chat-overlay');
    }
    return path.join(home, '.config', 'boosty-chat-overlay');
  }

  function getBundledExtensionDir() {
    const isPackaged = appMod ? appMod.isPackaged : false;
    if (!isPackaged) {
      return path.join(__dirname, '..', '..', 'extension');
    }
    const resPath = options.resourcesPath || (process.resourcesPath || '');
    const resourceDir = path.join(resPath, 'extension');
    if (fsMod.existsSync(resourceDir)) return resourceDir;
    return path.join(resPath, 'app.asar.unpacked', 'extension');
  }

  function getPersistentExtensionDir() {
    if (options.persistentExtensionDir) return options.persistentExtensionDir;
    return path.join(getUserDataDir(), 'extension');
  }

  function deployExtension(force = false) {
    const bundledDir = getBundledExtensionDir();
    const persistentDir = getPersistentExtensionDir();
    return deployPersistentExtension({
      bundledDir,
      persistentDir,
      force,
      fsModule: fsMod,
    });
  }

  function getExtensionDir() {
    if (options.extensionDir) {
      return options.extensionDir;
    }
    const isPackaged = appMod ? appMod.isPackaged : false;
    if (!isPackaged) {
      return getBundledExtensionDir();
    }
    // In packaged mode, ensure persistent extension is deployed and return persistent path
    try {
      deployExtension(false);
    } catch (err) {
      console.error('[BrowserManager] Auto-deploy extension error:', err?.message || err);
    }
    return getPersistentExtensionDir();
  }

  function openPreferredBrowser(url, browserId) {
    const browsers = getInstalledBrowsers();
    const browser = browsers.find(candidate => candidate.id === browserId) || browsers[0];
    if (!browser) {
      console.log(`[openPreferredBrowser] No specific browser found, falling back to shell.openExternal("${url}")`);
      if (shellMod && typeof shellMod.openExternal === 'function') {
        return shellMod.openExternal(url).then(() => ({ ok: true, browser: 'системный' }));
      }
      return Promise.resolve({ ok: true, browser: 'системный' });
    }

    const isChromium = ['chrome', 'brave', 'edge', 'yandex', 'chromium'].includes(browser.id);
    const isInternalUrl =
      url.includes('://extensions') ||
      url.startsWith('chrome://') ||
      url.startsWith('brave://') ||
      url.startsWith('edge://') ||
      url.startsWith('browser://') ||
      url.startsWith('about:');

    const args = (isChromium && isInternalUrl)
      ? ['--new-window', url]
      : [url];

    console.log(`[openPreferredBrowser] browserId=${browser.id}, exe="${browser.command}", args=${JSON.stringify(args)}, url="${url}"`);

    const child = spawnFunc(browser.command, args, { detached: true, stdio: 'ignore' });
    if (child && typeof child.unref === 'function') {
      child.unref();
    }
    return Promise.resolve({ ok: true, browser: browser.name });
  }

  return {
    getBrowserCandidates,
    installedBrowsers: getInstalledBrowsers,

    listBrowsers() {
      return getInstalledBrowsers().map(({ id, name }) => ({ id, name }));
    },

    getExtensionDir,
    getBundledExtensionDir,
    getPersistentExtensionDir,
    deployExtension,
    isTransientPath: isTransientMountPath,

    copyExtensionPath() {
      const extensionDir = getExtensionDir();
      if (clipboardMod && typeof clipboardMod.writeText === 'function') {
        clipboardMod.writeText(extensionDir);
      }
      return { ok: true, extensionDir };
    },

    prepareBrowserExtension(browserId) {
      const browser = getInstalledBrowsers().find(candidate => candidate.id === browserId);
      if (!browser) return { ok: false, error: 'Выбранный браузер не найден' };

      const extensionDir = getExtensionDir();
      if (clipboardMod && typeof clipboardMod.writeText === 'function') {
        clipboardMod.writeText(browser.extensionsUrl);
      }

      console.log(`[prepareBrowserExtension] browserId=${browser.id}, exe="${browser.command}", managerUrl="${browser.extensionsUrl}", extensionDir="${extensionDir}"`);

      openPreferredBrowser(browser.extensionsUrl, browser.id).catch(err => {
        console.error(`[prepareBrowserExtension] failed to open browser:`, err);
      });

      if (shellMod && typeof shellMod.showItemInFolder === 'function') {
        shellMod.showItemInFolder(path.join(extensionDir, 'manifest.json'));
      }

      return {
        ok: true,
        browser: browser.name,
        managerUrl: browser.extensionsUrl,
        extensionDir,
        firefox: browser.id === 'firefox',
      };
    },

    openExtensionFolder() {
      const extensionDir = getExtensionDir();
      if (shellMod && typeof shellMod.showItemInFolder === 'function') {
        try {
          shellMod.showItemInFolder(extensionDir);
        } catch {
          if (typeof shellMod.openPath === 'function') {
            shellMod.openPath(extensionDir);
          }
        }
      } else if (shellMod && typeof shellMod.openPath === 'function') {
        shellMod.openPath(extensionDir);
      }
      return { ok: true, extensionDir };
    },

    openBrowserExtensionsPage(browserId) {
      const browser = getInstalledBrowsers().find(candidate => candidate.id === browserId);
      if (!browser) return { ok: false, error: 'Выбранный браузер не найден' };

      const meta = getBrowserMetadata(browserId);
      const cleanUrl = meta?.extensionsUrlDisplay || getCleanExtensionsUrlForBrowser(browserId);

      if (clipboardMod && typeof clipboardMod.writeText === 'function') {
        clipboardMod.writeText(cleanUrl);
      }

      console.log(`[openBrowserExtensionsPage] browserId=${browser.id}, exe="${browser.command}", managerUrl="${browser.extensionsUrl}"`);

      let launchError = null;
      try {
        openPreferredBrowser(browser.extensionsUrl, browser.id).catch(err => {
          console.error(`[openBrowserExtensionsPage] failed to open extensions page:`, err);
        });
      } catch (err) {
        launchError = err?.message || String(err);
      }

      if (launchError) {
        return { ok: false, error: launchError, browser: browser.name, managerUrl: cleanUrl };
      }

      return {
        ok: true,
        browser: browser.name,
        managerUrl: cleanUrl,
        notice: 'Браузер запущен. Если страница расширений не открылась сама, вставьте скопированный адрес в адресную строку.',
      };
    },

    copyExtensionsUrl(browserId) {
      const meta = getBrowserMetadata(browserId);
      const url = meta?.extensionsUrlDisplay || getCleanExtensionsUrlForBrowser(browserId);
      if (clipboardMod && typeof clipboardMod.writeText === 'function') {
        clipboardMod.writeText(url);
      }
      return { ok: true, url };
    },

    openPreferredBrowser,
  };
}

module.exports = {
  createBrowserManager,
};
