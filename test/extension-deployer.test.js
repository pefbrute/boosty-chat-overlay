const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  compareSemver,
  isTransientMountPath,
  readExtensionManifest,
  deployPersistentExtension,
} = require('../desktop/browser/extension-deployer.js');

test('compareSemver works correctly', () => {
  assert.equal(compareSemver('0.4.0', '0.4.0'), 0);
  assert.equal(compareSemver('0.4.1', '0.4.0'), 1);
  assert.equal(compareSemver('0.3.9', '0.4.0'), -1);
  assert.equal(compareSemver('v1.0.0', '0.9.9'), 1);
});

test('isTransientMountPath detects AppImage and temp mount paths', () => {
  assert.equal(isTransientMountPath('/tmp/.mount_boosty1234/resources/extension'), true);
  assert.equal(isTransientMountPath('C:\\Users\\user\\AppData\\Roaming\\boosty-chat-overlay\\extension'), false);
  assert.equal(isTransientMountPath('/home/user/.config/boosty-chat-overlay/extension'), false);
  assert.equal(isTransientMountPath(null), false);
});

test('deployPersistentExtension: first deploy copies all files', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-test-'));
  const bundledDir = path.join(tmpRoot, 'bundled');
  const persistentDir = path.join(tmpRoot, 'user', 'extension');

  fs.mkdirSync(bundledDir, { recursive: true });
  fs.writeFileSync(path.join(bundledDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    version: '0.4.0',
    key: 'testkey123',
    name: 'Test Ext',
  }));
  fs.writeFileSync(path.join(bundledDir, 'content.js'), '// content script');

  const result = deployPersistentExtension({ bundledDir, persistentDir });
  assert.equal(result.ok, true);
  assert.equal(result.deployed, true);
  assert.equal(result.version, '0.4.0');
  assert.equal(fs.existsSync(path.join(persistentDir, 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(persistentDir, 'content.js')), true);

  // Clean up
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('deployPersistentExtension: same version is a no-op', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-test-'));
  const bundledDir = path.join(tmpRoot, 'bundled');
  const persistentDir = path.join(tmpRoot, 'user', 'extension');

  fs.mkdirSync(bundledDir, { recursive: true });
  fs.writeFileSync(path.join(bundledDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    version: '0.4.0',
    key: 'testkey123',
  }));

  // Initial deploy
  deployPersistentExtension({ bundledDir, persistentDir });

  // Second deploy with same version
  const result = deployPersistentExtension({ bundledDir, persistentDir });
  assert.equal(result.ok, true);
  assert.equal(result.deployed, false, 'should not redeploy when versions match');
  assert.equal(result.version, '0.4.0');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('deployPersistentExtension: newer bundled version updates persistent directory', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-test-'));
  const bundledDir = path.join(tmpRoot, 'bundled');
  const persistentDir = path.join(tmpRoot, 'user', 'extension');

  fs.mkdirSync(bundledDir, { recursive: true });
  fs.writeFileSync(path.join(bundledDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    version: '0.4.0',
    key: 'testkey123',
  }));
  deployPersistentExtension({ bundledDir, persistentDir });

  // Update bundled version to 0.5.0
  fs.writeFileSync(path.join(bundledDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    version: '0.5.0',
    key: 'testkey123',
  }));
  fs.writeFileSync(path.join(bundledDir, 'new-file.txt'), 'hello 0.5.0');

  const result = deployPersistentExtension({ bundledDir, persistentDir });
  assert.equal(result.ok, true);
  assert.equal(result.deployed, true);
  assert.equal(result.version, '0.5.0');
  assert.equal(fs.existsSync(path.join(persistentDir, 'new-file.txt')), true);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('deployPersistentExtension: invalid bundled manifest aborts without damaging existing persistent copy', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deployer-test-'));
  const bundledDir = path.join(tmpRoot, 'bundled');
  const persistentDir = path.join(tmpRoot, 'user', 'extension');

  fs.mkdirSync(bundledDir, { recursive: true });
  fs.writeFileSync(path.join(bundledDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    version: '0.4.0',
    key: 'testkey123',
  }));
  deployPersistentExtension({ bundledDir, persistentDir });

  // Corrupt bundled manifest
  fs.writeFileSync(path.join(bundledDir, 'manifest.json'), 'not-valid-json');

  const result = deployPersistentExtension({ bundledDir, persistentDir });
  assert.equal(result.ok, false);
  assert.equal(result.deployed, false);

  // Existing persistent copy remains completely intact
  const manifest = readExtensionManifest(persistentDir);
  assert.equal(manifest.version, '0.4.0');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
