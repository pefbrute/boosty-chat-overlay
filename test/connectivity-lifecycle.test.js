'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHealthTracker } = require('../core/health/tracker.js');
const { deriveSystemStatus } = require('../desktop/ui/status-hub.js');

test('Delayed heartbeat test: 0-3s checking, then connected without premature unavailable', () => {
  const baseTime = 100_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    serverStartedAt: baseTime,
    startupGraceMs: 6_000,
    silent: true,
  });

  // At 1s: checking
  const t1 = tracker.getHealthState({ now: baseTime + 1000 });
  assert.equal(t1.extension.state, 'checking');
  assert.equal(t1.boosty.state, 'checking');

  const ui1 = deriveSystemStatus({ health: t1, isChecking: true });
  assert.equal(ui1.extension.status, 'checking');
  assert.equal(ui1.extension.text, 'Проверяем…');
  assert.equal(ui1.stream.status, 'checking');
  assert.equal(ui1.stream.text, 'Ожидаем расширение');
  assert.equal(ui1.overall.status, 'connecting');
  assert.equal(ui1.overall.title, 'Восстанавливаем подключение');
  assert.equal(ui1.extension.action, null);
  assert.equal(ui1.stream.action, null);

  // At 3s: Delayed heartbeat arrives
  tracker.updateConnector({
    source: 'content_tab',
    extensionVersion: '0.4.0',
    url: 'https://boosty.to/stream',
    hasChat: true,
  }, baseTime + 3000);

  // At 3.1s: connected & chat-detected
  const t2 = tracker.getHealthState({ now: baseTime + 3100 });
  assert.equal(t2.extension.state, 'connected');
  assert.equal(t2.boosty.state, 'chat-detected');

  const ui2 = deriveSystemStatus({
    health: t2,
    obs: { ok: true, connected: true, scenes: [{ sceneName: 'Main', hasChat: true }] },
  });
  assert.equal(ui2.extension.status, 'connected');
  assert.equal(ui2.extension.text, 'Активно');
  assert.equal(ui2.stream.status, 'connected');
  assert.equal(ui2.stream.text, 'Чат подключён');
  assert.equal(ui2.overall.status, 'ready');
});

test('Timeout test: checking -> unavailable ONLY after configured grace period', () => {
  const baseTime = 200_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    serverStartedAt: baseTime,
    startupGraceMs: 6_000,
    silent: true,
  });

  // At 2s: checking
  const at2s = tracker.getHealthState({ now: baseTime + 2000 });
  assert.equal(at2s.extension.state, 'checking');
  assert.equal(at2s.boosty.state, 'checking');

  // At 5.5s (before 6s grace timeout): still checking
  const at55s = tracker.getHealthState({ now: baseTime + 5500 });
  assert.equal(at55s.extension.state, 'checking');
  assert.equal(at55s.boosty.state, 'checking');

  // At 6.5s (after grace timeout): unavailable
  const at65s = tracker.getHealthState({ now: baseTime + 6500 });
  assert.equal(at65s.extension.state, 'unavailable');
  assert.equal(at65s.boosty.state, 'unavailable');

  const ui = deriveSystemStatus({ health: at65s, isChecking: false });
  assert.equal(ui.extension.status, 'not-detected');
  assert.equal(ui.extension.text, 'Не обнаружено');
  assert.equal(ui.stream.status, 'not-found');
  assert.equal(ui.stream.text, 'Вкладка не найдена');
  assert.equal(ui.overall.status, 'setup-required');
});

test('Reconnect test: connected -> heartbeat stops -> reconnecting -> heartbeat resumes -> connected', () => {
  const baseTime = 300_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    serverStartedAt: baseTime,
    silent: true,
  });

  // Signal received
  tracker.updateConnector({ source: 'background', extensionVersion: '0.4.0' }, baseTime);

  // At 2s: connected
  const state1 = tracker.getHealthState({ now: baseTime + 2000 });
  assert.equal(state1.extension.state, 'connected');

  // At 7s (>5s, <15s without signal): reconnecting
  const state2 = tracker.getHealthState({ now: baseTime + 7000 });
  assert.equal(state2.extension.state, 'reconnecting');
  assert.equal(state2.extension.lastSeenSecondsAgo, 7);

  const ui2 = deriveSystemStatus({ health: state2 });
  assert.equal(ui2.extension.status, 'reconnecting');
  assert.equal(ui2.extension.badgeClass, 'warning');
  assert.match(ui2.extension.detail, /7 сек назад/);
  assert.equal(ui2.overall.status, 'connecting');

  // Heartbeat resumes at 9s
  tracker.updateConnector({ source: 'background', extensionVersion: '0.4.0' }, baseTime + 9000);

  // At 9.5s: immediately connected again
  const state3 = tracker.getHealthState({ now: baseTime + 9500 });
  assert.equal(state3.extension.state, 'connected');
  assert.equal(state3.extension.lastSeenSecondsAgo, 0);

  const ui3 = deriveSystemStatus({ health: state3 });
  assert.equal(ui3.extension.status, 'connected');
  assert.equal(ui3.extension.text, 'Активно');
});

