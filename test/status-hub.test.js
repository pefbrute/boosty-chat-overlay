const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveSystemStatus } = require('../desktop/ui/status-hub.js');

test('deriveSystemStatus: all systems working', () => {
  const state = {
    health: {
      extension: { state: 'connected', version: '0.4.0' },
      boosty: { state: 'chat-detected', tabUrl: 'https://boosty.to/streamer_live', hasChat: true },
      extensionConnected: true,
      extensionVersion: '0.4.0',
      isOutdated: false,
      boostyConnected: true,
      boostyTabUrl: 'https://boosty.to/streamer_live',
      receivedMessages: 15,
    },
    obs: {
      ok: true,
      connected: true,
      scenes: [
        { sceneUuid: 'sc-1', sceneName: 'Gameplay', hasChat: true },
      ],
    },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.overall.ready, true);
  assert.equal(status.overall.status, 'ready');

  // OBS
  assert.equal(status.obs.status, 'connected');
  assert.equal(status.obs.badgeClass, 'ready');
  assert.match(status.obs.detail, /Gameplay/);

  // Extension
  assert.equal(status.extension.status, 'connected');
  assert.equal(status.extension.badgeClass, 'ready');
  assert.match(status.extension.detail, /v0\.4\.0/);

  // Stream
  assert.equal(status.stream.status, 'connected');
  assert.equal(status.stream.badgeClass, 'ready');
  assert.match(status.stream.detail, /boosty\.to\/streamer_live/);

  // Overlay
  assert.equal(status.overlay.status, 'ready');
  assert.equal(status.overlay.badgeClass, 'ready');
  assert.match(status.overlay.detail, /Gameplay/);
  assert.equal(status.overlay.action.id, 'test-overlay');
});

test('deriveSystemStatus: Startup checking state displays calm connecting banner without CTAs', () => {
  const state = {
    health: {
      extension: { state: 'checking' },
      boosty: { state: 'checking' },
    },
    obs: { ok: false, connected: false },
    isChecking: true,
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.overall.ready, false);
  assert.equal(status.overall.status, 'connecting');
  assert.match(status.overall.title, /Восстанавливаем подключение/);
  assert.match(status.overall.desc, /Проверяем браузер и расширение/);

  assert.equal(status.extension.status, 'checking');
  assert.equal(status.extension.text, 'Проверяем…');
  assert.equal(status.extension.action, null); // No premature CTA!

  // Sequential dependency: while extension is checking, Boosty card shows "Ожидаем расширение"
  assert.equal(status.stream.status, 'checking');
  assert.equal(status.stream.text, 'Ожидаем расширение');
  assert.equal(status.stream.action, null); // No premature CTA!
});

test('deriveSystemStatus: Progress milestones and live ETA during checking (< 5.5s)', () => {
  const state = {
    health: {
      extension: { state: 'checking' },
      boosty: { state: 'checking' },
    },
    isChecking: true,
    elapsedMs: 2400,
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.overall.status, 'connecting');
  assert.equal(status.overall.title, 'Восстанавливаем подключение');
  assert.equal(status.overall.progress.phase, 'checking');
  assert.equal(status.overall.progress.isLongerThanUsual, false);
  assert.equal(status.overall.progress.elapsedText, 'Прошло 2.4 сек');
  assert.equal(status.overall.progress.expectedText, 'Обычно занимает до 5 сек');

  const milestones = status.overall.progress.milestones;
  assert.equal(milestones.length, 4);
  assert.equal(milestones[0].id, 'server');
  assert.equal(milestones[0].state, 'done');
  assert.equal(milestones[1].id, 'extension');
  assert.equal(milestones[1].state, 'active');
  assert.equal(milestones[2].id, 'tab');
  assert.equal(milestones[2].state, 'pending');
  assert.equal(milestones[3].id, 'chat');
  assert.equal(milestones[3].state, 'pending');
});

