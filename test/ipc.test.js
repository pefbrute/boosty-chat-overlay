const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpcHandlers } = require('../desktop/main/ipc.js');

test('registerIpcHandlers registers all required channels and routes calls', async () => {
  const handlers = new Map();
  const mockIpcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };

  const calls = {
    browserManager: [],
    obsService: [],
    clipboard: [],
  };

  const mockBrowserManager = {
    openPreferredBrowser(url, browserId) {
      calls.browserManager.push({ method: 'openPreferredBrowser', url, browserId });
      return Promise.resolve({ ok: true, browser: 'Brave' });
    },
    listBrowsers() {
      calls.browserManager.push({ method: 'listBrowsers' });
      return [{ id: 'brave', name: 'Brave' }];
    },
    prepareBrowserExtension(browserId) {
      calls.browserManager.push({ method: 'prepareBrowserExtension', browserId });
      return { ok: true, browser: 'Brave' };
    },
    openExtensionFolder() {
      calls.browserManager.push({ method: 'openExtensionFolder' });
      return { ok: true };
    },
    openBrowserExtensionsPage(browserId) {
      calls.browserManager.push({ method: 'openBrowserExtensionsPage', browserId });
      return { ok: true };
    },
    copyExtensionsUrl(browserId) {
      calls.browserManager.push({ method: 'copyExtensionsUrl', browserId });
      return { ok: true, url: 'brave://extensions/' };
    },
  };

  const mockObsService = {
    launchObs() {
      calls.obsService.push({ method: 'launchObs' });
      return { ok: true };
    },
    hasObsExecutable() {
      calls.obsService.push({ method: 'hasObsExecutable' });
      return true;
    },
    listScenes(pwd) {
      calls.obsService.push({ method: 'listScenes', pwd });
      return { ok: true, scenes: [] };
    },
    addScene(pwd, sc) {
      calls.obsService.push({ method: 'addScene', pwd, sc });
      return { ok: true, addedScene: sc };
    },
    removeScene(pwd, sc) {
      calls.obsService.push({ method: 'removeScene', pwd, sc });
      return { ok: true, removedScene: sc };
    },
    fitOverlayToCanvas(pwd) {
      calls.obsService.push({ method: 'fitOverlayToCanvas', pwd });
      return { ok: true };
    },
    refreshOverlay() {
      calls.obsService.push({ method: 'refreshOverlay' });
      return { ok: true, refreshed: true };
    },
    getStatus() {
      calls.obsService.push({ method: 'getStatus' });
      return { ok: true, connected: true };
    },
  };

  const mockClipboard = {
    writeText(txt) {
      calls.clipboard.push(txt);
    },
  };

  const mockApp = {
    getVersion() {
      return '0.4.0';
    },
  };

  registerIpcHandlers({
    ipcMain: mockIpcMain,
    browserManager: mockBrowserManager,
    obsService: mockObsService,
    clipboard: mockClipboard,
    app: mockApp,
    overlayUrl: 'http://127.0.0.1:17369/overlay/',
  });

  const expectedChannels = [
    'open-url',
    'copy-overlay-url',
    'list-browsers',
    'prepare-browser-extension',
    'open-extension-folder',
    'open-browser-extensions-page',
    'copy-extensions-url',
    'launch-obs',
    'has-obs-executable',
    'list-obs-scenes',
    'add-obs-scene',
    'remove-obs-scene',
    'fit-obs-overlay',
    'refresh-obs-overlay',
    'get-obs-status',
    'get-app-version',
    'export-connectivity-diagnostic',
  ];

  for (const ch of expectedChannels) {
    assert.ok(handlers.has(ch), `Channel ${ch} should be registered`);
  }

  // Test open-url with valid URL
  const openUrlHandler = handlers.get('open-url');
  const validOpen = await openUrlHandler({}, 'https://boosty.to/stream', 'brave');
  assert.equal(validOpen.ok, true);
  assert.equal(calls.browserManager[0].method, 'openPreferredBrowser');

  // Test open-url with disallowed URL
  await assert.rejects(
    async () => openUrlHandler({}, 'https://evil.com', 'brave'),
    /URL is not allowed/
  );

  // Test copy-overlay-url
  const copyHandler = handlers.get('copy-overlay-url');
  const copyRes = await copyHandler();
  assert.equal(copyRes, true);
  assert.equal(calls.clipboard[0], 'http://127.0.0.1:17369/overlay/');

  // Test get-app-version
  const versionHandler = handlers.get('get-app-version');
  assert.equal(await versionHandler(), '0.4.0');

  // Test OBS routing
  const addSceneHandler = handlers.get('add-obs-scene');
  const addRes = await addSceneHandler({}, 'pwd123', 'Gaming');
  assert.equal(addRes.ok, true);
  assert.equal(addRes.addedScene, 'Gaming');
  assert.deepEqual(calls.obsService.find(c => c.method === 'addScene'), {
    method: 'addScene',
    pwd: 'pwd123',
    sc: 'Gaming',
  });
});
