const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  deployPersistentExtension,
  isTransientMountPath,
  readExtensionManifest,
} = require('./extension-deployer.js');

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
    if (platform === 'win32') {
      const pathWin = path.win32 || path;
      const local = env.LOCALAPPDATA || '';
      const programFiles = env.PROGRAMFILES || '';
      const programFilesX86 = env['PROGRAMFILES(X86)'] || '';
      return [
        { id: 'brave', name: 'Brave', command: pathWin.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), extensionsUrl: 'brave://extensions/' },
        { id: 'brave', name: 'Brave', command: pathWin.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), extensionsUrl: 'brave://extensions/' },
        { id: 'brave', name: 'Brave', command: pathWin.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), extensionsUrl: 'brave://extensions/' },
        { id: 'chrome', name: 'Chrome', command: pathWin.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'), extensionsUrl: 'chrome://extensions/' },
        { id: 'chrome', name: 'Chrome', command: pathWin.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), extensionsUrl: 'chrome://extensions/' },
        { id: 'chrome', name: 'Chrome', command: pathWin.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), extensionsUrl: 'chrome://extensions/' },
        { id: 'edge', name: 'Edge', command: pathWin.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), extensionsUrl: 'edge://extensions/' },
        { id: 'edge', name: 'Edge', command: pathWin.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), extensionsUrl: 'edge://extensions/' },
        { id: 'yandex', name: 'Yandex', command: pathWin.join(local, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe'), extensionsUrl: 'browser://extensions/' },
      ];
    }

    if (platform === 'darwin') {
      return [
        { id: 'brave', name: 'Brave', command: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', extensionsUrl: 'brave://extensions/' },
        { id: 'chrome', name: 'Chrome', command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', extensionsUrl: 'chrome://extensions/' },
        { id: 'chromium', name: 'Chromium', command: '/Applications/Chromium.app/Contents/MacOS/Chromium', extensionsUrl: 'chrome://extensions/' },
      ];
    }

    return [
      { id: 'brave', name: 'Brave', command: '/usr/bin/brave-browser', extensionsUrl: 'brave://extensions/' },
      { id: 'brave', name: 'Brave', command: '/usr/bin/brave', extensionsUrl: 'brave://extensions/' },
      { id: 'chrome', name: 'Chrome', command: '/usr/bin/google-chrome', extensionsUrl: 'chrome://extensions/' },
      { id: 'chromium', name: 'Chromium', command: '/usr/bin/chromium', extensionsUrl: 'chrome://extensions/' },
      { id: 'chromium', name: 'Chromium', command: '/usr/bin/chromium-browser', extensionsUrl: 'chrome://extensions/' },
    ];
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
      if (shellMod && typeof shellMod.openPath === 'function') {
        shellMod.openPath(extensionDir);
      }
      return { ok: true, extensionDir };
    },

    openBrowserExtensionsPage(browserId) {
      const browser = getInstalledBrowsers().find(candidate => candidate.id === browserId);
      if (!browser) return { ok: false, error: 'Выбранный браузер не найден' };

      if (clipboardMod && typeof clipboardMod.writeText === 'function') {
        clipboardMod.writeText(browser.extensionsUrl);
      }

      console.log(`[openBrowserExtensionsPage] browserId=${browser.id}, exe="${browser.command}", managerUrl="${browser.extensionsUrl}"`);

      openPreferredBrowser(browser.extensionsUrl, browser.id).catch(err => {
        console.error(`[openBrowserExtensionsPage] failed to open extensions page:`, err);
      });

      return { ok: true, browser: browser.name, managerUrl: browser.extensionsUrl };
    },

    copyExtensionsUrl(browserId) {
      const browser = getInstalledBrowsers().find(candidate => candidate.id === browserId);
      const url = browser?.extensionsUrl || 'chrome://extensions/';
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
