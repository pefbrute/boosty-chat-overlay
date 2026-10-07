'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  PRODUCTION_VARIANT,
  LAB_VARIANT,
  getAppVariant,
  applyAppVariant,
} = require('../desktop/main/app-variant.js');
const { registerIpcHandlers } = require('../desktop/main/ipc.js');

test('App Variant — default resolves to Production configuration', () => {
  const variant = getAppVariant({});

  assert.equal(variant.id, 'production');
  assert.equal(variant.isLab, false);
  assert.equal(variant.name, 'Boosty Chat Overlay');
  assert.equal(variant.appId, 'ru.pefbrute.boosty-chat-overlay');
  assert.equal(variant.userDataDirName, 'Boosty Chat Overlay');
  assert.equal(variant.mainWindowTitle, 'Boosty Chat Overlay');
  assert.equal(variant.monitorWindowTitle, 'Boosty Chat Monitor');
  assert.equal(variant.badge, null);
  assert.equal(variant.isMessageLabEnabled, false);
  assert.ok(variant.iconPath.endsWith('icon.png'));
  assert.ok(fs.existsSync(variant.iconPath), 'Production icon must exist on disk');
});

test('App Variant — BOOSTY_OVERLAY_MESSAGE_LAB=1 activates Lab variant', () => {
  const variant = getAppVariant({ BOOSTY_OVERLAY_MESSAGE_LAB: '1' });

  assert.equal(variant.id, 'lab');
  assert.equal(variant.isLab, true);
  assert.equal(variant.name, 'Boosty Chat Overlay Lab');
  assert.equal(variant.appId, 'ru.pefbrute.boosty-chat-overlay.lab');
  assert.equal(variant.userDataDirName, 'Boosty Chat Overlay Lab');
  assert.equal(variant.mainWindowTitle, 'Boosty Chat Overlay Lab');
  assert.equal(variant.monitorWindowTitle, 'Boosty Chat Monitor — Lab');
  assert.equal(variant.badge, 'LAB');
  assert.equal(variant.isMessageLabEnabled, true);
  assert.ok(variant.iconPath.endsWith('icon-lab.png'));
  assert.ok(fs.existsSync(variant.iconPath), 'Lab icon must exist on disk');
});

test('App Variant — BOOSTY_APP_VARIANT=lab activates Lab variant', () => {
  const variant = getAppVariant({ BOOSTY_APP_VARIANT: 'lab' });

  assert.equal(variant.id, 'lab');
  assert.equal(variant.isLab, true);
  assert.equal(variant.name, 'Boosty Chat Overlay Lab');
  assert.equal(variant.badge, 'LAB');
});

test('App Variant — applyAppVariant configures Electron app instance for Production', () => {
  let appName = '';
  let appUserModelId = '';
  const paths = {
    appData: '/home/test/.config',
  };

  const mockApp = {
    setName: (name) => { appName = name; },
    setAppUserModelId: (id) => { appUserModelId = id; },
    getPath: (name) => paths[name],
    setPath: (name, p) => { paths[name] = p; },
  };

  const prodVariant = getAppVariant({});
  applyAppVariant(mockApp, prodVariant, {});

  assert.equal(appName, 'Boosty Chat Overlay');
  assert.equal(appUserModelId, 'ru.pefbrute.boosty-chat-overlay');
});

test('App Variant — applyAppVariant isolates userData for Lab variant', () => {
  let appName = '';
  let appUserModelId = '';
  const paths = {
    appData: '/home/test/.config',
  };

  const mockApp = {
    setName: (name) => { appName = name; },
    setAppUserModelId: (id) => { appUserModelId = id; },
    getPath: (name) => paths[name],
    setPath: (name, p) => { paths[name] = p; },
  };

  const labVariant = getAppVariant({ BOOSTY_OVERLAY_MESSAGE_LAB: '1' });
  applyAppVariant(mockApp, labVariant, {});

  assert.equal(appName, 'Boosty Chat Overlay Lab');
  assert.equal(appUserModelId, 'ru.pefbrute.boosty-chat-overlay.lab');
  assert.equal(paths.userData, path.join('/home/test/.config', 'Boosty Chat Overlay Lab'));
  assert.equal(paths.sessionData, path.join('/home/test/.config', 'Boosty Chat Overlay Lab', 'sessionData'));
});

test('App Variant — applyAppVariant preserves explicit BOOSTY_OVERLAY_USER_DATA', () => {
  const paths = {
    appData: '/home/test/.config',
  };

  const mockApp = {
    setName: () => {},
    setAppUserModelId: () => {},
    getPath: (name) => paths[name],
    setPath: (name, p) => { paths[name] = p; },
  };

  const labVariant = getAppVariant({ BOOSTY_OVERLAY_MESSAGE_LAB: '1' });
  applyAppVariant(mockApp, labVariant, { BOOSTY_OVERLAY_USER_DATA: '/tmp/custom-profile' });

  // When explicit BOOSTY_OVERLAY_USER_DATA is provided, setPath should not overwrite it
  assert.equal(paths.userData, undefined);
});

test('App Variant — IPC registration exposes get-app-variant', async () => {
  const handlers = {};
  const mockIpcMain = {
    handle: (channel, fn) => {
      handlers[channel] = fn;
    },
  };

  const labVariant = getAppVariant({ BOOSTY_OVERLAY_MESSAGE_LAB: '1' });

  registerIpcHandlers({
    ipcMain: mockIpcMain,
    browserManager: { listBrowsers: () => [] },
    obsService: { getObsStatus: () => ({}) },
    appVariant: labVariant,
  });

  assert.ok(typeof handlers['get-app-variant'] === 'function');
  const result = await handlers['get-app-variant']();
  assert.equal(result.isLab, true);
  assert.equal(result.name, 'Boosty Chat Overlay Lab');
  assert.equal(result.badge, 'LAB');
});

test('App Variant — Linux desktop launcher and wrapper integrity', () => {
  const desktopFilePath = path.resolve(
    process.env.HOME,
    '.local/share/applications/boosty-chat-overlay-lab.desktop'
  );

  assert.ok(fs.existsSync(desktopFilePath), 'Lab .desktop file must exist');
  const desktopContent = fs.readFileSync(desktopFilePath, 'utf8');

  assert.match(desktopContent, /Name=Boosty Chat Overlay Lab/);
  assert.match(desktopContent, /StartupWMClass=Boosty Chat Overlay Lab/);
  assert.match(desktopContent, /Exec=.*run-desktop-lab\.sh/);

  const wrapperPath = path.resolve(__dirname, '../run-desktop-lab.sh');
  assert.ok(fs.existsSync(wrapperPath), 'run-desktop-lab.sh must exist');
  const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');
  assert.match(wrapperContent, /npm run start:lab/);

  // Check wrapper executable mode
  const stat = fs.statSync(wrapperPath);
  assert.ok((stat.mode & 0o111) !== 0, 'run-desktop-lab.sh must be executable');
});
