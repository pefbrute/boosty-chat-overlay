const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

// Disable hardware acceleration and set headless flags
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

const testPort = 17399;
process.env.BOOSTY_OVERLAY_PORT = String(testPort);
const tmpConfig = path.join(__dirname, '..', 'overlay-settings-reconnect-electron.json');
process.env.BOOSTY_OVERLAY_CONFIG = tmpConfig;
fs.writeFileSync(tmpConfig, JSON.stringify({ durationSeconds: 20 }));
const tmpHistory = path.join(__dirname, '..', 'chat-history-reconnect-electron.json');
process.env.BOOSTY_OVERLAY_HISTORY = tmpHistory;
try { fs.unlinkSync(tmpHistory); } catch {}

const { server, host } = require('../server.js');

// Track incoming requests to /events for assertions
const sseConnections = [];
server.on('request', (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${testPort}`}`);
  if (req.method === 'GET' && url.pathname === '/events') {
    res.write('retry: 1000\n\n');
    sseConnections.push({
      timestamp: Date.now(),
      lastEventIdHeader: req.headers['last-event-id'],
      lastEventIdParam: url.searchParams.get('lastEventId'),
      socket: req.socket,
      res,
    });
  }
});

function postMessage(msg) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(msg);
    const req = http.request(
      {
        host,
        port: testPort,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body || '{}') }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function waitFor(fn, timeoutMs = 8000, intervalMs = 100) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    async function check() {
      try {
        const res = await fn();
        if (res) return resolve(res);
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`waitFor timeout after ${timeoutMs}ms`));
      }
      setTimeout(check, intervalMs);
    }
    check();
  });
}

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: {
        sandbox: true,
        contextIsolation: false,
        nodeIntegration: false,
      },
    });
  } catch (err) {
    console.warn('⚠ Integration test skipped: graphical environment unavailable (' + err.message + ')');
    cleanup(0);
    return;
  }

  function cleanup(code = 0) {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
    server.close(() => {
      try { fs.unlinkSync(tmpConfig); } catch {}
      try { fs.unlinkSync(tmpHistory); } catch {}
      app.quit();
      process.exit(code);
    });
  }

  const pageErrors = [];
  win.webContents.on('page-error', (event, err) => {
    pageErrors.push(err);
  });
  win.webContents.on('console-message', (event, level, message) => {
    console.log('[Browser Console]', message);
  });

  try {
    console.log('=== Electron Integration Test: Reconnect & Reload ===');

    // 1. Initial page load
    console.log('\n--- Step 1: Loading Overlay in Chromium ---');
    await win.loadURL(`http://127.0.0.1:${testPort}/overlay/`);
    
    // Wait for initial SSE connection
    await waitFor(() => sseConnections.length >= 1);
    const conn1 = sseConnections[0];
    console.log('✔ Initial EventSource connected. Last-Event-ID header:', conn1.lastEventIdHeader);
    assert.strictEqual(conn1.lastEventIdHeader, undefined, 'Initial connection must not have Last-Event-ID');

    // 2. Scenario A: Message A -> Drop Connection -> Message B during disconnect -> Chromium auto-reconnect
    console.log('\n--- Scenario A: Temporary SSE disconnect & native auto-reconnect ---');
    const msgA = await postMessage({ id: 'msg-A', author: 'UserA', text: 'Message Alpha' });
    console.log('✔ Posted Message A, eventId:', msgA.data.eventId);

    // Verify Message A rendered in DOM
    await waitFor(async () => {
      const count = await win.webContents.executeJavaScript('document.querySelectorAll(".message").length');
      return count === 1;
    });
    console.log('✔ Message A rendered in Chromium DOM');

    // Destroy socket to simulate network blip
    const conn1Count = sseConnections.length;
    console.log('Simulating connection drop by destroying socket...');
    conn1.socket.destroy();

    // Send Message B while disconnected
    const msgB = await postMessage({ id: 'msg-B', author: 'UserB', text: 'Message Beta' });
    console.log('✔ Posted Message B during disconnect, eventId:', msgB.data.eventId);

    // Wait for native EventSource to auto-reconnect
    console.log('Waiting for Chromium EventSource auto-reconnect...');
    await waitFor(() => sseConnections.length > conn1Count, 15000);
    const conn2 = sseConnections[sseConnections.length - 1];
    console.log('✔ Reconnected! Reconnect Last-Event-ID header:', conn2.lastEventIdHeader);

    // Verify server received Last-Event-ID matching Message A's eventId
    assert.strictEqual(
      String(conn2.lastEventIdHeader),
      String(msgA.data.eventId),
      `Server must receive Last-Event-ID header matching Message A (${msgA.data.eventId})`
    );

    // Verify DOM state: exactly 2 messages (1 for A, 1 for B), no duplicates
    await waitFor(async () => {
      const texts = await win.webContents.executeJavaScript(
        'Array.from(document.querySelectorAll(".message .text")).map(el => el.textContent)'
      );
      return texts.length === 2 && texts.includes('Message Alpha') && texts.includes('Message Beta');
    });
    console.log('✔ Scenario A verified: Exactly 1 card for Message A and 1 card for Message B, zero duplicates');

    // 3. Scenario B: Full page reload (Browser Source restart) & history replay
    console.log('\n--- Scenario B: Full page reload & history replay ---');
    await postMessage({ id: 'msg-fresh', author: 'FreshUser', text: 'Fresh Replay Message' });

    // Reload page
    const beforeReloadConnCount = sseConnections.length;
    console.log('Reloading page via webContents.reload()...');
    win.webContents.reload();

    // Wait for new connection after reload
    await waitFor(() => sseConnections.length > beforeReloadConnCount);
    const connReload = sseConnections[sseConnections.length - 1];
    console.log('✔ Reconnected after reload. Last-Event-ID header:', connReload.lastEventIdHeader);
    assert.strictEqual(connReload.lastEventIdHeader, undefined, 'Reloaded connection must not have Last-Event-ID');

    // Wait for DOM to render replayed active history messages
    await waitFor(async () => {
      const texts = await win.webContents.executeJavaScript(
        'Array.from(document.querySelectorAll(".message .text")).map(el => el.textContent)'
      );
      return texts.includes('Fresh Replay Message');
    });

    const finalTexts = await win.webContents.executeJavaScript(
      'Array.from(document.querySelectorAll(".message .text")).map(el => el.textContent)'
    );
    console.log('DOM messages after reload:', finalTexts);
    assert.ok(finalTexts.includes('Message Alpha'), 'History message Alpha should be replayed');
    assert.ok(finalTexts.includes('Message Beta'), 'History message Beta should be replayed');
    assert.ok(finalTexts.includes('Fresh Replay Message'), 'Fresh message should be replayed');

    // Verify expired TTL is ignored based on receivedAt
    const ttlIgnored = await win.webContents.executeJavaScript(`
      (() => {
        const countBefore = document.querySelectorAll('.message').length;
        events.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({
            id: 'msg-expired-ttl',
            author: 'ExpiredUser',
            text: 'Should Not Appear',
            receivedAt: Date.now() - 40000, // 40 seconds ago, duration is 20s
          })
        }));
        const countAfter = document.querySelectorAll('.message').length;
        return countBefore === countAfter;
      })()
    `);
    assert.strictEqual(ttlIgnored, true, 'Expired message by receivedAt TTL must not be added to DOM');
    console.log('✔ Scenario B verified: Full reload replays history cleanly and expired TTL is ignored');

    // 4. Scenario C: seenMessageIds bounded size & FIFO eviction
    console.log('\n--- Scenario C: seenMessageIds limit & FIFO eviction ---');
    const seenLimitResult = await win.webContents.executeJavaScript(`
      (() => {
        // Dispatch 350 simulated unique messages to test seenMessageIds FIFO
        for (let i = 1; i <= 350; i++) {
          events.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
              id: 'bulk-' + i,
              author: 'BulkUser',
              text: 'Bulk message ' + i,
              receivedAt: Date.now(),
            })
          }));
        }
        return {
          size: seenMessageIds.size,
          hasOldest: seenMessageIds.has('bulk-1'),
          hasNewest: seenMessageIds.has('bulk-350'),
          has300: seenMessageIds.has('bulk-300'),
        };
      })()
    `);

    console.log('seenMessageIds evaluation:', seenLimitResult);
    assert.strictEqual(seenLimitResult.size, 300, 'seenMessageIds must be capped at 300');
    assert.strictEqual(seenLimitResult.hasOldest, false, 'Oldest ID bulk-1 must be evicted');
    assert.strictEqual(seenLimitResult.hasNewest, true, 'Newest ID bulk-350 must be present');
    console.log('✔ Scenario C verified: seenMessageIds strictly capped at 300 with FIFO eviction');

    assert.strictEqual(pageErrors.length, 0, `Page errors: ${pageErrors.map(e => e.message).join(', ')}`);
    console.log('\n Все сценарии интеграционного теста успешно подтверждены!');
    cleanup(0);
  } catch (err) {
    console.error('❌ Integration test failed:', err);
    cleanup(1);
  }
});
