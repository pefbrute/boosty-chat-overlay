'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  PRODUCTION_VARIANT,
  LAB_VARIANT,
  FRESH_VARIANT,
  getAppVariant,
  applyAppVariant,
} = require('../desktop/main/app-variant.js');

const {
  isPathSafeForFreshReset,
  resetFreshUserData,
  getFreshUserDataPath,
  isFreshRunning,
} = require('../desktop/main/fresh-reset.js');

test('App Variant — FRESH_VARIANT definition and contract', () => {
  assert.equal(FRESH_VARIANT.id, 'fresh');
  assert.equal(FRESH_VARIANT.isFresh, true);
  assert.equal(FRESH_VARIANT.isLab, false);
  assert.equal(FRESH_VARIANT.name, 'Boosty Chat Overlay Fresh');
  assert.equal(FRESH_VARIANT.appId, 'ru.pefbrute.boosty-chat-overlay.fresh');
  assert.equal(FRESH_VARIANT.userDataDirName, 'Boosty Chat Overlay Fresh');
  assert.equal(FRESH_VARIANT.mainWindowTitle, 'Boosty Chat Overlay Fresh');
  assert.equal(FRESH_VARIANT.monitorWindowTitle, 'Boosty Chat Monitor — С нуля');
  assert.equal(FRESH_VARIANT.badge, 'С нуля');
  assert.equal(FRESH_VARIANT.isMessageLabEnabled, false);
  assert.equal(FRESH_VARIANT.iconFileName, 'icon-fresh.png');
});

test('App Variant — getAppVariant resolves Fresh variant', () => {
  const v1 = getAppVariant({ BOOSTY_APP_VARIANT: 'fresh' });
  assert.equal(v1.id, 'fresh');
  assert.equal(v1.isFresh, true);
  assert.equal(v1.isLab, false);
  assert.equal(v1.name, 'Boosty Chat Overlay Fresh');
  assert.equal(v1.badge, 'С нуля');
  assert.ok(v1.iconPath.endsWith('icon-fresh.png'));

  const v2 = getAppVariant({ BOOSTY_OVERLAY_APP_VARIANT: 'fresh' });
  assert.equal(v2.id, 'fresh');
  assert.equal(v2.isFresh, true);
});

test('App Variant — applyAppVariant configures and isolates userData for Fresh', () => {
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

  const freshVariant = getAppVariant({ BOOSTY_APP_VARIANT: 'fresh' });
  applyAppVariant(mockApp, freshVariant, {});

  assert.equal(appName, 'Boosty Chat Overlay Fresh');
  assert.equal(appUserModelId, 'ru.pefbrute.boosty-chat-overlay.fresh');
  assert.equal(paths.userData, path.join('/home/test/.config', 'Boosty Chat Overlay Fresh'));
  assert.equal(paths.sessionData, path.join('/home/test/.config', 'Boosty Chat Overlay Fresh', 'sessionData'));
});

test('Fresh Reset — Safety Guard blocks dangerous and non-fresh paths', () => {
  // Empty or invalid types
  assert.equal(isPathSafeForFreshReset(''), false);
  assert.equal(isPathSafeForFreshReset(null), false);
  assert.equal(isPathSafeForFreshReset(undefined), false);

  // System root and home
  assert.equal(isPathSafeForFreshReset('/'), false);
  assert.equal(isPathSafeForFreshReset(os.homedir()), false);

  // appData directory itself
  const appData = path.join(os.homedir(), '.config');
  assert.equal(isPathSafeForFreshReset(appData), false);

  // Production userData (MUST NEVER BE ALLOWED)
  const prodPath = path.join(appData, 'Boosty Chat Overlay');
  assert.equal(isPathSafeForFreshReset(prodPath), false);

  // Lab userData (MUST NEVER BE ALLOWED)
  const labPath = path.join(appData, 'Boosty Chat Overlay Lab');
  assert.equal(isPathSafeForFreshReset(labPath), false);

  // Valid Fresh paths
  const validFreshPath = path.join(appData, 'Boosty Chat Overlay Fresh');
  assert.equal(isPathSafeForFreshReset(validFreshPath), true);

  const customFreshPath = path.join('/tmp', 'custom-test', 'Boosty Chat Overlay Fresh');
  assert.equal(isPathSafeForFreshReset(customFreshPath), true);
});

