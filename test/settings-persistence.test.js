'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { writeFileSyncAtomic, createConfigStore } = require('../core/config/storage.js');
const { defaultConfig } = require('../core/config/defaults.js');
const { exportSettings, importSettings } = require('../core/config/transfer.js');

test('Settings Persistence: writeFileSyncAtomic writes safely via tmp file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-test-'));
  const targetFile = path.join(tmpDir, 'test-atomic.json');

  try {
    const data = JSON.stringify({ maxMessages: 10, durationSeconds: 0 }, null, 2);
    writeFileSyncAtomic(targetFile, data);

    assert.ok(fs.existsSync(targetFile), 'Target file must exist after write');
    const readBack = fs.readFileSync(targetFile, 'utf8');
    assert.strictEqual(readBack, data, 'Written content must match exactly');

    // Overwrite atomically
    const updated = JSON.stringify({ maxMessages: 20, durationSeconds: 15 }, null, 2);
    writeFileSyncAtomic(targetFile, updated);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), updated);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Settings Persistence: rapid consecutive updates preserve final state without corruption', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-rapid-'));
  const configFile = path.join(tmpDir, 'rapid-settings.json');

  try {
    const store = createConfigStore({ configFile, debounceMs: 10 });
    assert.strictEqual(store.get().maxMessages, 10, 'Default maxMessages is 10');

    // Rapid consecutive saves
    for (let i = 1; i <= 25; i++) {
      store.update({ maxMessages: i, fontSize: 16 + i });
    }

    // Allow debounce to flush
    await new Promise(r => setTimeout(r, 60));

    // File should exist and be valid JSON with last state
    assert.ok(fs.existsSync(configFile), 'Config file must exist after rapid saves');
    const diskContent = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.strictEqual(diskContent.maxMessages, 25);
    assert.strictEqual(diskContent.fontSize, 41);

    // Verify in-memory store matches disk
    assert.strictEqual(store.get().maxMessages, 25);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Settings Persistence: corrupted config triggers backup and falls back safely', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-corrupt-'));
  const configFile = path.join(tmpDir, 'corrupt-settings.json');

  try {
    // Write corrupted non-JSON content
    fs.writeFileSync(configFile, 'INVALID_CORRUPTED_JSON{{{', 'utf8');

    const store = createConfigStore({ configFile });
    const current = store.get();

    // Must return safe defaults without throwing
    assert.strictEqual(current.maxMessages, 10);
    assert.strictEqual(current.durationSeconds, 0);

    // Check that a .corrupt backup file was created
    const files = fs.readdirSync(tmpDir);
    const backupFile = files.find(f => f.startsWith('corrupt-settings.json.corrupt.'));
    assert.ok(backupFile, 'Corrupted file backup must have been created');
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, backupFile), 'utf8'), 'INVALID_CORRUPTED_JSON{{{');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Settings Persistence: sensitive obsPassword is never leaked in export', () => {
  const fullConfig = {
    ...defaultConfig,
    obsPassword: 'super-secret-password-12345',
    accentColor: '#3a86ff',
    maxMessages: 15,
  };

  const exported = exportSettings(fullConfig);

  // Must not have obsPassword
  assert.strictEqual(exported.config.obsPassword, undefined);
  const exportedString = JSON.stringify(exported);
  assert.strictEqual(exportedString.includes('super-secret-password-12345'), false);

  // Import into baseConfig must not erase base OBS password
  const targetConfig = {
    ...defaultConfig,
    obsPassword: 'my-active-obs-password',
  };

  const importedResult = importSettings(exportedString, targetConfig);
  assert.strictEqual(importedResult.success, true);
  assert.strictEqual(importedResult.config.maxMessages, 15);
  assert.strictEqual(importedResult.config.accentColor, '#3a86ff');
  assert.strictEqual(importedResult.config.obsPassword, 'my-active-obs-password');
});
