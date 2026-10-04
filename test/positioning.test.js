'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOGICAL_WIDTH,
  LOGICAL_HEIGHT,
  DEFAULT_SCENE,
  positionFromConfig,
  clampPosition,
  getAnchorFromCenter,
  snapPosition,
  configFromPosition,
  scalePreviewCoordinates,
} = require('../core/layout/positioning.js');

test('Positioning Math: 4 Corner Anchors', () => {
  const box = { width: 520, height: 300 };

  // 1. Top-Left: offsetX = 30, offsetY = 40
  const tlPos = positionFromConfig(
    { horizontalAnchor: 'left', verticalAnchor: 'top', offsetX: 30, offsetY: 40 },
    box
  );
  assert.equal(tlPos.left, 30);
  assert.equal(tlPos.top, 40);
  assert.equal(tlPos.right, 550);
  assert.equal(tlPos.bottom, 340);

  const tlCfg = configFromPosition(tlPos);
  assert.deepEqual(tlCfg, {
    horizontalAnchor: 'left',
    verticalAnchor: 'top',
    offsetX: 30,
    offsetY: 40,
  });

  // 2. Top-Right: offsetX = 50, offsetY = 25
  const trPos = positionFromConfig(
    { horizontalAnchor: 'right', verticalAnchor: 'top', offsetX: 50, offsetY: 25 },
    box
  );
  assert.equal(trPos.right, LOGICAL_WIDTH - 50); // 1870
  assert.equal(trPos.left, LOGICAL_WIDTH - 50 - 520); // 1350
  assert.equal(trPos.top, 25);

  const trCfg = configFromPosition(trPos);
  assert.deepEqual(trCfg, {
    horizontalAnchor: 'right',
    verticalAnchor: 'top',
    offsetX: 50,
    offsetY: 25,
  });

  // 3. Bottom-Left: offsetX = 20, offsetY = 20 (canonical default)
  const blPos = positionFromConfig(
    { horizontalAnchor: 'left', verticalAnchor: 'bottom', offsetX: 20, offsetY: 20 },
    box
  );
  assert.equal(blPos.left, 20);
  assert.equal(blPos.bottom, LOGICAL_HEIGHT - 20); // 1060
  assert.equal(blPos.top, LOGICAL_HEIGHT - 20 - 300); // 760

  const blCfg = configFromPosition(blPos);
  assert.deepEqual(blCfg, {
    horizontalAnchor: 'left',
    verticalAnchor: 'bottom',
    offsetX: 20,
    offsetY: 20,
  });

  // 4. Bottom-Right: offsetX = 64, offsetY = 36
  const brPos = positionFromConfig(
    { horizontalAnchor: 'right', verticalAnchor: 'bottom', offsetX: 64, offsetY: 36 },
    box
  );
  assert.equal(brPos.right, LOGICAL_WIDTH - 64);
  assert.equal(brPos.bottom, LOGICAL_HEIGHT - 36);

  const brCfg = configFromPosition(brPos);
  assert.deepEqual(brCfg, {
    horizontalAnchor: 'right',
    verticalAnchor: 'bottom',
    offsetX: 64,
    offsetY: 36,
  });
});

test('Positioning Math: Anchor Switch Continuous Transition (Zero Jump)', () => {
  const box = { width: 500, height: 200 };

  // Position box slightly left of center
  // Center is at 959 (scene center = 960)
  const leftOfCenter = {
    left: 959 - 250, // 709
    top: 500,
    width: 500,
    height: 200,
    right: 709 + 500, // 1209
    bottom: 700,
  };
  const cfgLeft = configFromPosition(leftOfCenter);
  assert.equal(cfgLeft.horizontalAnchor, 'left');
  assert.equal(cfgLeft.offsetX, 709);

  // Position box slightly right of center
  // Center is at 961
  const rightOfCenter = {
    left: 961 - 250, // 711
    top: 500,
    width: 500,
    height: 200,
    right: 711 + 500, // 1211
    bottom: 700,
  };
  const cfgRight = configFromPosition(rightOfCenter);
  assert.equal(cfgRight.horizontalAnchor, 'right');
  assert.equal(cfgRight.offsetX, LOGICAL_WIDTH - 1211); // 1920 - 1211 = 709

  // Now verify that applying cfgRight to overlay produces exactly the same visual coordinate (711)
  const renderedFromRight = positionFromConfig(cfgRight, box);
  assert.equal(renderedFromRight.left, 711);
  assert.equal(renderedFromRight.right, 1211);

  // Test wide movement: from x=200 to x=1500
  const startBox = { left: 200, top: 400, width: 400, height: 200, right: 600, bottom: 600 };
  const endBox = { left: 1400, top: 400, width: 400, height: 200, right: 1800, bottom: 600 };

  const startCfg = configFromPosition(startBox);
  assert.equal(startCfg.horizontalAnchor, 'left');
  assert.equal(startCfg.offsetX, 200);

  const endCfg = configFromPosition(endBox);
  assert.equal(endCfg.horizontalAnchor, 'right');
  assert.equal(endCfg.offsetX, LOGICAL_WIDTH - 1800); // 120px from right

  const reconstructedEnd = positionFromConfig(endCfg, { width: 400, height: 200 });
  assert.equal(reconstructedEnd.left, 1400);
});

