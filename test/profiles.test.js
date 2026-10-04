'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { PROFILE_DEFINITIONS, normalizeProfileId, applyProfile, detectProfile } = require('../core/config/profiles.js');
const { PRESETS, detectActivePreset } = require('../core/config/presets.js');
const { defaultConfig } = require('../core/config/defaults.js');

test('Profiles: canonical profile order is content, gaming, talking, minimal', () => {
  const keys = Object.keys(PROFILE_DEFINITIONS);
  assert.deepStrictEqual(keys, ['content', 'gaming', 'talking', 'minimal']);
  assert.strictEqual(PROFILE_DEFINITIONS.content.recommended, true);
  assert.strictEqual(PROFILE_DEFINITIONS.content.name, 'Просмотр контента');
});

test('Profiles: applyProfile for all 4 stream profiles', () => {
  const contentConfig = applyProfile(defaultConfig, 'content');
  assert.strictEqual(contentConfig.fontSize, PRESETS.compact.fontSize);
  assert.strictEqual(contentConfig.horizontalAnchor, 'right');
  assert.strictEqual(contentConfig.verticalAnchor, 'bottom');
  assert.strictEqual(contentConfig.newMessagePosition, 'bottom');
  assert.strictEqual(contentConfig.textAlign, 'left');
  assert.strictEqual(contentConfig.offsetX, 20);
  assert.strictEqual(contentConfig.offsetY, 20);
  assert.strictEqual(contentConfig.maxMessages, 3);
  assert.strictEqual(contentConfig.durationSeconds, 12);
  assert.strictEqual(contentConfig.maxStackHeight, 360);

  const gamingConfig = applyProfile(defaultConfig, 'gaming');
  assert.strictEqual(gamingConfig.fontSize, PRESETS.compact.fontSize);
  assert.strictEqual(gamingConfig.horizontalAnchor, 'left');
  assert.strictEqual(gamingConfig.verticalAnchor, 'bottom');
  assert.strictEqual(gamingConfig.offsetX, 24);
  assert.strictEqual(gamingConfig.offsetY, 24);
  assert.strictEqual(gamingConfig.maxMessages, 4);
  assert.strictEqual(gamingConfig.durationSeconds, 15);
  assert.strictEqual(gamingConfig.maxStackHeight, 500);

  const talkingConfig = applyProfile(defaultConfig, 'talking');
  assert.strictEqual(talkingConfig.fontSize, PRESETS.clean.fontSize);
  assert.strictEqual(talkingConfig.horizontalAnchor, 'right');
  assert.strictEqual(talkingConfig.verticalAnchor, 'bottom');
  assert.strictEqual(talkingConfig.offsetX, 32);
  assert.strictEqual(talkingConfig.offsetY, 32);
  assert.strictEqual(talkingConfig.maxMessages, 6);
  assert.strictEqual(talkingConfig.durationSeconds, 25);
  assert.strictEqual(talkingConfig.textAlign, 'right');

  const minimalConfig = applyProfile(defaultConfig, 'minimal');
  assert.strictEqual(minimalConfig.fontSize, PRESETS.compact.fontSize);
  assert.strictEqual(minimalConfig.horizontalAnchor, 'left');
  assert.strictEqual(minimalConfig.verticalAnchor, 'bottom');
  assert.strictEqual(minimalConfig.offsetX, 20);
  assert.strictEqual(minimalConfig.offsetY, 20);
  assert.strictEqual(minimalConfig.maxMessages, 2);
  assert.strictEqual(minimalConfig.durationSeconds, 10);
  assert.strictEqual(minimalConfig.maxStackHeight, 300);
});

test('Profiles: exact profile config detection', () => {
  for (const id of Object.keys(PROFILE_DEFINITIONS)) {
    const cfg = applyProfile(defaultConfig, id);
    assert.strictEqual(detectProfile(cfg), id, `Profile ${id} must be detected exactly`);
  }
});

test('Profiles: modifying layout offset on content profile returns null (Custom)', () => {
  const contentConfig = applyProfile(defaultConfig, 'content');
  const modifiedOffset = { ...contentConfig, offsetX: 50 };
  assert.strictEqual(detectProfile(modifiedOffset), null);
});

