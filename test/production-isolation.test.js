'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '..', 'desktop', 'preload.js'),
      },
    });

    await win.loadURL('about:blank');
    const isAuditDefined = await win.webContents.executeJavaScript('window.boostyAudit !== undefined');
    console.log('Production isolation test: window.boostyAudit !== undefined is', isAuditDefined);
    if (isAuditDefined) {
      console.error('FAIL: window.boostyAudit must not be defined when UI_AUDIT_MODE is not 1!');
      app.quit();
      process.exit(1);
    }
    console.log('PASS: window.boostyAudit is strictly undefined in normal production mode.');
    win.destroy();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('Error during test:', err);
    app.quit();
    process.exit(1);
  }
});