test('deriveSystemStatus: Longer than usual threshold copy (>= 5.5s)', () => {
  const state = {
    health: {
      extension: { state: 'checking' },
      boosty: { state: 'checking' },
    },
    isChecking: true,
    elapsedMs: 6200,
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.overall.status, 'connecting');
  assert.equal(status.overall.title, 'Это занимает чуть дольше обычного…');
  assert.equal(status.overall.progress.isLongerThanUsual, true);
  assert.equal(status.overall.progress.elapsedText, 'Прошло 6.2 сек');
  assert.equal(status.overall.progress.expectedText, 'Обычно занимает до 5 сек');
});

test('deriveSystemStatus: Sequential dependency: Boosty card searches tabs once extension connects', () => {
  const state = {
    health: {
      extension: { state: 'connected', version: '0.4.0' },
      boosty: { state: 'checking' },
    },
    isChecking: true,
    elapsedMs: 3100,
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.extension.status, 'connected');
  assert.equal(status.stream.status, 'checking');
  assert.equal(status.stream.text, 'Ищем вкладку…');

  const milestones = status.overall.progress.milestones;
  assert.equal(milestones[0].state, 'done'); // Server
  assert.equal(milestones[1].state, 'done'); // Extension connected
  assert.equal(milestones[2].state, 'active'); // Tab searching active
  assert.equal(milestones[3].state, 'pending'); // Chat pending
});

test('deriveSystemStatus: Recovery toast banner and duration', () => {
  const state = {
    health: {
      extension: { state: 'connected', version: '0.4.0' },
      boosty: { state: 'chat-detected', tabUrl: 'https://boosty.to/stream', hasChat: true },
      extensionConnected: true,
      boostyConnected: true,
    },
    obs: {
      ok: true,
      connected: true,
      scenes: [{ sceneName: 'Stream', hasChat: true }],
    },
    isRecoveredRecently: true,
    recoveryDurationMs: 2500,
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.overall.ready, true);
  assert.equal(status.overall.status, 'ready');
  assert.equal(status.overall.title, 'Подключение восстановлено');
  assert.equal(status.overall.desc, 'Подключение восстановлено за 2.5 сек');
  assert.equal(status.overall.progress.phase, 'recovered');
  assert.equal(status.overall.progress.recoveryText, 'Подключение восстановлено за 2.5 сек');
});

test('deriveSystemStatus: Reconnecting state shows warning with seconds elapsed', () => {
  const state = {
    health: {
      extension: { state: 'reconnecting', lastSeenSecondsAgo: 7 },
      boosty: { state: 'tab-detected', tabUrl: 'https://boosty.to/channel' },
      extensionConnected: false,
      boostyConnected: true,
    },
    obs: { ok: true, connected: true, scenes: [{ sceneName: 'Main', hasChat: true }] },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.extension.status, 'reconnecting');
  assert.equal(status.extension.badgeClass, 'warning');
  assert.match(status.extension.text, /Переподключение/);
  assert.match(status.extension.detail, /7 сек назад/);
  assert.equal(status.extension.action, null);

  assert.equal(status.overall.status, 'connecting');
  assert.match(status.overall.title, /Переподключение/);
});

test('deriveSystemStatus: Tab detected vs Chat detected', () => {
  const stateTabOnly = {
    health: {
      extension: { state: 'connected', version: '0.4.0' },
      boosty: { state: 'tab-detected', tabUrl: 'https://boosty.to/channel', hasChat: false },
      extensionConnected: true,
      boostyConnected: true,
    },
    obs: { ok: true, connected: true, scenes: [{ sceneName: 'Main', hasChat: true }] },
  };

  const status = deriveSystemStatus(stateTabOnly);
  assert.equal(status.stream.status, 'tab-detected');
  assert.equal(status.stream.text, 'Вкладка открыта');
  assert.match(status.stream.detail, /boosty\.to\/channel/);

  const stateChat = {
    health: {
      extension: { state: 'connected', version: '0.4.0' },
      boosty: { state: 'chat-detected', tabUrl: 'https://boosty.to/channel/streams', hasChat: true },
      extensionConnected: true,
      boostyConnected: true,
    },
    obs: { ok: true, connected: true, scenes: [{ sceneName: 'Main', hasChat: true }] },
  };

  const statusChat = deriveSystemStatus(stateChat);
  assert.equal(statusChat.stream.status, 'connected');
  assert.equal(statusChat.stream.text, 'Чат подключён');
});

