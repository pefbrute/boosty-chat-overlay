'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boostyMonitor', {
  apiOrigin: `http://127.0.0.1:${process.env.BOOSTY_OVERLAY_PORT || 17369}`,
  getState: () => ipcRenderer.invoke('monitor-get-state'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('monitor-set-always-on-top', enabled),
});

if (process.env.UI_AUDIT_MODE === '1' || process.env.BOOSTY_OVERLAY_UI_TEST === '1') {
  contextBridge.exposeInMainWorld('__MONITOR_TEST_HOOK__', {
    isTest: true,
  });
}
