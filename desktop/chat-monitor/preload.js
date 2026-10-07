'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const isLab = process.env.BOOSTY_OVERLAY_MESSAGE_LAB === '1' ||
  process.env.BOOSTY_APP_VARIANT === 'lab';

const isMessageLabEnabled = isLab ||
  process.env.BOOSTY_OVERLAY_UI_TEST === '1' ||
  process.env.UI_AUDIT_MODE === '1';

const appVariant = {
  id: isLab ? 'lab' : 'production',
  isLab,
  badge: isLab ? 'LAB' : null,
  name: isLab ? 'Boosty Chat Overlay Lab' : 'Boosty Chat Overlay',
  monitorWindowTitle: isLab ? 'Boosty Chat Monitor — Lab' : 'Boosty Chat Monitor',
};

contextBridge.exposeInMainWorld('boostyMonitor', {
  apiOrigin: `http://127.0.0.1:${process.env.BOOSTY_OVERLAY_PORT || 17369}`,
  getState: () => ipcRenderer.invoke('monitor-get-state'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('monitor-set-always-on-top', enabled),
  getAppVariant: () => ipcRenderer.invoke('get-app-variant'),
  appVariant,
  isMessageLabEnabled,
});

if (process.env.UI_AUDIT_MODE === '1' || process.env.BOOSTY_OVERLAY_UI_TEST === '1') {
  contextBridge.exposeInMainWorld('__MONITOR_TEST_HOOK__', {
    isTest: true,
  });
}