test('deriveSystemStatus: OBS not running shows CTA launch-obs', () => {
  const state = {
    health: { extensionConnected: true, boostyConnected: true },
    obs: { ok: false, connected: false },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.overall.ready, false);
  assert.equal(status.obs.status, 'not-running');
  assert.equal(status.obs.action.id, 'launch-obs');
  assert.match(status.obs.action.label, /Запустить OBS/);
  assert.equal(status.overlay.status, 'obs-disconnected');
});

test('deriveSystemStatus: Extension offline shows CTA setup-ext and clean tab-missing status', () => {
  const state = {
    health: { extensionConnected: false, boostyConnected: false },
    obs: { ok: true, connected: true, scenes: [{ sceneName: 'Main', hasChat: false }] },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.extension.status, 'not-detected');
  assert.equal(status.extension.action.id, 'setup-ext');
  assert.equal(status.stream.status, 'not-found');
  assert.equal(status.stream.text, 'Вкладка не найдена');
  assert.match(status.overall.title, /Расширение не отвечает/);
});

test('deriveSystemStatus: Outdated extension shows update CTA', () => {
  const state = {
    health: {
      extension: { state: 'connected', version: '0.2.0' },
      extensionConnected: true,
      extensionVersion: '0.2.0',
      isOutdated: true,
      bundledExtensionVersion: '0.4.0',
    },
    obs: { ok: true, connected: true },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.extension.status, 'outdated');
  assert.equal(status.extension.badgeClass, 'warning');
  assert.equal(status.extension.action.id, 'update-ext');
  assert.match(status.extension.detail, /v0\.4\.0/);
});

test('deriveSystemStatus: Boosty page missing shows CTA open-boosty', () => {
  const state = {
    health: {
      extension: { state: 'connected', version: '0.4.0' },
      boosty: { state: 'unavailable' },
      extensionConnected: true,
      boostyConnected: false,
    },
    obs: { ok: true, connected: true },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.stream.status, 'not-found');
  assert.equal(status.stream.text, 'Вкладка не найдена');
  assert.equal(status.stream.action.id, 'open-boosty');
  assert.match(status.stream.action.label, /Открыть Boosty/);
  assert.match(status.overall.title, /Вкладка Boosty не найдена/);
});

test('deriveSystemStatus: Overlay missing shows CTA add-overlay', () => {
  const state = {
    health: { extensionConnected: true, boostyConnected: true },
    obs: {
      ok: true,
      connected: true,
      scenes: [
        { sceneUuid: 's1', sceneName: 'Gaming', hasChat: false },
      ],
    },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.overlay.status, 'not-added');
  assert.equal(status.overlay.action.id, 'add-overlay');
  assert.match(status.overlay.action.label, /Добавить/);
});

test('deriveSystemStatus: OBS restartRequired explained cleanly with CTA', () => {
  const state = {
    health: { extensionConnected: true, boostyConnected: true },
    obs: { ok: false, connected: false, restartRequired: true },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.obs.status, 'restart-required');
  assert.equal(status.obs.badgeClass, 'warning');
  assert.match(status.obs.text, /перезапуск/i);
  assert.equal(status.obs.action.id, 'restart-obs');
});

test('deriveSystemStatus: OBS duplicateCount > 0 shows brief warning without extra action button', () => {
  const state = {
    health: { extensionConnected: true, boostyConnected: true },
    obs: {
      ok: true,
      connected: true,
      duplicateCount: 1,
      scenes: [{ sceneUuid: 's1', sceneName: 'Gaming', hasChat: true }],
    },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.overlay.badgeClass, 'warning');
  assert.equal(status.overlay.text, 'Обнаружены дубликаты оверлея OBS');
  assert.equal(status.overlay.action, null);
});
