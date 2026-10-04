const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildCanonicalOverlayTransform,
  isObsOverlayTransformCanonical,
} = require('../desktop/obs/transform.js');

test('buildCanonicalOverlayTransform produces expected 1:1 properties', () => {
  const transform = buildCanonicalOverlayTransform({ baseWidth: 1920, baseHeight: 1080 });
  assert.strictEqual(transform.positionX, 0);
  assert.strictEqual(transform.positionY, 0);
  assert.strictEqual(transform.scaleX, 1.0);
  assert.strictEqual(transform.scaleY, 1.0);
  assert.strictEqual(transform.rotation, 0);
  assert.strictEqual(transform.alignment, 5); // Top-Left
  assert.strictEqual(transform.boundsType, 'OBS_BOUNDS_NONE');
  assert.strictEqual(transform.cropTop, 0);
  assert.strictEqual(transform.cropBottom, 0);
  assert.strictEqual(transform.cropLeft, 0);
  assert.strictEqual(transform.cropRight, 0);
});

test('isObsOverlayTransformCanonical identifies canonical transform across resolutions', () => {
  const resolutions = [
    { baseWidth: 1920, baseHeight: 1080 },
    { baseWidth: 1280, baseHeight: 720 },
    { baseWidth: 2560, baseHeight: 1440 },
    { baseWidth: 3840, baseHeight: 2160 },
  ];

  for (const res of resolutions) {
    const transform = buildCanonicalOverlayTransform(res);
    const inputSettings = { width: res.baseWidth, height: res.baseHeight };
    const check = isObsOverlayTransformCanonical(transform, inputSettings, res);

    assert.strictEqual(check.canonical, true, `Failed for resolution ${res.baseWidth}x${res.baseHeight}`);
    assert.strictEqual(check.reason, undefined);
  }
});

test('isObsOverlayTransformCanonical handles float precision in scale (e.g. 1.0000001 or 0.999999)', () => {
  const videoSettings = { baseWidth: 1920, baseHeight: 1080 };
  const inputSettings = { width: 1920, height: 1080 };
  const transform = {
    ...buildCanonicalOverlayTransform(videoSettings),
    scaleX: 1.0000001,
    scaleY: 0.9999995,
  };

  const check = isObsOverlayTransformCanonical(transform, inputSettings, videoSettings);
  assert.strictEqual(check.canonical, true, 'Float precision within tolerance must be canonical');
});

test('isObsOverlayTransformCanonical flags viewport mismatch (e.g. 900x700 on 1920x1080 canvas)', () => {
  const videoSettings = { baseWidth: 1920, baseHeight: 1080 };
  const inputSettings = { width: 900, height: 700 };
  const transform = buildCanonicalOverlayTransform(videoSettings);

  const check = isObsOverlayTransformCanonical(transform, inputSettings, videoSettings);
  assert.strictEqual(check.canonical, false);
  assert.strictEqual(check.reason, 'viewport_mismatch');
  assert.strictEqual(check.details.inputW, 900);
  assert.strictEqual(check.details.baseW, 1920);
});

test('isObsOverlayTransformCanonical flags hardware scale mismatch (e.g. scale 1.54 or 0.8)', () => {
  const videoSettings = { baseWidth: 1920, baseHeight: 1080 };
  const inputSettings = { width: 1920, height: 1080 };
  const transform = {
    ...buildCanonicalOverlayTransform(videoSettings),
    scaleX: 1.54,
    scaleY: 1.54,
  };

  const check = isObsOverlayTransformCanonical(transform, inputSettings, videoSettings);
  assert.strictEqual(check.canonical, false);
  assert.strictEqual(check.reason, 'scale_mismatch');
});

test('isObsOverlayTransformCanonical flags position offset, crop, and rotation', () => {
  const videoSettings = { baseWidth: 1920, baseHeight: 1080 };
  const inputSettings = { width: 1920, height: 1080 };

  // Position offset
  const posCheck = isObsOverlayTransformCanonical({
    ...buildCanonicalOverlayTransform(videoSettings),
    positionX: 50,
  }, inputSettings, videoSettings);
  assert.strictEqual(posCheck.canonical, false);
  assert.strictEqual(posCheck.reason, 'position_offset');

  // Crop
  const cropCheck = isObsOverlayTransformCanonical({
    ...buildCanonicalOverlayTransform(videoSettings),
    cropBottom: 20,
  }, inputSettings, videoSettings);
  assert.strictEqual(cropCheck.canonical, false);
  assert.strictEqual(cropCheck.reason, 'crop_detected');

  // Rotation
  const rotCheck = isObsOverlayTransformCanonical({
    ...buildCanonicalOverlayTransform(videoSettings),
    rotation: 5.5,
  }, inputSettings, videoSettings);
  assert.strictEqual(rotCheck.canonical, false);
  assert.strictEqual(rotCheck.reason, 'rotation_detected');

  // Bounds type
  const boundsCheck = isObsOverlayTransformCanonical({
    ...buildCanonicalOverlayTransform(videoSettings),
    boundsType: 'OBS_BOUNDS_STRETCH',
  }, inputSettings, videoSettings);
  assert.strictEqual(boundsCheck.canonical, false);
  assert.strictEqual(boundsCheck.reason, 'bounds_type_mismatch');
});

test('isObsOverlayTransformCanonical handles missing settings safely', () => {
  assert.strictEqual(isObsOverlayTransformCanonical(null, null, null).canonical, false);
  assert.strictEqual(isObsOverlayTransformCanonical(null, null, null).reason, 'missing_video_settings');
  assert.strictEqual(isObsOverlayTransformCanonical(null, null, { baseWidth: 1920, baseHeight: 1080 }).reason, 'missing_input_settings');
});
