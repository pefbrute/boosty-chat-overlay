'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn, execSync } = require('node:child_process');
const { WebSocketServer } = require('ws');

async function testYandexLiveFlow() {
  console.log('=== Testing Yandex Browser Live Extension Verification ===');

  const yandexBin = '/usr/bin/yandex-browser';
  if (!fs.existsSync(yandexBin)) {
    console.log('[SKIP] Yandex Browser binary not found at /usr/bin/yandex-browser');
    return;
  }

  const testPort = 17369;
  const extensionDir = path.resolve(__dirname, '../extension');

  let activeWs = null;
  let receivedPayloads = [];

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        extensionConnected: Boolean(activeWs),
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: '/connector' });

  wss.on('connection', ws => {
    activeWs = ws;
    console.log('[Server] ✔ WebSocket connection established with Yandex Browser extension!');

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        console.log(`[Server] ✔ Received message from Yandex: type=${msg.type || msg.action || 'payload'}`);
        receivedPayloads.push(msg);
      } catch (err) {
        console.warn('[Server] Non-JSON payload received:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('[Server] WebSocket connection closed.');
      activeWs = null;
    });

    ws.send(JSON.stringify({ type: 'ready', serverTime: Date.now() }));
  });

  await new Promise(resolve => server.listen(testPort, '127.0.0.1', resolve));
  console.log(`[Server] Listening on 127.0.0.1:${testPort}`);

  const tempUserData = path.join(os.tmpdir(), `yandex-live-profile-${Date.now()}`);
  fs.mkdirSync(tempUserData, { recursive: true });

  const display = process.env.DISPLAY || ':0';
  console.log(`Launching real Yandex Browser (DISPLAY=${display}) with extension from ${extensionDir}...`);
  const browserProc = spawn(yandexBin, [
    `--user-data-dir=${tempUserData}`,
    `--load-extension=${extensionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    'about:blank',
  ], {
    stdio: 'ignore',
    detached: true,
    env: {
      ...process.env,
      DISPLAY: display,
    },
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && receivedPayloads.length === 0) {
    await new Promise(r => setTimeout(r, 400));
  }

  // Cleanup
  try {
    execSync(`pkill -KILL -f "${tempUserData}"`, { stdio: 'ignore' });
  } catch {}
  wss.close();
  server.close();
  try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch {}

  if (receivedPayloads.length === 0) {
    throw new Error('Yandex Browser extension did not send payload within 15s.');
  }

  console.log('🎉 REAL YANDEX BROWSER EXTENSION VERIFICATION SUCCEEDED!');
  console.log('Received payload:', JSON.stringify(receivedPayloads[0]));
  process.exit(0);
}

testYandexLiveFlow().catch(err => {
  console.error('Yandex Live verification error:', err);
  process.exit(1);
});