test('Browser restart test: connected -> extension loss -> unavailable -> announce -> connected', () => {
  const baseTime = 400_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    serverStartedAt: baseTime,
    silent: true,
  });

  // Initial connection
  tracker.updateConnector({ source: 'background', extensionVersion: '0.4.0' }, baseTime);

  // Browser closes, no heartbeats for 20 seconds
  const lost = tracker.getHealthState({ now: baseTime + 20_000 });
  assert.equal(lost.extension.state, 'unavailable');

  // Browser restarts and extension sends immediate announce
  tracker.updateConnector({
    source: 'content_tab',
    extensionVersion: '0.4.0',
    url: 'https://boosty.to/stream',
    hasChat: true,
  }, baseTime + 22_000);

  // Seamless recovery to connected & chat-detected
  const recovered = tracker.getHealthState({ now: baseTime + 22_100 });
  assert.equal(recovered.extension.state, 'connected');
  assert.equal(recovered.boosty.state, 'chat-detected');
});

test('Boosty tab lifecycle test: tab announce -> tab-detected -> chat attach -> chat-detected -> tab close', () => {
  const baseTime = 500_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    serverStartedAt: baseTime,
    startupGraceMs: 4000,
    silent: true,
  });

  // Step 1: Extension background connected, no Boosty tab yet (after grace)
  tracker.updateConnector({ source: 'background', extensionVersion: '0.4.0' }, baseTime + 4500);
  const step1 = tracker.getHealthState({ now: baseTime + 4600 });
  assert.equal(step1.extension.state, 'connected');
  assert.equal(step1.boosty.state, 'unavailable');

  const ui1 = deriveSystemStatus({ health: step1 });
  assert.equal(ui1.stream.status, 'not-found');
  assert.equal(ui1.stream.text, 'Вкладка не найдена');
  assert.match(ui1.overall.title, /Вкладка Boosty не найдена/);

  // Step 2: User opens Boosty channel page (no chat container yet)
  tracker.updateConnector({
    source: 'content_tab',
    tabSessionId: 'tab-1',
    extensionVersion: '0.4.0',
    url: 'https://boosty.to/my_channel',
    hasChat: false,
  }, baseTime + 5000);

  const step2 = tracker.getHealthState({ now: baseTime + 5100 });
  assert.equal(step2.boosty.state, 'tab-detected');
  assert.equal(step2.boosty.hasChat, false);

  const ui2 = deriveSystemStatus({ health: step2 });
  assert.equal(ui2.stream.status, 'tab-detected');
  assert.equal(ui2.stream.text, 'Вкладка открыта');

  // Step 3: Stream chat container loads in DOM -> immediate announce with hasChat: true
  tracker.updateConnector({
    source: 'content_tab',
    tabSessionId: 'tab-1',
    extensionVersion: '0.4.0',
    url: 'https://boosty.to/my_channel/streams',
    hasChat: true,
  }, baseTime + 7000);

  const step3 = tracker.getHealthState({ now: baseTime + 7100 });
  assert.equal(step3.boosty.state, 'chat-detected');
  assert.equal(step3.boosty.hasChat, true);

  const ui3 = deriveSystemStatus({
    health: step3,
    obs: { ok: true, connected: true, scenes: [{ sceneName: 'Main', hasChat: true }] },
  });
  assert.equal(ui3.stream.status, 'connected');
  assert.equal(ui3.stream.text, 'Чат подключён');
  assert.equal(ui3.overall.status, 'ready');

  // Step 4: Tab is closed (no updates for > 15s)
  const step4 = tracker.getHealthState({ now: baseTime + 23_000 });
  assert.equal(step4.boosty.state, 'unavailable');

  const ui4 = deriveSystemStatus({ health: step4 });
  assert.equal(ui4.stream.status, 'not-found');
  assert.equal(ui4.stream.text, 'Вкладка не найдена');
});

test('Multiple Boosty tabs test: avoids status flapping between tabs', () => {
  const baseTime = 600_000;
  const tracker = createHealthTracker({
    appVersion: '0.4.0',
    serverStartedAt: baseTime,
    silent: true,
  });

  // Tab 1 is on channel overview (hasChat: false)
  tracker.updateConnector({
    source: 'content_tab',
    tabSessionId: 'tab-overview',
    extensionVersion: '0.4.0',
    url: 'https://boosty.to/channel',
    hasChat: false,
  }, baseTime + 1000);

  // Tab 2 is on active stream (hasChat: true)
  tracker.updateConnector({
    source: 'content_tab',
    tabSessionId: 'tab-stream',
    extensionVersion: '0.4.0',
    url: 'https://boosty.to/channel/streams',
    hasChat: true,
  }, baseTime + 1500);

  // Both tabs are alive: chat-detected takes precedence
  const state1 = tracker.getHealthState({ now: baseTime + 2000 });
  assert.equal(state1.boosty.state, 'chat-detected');
  assert.equal(state1.boosty.hasChat, true);
  assert.equal(state1.boosty.tabUrl, 'https://boosty.to/channel/streams');

  // Even when tab-overview ticks again, chat-detected remains stable
  tracker.updateConnector({
    source: 'content_tab',
    tabSessionId: 'tab-overview',
    extensionVersion: '0.4.0',
    url: 'https://boosty.to/channel',
    hasChat: false,
  }, baseTime + 3000);

  const state2 = tracker.getHealthState({ now: baseTime + 3100 });
  assert.equal(state2.boosty.state, 'chat-detected');
  assert.equal(state2.boosty.hasChat, true);
  assert.equal(state2.boosty.tabUrl, 'https://boosty.to/channel/streams');
});

