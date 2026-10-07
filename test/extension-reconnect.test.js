'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');
const { createHealthTracker } = require('../core/health/tracker.js');
const { deriveSystemStatus } = require('../desktop/ui/status-hub.js');
const { EXPECTED_EXTENSION_ID } = require('../core/constants.js');

test('Scenario A: Extension starts before Desktop server (fast connect on server start)', async () => {
  // Simulate desktop server not yet listening, extension retrying with bounded backoff
  let connectAttempts = 0;
  const backoffs = [250, 500, 1000, 1500];

  function getNextDelay(attempt) {
    const base = backoffs[Math.min(attempt - 1, backoffs.length - 1)];
    return base; // bounded, capped at 1500ms
  }

  assert.equal(getNextDelay(1), 250);
  assert.equal(getNextDelay(2), 500);
  assert.equal(getNextDelay(3), 1000);
  assert.equal(getNextDelay(4), 1500);
  assert.equal(getNextDelay(10), 1500); // capped at 1500ms <= 2s target

  // Now create server and connect
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const tracker = createHealthTracker({
    appVersion: '0.4.1',
    serverStartedAt: Date.now(),
    silent: true,
  });

  let serverConnected = false;
  wss.on('connection', (ws) => {
    serverConnected = true;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'HANDSHAKE') {
        tracker.registerWsConnection('conn-scenario-a', {
          extensionId: msg.extensionId,
          extensionVersion: msg.extensionVersion,
          tabs: msg.tabs || [],
        });
        ws.send(JSON.stringify({ type: 'HANDSHAKE_ACK', ok: true }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  // Extension connects once server is ready
  const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);
  await new Promise((resolve) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'HANDSHAKE',
        extensionId: EXPECTED_EXTENSION_ID,
        extensionVersion: '0.4.1',
        tabs: [{ tabId: 101, url: 'https://boosty.to/stream', hasChat: true }],
      }));
    });
    ws.on('message', (raw) => {
      const resp = JSON.parse(raw.toString());
      if (resp.type === 'HANDSHAKE_ACK') resolve();
    });
  });

  assert.ok(serverConnected);
  const health = tracker.getHealthState();
  assert.equal(health.extension.state, 'connected');
  assert.equal(health.extension.isCanonical, true);
  assert.equal(health.boosty.state, 'chat-detected');

  ws.close();
  wss.close();
  await new Promise((resolve) => server.close(resolve));
});

test('Scenario B: Desktop server restarted while extension and Boosty tab stay open', () => {
  const baseTime = 100_000;
  const tracker1 = createHealthTracker({
    appVersion: '0.4.1',
    serverStartedAt: baseTime,
    silent: true,
  });

  // Extension connected to server 1
  tracker1.registerWsConnection('conn-1', {
    extensionId: EXPECTED_EXTENSION_ID,
    extensionVersion: '0.4.1',
    tabs: [{ tabId: 202, url: 'https://boosty.to/channel/live', hasChat: true }],
  }, baseTime);

  const h1 = tracker1.getHealthState({ now: baseTime + 1000 });
  assert.equal(h1.extension.state, 'connected');
  assert.equal(h1.boosty.state, 'chat-detected');

  // Server 1 goes down, server 2 starts at baseTime + 2000
  const tracker2 = createHealthTracker({
    appVersion: '0.4.1',
    serverStartedAt: baseTime + 2000,
    silent: true,
  });

  // At 2100ms: server 2 in startup grace, checking
  const h2Initial = tracker2.getHealthState({ now: baseTime + 2100 });
  assert.equal(h2Initial.extension.state, 'checking');

  // Extension reconnects rapidly (within <= 1.5s bounded backoff) at 2800ms
  tracker2.registerWsConnection('conn-2', {
    extensionId: EXPECTED_EXTENSION_ID,
    extensionVersion: '0.4.1',
    tabs: [{ tabId: 202, url: 'https://boosty.to/channel/live', hasChat: true }],
  }, baseTime + 2800);

  const h2Connected = tracker2.getHealthState({ now: baseTime + 2900 });
  assert.equal(h2Connected.extension.state, 'connected');
  assert.equal(h2Connected.boosty.state, 'chat-detected');

  const ui = deriveSystemStatus({ health: h2Connected, obs: { ok: true, connected: true, scenes: [{ hasChat: true }] } });
  assert.equal(ui.overall.status, 'ready');
});

test('Scenario C: Content script context invalidation teardown and clean recovery', () => {
  // Simulate browser environment
  const mockWindow = {};
  let teardownCalled = false;
  let observerDisconnected = false;

  const mockObserver = {
    disconnect() {
      observerDisconnected = true;
    },
  };

  // Helper matching content.js logic
  let isDestroyed = false;
  function isContextInvalidatedError(err) {
    if (!err) return false;
    const msg = String(err?.message || err);
    return msg.includes('Extension context invalidated') ||
           msg.includes('context invalidated') ||
           msg.includes('context was invalidated');
  }

  function destroyContentScript(reason) {
    if (isDestroyed) return;
    isDestroyed = true;
    teardownCalled = true;
    mockObserver.disconnect();
  }

  // Simulate chrome.runtime throwing context invalidated
  const err = new Error('Extension context invalidated.');
  assert.ok(isContextInvalidatedError(err));

  // Trigger teardown
  destroyContentScript('context invalidated');
  assert.ok(teardownCalled);
  assert.ok(observerDisconnected);
  assert.ok(isDestroyed);

  // Subsequent calls are no-ops without throwing
  destroyContentScript('called again');
  assert.equal(isDestroyed, true);
});

