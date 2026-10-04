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

test('normalizeAnimationType validation and fallback', () => {
  const { normalizeAnimationType } = require('../core/config/schema.js');
  assert.equal(normalizeAnimationType('none'), 'none');
  assert.equal(normalizeAnimationType('fade'), 'fade');
  assert.equal(normalizeAnimationType('slide-up'), 'slide-up');
  assert.equal(normalizeAnimationType('slide-side'), 'slide-side');
  assert.equal(normalizeAnimationType('  FADE  '), 'fade');
  assert.equal(normalizeAnimationType('SLIDE-UP'), 'slide-up');
  assert.equal(normalizeAnimationType('invalid-type'), 'fade');
  assert.equal(normalizeAnimationType(null), 'fade');
  assert.equal(normalizeAnimationType(undefined, 'slide-side'), 'slide-side');
});

test('normalizeAnimationDuration clamping and sanitization', () => {
  const { normalizeAnimationDuration } = require('../core/config/schema.js');
  assert.equal(normalizeAnimationDuration(280), 280);
  assert.equal(normalizeAnimationDuration('350'), 350);
  assert.equal(normalizeAnimationDuration(50), 150, 'Must clamp to min 150ms');
  assert.equal(normalizeAnimationDuration(2500), 1000, 'Must clamp to max 1000ms');
  assert.equal(normalizeAnimationDuration('invalid'), 280, 'Fallback on invalid');
  assert.equal(normalizeAnimationDuration(null), 280, 'Fallback on null');
  assert.equal(normalizeAnimationDuration(undefined, 420), 420);
});

test('normalizeConfig animation flat, nested and legacy compatibility', () => {
  // 1. Flat animation fields
  const flat = normalizeConfig({
    animationType: 'slide-up',
    animationDurationMs: 450,
  });
  assert.equal(flat.animationType, 'slide-up');
  assert.equal(flat.animationDurationMs, 450);

  // 2. Nested animation object
  const nested = normalizeConfig({
    animation: {
      type: 'slide-side',
      durationMs: 320,
    },
  });
  assert.equal(nested.animationType, 'slide-side');
  assert.equal(nested.animationDurationMs, 320);

  // 3. Legacy config without animation fields gets defaults without failing
  const legacy = normalizeConfig({
    fontSize: 24,
    maxMessages: 5,
  });
  assert.equal(legacy.animationType, 'fade');
  assert.equal(legacy.animationDurationMs, 280);
  assert.equal(legacy.fontSize, 24);
  assert.equal(legacy.maxMessages, 5);
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