test('Fresh Reset — throws error when target path fails safety validation', () => {
  const unsafePath = path.join(os.homedir(), '.config', 'Boosty Chat Overlay');
  assert.throws(
    () => resetFreshUserData(unsafePath),
    /CRITICAL SAFETY ERROR/
  );
});

test('Fresh Reset — performs clean reset on safe directory', () => {
  const testFreshDir = path.join(os.tmpdir(), `test-reset-${Date.now()}`, 'Boosty Chat Overlay Fresh');
  fs.mkdirSync(testFreshDir, { recursive: true });

  // Place some dummy files (simulating old config, storage, etc.)
  fs.writeFileSync(path.join(testFreshDir, 'overlay-settings.json'), '{"port":17369}');
  fs.writeFileSync(path.join(testFreshDir, 'Preferences'), '{"zoom":1}');
  const subDir = path.join(testFreshDir, 'Local Storage');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, 'leveldb.dat'), '12345');

  assert.equal(fs.readdirSync(testFreshDir).length > 0, true);

  const result = resetFreshUserData(testFreshDir);
  assert.equal(result.reset, true);
  assert.equal(fs.existsSync(testFreshDir), true);
  // Directory should now be empty
  assert.deepEqual(fs.readdirSync(testFreshDir), []);

  // Cleanup
  fs.rmSync(path.dirname(testFreshDir), { recursive: true, force: true });
});

test('Fresh Reset — preserves state when keepState option is active', () => {
  const testFreshDir = path.join(os.tmpdir(), `test-keep-${Date.now()}`, 'Boosty Chat Overlay Fresh');
  fs.mkdirSync(testFreshDir, { recursive: true });
  fs.writeFileSync(path.join(testFreshDir, 'saved-state.json'), '{"persisted":true}');

  const result = resetFreshUserData(testFreshDir, { keepState: true });
  assert.equal(result.reset, false);
  assert.equal(result.reason, 'keep_state');
  assert.equal(fs.existsSync(path.join(testFreshDir, 'saved-state.json')), true);

  // Cleanup
  fs.rmSync(path.dirname(testFreshDir), { recursive: true, force: true });
});

test('Fresh Reset — isFreshRunning detects missing lock file', () => {
  const testFreshDir = path.join(os.tmpdir(), `test-running-${Date.now()}`, 'Boosty Chat Overlay Fresh');
  fs.mkdirSync(testFreshDir, { recursive: true });

  assert.equal(isFreshRunning(testFreshDir), false);

  // Cleanup
  fs.rmSync(path.dirname(testFreshDir), { recursive: true, force: true });
});

test('Fresh Variant — Linux desktop launcher and wrapper integrity', () => {
  const desktopFilePath = path.resolve(
    os.homedir(),
    '.local/share/applications/boosty-chat-overlay-fresh.desktop'
  );

  assert.ok(fs.existsSync(desktopFilePath), 'Fresh .desktop file must exist');
  const desktopContent = fs.readFileSync(desktopFilePath, 'utf8');

  assert.match(desktopContent, /Name=Boosty Chat Overlay Fresh/);
  assert.match(desktopContent, /StartupWMClass=Boosty Chat Overlay Fresh/);
  assert.match(desktopContent, /Exec=.*run-desktop-fresh\.sh/);

  const wrapperPath = path.resolve(__dirname, '../run-desktop-fresh.sh');
  assert.ok(fs.existsSync(wrapperPath), 'run-desktop-fresh.sh must exist');
  const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');
  assert.match(wrapperContent, /npm run start:fresh/);

  const stat = fs.statSync(wrapperPath);
  assert.ok((stat.mode & 0o111) !== 0, 'run-desktop-fresh.sh must be executable');

  // Verify icon files
  assert.ok(fs.existsSync(path.resolve(__dirname, '../build/icon-fresh.svg')), 'icon-fresh.svg must exist');
  assert.ok(fs.existsSync(path.resolve(__dirname, '../build/icon-fresh.png')), 'icon-fresh.png must exist');

  const installedIcon = path.resolve(os.homedir(), '.local/share/icons/hicolor/512x512/apps/boosty-chat-overlay-fresh.png');
  assert.ok(fs.existsSync(installedIcon), 'Installed 512x512 icon must exist');
});
