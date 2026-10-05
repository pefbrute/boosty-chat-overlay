'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { EXPECTED_EXTENSION_ID } = require('../core/constants');
const { createHealthTracker } = require('../core/health/tracker');
const { deriveSystemStatus } = require('../desktop/ui/status-hub');
const { isTransientMountPath, deployPersistentExtension } = require('../desktop/browser/extension-deployer');

test('Legacy Migration: AppImage path classifier detects transient mount vs persistent path', () => {
  assert.equal(isTransientMountPath('/tmp/.mount_BoostyAbCdEf/resources/extension'), true);
  assert.equal(isTransientMountPath('/tmp/.mount_12345/extension'), true);
  assert.equal(isTransientMountPath('/home/user/.config/boosty-chat-overlay/extension'), false);
  assert.equal(isTransientMountPath('/home/user/AppData/Roaming/boosty-chat-overlay/extension'), false);
});

test('Legacy Migration: deployPersistentExtension is no-op on same version', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-deploy-noop-'));
  const bundledDir = path.join(tmpBase, 'bundled');
  const persistentDir = path.join(tmpBase, 'persistent');

  fs.mkdirSync(bundledDir, { recursive: true });
  fs.writeFileSync(path.join(bundledDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    version: '0.4.0',
    key: 'testkey',
  }));
  fs.writeFileSync(path.join(bundledDir, 'background.js'), '// v0.4.0');

  // First deploy
  const first = deployPersistentExtension({ bundledDir, persistentDir });
  assert.equal(first.ok, true);
  assert.equal(first.deployed, true);

  // Stat file to get mtime
  const mtimeBefore = fs.statSync(path.join(persistentDir, 'background.js')).mtimeMs;

  // Second deploy (same version)
  const second = deployPersistentExtension({ bundledDir, persistentDir });
  assert.equal(second.ok, true);
  assert.equal(second.deployed, false);

  const mtimeAfter = fs.statSync(path.join(persistentDir, 'background.js')).mtimeMs;
  assert.equal(mtimeBefore, mtimeAfter);

  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test('Legacy Migration: health tracker detects legacy extension ID and flags migrationRequired', () => {
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    expectedExtensionId: EXPECTED_EXTENSION_ID,
    silent: true,
  });

  const legacyId = 'abcdefghijklmnopabcdefghijklmnop'; // Legacy extension ID without key
  tracker.registerWsConnection('conn-legacy-1', {
    extensionId: legacyId,
    extensionVersion: '0.4.0',
    tabs: [{ tabId: 1, url: 'https://boosty.to/stream', hasChat: true }],
  });

  const state = tracker.getHealthState();
  assert.equal(state.extension.state, 'connected');
  assert.equal(state.extensionId, legacyId);
  assert.equal(state.extensionMigrationRequired, true);
  assert.equal(state.isLegacyExtension, true);
  assert.equal(state.extension.isCanonical, false);

  // Status hub derivation must show migration-required warning with action 'migrate-ext'
  const derived = deriveSystemStatus({ health: state });
  assert.equal(derived.extension.status, 'migration-required');
  assert.equal(derived.extension.badgeClass, 'warning');
  assert.equal(derived.extension.action?.id, 'migrate-ext');
  assert.ok(derived.extension.detail.includes('старая версия расширения'));
});

test('Legacy Migration: duplicate connectors coexistence policy prioritizes canonical and drops legacy duplicates', () => {
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    expectedExtensionId: EXPECTED_EXTENSION_ID,
    silent: true,
  });

  const legacyId = 'legacyextid123456789012345678901';

  // 1. Legacy connector connects first
  tracker.registerWsConnection('conn-legacy', {
    extensionId: legacyId,
    extensionVersion: '0.4.0',
  });
  // Since no canonical connection is present yet, legacy is accepted
  assert.equal(tracker.shouldAcceptWsMessage('conn-legacy'), true);

  // 2. Canonical stable extension connects
  tracker.registerWsConnection('conn-canonical', {
    extensionId: EXPECTED_EXTENSION_ID,
    extensionVersion: '0.4.0',
  });

  // Now both are connected: canonical MUST be accepted, legacy MUST be dropped!
  assert.equal(tracker.shouldAcceptWsMessage('conn-canonical'), true);
  assert.equal(tracker.shouldAcceptWsMessage('conn-legacy'), false);

  const state = tracker.getHealthState();
  assert.equal(state.duplicateConnectors, true);
  // Active primary client is canonical!
  assert.equal(state.extensionId, EXPECTED_EXTENSION_ID);
  assert.equal(state.extension.isCanonical, true);

  // 3. If legacy disconnects, canonical remains accepted
  tracker.unregisterWsConnection('conn-legacy');
  assert.equal(tracker.shouldAcceptWsMessage('conn-canonical'), true);
  const stateAfter = tracker.getHealthState();
  assert.equal(stateAfter.duplicateConnectors, false);
  assert.equal(stateAfter.extensionMigrationRequired, false);
});

test('Legacy Migration: reload-required UX when persistent files are updated on disk but running in-browser is older', () => {
  const health = {
    ok: true,
    extensionConnected: true,
    extension: {
      state: 'connected',
      version: '0.4.0',
      extensionId: EXPECTED_EXTENSION_ID,
    },
    extensionId: EXPECTED_EXTENSION_ID,
    expectedExtensionId: EXPECTED_EXTENSION_ID,
    persistentExtensionVersion: '0.4.1', // Updated on disk!
    extensionMigrationRequired: false,
    isLegacyExtension: false,
    isOutdated: false,
  };

  const derived = deriveSystemStatus({ health });
  assert.equal(derived.extension.status, 'reload-required');
  assert.equal(derived.extension.badgeClass, 'warning');
  assert.equal(derived.extension.action?.id, 'reload-ext');
  assert.ok(derived.extension.detail.includes('перезагрузите его в браузере'));
});
