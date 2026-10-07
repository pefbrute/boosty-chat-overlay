'use strict';

const path = require('node:path');
const {
  MIN_WIDTH,
  MIN_HEIGHT,
  DEFAULT_MONITOR_STATE,
  validateWindowBounds,
  loadWindowState,
  saveWindowState,
} = require('./state.js');

/**
 * Creates and manages the lifecycle of the single canonical Chat Monitor window.
 *
 * @param {object} [options]
 * @param {object} [options.BrowserWindow] Electron BrowserWindow class or mock
 * @param {object} [options.screen] Electron screen module or mock
 * @param {object} [options.app] Electron app module or mock
 * @param {string} [options.stateFilePath] Optional custom path for window state persistence
 * @param {string} [options.htmlPath] Optional custom path for index.html
 * @param {string} [options.preloadPath] Optional custom path for preload.js
 */
function createChatMonitorManager(options = {}) {
  const electron = (() => {
    try {
      return require('electron');
    } catch {
      return {};
    }
  })();

  const BrowserWindow = options.BrowserWindow || electron.BrowserWindow;
  const screen = options.screen || electron.screen;
  const app = options.app || electron.app;

  const stateFilePath =
    options.stateFilePath ||
    (app && typeof app.getPath === 'function'
      ? path.join(app.getPath('userData'), 'chat-monitor-state.json')
      : null);

  const htmlPath = options.htmlPath || path.join(__dirname, 'index.html');
  const preloadPath = options.preloadPath || path.join(__dirname, 'preload.js');

  let monitorWindow = null;
  let saveTimer = null;
  let currentState = loadWindowState(stateFilePath);

  function scheduleSave(delayMs = 300) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveWindowState(stateFilePath, currentState);
      saveTimer = null;
    }, delayMs);
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveWindowState(stateFilePath, currentState);
  }

  function updateBoundsFromWindow() {
    if (!monitorWindow || monitorWindow.isDestroyed()) return;
    try {
      const bounds = monitorWindow.getBounds();
      currentState.x = bounds.x;
      currentState.y = bounds.y;
      currentState.width = bounds.width;
      currentState.height = bounds.height;
      scheduleSave(300);
    } catch {
      // Window might be destroying
    }
  }

  /**
   * Opens or focuses the canonical Chat Monitor window.
   *
   * @returns {object} BrowserWindow instance
   */
  function openWindow() {
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      if (typeof monitorWindow.isMinimized === 'function' && monitorWindow.isMinimized()) {
        monitorWindow.restore();
      }
      if (typeof monitorWindow.isVisible === 'function' && !monitorWindow.isVisible()) {
        monitorWindow.show();
      }
      if (typeof monitorWindow.focus === 'function') {
        monitorWindow.focus();
      }
      return monitorWindow;
    }

    currentState = loadWindowState(stateFilePath);

    const displays = screen && typeof screen.getAllDisplays === 'function' ? screen.getAllDisplays() : [];
    const primaryDisplay = screen && typeof screen.getPrimaryDisplay === 'function' ? screen.getPrimaryDisplay() : null;
    const validatedBounds = validateWindowBounds(currentState, displays, primaryDisplay);

    currentState.x = validatedBounds.x;
    currentState.y = validatedBounds.y;
    currentState.width = validatedBounds.width;
    currentState.height = validatedBounds.height;

    const hideWindow = process.env.BOOSTY_OVERLAY_HIDE_WINDOW === '1';

    monitorWindow = new BrowserWindow({
      x: validatedBounds.x,
      y: validatedBounds.y,
      width: validatedBounds.width,
      height: validatedBounds.height,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      backgroundColor: '#0f1015',
      title: options.title || 'Boosty Chat Monitor',
      icon: options.icon || undefined,
      show: !hideWindow,
      alwaysOnTop: Boolean(currentState.alwaysOnTop),
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath,
      },
    });

    if (typeof monitorWindow.setMenuBarVisibility === 'function') {
      monitorWindow.setMenuBarVisibility(false);
    }

    if (typeof monitorWindow.loadFile === 'function') {
      monitorWindow.loadFile(htmlPath);
    }

    // Window events for bounds tracking
    monitorWindow.on('resize', updateBoundsFromWindow);
    monitorWindow.on('move', updateBoundsFromWindow);

    monitorWindow.on('always-on-top-changed', (_event, isAlwaysOnTop) => {
      currentState.alwaysOnTop = Boolean(isAlwaysOnTop);
      scheduleSave(100);
    });

    monitorWindow.on('close', () => {
      updateBoundsFromWindow();
      flushSave();
    });

    monitorWindow.on('closed', () => {
      monitorWindow = null;
    });

    return monitorWindow;
  }

  /**
   * Sets or toggles always-on-top for the Chat Monitor window.
   *
   * @param {boolean} [enabled]
   * @returns {{ ok: boolean, alwaysOnTop: boolean }}
   */
  function setAlwaysOnTop(enabled) {
    if (!monitorWindow || monitorWindow.isDestroyed()) {
      const targetState = enabled !== undefined ? Boolean(enabled) : !currentState.alwaysOnTop;
      currentState.alwaysOnTop = targetState;
      saveWindowState(stateFilePath, currentState);
      return { ok: true, alwaysOnTop: targetState };
    }

    const nextValue =
      enabled !== undefined
        ? Boolean(enabled)
        : !(typeof monitorWindow.isAlwaysOnTop === 'function' ? monitorWindow.isAlwaysOnTop() : currentState.alwaysOnTop);

    if (typeof monitorWindow.setAlwaysOnTop === 'function') {
      monitorWindow.setAlwaysOnTop(nextValue);
    }
    currentState.alwaysOnTop = nextValue;
    saveWindowState(stateFilePath, currentState);
    return { ok: true, alwaysOnTop: nextValue };
  }

  /**
   * Returns current persisted state.
   */
  function getState() {
    const isAot =
      monitorWindow && !monitorWindow.isDestroyed() && typeof monitorWindow.isAlwaysOnTop === 'function'
        ? monitorWindow.isAlwaysOnTop()
        : currentState.alwaysOnTop;
    return {
      ...currentState,
      alwaysOnTop: Boolean(isAot),
      isOpen: Boolean(monitorWindow && !monitorWindow.isDestroyed()),
    };
  }

  /**
   * Returns current BrowserWindow reference or null.
   */
  function getWindow() {
    return monitorWindow && !monitorWindow.isDestroyed() ? monitorWindow : null;
  }

  /**
   * Closes the window if open.
   */
  function closeWindow() {
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.close();
      monitorWindow = null;
    }
  }

  return {
    openWindow,
    getState,
    setAlwaysOnTop,
    getWindow,
    closeWindow,
  };
}

module.exports = {
  createChatMonitorManager,
};
