const test = require('node:test');
const assert = require('node:assert/strict');
const { compareSemver, createHealthTracker, HEALTH_TIMINGS } = require('../core/health/tracker.js');

test('compareSemver handles semantic version comparisons', () => {
  assert.equal(compareSemver('0.4.0', '0.4.0'), 0);
  assert.equal(compareSemver('0.4.1', '0.4.0'), 1);
  assert.equal(compareSemver('0.3.9', '0.4.0'), -1);
  assert.equal(compareSemver('v1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.2.0', '1.10.0'), -1);
  assert.equal(compareSemver(null, '1.0.0'), 0);
});

test('createHealthTracker tracks lifecycle states, connector, tabs and message state', () => {
  const baseTime = 100_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    bundledExtensionVersion: '0.4.0',
    serverStartedAt: baseTime,
    silent: true,
  });

  // Initial state during startup grace: checking
  const initial = tracker.getHealthState({ now: baseTime });
  assert.equal(initial.ok, true);
  assert.equal(initial.appVersion, '0.4.0');
  assert.equal(initial.receivedMessages, 0);
  assert.equal(initial.extension.state, 'checking');
  assert.equal(initial.boosty.state, 'checking');
  assert.equal(initial.extensionConnected, false);
  assert.equal(initial.boostyConnected, false);

  // Heartbeat from extension background
  tracker.updateConnector({ extensionVersion: '0.3.0', source: 'background' }, baseTime + 1000);
  const afterHeartbeat = tracker.getHealthState({ now: baseTime + 2000, overlayClients: 1, historyCount: 0 });
  assert.equal(afterHeartbeat.extension.state, 'connected');
  assert.equal(afterHeartbeat.extensionConnected, true);
  assert.equal(afterHeartbeat.isOutdated, true); // 0.3.0 < 0.4.0
  assert.equal(afterHeartbeat.overlayClients, 1);

  // Content tab heartbeat (tab detected, no chat yet)
  tracker.updateConnector({
    extensionVersion: '0.4.0',
    source: 'content_tab',
    url: 'https://boosty.to/stream',
    hasChat: false,
  }, baseTime + 3000);

  const afterContentTab = tracker.getHealthState({ now: baseTime + 4000 });
  assert.equal(afterContentTab.extension.state, 'connected');
  assert.equal(afterContentTab.boosty.state, 'tab-detected');
  assert.equal(afterContentTab.boostyConnected, true);
  assert.equal(afterContentTab.boosty.hasChat, false);
  assert.equal(afterContentTab.boostyTabUrl, 'https://boosty.to/stream');
  assert.equal(afterContentTab.isOutdated, false); // 0.4.0 === 0.4.0

  // Record a regular message (chat detected)
  tracker.recordMessage({ extensionVersion: '0.4.0', now: baseTime + 5000 });
  const afterMessage = tracker.getHealthState({ now: baseTime + 6000, historyCount: 1 });
  assert.equal(afterMessage.receivedMessages, 1);
  assert.equal(afterMessage.lastMessageAt, baseTime + 5000);
  assert.equal(afterMessage.boosty.state, 'chat-detected');
  assert.equal(afterMessage.boosty.hasChat, true);

  // Reconnecting transition (7 seconds after message, >5s and <15s)
  const reconnecting = tracker.getHealthState({ now: baseTime + 12_000 });
  assert.equal(reconnecting.extension.state, 'reconnecting');
  assert.equal(reconnecting.extensionConnected, false);
  assert.equal(reconnecting.boosty.state, 'chat-detected');

  // Unavailable transition (>15s since last signal)
  const unavailable = tracker.getHealthState({ now: baseTime + 25_000 });
  assert.equal(unavailable.extension.state, 'unavailable');
  assert.equal(unavailable.boosty.state, 'unavailable');
  assert.equal(unavailable.extensionConnected, false);
  assert.equal(unavailable.boostyConnected, false);
});

test('createHealthTracker handles background tabs array with multiple tabs', () => {
  const baseTime = 200_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    serverStartedAt: baseTime,
    silent: true,
  });

  tracker.updateConnector({
    extensionVersion: '0.4.0',
    source: 'background',
    tabs: [
      { tabId: 1, url: 'https://boosty.to/channel1', hasChat: false, lastSeenAt: baseTime + 1000 },
      { tabId: 2, url: 'https://boosty.to/channel2/stream', hasChat: true, lastSeenAt: baseTime + 1500 },
    ],
  }, baseTime + 2000);

  const state = tracker.getHealthState({ now: baseTime + 2500 });
  assert.equal(state.extension.state, 'connected');
  assert.equal(state.boosty.state, 'chat-detected');
  assert.equal(state.boosty.hasChat, true);
  assert.equal(state.boosty.tabUrl, 'https://boosty.to/channel2/stream');
  assert.equal(state.boosty.activeTabsCount, 2);
});