test('Positioning Math: Scale Invariance across Viewports', () => {
  const scene = { width: 1920, height: 1080 };
  const targetLogicalPoint = { x: 500, y: 350 };

  const viewports = [
    { width: 640, height: 360, left: 100, top: 50 },
    { width: 960, height: 540, left: 200, top: 80 },
    { width: 1280, height: 720, left: 50, top: 40 },
    { width: 1920, height: 1080, left: 0, top: 0 },
  ];

  for (const vp of viewports) {
    const scale = vp.width / scene.width;
    const screenX = vp.left + targetLogicalPoint.x * scale;
    const screenY = vp.top + targetLogicalPoint.y * scale;

    const result = scalePreviewCoordinates(screenX, screenY, vp, scene);
    assert.ok(Math.abs(result.logicalX - targetLogicalPoint.x) < 0.001);
    assert.ok(Math.abs(result.logicalY - targetLogicalPoint.y) < 0.001);
  }
});

test('Positioning Math: Clamping within Bounds', () => {
  const box = { width: 500, height: 300 };

  // 1. Negative Left / Top
  const negative = clampPosition({ left: -100, top: -50, width: 500, height: 300 });
  assert.equal(negative.left, 0);
  assert.equal(negative.top, 0);
  assert.equal(negative.right, 500);
  assert.equal(negative.bottom, 300);

  // 2. Overflow Right / Bottom
  const overflow = clampPosition({ left: 1800, top: 950, width: 500, height: 300 });
  assert.equal(overflow.right, 1920);
  assert.equal(overflow.left, 1420);
  assert.equal(overflow.bottom, 1080);
  assert.equal(overflow.top, 780);

  // 3. Oversized box
  const oversized = clampPosition({ left: 100, top: 100, width: 2500, height: 1500 });
  assert.equal(oversized.width, 1920);
  assert.equal(oversized.height, 1080);
  assert.equal(oversized.left, 0);
  assert.equal(oversized.top, 0);
});

test('Positioning Math: Round-Trip Config <-> Position Fidelity (±1 px)', () => {
  const testConfigs = [
    { horizontalAnchor: 'left', verticalAnchor: 'bottom', offsetX: 20, offsetY: 20 },
    { horizontalAnchor: 'right', verticalAnchor: 'bottom', offsetX: 35, offsetY: 45 },
    { horizontalAnchor: 'left', verticalAnchor: 'top', offsetX: 120, offsetY: 80 },
    { horizontalAnchor: 'right', verticalAnchor: 'top', offsetX: 75, offsetY: 15 },
    { horizontalAnchor: 'left', verticalAnchor: 'bottom', offsetX: 250, offsetY: 180 },
    { horizontalAnchor: 'right', verticalAnchor: 'top', offsetX: 310, offsetY: 240 },
  ];

  const box = { width: 548, height: 260 };

  for (const original of testConfigs) {
    const pos = positionFromConfig(original, box);
    const converted = configFromPosition(pos);

    assert.equal(converted.horizontalAnchor, original.horizontalAnchor);
    assert.equal(converted.verticalAnchor, original.verticalAnchor);
    assert.ok(Math.abs(converted.offsetX - original.offsetX) <= 1, `offsetX mismatch: ${converted.offsetX} vs ${original.offsetX}`);
    assert.ok(Math.abs(converted.offsetY - original.offsetY) <= 1, `offsetY mismatch: ${converted.offsetY} vs ${original.offsetY}`);
  }
});

test('Positioning Math: Snapping to Center and Edges', () => {
  const box = { left: 955 - 250, top: 535 - 100, width: 500, height: 200 };
  const snapped = snapPosition(box);

  // Center X was at 955 (5px from 960) -> snapped to 960
  assert.equal(snapped.guides.snapCenterX, true);
  assert.equal(snapped.position.left, 960 - 250);

  // Center Y was at 535 (5px from 540) -> snapped to 540
  assert.equal(snapped.guides.snapCenterY, true);
  assert.equal(snapped.position.top, 540 - 100);

  // Test edge snap
  const nearEdge = { left: 19, top: 21, width: 500, height: 200 };
  const edgeSnapped = snapPosition(nearEdge);
  assert.equal(edgeSnapped.guides.snapLeft, true);
  assert.equal(edgeSnapped.position.left, 20); // snapped to 20
  assert.equal(edgeSnapped.guides.snapTop, true);
  assert.equal(edgeSnapped.position.top, 20); // snapped to 20
});