test('Profiles: modifying appearance preset returns null (Custom)', () => {
  const contentConfig = applyProfile(defaultConfig, 'content');
  // Content uses compact (opacity 90). Change opacity to 50
  const modifiedStyle = { ...contentConfig, backgroundOpacity: 50 };
  assert.strictEqual(detectProfile(modifiedStyle), null);
});

test('Profiles: modifying stack size returns null (Custom)', () => {
  const contentConfig = applyProfile(defaultConfig, 'content');
  const modifiedStack = { ...contentConfig, maxMessages: 10 };
  assert.strictEqual(detectProfile(modifiedStack), null);
});

test('Profiles: preset independence - changing preset keeps active preset and makes profile Custom', () => {
  const contentConfig = applyProfile(defaultConfig, 'content');
  assert.strictEqual(detectProfile(contentConfig), 'content');
  assert.strictEqual(detectActivePreset(contentConfig), 'compact');

  // User manually switches appearance preset to 'glass'
  const withGlass = { ...contentConfig, ...PRESETS.glass };
  assert.strictEqual(detectActivePreset(withGlass), 'glass', 'Appearance preset should detect glass');
  assert.strictEqual(detectProfile(withGlass), null, 'Profile should no longer match content');
});

test('Profiles: drag independence - dragging position keeps appearance preset Compact and makes profile Custom', () => {
  const contentConfig = applyProfile(defaultConfig, 'content');
  assert.strictEqual(detectProfile(contentConfig), 'content');
  assert.strictEqual(detectActivePreset(contentConfig), 'compact');

  // User drags position to top-right
  const afterDrag = {
    ...contentConfig,
    horizontalAnchor: 'right',
    verticalAnchor: 'top',
    offsetX: 80,
    offsetY: 60,
  };
  assert.strictEqual(detectActivePreset(afterDrag), 'compact', 'Appearance preset must remain compact after drag');
  assert.strictEqual(detectProfile(afterDrag), null, 'Profile must become custom after drag');
});

test('Profiles: error handling on invalid or removed podcast profile ID', () => {
  assert.throws(() => {
    applyProfile(defaultConfig, 'non-existent-profile');
  }, /Unknown profile ID/);
  assert.throws(() => {
    applyProfile(defaultConfig, 'podcast');
  }, /Unknown profile ID/);
});

test('Profiles: backward compatibility with legacy config and removed podcast metadata', () => {
  const legacyConfig = {
    fontSize: 21,
    accentColor: '#f15f2c',
    durationSeconds: 20,
    maxMessages: 6,
  };
  assert.strictEqual(detectProfile(legacyConfig), null);
  assert.strictEqual(normalizeProfileId('podcast'), null, 'Removed podcast profile ID must normalize to null');
  assert.strictEqual(normalizeProfileId('content'), 'content');
});

test('Profiles & Presets: animation settings independence', () => {
  const contentConfig = applyProfile(defaultConfig, 'content');
  assert.strictEqual(detectProfile(contentConfig), 'content');
  assert.strictEqual(detectActivePreset(contentConfig), 'compact');

  // Changing animationType to slide-up does NOT break profile or preset detection
  const withSlideUp = { ...contentConfig, animationType: 'slide-up', animationDurationMs: 450 };
  assert.strictEqual(detectProfile(withSlideUp), 'content', 'Profile must remain content when animationType changes');
  assert.strictEqual(detectActivePreset(withSlideUp), 'compact', 'Preset must remain compact when animationType changes');

  // Changing animationType to none does NOT break profile or preset detection
  const withNone = { ...contentConfig, animationType: 'none', animationDurationMs: 180 };
  assert.strictEqual(detectProfile(withNone), 'content', 'Profile must remain content when animation is none');
  assert.strictEqual(detectActivePreset(withNone), 'compact', 'Preset must remain compact when animation is none');

  // Applying another profile preserves custom animation settings from currentConfig
  const gamingFromSlide = applyProfile(withSlideUp, 'gaming');
  assert.strictEqual(detectProfile(gamingFromSlide), 'gaming');
  assert.strictEqual(gamingFromSlide.animationType, 'slide-up', 'Custom animationType must be preserved across applyProfile');
  assert.strictEqual(gamingFromSlide.animationDurationMs, 450, 'Custom animationDurationMs must be preserved across applyProfile');
});
