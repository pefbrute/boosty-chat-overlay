const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const WebSocket = require('ws');

const testPort = 17395;
process.env.BOOSTY_OVERLAY_PORT = String(testPort);
const tmpConfig = path.join(__dirname, '..', 'overlay-settings-pipeline-test.json');
process.env.BOOSTY_OVERLAY_CONFIG = tmpConfig;
try { fs.unlinkSync(tmpConfig); } catch {}

const { server, host } = require('../server.js');

function httpRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port: testPort, ...options }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body, json: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
    req.end();
  });
}

function createSseCollector(durationMs = 1000, headers = {}) {
  const events = [];
  let req;
  const promise = new Promise((resolve, reject) => {
    req = http.request({ host, port: testPort, path: '/events', method: 'GET', headers }, res => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          const lines = part.split('\n');
          const dataLine = lines.find(l => l.startsWith('data: '));
          const idLine = lines.find(l => l.startsWith('id: '));
          if (dataLine) {
            try {
              const parsed = JSON.parse(dataLine.slice(6));
              events.push({
                data: parsed,
                eventId: idLine ? idLine.slice(4).trim() : null,
              });
            } catch {}
          }
        }
      });
    });
    req.on('error', err => {
      if (err.code !== 'ECONNRESET') reject(err);
    });
    setTimeout(() => {
      req.destroy();
      resolve(events);
    }, durationMs);
    req.end();
  });

  return { promise, close: () => req?.destroy() };
}

test('Message Pipeline: Control Plane does not emit chat messages', async () => {
  const sse = createSseCollector(500);
  await new Promise(r => setTimeout(r, 50));

  // Connect WS as extension (Control Plane)
  const ws = new WebSocket(`ws://${host}:${testPort}/connector`);
  await new Promise(resolve => ws.once('open', resolve));

  // 1. Handshake
  ws.send(JSON.stringify({
    type: 'HANDSHAKE',
    client: 'boosty-chat-connector',
    version: '0.4.0',
    tabs: [{ tabId: 101, url: 'https://boosty.to/stream', hasChat: true, isStream: true }],
  }));

  // 2. Ping
  ws.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));

  // 3. Tab State
  ws.send(JSON.stringify({
    type: 'TAB_STATE',
    payload: { tabId: 101, url: 'https://boosty.to/stream', hasChat: true, isStream: true },
  }));

  // Wait for SSE collector to finish
  const collected = await sse.promise;
  ws.close();

  // SSE must have received 0 chat messages from control plane traffic
  const chatMessages = collected.filter(e => e.data && e.data.platform === 'boosty');
  assert.equal(chatMessages.length, 0, 'Control Plane events must not leak into chat message stream');
});

test('Message Pipeline: Direct ingestion POST /message -> history -> SSE -> /history', async () => {
  const sse = createSseCollector(600);
  await new Promise(r => setTimeout(r, 50));

  const postRes = await httpRequest(
    { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    {
      id: 'pipeline-msg-1',
      platform: 'boosty',
      author: 'Tester Alpha',
      text: 'Direct HTTP Ingestion Test',
    }
  );

  assert.equal(postRes.status, 202);
  assert.equal(postRes.json.ok, true);
  assert.ok(postRes.json.eventId);

  const events = await sse.promise;
  const match = events.find(e => e.data.id === 'pipeline-msg-1');
  assert.ok(match, 'Message must be broadcast via SSE');
  assert.equal(match.data.author.name, 'Tester Alpha');
  assert.equal(match.data.text, 'Direct HTTP Ingestion Test');

  // Verify /history endpoint contains it
  const hist = await httpRequest({ path: '/history', method: 'GET' });
  assert.equal(hist.status, 200);
  assert.ok(Array.isArray(hist.json));
  const inHistory = hist.json.find(m => m.id === 'pipeline-msg-1');
  assert.ok(inHistory, 'Message must be present in /history');
  assert.equal(inHistory.author.name, 'Tester Alpha');
});

test('Message Pipeline: Deduplication drops repeated message IDs', async () => {
  const sse = createSseCollector(500);
  await new Promise(r => setTimeout(r, 50));

  // Send first instance
  const post1 = await httpRequest(
    { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { id: 'pipeline-dedup-1', author: 'Dedup Tester', text: 'First post' }
  );
  assert.equal(post1.status, 202);
  assert.equal(post1.json.duplicate, undefined);

  // Send duplicate
  const post2 = await httpRequest(
    { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { id: 'pipeline-dedup-1', author: 'Dedup Tester', text: 'Second post (duplicate)' }
  );
  assert.equal(post2.status, 202);
  assert.equal(post2.json.duplicate, true);

  const events = await sse.promise;
  const matchingEvents = events.filter(e => e.data.id === 'pipeline-dedup-1');
  assert.equal(matchingEvents.length, 1, 'Duplicate message must not be broadcast a second time');
});

test('Message Pipeline: GET /test button action -> SSE + /history', async () => {
  const sse = createSseCollector(600);
  await new Promise(r => setTimeout(r, 50));

  const testRes = await httpRequest({ path: '/test', method: 'GET' });
  assert.equal(testRes.status, 200);
  assert.equal(testRes.json.ok, true);

  const events = await sse.promise;
  const testMsg = events.find(e => e.data.id && e.data.id.startsWith('test-'));
  assert.ok(testMsg, 'Test message must be received via SSE');
  assert.equal(testMsg.data.author.name, 'Тестовый зритель');
  assert.equal(testMsg.data.text, 'Boosty → OBS работает 🎉');

  const hist = await httpRequest({ path: '/history', method: 'GET' });
  assert.equal(hist.status, 200);
  assert.ok(hist.json.some(m => m.id === testMsg.data.id));
});

test('Message Pipeline: Extension WebSocket Data Plane MESSAGE routing', async () => {
  const sse = createSseCollector(700);
  await new Promise(r => setTimeout(r, 50));

  const ws = new WebSocket(`ws://${host}:${testPort}/connector`);
  await new Promise(resolve => ws.once('open', resolve));

  const ackPromise = new Promise(resolve => {
    ws.on('message', data => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'MESSAGE_ACK' && parsed.id === 'ws-chat-msg-1') {
          resolve(parsed);
        }
      } catch {}
    });
  });

  // Send Data Plane chat message over WebSocket
  ws.send(JSON.stringify({
    type: 'MESSAGE',
    payload: {
      id: 'ws-chat-msg-1',
      platform: 'boosty',
      author: 'StreamChatViewer',
      text: 'Message received via extension WebSocket transport',
      publishTime: '12:45',
    },
  }));

  const ack = await ackPromise;
  assert.equal(ack.ok, true);
  assert.equal(ack.id, 'ws-chat-msg-1');
  assert.ok(ack.eventId);

  const events = await sse.promise;
  ws.close();

  const wsMatch = events.find(e => e.data.id === 'ws-chat-msg-1');
  assert.ok(wsMatch, 'WebSocket chat message must be broadcast via SSE');
  assert.equal(wsMatch.data.author.name, 'StreamChatViewer');
  assert.equal(wsMatch.data.text, 'Message received via extension WebSocket transport');
});

test.after(() => {
  server.close();
  try { fs.unlinkSync(tmpConfig); } catch {}
});
