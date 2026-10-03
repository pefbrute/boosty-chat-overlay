const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveSystemStatus } = require('../desktop/ui/status-hub.js');

test('deriveSystemStatus: all systems working', () => {
  const state = {
    health: {
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

test('deriveSystemStatus: Extension offline shows CTA setup-ext', () => {
  const state = {
    health: { extensionConnected: false, boostyConnected: false },
    obs: { ok: true, connected: true, scenes: [{ sceneName: 'Main', hasChat: false }] },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.extension.status, 'not-detected');
  assert.equal(status.extension.action.id, 'setup-ext');
  assert.equal(status.stream.status, 'disabled');
});

test('deriveSystemStatus: Outdated extension shows update CTA', () => {
  const state = {
    health: {
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
    health: { extensionConnected: true, boostyConnected: false },
    obs: { ok: true, connected: true },
  };

  const status = deriveSystemStatus(state);
  assert.equal(status.stream.status, 'not-found');
  assert.equal(status.stream.action.id, 'open-boosty');
  assert.match(status.stream.action.label, /Открыть Boosty/);
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