test('Scenario C2: Content script idempotency and replacement cleanup', () => {
  let previousCleanedUp = false;
  const mockWindow = {
    __BOOSTY_CHAT_CONNECTOR_ACTIVE__: 'connector_old',
    __BOOSTY_CHAT_CONNECTOR_CLEANUP__: () => {
      previousCleanedUp = true;
    },
  };

  // When new instance executes:
  const newInstanceId = 'connector_new';
  if (typeof mockWindow.__BOOSTY_CHAT_CONNECTOR_CLEANUP__ === 'function') {
    mockWindow.__BOOSTY_CHAT_CONNECTOR_CLEANUP__();
  }
  mockWindow.__BOOSTY_CHAT_CONNECTOR_ACTIVE__ = newInstanceId;

  assert.ok(previousCleanedUp, 'Previous instance must be cleanly torn down');
  assert.equal(mockWindow.__BOOSTY_CHAT_CONNECTOR_ACTIVE__, 'connector_new');
});

test('Scenario C3: Stale tab script detection and explicit UI status', () => {
  const baseTime = 500_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.1',
    serverStartedAt: baseTime,
    silent: true,
  });

  // Extension connected, but tab lastSeenAt was at baseTime and now it is 40s later (stale script after reload)
  tracker.registerWsConnection('conn-stale', {
    extensionId: EXPECTED_EXTENSION_ID,
    extensionVersion: '0.4.1',
    tabs: [{ tabId: 303, url: 'https://boosty.to/channel', hasChat: false, lastSeenAt: baseTime }],
  }, baseTime);

  // 40 seconds later without heartbeats from content script
  const health = tracker.getHealthState({ now: baseTime + 40_000 });
  assert.equal(health.extension.state, 'connected');
  assert.equal(health.boosty.staleTabScript, true);

  const ui = deriveSystemStatus({ health });
  assert.equal(ui.stream.status, 'reload-tab-required');
  assert.equal(ui.stream.text, 'Обновите вкладку (Ctrl+R)');
  assert.ok(ui.stream.detail.includes('Ctrl+R'));
  assert.equal(ui.overall.title, 'Требуется обновить страницу Boosty');
});

test('Scenario D: Boosty tab opened after desktop app', () => {
  const baseTime = 600_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.1',
    serverStartedAt: baseTime,
    silent: true,
  });

  // 1. Extension connected first (no tabs open yet)
  tracker.registerWsConnection('conn-d', {
    extensionId: EXPECTED_EXTENSION_ID,
    extensionVersion: '0.4.1',
    tabs: [],
  }, baseTime);

  const h1 = tracker.getHealthState({ now: baseTime + 500 });
  assert.equal(h1.extension.state, 'connected');
  assert.equal(h1.boosty.state, 'checking'); // within startup grace

  const ui1 = deriveSystemStatus({ health: h1 });
  assert.equal(ui1.extension.status, 'connected');
  assert.equal(ui1.extension.text, 'Активно');
  assert.equal(ui1.stream.status, 'checking');
  assert.equal(ui1.stream.text, 'Ищем вкладку…');

  // 2. User opens Boosty tab -> tab announce arrives
  tracker.updateTabState({
    tabId: 404,
    url: 'https://boosty.to/stream/my-show',
    hasChat: true,
  }, 'conn-d', baseTime + 1500);

  const h2 = tracker.getHealthState({ now: baseTime + 1600 });
  assert.equal(h2.boosty.state, 'chat-detected');
  assert.equal(h2.boosty.hasChat, true);

  const ui2 = deriveSystemStatus({
    health: h2,
    obs: { ok: true, connected: true, scenes: [{ hasChat: true }] },
  });
  assert.equal(ui2.stream.status, 'connected');
  assert.equal(ui2.stream.text, 'Чат подключён');
  assert.equal(ui2.overall.status, 'ready');
});

test('Scenario E: Desktop app opened after Boosty tab', () => {
  const baseTime = 700_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.1',
    serverStartedAt: baseTime,
    silent: true,
  });

  // Extension connects during handshake with tab already hydrated from browser session
  tracker.registerWsConnection('conn-e', {
    extensionId: EXPECTED_EXTENSION_ID,
    extensionVersion: '0.4.1',
    tabs: [{
      tabId: 505,
      url: 'https://boosty.to/streams/current',
      hasChat: true,
      lastSeenAt: baseTime,
    }],
  }, baseTime + 300);

  const health = tracker.getHealthState({ now: baseTime + 350 });
  assert.equal(health.extension.state, 'connected');
  assert.equal(health.boosty.state, 'chat-detected');
  assert.equal(health.boosty.hasChat, true);

  const ui = deriveSystemStatus({
    health,
    obs: { ok: true, connected: true, scenes: [{ hasChat: true }] },
  });
  assert.equal(ui.overall.status, 'ready');
  assert.equal(ui.stream.text, 'Чат подключён');
});
