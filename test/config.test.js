const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { defaultConfig } = require('../core/config/defaults.js');
const { normalizeConfig } = require('../core/config/schema.js');
const { createConfigStore } = require('../core/config/storage.js');

test('normalizeConfig defaults', () => {
  const result = normalizeConfig({});
  assert.deepEqual(result, defaultConfig);
});

test('normalizeConfig clamping and sanitization', () => {
  const custom = normalizeConfig({
    durationSeconds: 9999, // clamp to 120
    fontSize: 5,           // clamp to 12
    textColor: 'invalid-color', // fallback to default
    accentColor: '#12abCD',     // lowercase hex
    showAvatars: false,
    horizontalAnchor: 'middle', // fallback to 'left'
    verticalAnchor: 'top',
  });

  assert.equal(custom.durationSeconds, 120);
  assert.equal(custom.fontSize, 12);
  assert.equal(custom.textColor, '#ffffff');
  assert.equal(custom.accentColor, '#12abcd');
  assert.equal(custom.showAvatars, false);
  assert.equal(custom.horizontalAnchor, 'left');
  assert.equal(custom.verticalAnchor, 'top');
});

test('createConfigStore in-memory and disk persistence', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  const tempFile = path.join(tempDir, 'test-config.json');

  try {
    const store = createConfigStore({ configFile: tempFile });
    assert.deepEqual(store.get(), defaultConfig);

    const updated = store.update({ fontSize: 30, textColor: '#00ff00' });
    assert.equal(updated.fontSize, 30);
    assert.equal(updated.textColor, '#00ff00');
    assert.equal(store.get().fontSize, 30);

    // Verify file content on disk
    const saved = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
    assert.equal(saved.fontSize, 30);
    assert.equal(saved.textColor, '#00ff00');

    // Test new store loading saved file
    const store2 = createConfigStore({ configFile: tempFile });
    assert.equal(store2.get().fontSize, 30);
    assert.equal(store2.get().textColor, '#00ff00');

    // Test reset
    store.reset(true);
    assert.deepEqual(store.get(), defaultConfig);
    const resetFile = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
    assert.deepEqual(resetFile, defaultConfig);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
