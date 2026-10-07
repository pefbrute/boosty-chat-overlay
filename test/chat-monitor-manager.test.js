'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createChatMonitorManager } = require('../desktop/chat-monitor/manager.js');

function createMockBrowserWindow() {
  const instances = [];

  class MockBrowserWindow {
    constructor(options) {
      this.options = options;
      this.bounds = {
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height,
      };
      this._visible = options.show !== false;
      this._minimized = false;
      this._alwaysOnTop = Boolean(options.alwaysOnTop);
      this._destroyed = false;
      this._focused = false;
      this._listeners = new Map();
      instances.push(this);
    }

    on(event, handler) {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, []);
      }
      this._listeners.get(event).push(handler);
      return this;
    }

    emit(event, ...args) {
      const handlers = this._listeners.get(event) || [];
      for (const fn of handlers) fn(...args);
    }

    getBounds() {
      return { ...this.bounds };
    }

    setBounds(b) {
      Object.assign(this.bounds, b);
      this.emit('resize');
    }

    isMinimized() {
      return this._minimized;
    }

    restore() {
      this._minimized = false;
    }

    isVisible() {
      return this._visible;
    }

    show() {
      this._visible = true;
    }

    hide() {
      this._visible = false;
    }

    focus() {
      this._focused = true;
    }

    isAlwaysOnTop() {
      return this._alwaysOnTop;
    }

    setAlwaysOnTop(val) {
      this._alwaysOnTop = Boolean(val);
      this.emit('always-on-top-changed', this._alwaysOnTop);
    }

    setMenuBarVisibility() {}
    loadFile() {}

    isDestroyed() {
      return this._destroyed;
    }

    close() {
      this.emit('close');
      this._destroyed = true;
      this.emit('closed');
    }
  }

  return { MockBrowserWindow, instances };
}

test('ChatMonitorManager: openWindow creates a window, second open focuses existing without duplicating', () => {
  const { MockBrowserWindow, instances } = createMockBrowserWindow();
  const tmpState = path.join(os.tmpdir(), `chat-monitor-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  const mockScreen = {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  };

  const manager = createChatMonitorManager({
    BrowserWindow: MockBrowserWindow,
    screen: mockScreen,
    stateFilePath: tmpState,
  });

  try {
    // 1. First open creates 1 window
    const win1 = manager.openWindow();
    assert.ok(win1);
    assert.equal(instances.length, 1);
    assert.equal(manager.getState().isOpen, true);

    // 2. Second open focuses existing window, does not create a new one
    win1._focused = false;
    const win2 = manager.openWindow();
    assert.equal(win2, win1);
    assert.equal(instances.length, 1);
    assert.equal(win1._focused, true);

    // 3. Minimized window is restored on second open
    win1._minimized = true;
    win1._focused = false;
    manager.openWindow();
    assert.equal(win1.isMinimized(), false);
    assert.equal(win1._focused, true);
  } finally {
    manager.closeWindow();
    try { if (fs.existsSync(tmpState)) fs.unlinkSync(tmpState); } catch {}
  }
});

test('ChatMonitorManager: closing monitor does not affect app, reopen creates new window restoring state', () => {
  const { MockBrowserWindow, instances } = createMockBrowserWindow();
  const tmpState = path.join(os.tmpdir(), `chat-monitor-reopen-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  const mockScreen = {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  };

  const manager = createChatMonitorManager({
    BrowserWindow: MockBrowserWindow,
    screen: mockScreen,
    stateFilePath: tmpState,
  });

  try {
    const win1 = manager.openWindow();
    assert.equal(instances.length, 1);

    // Change size & toggle Always on Top
    win1.setBounds({ x: 250, y: 150, width: 450, height: 680 });
    manager.setAlwaysOnTop(true);
    assert.equal(manager.getState().alwaysOnTop, true);

    // Close window
    manager.closeWindow();
    assert.equal(manager.getState().isOpen, false);
    assert.equal(manager.getWindow(), null);

    // Reopen creates second instance restoring saved state
    const win2 = manager.openWindow();
    assert.equal(instances.length, 2);
    assert.equal(win2.bounds.width, 450);
    assert.equal(win2.bounds.height, 680);
    assert.equal(win2.isAlwaysOnTop(), true);
  } finally {
    manager.closeWindow();
    try { if (fs.existsSync(tmpState)) fs.unlinkSync(tmpState); } catch {}
  }
});

test('ChatMonitorManager: invalid offscreen saved position falls back safely on open', () => {
  const { MockBrowserWindow } = createMockBrowserWindow();
  const tmpState = path.join(os.tmpdir(), `chat-monitor-offscreen-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  // Write corrupt/offscreen coordinates to state file
  fs.writeFileSync(tmpState, JSON.stringify({
    x: 9999,
    y: 8888,
    width: 400,
    height: 600,
    alwaysOnTop: false,
  }));

  const mockScreen = {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  };

  const manager = createChatMonitorManager({
    BrowserWindow: MockBrowserWindow,
    screen: mockScreen,
    stateFilePath: tmpState,
  });

  try {
    const win = manager.openWindow();
    assert.ok(win);
    // Should be centered on primary display (1920x1080)
    const expectedX = Math.round((1920 - 400) / 2);
    const expectedY = Math.round((1080 - 600) / 2);
    assert.equal(win.bounds.x, expectedX);
    assert.equal(win.bounds.y, expectedY);
  } finally {
    manager.closeWindow();
    try { if (fs.existsSync(tmpState)) fs.unlinkSync(tmpState); } catch {}
  }
});
