'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SizePresets = require('../core/config/size-presets.js');

test('SizePresets definitions and labels', () => {
  assert.ok(SizePresets.SIZE_PRESETS.compact, 'compact preset must exist');
  assert.ok(SizePresets.SIZE_PRESETS.normal, 'normal preset must exist');
  assert.ok(SizePresets.SIZE_PRESETS.large, 'large preset must exist');

  assert.strictEqual(SizePresets.SIZE_LABELS.compact, 'Компактный');
  assert.strictEqual(SizePresets.SIZE_LABELS.normal, 'Обычный');
  assert.strictEqual(SizePresets.SIZE_LABELS.large, 'Крупный');

  // Verify compact dimensions
  assert.strictEqual(SizePresets.SIZE_PRESETS.compact.cardWidth, 380);
  assert.strictEqual(SizePresets.SIZE_PRESETS.compact.fontSize, 16);
  assert.strictEqual(SizePresets.SIZE_PRESETS.compact.authorFontSize, 13);
  assert.strictEqual(SizePresets.SIZE_PRESETS.compact.cardPadding, 8);
  assert.strictEqual(SizePresets.SIZE_PRESETS.compact.messageGap, 6);

  // Verify normal dimensions
  assert.strictEqual(SizePresets.SIZE_PRESETS.normal.cardWidth, 520);
  assert.strictEqual(SizePresets.SIZE_PRESETS.normal.fontSize, 21);
  assert.strictEqual(SizePresets.SIZE_PRESETS.normal.authorFontSize, 16);
  assert.strictEqual(SizePresets.SIZE_PRESETS.normal.cardPadding, 10);
  assert.strictEqual(SizePresets.SIZE_PRESETS.normal.messageGap, 10);

  // Verify large dimensions
  assert.strictEqual(SizePresets.SIZE_PRESETS.large.cardWidth, 640);
  assert.strictEqual(SizePresets.SIZE_PRESETS.large.fontSize, 26);
  assert.strictEqual(SizePresets.SIZE_PRESETS.large.authorFontSize, 18);
  assert.strictEqual(SizePresets.SIZE_PRESETS.large.cardPadding, 14);
  assert.strictEqual(SizePresets.SIZE_PRESETS.large.messageGap, 14);
});

test('applySizePreset applies size properties without modifying other config keys', () => {
  const initialConfig = {
    durationSeconds: 15,
    maxMessages: 4,
    accentColor: '#ff0000',
    horizontalAnchor: 'right',
    verticalAnchor: 'top',
    fontSize: 21,
    cardWidth: 520,
  };

  const updated = SizePresets.applySizePreset(initialConfig, 'compact');
  assert.strictEqual(updated.durationSeconds, 15, 'durationSeconds preserved');
  assert.strictEqual(updated.maxMessages, 4, 'maxMessages preserved');
  assert.strictEqual(updated.accentColor, '#ff0000', 'accentColor preserved');
  assert.strictEqual(updated.horizontalAnchor, 'right', 'anchor preserved');

  assert.strictEqual(updated.cardWidth, 380);
  assert.strictEqual(updated.fontSize, 16);
  assert.strictEqual(updated.authorFontSize, 13);
  assert.strictEqual(updated.cardPadding, 8);
  assert.strictEqual(updated.messageGap, 6);
  assert.strictEqual(updated.borderRadius, 6);
  assert.strictEqual(updated.avatarSize, 32);

  assert.throws(() => {
    SizePresets.applySizePreset(initialConfig, 'unknown-size');
  }, /Unknown size preset/);
});

test('detectSizePreset returns matching preset or null for custom values', () => {
  const compactConfig = { ...SizePresets.SIZE_PRESETS.compact, accentColor: '#00ff00', durationSeconds: 10 };
  assert.strictEqual(SizePresets.detectSizePreset(compactConfig), 'compact');

  const normalConfig = { ...SizePresets.SIZE_PRESETS.normal, durationSeconds: 20 };
  assert.strictEqual(SizePresets.detectSizePreset(normalConfig), 'normal');

  const largeConfig = { ...SizePresets.SIZE_PRESETS.large };
  assert.strictEqual(SizePresets.detectSizePreset(largeConfig), 'large');

  // Mismatch in one key -> null (custom)
  const modifiedFontSize = { ...SizePresets.SIZE_PRESETS.compact, fontSize: 17 };
  assert.strictEqual(SizePresets.detectSizePreset(modifiedFontSize), null);

  const modifiedWidth = { ...SizePresets.SIZE_PRESETS.normal, cardWidth: 500 };
  assert.strictEqual(SizePresets.detectSizePreset(modifiedWidth), null);

  const modifiedPadding = { ...SizePresets.SIZE_PRESETS.large, cardPadding: 12 };
  assert.strictEqual(SizePresets.detectSizePreset(modifiedPadding), null);

  assert.strictEqual(SizePresets.detectSizePreset(null), null);
  assert.strictEqual(SizePresets.detectSizePreset({}), null);
});
