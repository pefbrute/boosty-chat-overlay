'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIN_WIDTH = 340;
const MIN_HEIGHT = 400;

const DEFAULT_MONITOR_STATE = {
  width: 380,
  height: 600,
  x: undefined,
  y: undefined,
  alwaysOnTop: false,
};

/**
 * Validates window bounds against available displays.
 * If saved coordinates are offscreen or invalid (e.g. disconnected monitor),
 * safely centers the window on the primary display.
 *
 * @param {object} bounds - { x, y, width, height }
 * @param {Array<object>} displays - Array of Electron Display objects
 * @param {object} primaryDisplay - Primary Electron Display object
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function validateWindowBounds(bounds = {}, displays = [], primaryDisplay = null) {
  const fallbackDisplay = primaryDisplay || (displays.length > 0 ? displays[0] : null);
  const workArea = fallbackDisplay?.workArea || fallbackDisplay?.bounds || { x: 0, y: 0, width: 1280, height: 800 };

  const parsedWidth = Number(bounds.width);
  const parsedHeight = Number(bounds.height);

  const width = Math.min(
    workArea.width,
    Math.max(MIN_WIDTH, Number.isFinite(parsedWidth) ? Math.round(parsedWidth) : DEFAULT_MONITOR_STATE.width)
  );
  const height = Math.min(
    workArea.height,
    Math.max(MIN_HEIGHT, Number.isFinite(parsedHeight) ? Math.round(parsedHeight) : DEFAULT_MONITOR_STATE.height)
  );

  const parsedX = Number(bounds.x);
  const parsedY = Number(bounds.y);
  const hasCoordinates = Number.isFinite(parsedX) && Number.isFinite(parsedY);

  if (!hasCoordinates || displays.length === 0) {
    return {
      x: Math.round(workArea.x + Math.max(0, (workArea.width - width) / 2)),
      y: Math.round(workArea.y + Math.max(0, (workArea.height - height) / 2)),
      width,
      height,
    };
  }

  // Check if at least 100x100 of window and its top title bar area intersect any display workArea
  const isVisibleOnAnyDisplay = displays.some(display => {
    const area = display.workArea || display.bounds;
    if (!area) return false;

    const overlapX = Math.max(0, Math.min(parsedX + width, area.x + area.width) - Math.max(parsedX, area.x));
    const overlapY = Math.max(0, Math.min(parsedY + height, area.y + area.height) - Math.max(parsedY, area.y));

    // Ensure top title bar (parsedY to parsedY + 40) is within reasonable reach
    const topBarReachable = parsedY >= area.y - 10 && parsedY <= area.y + area.height - 35;

    return overlapX >= 100 && overlapY >= 80 && topBarReachable;
  });

  if (isVisibleOnAnyDisplay) {
    return {
      x: Math.round(parsedX),
      y: Math.round(parsedY),
      width,
      height,
    };
  }

  // Offscreen: center on primary display work area
  return {
    x: Math.round(workArea.x + Math.max(0, (workArea.width - width) / 2)),
    y: Math.round(workArea.y + Math.max(0, (workArea.height - height) / 2)),
    width,
    height,
  };
}

/**
 * Loads saved Chat Monitor window state from disk.
 *
 * @param {string} filePath
 * @returns {object}
 */
function loadWindowState(filePath) {
  if (!filePath) return { ...DEFAULT_MONITOR_STATE };
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      return {
        width: Number.isFinite(Number(parsed.width)) ? Math.round(Number(parsed.width)) : DEFAULT_MONITOR_STATE.width,
        height: Number.isFinite(Number(parsed.height)) ? Math.round(Number(parsed.height)) : DEFAULT_MONITOR_STATE.height,
        x: Number.isFinite(Number(parsed.x)) ? Math.round(Number(parsed.x)) : undefined,
        y: Number.isFinite(Number(parsed.y)) ? Math.round(Number(parsed.y)) : undefined,
        alwaysOnTop: Boolean(parsed.alwaysOnTop),
      };
    }
  } catch (err) {
    console.warn('[ChatMonitor] Failed to read window state file:', err.message);
  }
  return { ...DEFAULT_MONITOR_STATE };
}

/**
 * Saves Chat Monitor window state to disk.
 *
 * @param {string} filePath
 * @param {object} state
 */
function saveWindowState(filePath, state = {}) {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = JSON.stringify(
      {
        width: state.width,
        height: state.height,
        x: state.x,
        y: state.y,
        alwaysOnTop: Boolean(state.alwaysOnTop),
      },
      null,
      2
    );
    fs.writeFileSync(filePath, `${payload}\n`, 'utf8');
  } catch (err) {
    console.warn('[ChatMonitor] Failed to save window state file:', err.message);
  }
}

module.exports = {
  MIN_WIDTH,
  MIN_HEIGHT,
  DEFAULT_MONITOR_STATE,
  validateWindowBounds,
  loadWindowState,
  saveWindowState,
};
