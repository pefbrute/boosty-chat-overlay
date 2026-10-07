'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

ipcMain.handle('monitor-get-state', () => ({
  x: 100,
  y: 100,
  width: 420,
  height: 520,
  alwaysOnTop: false,
}));
ipcMain.handle('monitor-set-always-on-top', () => true);
ipcMain.handle('get-app-variant', () => ({
  isLab: true,
  name: 'Boosty Chat Overlay Lab',
  monitorWindowTitle: 'Boosty Chat Monitor — Lab',
}));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 420,
    height: 520,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../desktop/chat-monitor/preload.js'),
    },
  });

  try {
    await win.loadFile(path.join(__dirname, '../desktop/chat-monitor/index.html'));
    await new Promise((r) => setTimeout(r, 400));

    // 1. Verify autoscroll works in real Chromium layout even when window is unfocused
    const diagLogs = await win.webContents.executeJavaScript(`
      (async () => {
        document.hasFocus = () => false;
        const logs = [];
        const container = document.querySelector('#chat-container');
        const app = window.__chatMonitorApp;

        function getMetrics(label) {
          const scrollTop = container ? container.scrollTop : 0;
          const scrollHeight = container ? container.scrollHeight : 0;
          const clientHeight = container ? container.clientHeight : 0;
          const distFromBottom = scrollHeight - clientHeight - scrollTop;
          return {
            label,
            scrollTop,
            scrollHeight,
            clientHeight,
            distFromBottom,
            followLatest: app ? app.isFollowLatest() : null,
            isScrolledUp: app ? app.isScrolledUp() : null,
            unreadCount: app ? app.getUnreadCount() : null,
          };
        }

        logs.push(getMetrics('initial'));

        for (let i = 1; i <= 10; i++) {
          app.handleIncomingMessage({
            id: 'msg-' + i,
            author: 'User_' + i,
            text: 'Message number ' + i + ' with enough text to populate chat container and create scroll height for testing in Electron window',
            publishedAt: '12:00:00',
            receivedAt: Date.now(),
            role: 'user',
          });
          await new Promise((r) => setTimeout(r, 25));
          logs.push(getMetrics('after-msg-' + i));
        }

        return logs;
      })()
    `);

    const last = diagLogs[diagLogs.length - 1];
    assert.ok(last.scrollTop > 0, `Expected scrollTop > 0 after 10 messages, got ${last.scrollTop}`);
    assert.ok(last.distFromBottom <= 60, `Expected distFromBottom <= 60, got ${last.distFromBottom}`);
    assert.equal(last.followLatest, true, 'Expected followLatest to remain true');
    assert.equal(last.isScrolledUp, false, 'Expected isScrolledUp to remain false');
    assert.equal(last.unreadCount, 10, 'Expected unreadCount to increment while unfocused');

    // 2. Verify manual scroll-up freezes autoscroll, shows button, and click restores bottom
    const scrollUpLogs = await win.webContents.executeJavaScript(`
      (async () => {
        const container = document.querySelector('#chat-container');
        const app = window.__chatMonitorApp;
        const btnScrollBottom = document.querySelector('#btn-scroll-bottom');

        container.scrollTop = 50;
        container.dispatchEvent(new Event('scroll'));
        await new Promise((r) => setTimeout(r, 30));

        const scrollPosBefore = container.scrollTop;
        const isScrolledUpBefore = app.isScrolledUp();
        const followLatestBefore = app.isFollowLatest();

        app.handleIncomingMessage({
          id: 'msg-detached-1',
          author: 'DetachedUser',
          text: 'This message arrived while scrolled up',
          publishedAt: '12:05:00',
          receivedAt: Date.now(),
        });
        await new Promise((r) => setTimeout(r, 30));

        const scrollPosAfter = container.scrollTop;
        const btnVisible = btnScrollBottom ? btnScrollBottom.style.display !== 'none' : false;

        if (btnScrollBottom) btnScrollBottom.click();
        await new Promise((r) => setTimeout(r, 40));

        const finalDist = container.scrollHeight - container.clientHeight - container.scrollTop;
        const finalBtnVisible = btnScrollBottom ? btnScrollBottom.style.display !== 'none' : false;

        return {
          scrollPosBefore,
          isScrolledUpBefore,
          followLatestBefore,
          scrollPosAfter,
          didNotJump: scrollPosBefore === scrollPosAfter,
          btnVisible,
          finalDist,
          finalBtnVisible,
          finalFollowLatest: app.isFollowLatest(),
        };
      })()
    `);

    assert.equal(scrollUpLogs.isScrolledUpBefore, true);
    assert.equal(scrollUpLogs.followLatestBefore, false);
    assert.equal(scrollUpLogs.didNotJump, true, 'Viewport must not jump when user is scrolled up');
    assert.equal(scrollUpLogs.btnVisible, true, 'Scroll-to-bottom button must be visible when scrolled up');
    assert.ok(scrollUpLogs.finalDist <= 60, `Expected finalDist <= 60 after button click, got ${scrollUpLogs.finalDist}`);
    assert.equal(scrollUpLogs.finalBtnVisible, false, 'Scroll-to-bottom button must hide after click');
    assert.equal(scrollUpLogs.finalFollowLatest, true, 'followLatest must be restored after button click');

    console.log('✔ Chat Monitor Electron Autoscroll E2E passed');
    win.destroy();
    app.quit();
  } catch (err) {
    console.error('✖ Chat Monitor Electron Autoscroll E2E failed:', err);
    win.destroy();
    process.exit(1);
  }
});
