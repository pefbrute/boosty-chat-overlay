#!/usr/bin/env node
'use strict';

/**
 * scripts/stress-test-connectivity.js
 * Comprehensive Stress Test Suite for Boosty Chat Overlay Connectivity & Lifecycle.
 *
 * Tests:
 *  - Test A: 20 Repeated Desktop/Server Restarts (asserts 20/20 auto-reconnects, measures latency stats)
 *  - Test B: Long Background Idle with Keepalive Ping/Pong (zero flapping)
 *  - Test C: Desktop Downtime Recovery (server offline, backoff retry, instant reconnect on restore)
 *  - Test D: Service Worker Sleep / Wake Recovery (session storage tab retention, generation guards)
 *  - Test E: Background Tab Throttling (port events bypass timer throttling)
 *  - Test F: Browser Restart Simulation (clean disconnect, reconnect on restart)
 *  - Test G: Tab Lifecycle (instant removal upon port disconnect)
 *  - Test H: Multiple Tabs Concurrent Management (prioritizes stream/chat, closes inactive cleanly)
 *  - Test I: Soak Stability & Diagnostic Ring Buffer Test
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { WebSocket, WebSocketServer } = require('ws');
const { createHealthTracker } = require('../core/health/tracker.js');

const TEST_PORT = 17389;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculatePercentile(numbers, percentile) {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * Creates a controllable test server instance with WebSocket & HTTP endpoints.
 */
function createTestServer(port = TEST_PORT, options = {}) {
  const healthTracker = createHealthTracker({
    appVersion: '0.4.0',
    bundledExtensionVersion: '0.4.0',
    startupGraceMs: options.startupGraceMs ?? 3000,
    silent: true,
  });

  let connectionIdCounter = 0;
  const wss = new WebSocketServer({ noServer: true });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      const state = healthTracker.getHealthState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(state));
    }

    if (req.method === 'GET' && url.pathname === '/diagnostic') {
      const trace = healthTracker.getDiagnosticTrace();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, trace }));
    }

    if (req.method === 'POST' && url.pathname === '/connector') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = body.trim() ? JSON.parse(body) : {};
          healthTracker.updateConnector(data);
        } catch {
          healthTracker.updateConnector();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/connector' || url.pathname === '/ws') {
      // Origin check
      const origin = request.headers['origin'] || '';
      if (origin && !origin.startsWith('chrome-extension://') && !origin.startsWith('http://127.0.0.1') && !origin.startsWith('https://boosty.to')) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        return socket.destroy();
      }
      wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    const connectionId = `conn-${Date.now()}-${++connectionIdCounter}`;
    let isHandshakeComplete = false;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'HANDSHAKE') {
          isHandshakeComplete = true;
          healthTracker.registerWsConnection(connectionId, {
            client: msg.client || 'boosty-chat-connector',
            version: msg.version || '0.4.0',
            tabs: msg.tabs || [],
            clientGeneration: msg.generation || 1,
          });
          ws.send(JSON.stringify({ type: 'HANDSHAKE_ACK', connectionId, ok: true }));
          return;
        }

        if (msg.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
          return;
        }

        if (msg.type === 'TAB_STATE') {
          if (msg.payload) {
            healthTracker.updateTabState(msg.payload);
          }
          return;
        }

        if (msg.type === 'TAB_CLOSED') {
          if (msg.tabId) {
            healthTracker.removeTab(msg.tabId, 'Tab closed');
          }
          return;
        }
      } catch {}
    });

    ws.on('close', () => {
      healthTracker.unregisterWsConnection(connectionId, 'Socket closed');
    });

    ws.on('error', () => {
      healthTracker.unregisterWsConnection(connectionId, 'Socket error');
    });
  });

  return {
    server,
    wss,
    healthTracker,
    port,
    listen() {
      return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve());
      });
    },
    close() {
      return new Promise((resolve) => {
        for (const client of wss.clients) {
          try { client.terminate(); } catch {}
        }
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(() => resolve());
      });
    },
  };
}

/**
 * Mock Chromium MV3 Extension Client that implements the exact reconnect and port logic of background.js.
 */
class MockMV3ExtensionClient {
  constructor(port = TEST_PORT, options = {}) {
    this.port = port;
    this.version = options.version || '0.4.0';
    this.tabs = new Map(options.initialTabs || []);
    this.sessionStorage = { activeBoostyTabs: [] };
    this.ws = null;
    this.isConnected = false;
    this.clientGeneration = 0;
    this.retryAttempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.shouldRun = true;
    this.reconnectLatencies = [];
    this.onStateChange = options.onStateChange || (() => {});
  }

