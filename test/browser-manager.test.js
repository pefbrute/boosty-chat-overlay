const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBrowserManager } = require('../desktop/browser/manager.js');

test('getBrowserCandidates returns candidates per platform', () => {
  const linuxMgr = createBrowserManager({ platform: 'linux' });
  const linuxCandidates = linuxMgr.getBrowserCandidates();
  assert.ok(linuxCandidates.some(c => c.id === 'brave' && c.command.includes('brave')));
  assert.ok(linuxCandidates.some(c => c.id === 'chrome' && c.command.includes('google-chrome')));

  const winMgr = createBrowserManager({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\User\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files' },
  });
  const winCandidates = winMgr.getBrowserCandidates();
  assert.ok(winCandidates.some(c => c.id === 'brave' && c.command.includes('brave.exe')));
  assert.ok(winCandidates.some(c => c.id === 'edge' && c.command.includes('msedge.exe')));
});

test('installedBrowsers filters by file existence and deduplicates', () => {
  const fakeFs = {
    existsSync(p) {
      return p === '/usr/bin/brave-browser' || p === '/usr/bin/google-chrome';
    },
  };

  const mgr = createBrowserManager({
    platform: 'linux',
    fsModule: fakeFs,
  });

  const installed = mgr.installedBrowsers();
  assert.equal(installed.length, 2);
  assert.equal(installed[0].id, 'brave');
  assert.equal(installed[1].id, 'chrome');

  const list = mgr.listBrowsers();
  assert.deepEqual(list, [
    { id: 'brave', name: 'Brave' },
    { id: 'chrome', name: 'Chrome' },
  ]);
});

test('getExtensionDir handles packaged and unpackaged modes with persistent path', () => {
  const devMgr = createBrowserManager({
    appModule: { isPackaged: false },
  });
  assert.equal(devMgr.getExtensionDir(), path.resolve(__dirname, '..', 'extension'));
  assert.equal(devMgr.getBundledExtensionDir(), path.resolve(__dirname, '..', 'extension'));

  const fakeFs = {
    existsSync(p) {
      return p === '/opt/app/resources/extension';
    },
    mkdirSync() {},
    readdirSync() { return []; },
  };
  const prodMgr = createBrowserManager({
    appModule: { isPackaged: true },
    resourcesPath: '/opt/app/resources',
    userDataDir: '/home/tester/.config/boosty-chat-overlay',
    fsModule: fakeFs,
  });
  assert.equal(prodMgr.getBundledExtensionDir(), '/opt/app/resources/extension');
  assert.equal(prodMgr.getPersistentExtensionDir(), '/home/tester/.config/boosty-chat-overlay/extension');
  assert.equal(prodMgr.getExtensionDir(), '/home/tester/.config/boosty-chat-overlay/extension');
});

test('prepareBrowserExtension and copyExtensionsUrl', () => {
  let clipboardText = '';
  let shownPath = '';

  const fakeClipboard = {
    writeText(text) {
      clipboardText = text;
    },
  };
  const fakeShell = {
    showItemInFolder(p) {
      shownPath = p;
    },
  };
  const fakeFs = {
    existsSync(p) {
      return p === '/usr/bin/brave-browser';
    },
  };

  let spawned = null;
  const fakeSpawn = (cmd, args, opts) => {
    spawned = { cmd, args, opts };
    return { unref() {} };
  };

  const mgr = createBrowserManager({
    platform: 'linux',
    fsModule: fakeFs,
    clipboardModule: fakeClipboard,
    shellModule: fakeShell,
    spawnFn: fakeSpawn,
    extensionDir: '/tmp/extension',
  });

  const res = mgr.prepareBrowserExtension('brave');
  assert.equal(res.ok, true);
  assert.equal(res.browser, 'Brave');
  assert.equal(res.managerUrl, 'brave://extensions/');
  assert.equal(res.firefox, false);
  assert.equal(clipboardText, 'brave://extensions/');
  assert.equal(shownPath, '/tmp/extension/manifest.json');
  assert.equal(spawned.cmd, '/usr/bin/brave-browser');
  assert.deepEqual(spawned.args, ['--new-window', 'brave://extensions/']);

  // Copy extensions URL
  const copyRes = mgr.copyExtensionsUrl('brave');
  assert.equal(copyRes.ok, true);
  assert.equal(copyRes.url, 'brave://extensions/');
});

test('openPreferredBrowser falls back to shell.openExternal when no browser found', async () => {
  let openedUrl = '';
  const fakeShell = {
    async openExternal(url) {
      openedUrl = url;
    },
  };
  const fakeFs = {
    existsSync() {
      return false;
    },
  };

  const mgr = createBrowserManager({
    platform: 'linux',
    fsModule: fakeFs,
    shellModule: fakeShell,
  });

  const res = await mgr.openPreferredBrowser('https://boosty.to/stream', 'brave');
  assert.equal(res.ok, true);
  assert.equal(res.browser, 'системный');
  assert.equal(openedUrl, 'https://boosty.to/stream');
});