test('createHealthTracker startup grace period transitions from checking to unavailable', () => {
  const baseTime = 300_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    serverStartedAt: baseTime,
    startupGraceMs: 6000,
    silent: true,
  });

  // During grace (0-6s): checking
  const duringGrace = tracker.getHealthState({ now: baseTime + 3000 });
  assert.equal(duringGrace.extension.state, 'checking');
  assert.equal(duringGrace.boosty.state, 'checking');

  // Past grace (7s): unavailable
  const pastGrace = tracker.getHealthState({ now: baseTime + 7000 });
  assert.equal(pastGrace.extension.state, 'unavailable');
  assert.equal(pastGrace.boosty.state, 'unavailable');
});

test('createHealthTracker handles WebSocket connection lifecycle and generation guards', () => {
  const baseTime = 400_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    serverStartedAt: baseTime,
    silent: true,
  });

  // 1. Initial state
  const initial = tracker.getHealthState({ now: baseTime });
  assert.equal(initial.transport, 'none');
  assert.equal(initial.connectionId, null);

  // 2. Register WebSocket connection (generation 1)
  tracker.registerWsConnection('conn-1', {
    extensionVersion: '0.4.0',
    tabs: [{ tabId: 101, url: 'https://boosty.to/stream', hasChat: true, isStream: true }],
  }, baseTime + 500);

  const connectedState = tracker.getHealthState({ now: baseTime + 600 });
  assert.equal(connectedState.transport, 'websocket');
  assert.equal(connectedState.connectionId, 'conn-1');
  assert.equal(connectedState.connectionGeneration, 1);
  assert.equal(connectedState.extension.state, 'connected');
  assert.equal(connectedState.boosty.state, 'chat-detected');
  assert.equal(connectedState.boosty.activeTabsCount, 1);

  // 3. Stale disconnect from older/non-existent connection should be rejected
  const staleRes = tracker.unregisterWsConnection('conn-old', 'network', baseTime + 700);
  assert.equal(staleRes, false);
  const stillConnected = tracker.getHealthState({ now: baseTime + 800 });
  assert.equal(stillConnected.extension.state, 'connected');

  // 4. Valid disconnect transitions to reconnecting and retains tab state (Requirement 14)
  const validRes = tracker.unregisterWsConnection('conn-1', 'closed', baseTime + 1000);
  assert.equal(validRes, true);

  const reconnectingState = tracker.getHealthState({ now: baseTime + 1200 });
  assert.equal(reconnectingState.extension.state, 'reconnecting');
  assert.equal(reconnectingState.boosty.state, 'chat-detected'); // Tab retained during reconnect!

  // 5. New connection establishes generation 2
  tracker.registerWsConnection('conn-2', {
    extensionVersion: '0.4.0',
    extensionId: 'bcoadgccgjomlcadhmeognidaoocohdp',
    tabs: [{ tabId: 101, url: 'https://boosty.to/stream', hasChat: true, isStream: true }],
  }, baseTime + 2000);

  const reconnectedState = tracker.getHealthState({ now: baseTime + 2100 });
  assert.equal(reconnectedState.extension.state, 'connected');
  assert.equal(reconnectedState.extensionId, 'bcoadgccgjomlcadhmeognidaoocohdp');
  assert.equal(reconnectedState.extension.extensionId, 'bcoadgccgjomlcadhmeognidaoocohdp');
  assert.equal(reconnectedState.connectionId, 'conn-2');
  assert.equal(reconnectedState.connectionGeneration, 2);

  // 6. Event-driven tab update and removal
  tracker.updateTabState({ tabId: 102, url: 'https://boosty.to/blog', hasChat: false }, 'conn-2', baseTime + 2500);
  const stateWithTwoTabs = tracker.getHealthState({ now: baseTime + 2600 });
  assert.equal(stateWithTwoTabs.boosty.activeTabsCount, 2);

  tracker.removeTab(101, 'conn-2');
  const stateWithOneTab = tracker.getHealthState({ now: baseTime + 2700 });
  assert.equal(stateWithOneTab.boosty.activeTabsCount, 1);
  assert.equal(stateWithOneTab.boosty.state, 'tab-detected');

  // 7. Diagnostic trace buffer contains recorded events
  const trace = tracker.getDiagnosticTrace();
  assert.ok(trace.length >= 4);
  assert.ok(trace.some(e => e.event === 'extension_ws_connected'));
  assert.ok(trace.some(e => e.event === 'extension_ws_disconnected'));
});
