'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  MIN_WIDTH,
  MIN_HEIGHT,
  DEFAULT_MONITOR_STATE,
  validateWindowBounds,
  loadWindowState,
  saveWindowState,
} = require('../desktop/chat-monitor/state.js');

test('validateWindowBounds: clamps to minimum window dimensions (340x400)', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  ];
  const primary = displays[0];

  const bounds = validateWindowBounds({ width: 200, height: 150 }, displays, primary);
  assert.equal(bounds.width, MIN_WIDTH);
  assert.equal(bounds.height, MIN_HEIGHT);
});

test('validateWindowBounds: centers on primary display when coordinates are undefined', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  ];
  const primary = displays[0];

  const bounds = validateWindowBounds({ width: 380, height: 600 }, displays, primary);
  const expectedX = Math.round((1920 - 380) / 2);
  const expectedY = Math.round((1080 - 600) / 2);
  assert.equal(bounds.x, expectedX);
  assert.equal(bounds.y, expectedY);
  assert.equal(bounds.width, 380);
  assert.equal(bounds.height, 600);
});

test('validateWindowBounds: preserves valid coordinates within active display', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } }, // Second monitor
  ];
  const primary = displays[0];

  // Window placed on second monitor
  const bounds = validateWindowBounds({ x: 2000, y: 100, width: 400, height: 650 }, displays, primary);
  assert.equal(bounds.x, 2000);
  assert.equal(bounds.y, 100);
  assert.equal(bounds.width, 400);
  assert.equal(bounds.height, 650);
});

test('validateWindowBounds: falls back safely to primary display when saved position is offscreen', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  ];
  const primary = displays[0];

  // Coordinates from a previously connected 2nd monitor that is now disconnected
  const offscreen = validateWindowBounds({ x: 3800, y: 2000, width: 380, height: 600 }, displays, primary);
  const expectedX = Math.round((1920 - 380) / 2);
  const expectedY = Math.round((1080 - 600) / 2);
  assert.equal(offscreen.x, expectedX);
  assert.equal(offscreen.y, expectedY);
});

test('saveWindowState and loadWindowState: persist and restore state including alwaysOnTop', () => {
  const tmpFile = path.join(os.tmpdir(), `chat-monitor-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    // 1. Initial read from non-existent file returns defaults
    const initial = loadWindowState(tmpFile);
    assert.equal(initial.width, DEFAULT_MONITOR_STATE.width);
    assert.equal(initial.height, DEFAULT_MONITOR_STATE.height);
    assert.equal(initial.alwaysOnTop, false);

    // 2. Save custom state with alwaysOnTop = true
    saveWindowState(tmpFile, {
      x: 120,
      y: 80,
      width: 420,
      height: 700,
      alwaysOnTop: true,
    });

    // 3. Load back
    const restored = loadWindowState(tmpFile);
    assert.equal(restored.x, 120);
    assert.equal(restored.y, 80);
    assert.equal(restored.width, 420);
    assert.equal(restored.height, 700);
    assert.equal(restored.alwaysOnTop, true);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
});