test('Deterministic Progress & ETA: elapsed increments, milestones, and longer-than-usual threshold', () => {
  const baseTime = 1700000000000;
  const tracker = createHealthTracker({
    connectorTimeoutMs: 15000,
    checkGracePeriodMs: 10000,
    nowFn: () => baseTime,
  });

  // At 1.2s: checking, under threshold
  const t1 = tracker.getHealthState({ now: baseTime + 1200 });
  const ui1 = deriveSystemStatus({
    health: t1,
    isChecking: true,
    elapsedMs: 1200,
  });
  assert.equal(ui1.overall.status, 'connecting');
  assert.equal(ui1.overall.title, 'Восстанавливаем подключение');
  assert.equal(ui1.overall.progress.isLongerThanUsual, false);
  assert.equal(ui1.overall.progress.elapsedText, 'Прошло 1.2 сек');
  assert.equal(ui1.overall.progress.expectedText, 'Обычно занимает до 5 сек');
  assert.equal(ui1.overall.progress.milestones[0].state, 'done');    // Server
  assert.equal(ui1.overall.progress.milestones[1].state, 'active');  // Extension
  assert.equal(ui1.overall.progress.milestones[2].state, 'pending'); // Tab
  assert.equal(ui1.overall.progress.milestones[3].state, 'pending'); // Chat

  // At 5.8s: elapsed > normal threshold (5.5s) -> "Это занимает чуть дольше обычного…"
  const t2 = tracker.getHealthState({ now: baseTime + 5800 });
  const ui2 = deriveSystemStatus({
    health: t2,
    isChecking: true,
    elapsedMs: 5800,
  });
  assert.equal(ui2.overall.status, 'connecting');
  assert.equal(ui2.overall.title, 'Это занимает чуть дольше обычного…');
  assert.equal(ui2.overall.progress.isLongerThanUsual, true);
  assert.equal(ui2.overall.progress.elapsedText, 'Прошло 5.8 сек');
  assert.equal(ui2.overall.progress.expectedText, 'Обычно занимает до 5 сек');
  assert.equal(ui2.extension.action, null); // Still checking, NO premature CTA

  // At 11s: after grace period (10s) -> true timeout
  const t3 = tracker.getHealthState({ now: baseTime + 11000 });
  const ui3 = deriveSystemStatus({
    health: t3,
    isChecking: false,
    elapsedMs: 11000,
  });
  assert.equal(ui3.overall.status, 'setup-required');
  assert.equal(ui3.overall.title, 'Расширение не отвечает');
  assert.equal(ui3.extension.status, 'not-detected');
  assert.equal(ui3.extension.action.id, 'setup-ext'); // Action CTA appears ONLY on true timeout
});

test('Deterministic Recovery & Success Toast: transition displays recovery duration', () => {
  const baseTime = 1700000000000;
  const tracker = createHealthTracker({
    nowFn: () => baseTime,
  });

  // Fully connected
  tracker.updateConnector({
    source: 'content_tab',
    extensionVersion: '0.4.0',
    url: 'https://boosty.to/stream',
    hasChat: true,
  }, baseTime + 2400);

  const health = tracker.getHealthState({ now: baseTime + 2450 });
  const obs = {
    ok: true,
    connected: true,
    scenes: [{ sceneName: 'Main', hasChat: true }],
  };

  // UI in recovery flash (first 2 seconds after ready)
  const uiRecovered = deriveSystemStatus({
    health,
    obs,
    isRecoveredRecently: true,
    recoveryDurationMs: 2450,
  });
  assert.equal(uiRecovered.overall.ready, true);
  assert.equal(uiRecovered.overall.status, 'ready');
  assert.equal(uiRecovered.overall.title, 'Подключение восстановлено');
  assert.equal(uiRecovered.overall.desc, 'Подключение восстановлено за 2.5 сек');
  assert.equal(uiRecovered.overall.progress.phase, 'recovered');

  // UI after recovery flash has elapsed -> settled compact ready state
  const uiSettled = deriveSystemStatus({
    health,
    obs,
    isRecoveredRecently: false,
  });
  assert.equal(uiSettled.overall.ready, true);
  assert.equal(uiSettled.overall.status, 'ready');
  assert.equal(uiSettled.overall.title, 'Готово к стриму');
  assert.equal(uiSettled.overall.desc, 'Все компоненты активны и получают сообщения');
  assert.equal(uiSettled.overall.progress.phase, 'idle');
});

