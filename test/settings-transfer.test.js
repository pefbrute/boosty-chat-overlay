'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { exportSettings, importSettings, EXPORT_SCHEMA_VERSION, EXPORTABLE_CONFIG_KEYS } = require('../core/config/transfer.js');
const { defaultConfig } = require('../core/config/defaults.js');

test('Settings Transfer: exportSettings packages only portable visual config', () => {
  const current = {
    ...defaultConfig,
    obsHost: '192.168.1.100',
    obsPort: 4455,
    obsPassword: 'streamer-secret-key',
    obsScene: 'Main Scene',
    maxMessages: 20,
    durationSeconds: 15,
    fontSize: 24,
    accentColor: '#8b5cf6',
  };

  const bundle = exportSettings(current);
  assert.strictEqual(bundle.app, 'boosty-chat-overlay');
  assert.strictEqual(bundle.schemaVersion, EXPORT_SCHEMA_VERSION);
  assert.ok(bundle.exportedAt);
  assert.strictEqual(bundle.config.maxMessages, 20);
  assert.strictEqual(bundle.config.durationSeconds, 15);
  assert.strictEqual(bundle.config.fontSize, 24);
  assert.strictEqual(bundle.config.accentColor, '#8b5cf6');

  // Verify non-portable keys are NOT in bundle
  assert.strictEqual(bundle.config.obsHost, undefined);
  assert.strictEqual(bundle.config.obsPort, undefined);
  assert.strictEqual(bundle.config.obsPassword, undefined);
  assert.strictEqual(bundle.config.obsScene, undefined);

  // Verify all keys in exported config are strictly in EXPORTABLE_CONFIG_KEYS
  for (const key of Object.keys(bundle.config)) {
    assert.ok(EXPORTABLE_CONFIG_KEYS.includes(key), `Key ${key} must be in EXPORTABLE_CONFIG_KEYS`);
  }
});

test('Settings Transfer: importSettings accepts valid export bundle and preserves secrets', () => {
  const validJson = JSON.stringify({
    app: 'boosty-chat-overlay',
    schemaVersion: 1,
    exportedAt: '2026-10-08T00:00:00.000Z',
    config: {
      maxMessages: 30,
      durationSeconds: 0,
      fontSize: 28,
      accentColor: '#10b981',
      cardWidth: 600,
    },
  });

  const baseConfig = {
    ...defaultConfig,
    obsPassword: 'keep-my-existing-password',
    obsPort: 4455,
  };

  const res = importSettings(validJson, baseConfig);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.changed, true);
  assert.strictEqual(res.config.maxMessages, 30);
  assert.strictEqual(res.config.durationSeconds, 0);
  assert.strictEqual(res.config.fontSize, 28);
  assert.strictEqual(res.config.accentColor, '#10b981');
  assert.strictEqual(res.config.cardWidth, 600);
  assert.strictEqual(res.config.obsPassword, 'keep-my-existing-password');
  assert.strictEqual(res.config.obsPort, 4455);
});

test('Settings Transfer: importSettings rejects corrupt JSON and returns clear error', () => {
  const baseConfig = { ...defaultConfig };
  const res = importSettings('NOT_JSON_DATA', baseConfig);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('JSON'));
  // Config returned must remain intact baseConfig (rollback guarantee)
  assert.strictEqual(res.config.maxMessages, baseConfig.maxMessages);
});

test('Settings Transfer: importSettings rejects incompatible schema version', () => {
  const badVersionJson = JSON.stringify({
    app: 'boosty-chat-overlay',
    schemaVersion: 99,
    config: { maxMessages: 20 },
  });

  const res = importSettings(badVersionJson, defaultConfig);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('99'));
});

test('Settings Transfer: importSettings sanitizes and clamps out-of-range values', () => {
  const extremeJson = JSON.stringify({
    app: 'boosty-chat-overlay',
    schemaVersion: 1,
    config: {
      maxMessages: 9999, // Should clamp to 50
      fontSize: 9999,    // Should clamp to 48
      durationSeconds: -5, // Should normalize
    },
  });

  const res = importSettings(extremeJson, defaultConfig);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.config.maxMessages, 50, 'maxMessages clamped to 50');
  assert.strictEqual(res.config.fontSize, 48, 'fontSize clamped to 48');
  assert.strictEqual(res.config.durationSeconds, 0);
});
