const test = require('node:test');
const assert = require('node:assert/strict');
const { compareSemver, createHealthTracker } = require('../core/health/tracker.js');

test('compareSemver handles semantic version comparisons', () => {
  assert.equal(compareSemver('0.4.0', '0.4.0'), 0);
  assert.equal(compareSemver('0.4.1', '0.4.0'), 1);
  assert.equal(compareSemver('0.3.9', '0.4.0'), -1);
  assert.equal(compareSemver('v1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.2.0', '1.10.0'), -1);
  assert.equal(compareSemver(null, '1.0.0'), 0);
});

test('createHealthTracker tracks connector and message state', () => {
  const baseTime = 100_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    bundledExtensionVersion: '0.4.0',
  });

  // Initial state
  const initial = tracker.getHealthState({ now: baseTime });
  assert.equal(initial.ok, true);
  assert.equal(initial.appVersion, '0.4.0');
  assert.equal(initial.receivedMessages, 0);
  assert.equal(initial.connectorConnected, false);
  assert.equal(initial.extensionConnected, false);
  assert.equal(initial.boostyConnected, false);

  // Heartbeat from extension background
  tracker.updateConnector({ extensionVersion: '0.3.0', source: 'background' }, baseTime + 1000);
  const afterHeartbeat = tracker.getHealthState({ now: baseTime + 2000, overlayClients: 1, historyCount: 0 });
  assert.equal(afterHeartbeat.connectorConnected, true);
  assert.equal(afterHeartbeat.extensionConnected, true);
  assert.equal(afterHeartbeat.boostyConnected, false);
  assert.equal(afterHeartbeat.isOutdated, true); // 0.3.0 < 0.4.0
  assert.equal(afterHeartbeat.overlayClients, 1);

  // Content tab heartbeat
  tracker.updateConnector({
    extensionVersion: '0.4.0',
    source: 'content_tab',
    url: 'https://boosty.to/stream',
  }, baseTime + 3000);

  const afterContentTab = tracker.getHealthState({ now: baseTime + 4000 });
  assert.equal(afterContentTab.boostyConnected, true);
  assert.equal(afterContentTab.boostyTabUrl, 'https://boosty.to/stream');
  assert.equal(afterContentTab.isOutdated, false); // 0.4.0 === 0.4.0

  // Record a regular message
  tracker.recordMessage({ extensionVersion: '0.4.0', now: baseTime + 5000 });
  const afterMessage = tracker.getHealthState({ now: baseTime + 6000, historyCount: 1 });
  assert.equal(afterMessage.receivedMessages, 1);
  assert.equal(afterMessage.lastMessageAt, baseTime + 5000);
  assert.equal(afterMessage.historyCount, 1);

  // Time decay: 15s later -> connector disconnected (>12s), extension still connected (<60s)
  const later = tracker.getHealthState({ now: baseTime + 20_000 });
  assert.equal(later.connectorConnected, false);
  assert.equal(later.boostyConnected, false);
  assert.equal(later.extensionConnected, true);

  // 70s later -> all disconnected (>60s)
  const muchLater = tracker.getHealthState({ now: baseTime + 75_000 });
  assert.equal(muchLater.extensionConnected, false);
});