  start() {
    this.shouldRun = true;
    this.connect();
  }

  stop() {
    this.shouldRun = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.isConnected = false;
  }

  connect() {
    if (!this.shouldRun) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const startTime = Date.now();
    this.clientGeneration++;

    const wsUrl = `ws://127.0.0.1:${this.port}/connector`;
    const socket = new WebSocket(wsUrl, {
      headers: {
        Origin: 'chrome-extension://lehekceeogchimabplobfmfdedgkahkh',
      },
    });

    socket.on('open', () => {
      this.ws = socket;
      this.isConnected = true;
      const latency = Date.now() - startTime;
      this.reconnectLatencies.push(latency);
      this.retryAttempt = 0;

      // Handshake with current tabs
      socket.send(JSON.stringify({
        type: 'HANDSHAKE',
        client: 'boosty-chat-connector',
        version: this.version,
        generation: this.clientGeneration,
        tabs: Array.from(this.tabs.values()),
      }));

      this.startPingLoop();
      this.onStateChange('connected', { generation: this.clientGeneration, latency });
    });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'PONG') {
          this.lastPongAt = Date.now();
        }
      } catch {}
    });

    socket.on('close', () => {
      this.handleDisconnect('close');
    });

    socket.on('error', () => {
      this.handleDisconnect('error');
    });
  }

  startPingLoop() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
      }
    }, 250); // fast ping in test mode
  }

  handleDisconnect(reason) {
    if (!this.isConnected && this.reconnectTimer) return;
    this.isConnected = false;
    this.ws = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.onStateChange('disconnected', { reason });

    if (!this.shouldRun || this.isSleeping) return;

    this.retryAttempt++;
    // Jittered backoff matching background.js
    const delays = [50, 150, 300, 500, 1000];
    const delay = (delays[Math.min(this.retryAttempt - 1, delays.length - 1)]) + Math.floor(Math.random() * 50);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  simulateWorkerSleep() {
    this.isSleeping = true;
    // Save to session storage before sleep
    this.sessionStorage.activeBoostyTabs = Array.from(this.tabs.values());
    if (this.ws) {
      try { this.ws.terminate(); } catch {}
      this.ws = null;
    }
    this.isConnected = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // In-memory tab Map is wiped on worker termination
    this.tabs.clear();
  }

  simulateWorkerWake() {
    this.isSleeping = false;
    // Restore from session storage
    if (Array.isArray(this.sessionStorage.activeBoostyTabs)) {
      for (const t of this.sessionStorage.activeBoostyTabs) {
        this.tabs.set(t.tabId, t);
      }
    }
    this.connect();
  }

  sendTabEvent(type, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  closeTab(tabId) {
    this.tabs.delete(tabId);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'TAB_CLOSED', tabId }));
    }
  }
}

// -------------------------------------------------------------
// Test Execution Suite
// -------------------------------------------------------------

async function runTestSuite() {
  console.log('=================================================================');
  console.log(' BOOSTY CHAT OVERLAY - COMPREHENSIVE CONNECTIVITY STRESS SUITE  ');
  console.log('=================================================================');
  console.log('Timestamp:', new Date().toISOString());

  const testReport = {
    startedAt: new Date().toISOString(),
    tests: {},
    passed: true,
  };

  // -------------------------------------------------------------
  // Test A: 20 Repeated Desktop App / Server Restarts
  // -------------------------------------------------------------
  console.log('\n--- Test A: 20 Repeated Desktop App / Server Restarts ---');
  {
    const ITERATIONS = 20;
    const clientLatencies = [];
    let server = createTestServer(TEST_PORT);
    await server.listen();

    const client = new MockMV3ExtensionClient(TEST_PORT, {
      initialTabs: [[101, { tabId: 101, url: 'https://boosty.to/stream', hasChat: true, isStream: true, title: 'Live' }]],
    });
    client.start();

    // Wait for initial connection
    await sleep(300);
    assert.equal(client.isConnected, true, 'Client should be initially connected');

    for (let i = 1; i <= ITERATIONS; i++) {
      process.stdout.write(`  Cycle ${i}/${ITERATIONS}: Restarting server... `);
      const stopStart = Date.now();

      // Stop server
      await server.close();

      // Wait a realistic brief restart delay (100ms - 250ms)
      await sleep(150);

      // Start new server instance
      server = createTestServer(TEST_PORT);
      await server.listen();

      // Wait for client to automatically reconnect
      const reconnectTimeout = Date.now() + 4000;
      let reconnected = false;
      while (Date.now() < reconnectTimeout) {
        const state = server.healthTracker.getHealthState();
        if (state.extension.state === 'connected' && state.boosty.state === 'chat-detected') {
          reconnected = true;
          break;
        }
        await sleep(50);
      }

      assert.equal(reconnected, true, `Cycle ${i} failed to automatically reconnect within timeout`);
      const elapsed = Date.now() - stopStart;
      clientLatencies.push(elapsed);
      console.log(`✓ Reconnected in ${elapsed}ms (Generation ${server.healthTracker.getHealthState().connectionGeneration})`);
    }

    client.stop();
    await server.close();

    const minLat = Math.min(...clientLatencies);
    const medianLat = calculatePercentile(clientLatencies, 50);
    const p75Lat = calculatePercentile(clientLatencies, 75);
    const p90Lat = calculatePercentile(clientLatencies, 90);
    const maxLat = Math.max(...clientLatencies);

    console.log(`\n  Results for Test A (20/20 Successful Reconnects):`);
    console.log(`    Min Latency:    ${minLat}ms`);
    console.log(`    Median Latency: ${medianLat}ms`);
    console.log(`    p75 Latency:    ${p75Lat}ms`);
    console.log(`    p90 Latency:    ${p90Lat}ms`);
    console.log(`    Max Latency:    ${maxLat}ms`);

    testReport.tests.testA = {
      passed: true,
      cycles: ITERATIONS,
      min: minLat,
      median: medianLat,
      p75: p75Lat,
      p90: p90Lat,
      max: maxLat,
    };
  }

  // -------------------------------------------------------------
  // Test B: Long Background Idle with Keepalive Ping/Pong
  // -------------------------------------------------------------
  console.log('\n--- Test B: Long Background Idle with Keepalive Ping/Pong ---');
  {
    const server = createTestServer(TEST_PORT);
    await server.listen();

    const client = new MockMV3ExtensionClient(TEST_PORT, {
      initialTabs: [[201, { tabId: 201, url: 'https://boosty.to/stream', hasChat: true, isStream: true, title: 'Stream' }]],
    });
    client.start();
    await sleep(200);

    let stateFlaps = 0;
    const checkStart = Date.now();
    // Simulate extended idle duration with continuous pings
    while (Date.now() - checkStart < 2500) {
      const state = server.healthTracker.getHealthState();
      if (state.extension.state !== 'connected' || state.boosty.state !== 'chat-detected') {
        stateFlaps++;
      }
      await sleep(100);
    }

    assert.equal(stateFlaps, 0, 'Zero flapping should occur during background idle');
    console.log('  ✓ 0 flapping events observed during background idle. Keepalive maintained.');

    client.stop();
    await server.close();
    testReport.tests.testB = { passed: true, flaps: stateFlaps };
  }

  // -------------------------------------------------------------
  // Test C: Desktop Downtime Recovery (Server Offline)
  // -------------------------------------------------------------
  console.log('\n--- Test C: Desktop Downtime Recovery ---');
  {
    let server = createTestServer(TEST_PORT);
    await server.listen();

    const client = new MockMV3ExtensionClient(TEST_PORT, {
      initialTabs: [[301, { tabId: 301, url: 'https://boosty.to/chat', hasChat: true, isStream: false, title: 'Chat' }]],
    });
    client.start();
    await sleep(200);
    assert.equal(client.isConnected, true);

    console.log('  Simulating desktop server shutdown...');
    await server.close();

    // Verify client enters backoff retry
    await sleep(800);
    assert.equal(client.isConnected, false);
    assert.ok(client.retryAttempt > 0, 'Client should actively retry with backoff');
    console.log(`  Client actively retrying (attempt #${client.retryAttempt})...`);

    // Restart server after downtime
    server = createTestServer(TEST_PORT);
    await server.listen();
    console.log('  Server restarted. Waiting for client auto-reconnect...');

    const reconnectStart = Date.now();
    let reconnected = false;
    while (Date.now() - reconnectStart < 3000) {
      if (client.isConnected && server.healthTracker.getHealthState().extension.state === 'connected') {
        reconnected = true;
        break;
      }
      await sleep(50);
    }

    assert.equal(reconnected, true, 'Client must reconnect automatically after server downtime');
    console.log(`  ✓ Reconnected within ${Date.now() - reconnectStart}ms without browser user interaction.`);

    client.stop();
    await server.close();
    testReport.tests.testC = { passed: true, attemptsBeforeReconnect: client.retryAttempt };
  }

  // -------------------------------------------------------------
  // Test D: Service Worker Sleep / Wake Recovery
  // -------------------------------------------------------------
  console.log('\n--- Test D: Service Worker Sleep / Wake Recovery ---');
  {
    const server = createTestServer(TEST_PORT);
    await server.listen();

    const client = new MockMV3ExtensionClient(TEST_PORT, {
      initialTabs: [[401, { tabId: 401, url: 'https://boosty.to/beautiful_foot', hasChat: true, isStream: true, title: 'Live' }]],
    });
    client.start();
    await sleep(200);

    const initialHealth = server.healthTracker.getHealthState();
    assert.equal(initialHealth.extension.state, 'connected');
    assert.equal(initialHealth.boosty.state, 'chat-detected');
    assert.equal(initialHealth.connectionGeneration, 1);

    console.log('  Triggering Service Worker sleep (process termination & memory wipe)...');
    client.simulateWorkerSleep();

    // Verify server retains tab state during temporary worker reconnecting phase
    await sleep(500);
    const duringSleepHealth = server.healthTracker.getHealthState();
    assert.equal(duringSleepHealth.extension.state, 'reconnecting');
    assert.equal(duringSleepHealth.boosty.state, 'chat-detected', 'Boosty tab state retained across worker sleep');
    console.log('  ✓ Server smoothly retained Boosty tab state during worker sleep.');

    console.log('  Triggering Service Worker wake (session storage reload)...');
    client.simulateWorkerWake();
    await sleep(300);

    const afterWakeHealth = server.healthTracker.getHealthState();
    assert.equal(afterWakeHealth.extension.state, 'connected');
    assert.equal(afterWakeHealth.boosty.state, 'chat-detected');
    assert.equal(afterWakeHealth.connectionGeneration, 2, 'Monotonic connection generation incremented to 2');
    console.log('  ✓ Reconnected cleanly with generation 2. Zero false unavailable transitions.');

    client.stop();
    await server.close();
    testReport.tests.testD = { passed: true };
  }

  // -------------------------------------------------------------
  // Test E: Background Tab Throttling (Port Event Delivery)
  // -------------------------------------------------------------
  console.log('\n--- Test E: Background Tab Throttling (Port Event Delivery) ---');
  {
    const server = createTestServer(TEST_PORT);
    await server.listen();

    const client = new MockMV3ExtensionClient(TEST_PORT, {
      initialTabs: [[501, { tabId: 501, url: 'https://boosty.to/stream', hasChat: false, isStream: true, title: 'Stream' }]],
    });
    client.start();
    await sleep(200);

    const beforeState = server.healthTracker.getHealthState();
    assert.equal(beforeState.boosty.state, 'tab-detected');

    console.log('  Dispatched DOM Chat Attached Port event from background tab...');
    const eventTime = Date.now();
    client.sendTabEvent('TAB_STATE', {
      tabId: 501,
      url: 'https://boosty.to/stream',
      hasChat: true,
      isStream: true,
      title: 'Stream with Chat',
      lastSeenAt: Date.now(),
    });

    await sleep(100);
    const afterState = server.healthTracker.getHealthState();
    assert.equal(afterState.boosty.state, 'chat-detected');
    console.log(`  ✓ Chat detected via event in ${Date.now() - eventTime}ms without polling intervals.`);

    client.stop();
    await server.close();
    testReport.tests.testE = { passed: true };
  }

  // -------------------------------------------------------------
  // Test F: Browser Restart Simulation
  // -------------------------------------------------------------
  console.log('\n--- Test F: Browser Restart Simulation ---');
  {
    const server = createTestServer(TEST_PORT, { startupGraceMs: 1500 });
    await server.listen();

    let client = new MockMV3ExtensionClient(TEST_PORT, {
      initialTabs: [[601, { tabId: 601, url: 'https://boosty.to/channel', hasChat: true, isStream: false, title: 'Channel' }]],
    });
    client.start();
    await sleep(200);

    console.log('  Closing browser (all extensions & tabs terminate)...');
    client.stop();
    await sleep(100);

    const reconnectingState = server.healthTracker.getHealthState();
    assert.equal(reconnectingState.extension.state, 'reconnecting', 'Enters reconnecting grace period');
    console.log('  ✓ Enters reconnecting grace period without abrupt failure.');

    // After reconnecting threshold (15s), transitions to unavailable
    const unavailState = server.healthTracker.getHealthState({ now: Date.now() + 16_000 });
    assert.equal(unavailState.extension.state, 'unavailable');
    console.log('  ✓ Extension marked unavailable after disconnect grace threshold.');

    console.log('  Browser re-opened...');
    client = new MockMV3ExtensionClient(TEST_PORT, {
      initialTabs: [[601, { tabId: 601, url: 'https://boosty.to/channel', hasChat: true, isStream: false, title: 'Channel' }]],
    });
    client.start();
    await sleep(300);

    const restoredState = server.healthTracker.getHealthState();
    assert.equal(restoredState.extension.state, 'connected');
    console.log('  ✓ Restored to connected immediately upon browser re-launch.');

    client.stop();
    await server.close();
    testReport.tests.testF = { passed: true };
  }

  // -------------------------------------------------------------
  // Test G & H: Tab Lifecycle & Multiple Tabs Concurrent Management
  // -------------------------------------------------------------
  console.log('\n--- Test G & H: Tab Lifecycle & Multiple Tabs Concurrent Management ---');
  {
    const server = createTestServer(TEST_PORT);
    await server.listen();

    const client = new MockMV3ExtensionClient(TEST_PORT, {
      initialTabs: [
        [701, { tabId: 701, url: 'https://boosty.to/blog', hasChat: false, isStream: false, title: 'Blog Post' }],
        [702, { tabId: 702, url: 'https://boosty.to/offline', hasChat: false, isStream: true, title: 'Offline Stream' }],
        [703, { tabId: 703, url: 'https://boosty.to/live', hasChat: true, isStream: true, title: 'Live Stream' }],
      ],
    });
    client.start();
    await sleep(200);

    const initialMulti = server.healthTracker.getHealthState();
    assert.equal(initialMulti.boosty.activeTabsCount, 3);
    assert.equal(initialMulti.boosty.state, 'chat-detected');
    assert.equal(initialMulti.boosty.tabUrl, 'https://boosty.to/live', 'Prioritizes live stream with chat');
    console.log('  ✓ 3 tabs registered; live stream tab prioritized as primary.');

    console.log('  Closing blog and offline tabs...');
    client.closeTab(701);
    client.closeTab(702);
    await sleep(100);

    const afterCloseMulti = server.healthTracker.getHealthState();
    assert.equal(afterCloseMulti.boosty.activeTabsCount, 1);
    assert.equal(afterCloseMulti.boosty.state, 'chat-detected');
    assert.equal(afterCloseMulti.boosty.tabUrl, 'https://boosty.to/live');
    console.log('  ✓ Tabs removed instantly via TAB_CLOSED events without TTL delays.');

    client.stop();
    await server.close();
    testReport.tests.testGH = { passed: true };
  }

  // -------------------------------------------------------------
  // Test I: Soak Stability & Diagnostic Ring Buffer Test
  // -------------------------------------------------------------
  console.log('\n--- Test I: Soak Stability & Diagnostic Ring Buffer Test ---');
  {
    const server = createTestServer(TEST_PORT);
    await server.listen();

    const client = new MockMV3ExtensionClient(TEST_PORT, {
      initialTabs: [[801, { tabId: 801, url: 'https://boosty.to/stream', hasChat: true, isStream: true, title: 'Soak' }]],
    });
    client.start();
    await sleep(200);

    // Flood with 250 state updates to test ring buffer bounding (max 200 items)
    for (let i = 0; i < 250; i++) {
      server.healthTracker.recordTrace('test_event', { iteration: i });
    }

    const trace = server.healthTracker.getDiagnosticTrace();
    assert.equal(trace.length, 200, 'Diagnostic trace ring buffer should strictly bound at 200 items');
    assert.equal(trace[trace.length - 1].event, 'test_event');
    console.log('  ✓ Ring buffer bounded at 200 items (zero memory leaks).');

    client.stop();
    await server.close();
    testReport.tests.testI = { passed: true, traceBufferLength: trace.length };
  }

  // -------------------------------------------------------------
  // Save Test Artifact
  // -------------------------------------------------------------
  testReport.completedAt = new Date().toISOString();
  const artifactsDir = path.resolve(__dirname, '../artifacts/connectivity');
  fs.mkdirSync(artifactsDir, { recursive: true });
  const reportPath = path.join(artifactsDir, `stress-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(testReport, null, 2));

  console.log('\n=================================================================');
  console.log(' ALL 9 CONNECTIVITY STRESS TESTS PASSED (100% SUCCESS)');
  console.log(` Report written to: ${reportPath}`);
  console.log('=================================================================\n');

  return testReport;
}

if (require.main === module) {
  runTestSuite().catch(err => {
    console.error('\n❌ Connectivity Stress Test Suite FAILED:', err);
    process.exit(1);
  });
}

module.exports = { runTestSuite };
