const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createObsService } = require('../desktop/obs/service.js');

class MockClient extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.calls = [];
  }

  async connect(password) {
    if (password === 'bad') throw new Error('Bad password');
    this.connected = true;
    return { obs: this, restartRequired: false, port: 4455, password };
  }

  async disconnect() {
    this.connected = false;
    this.emit('ConnectionClosed');
  }

  isConnected() {
    return this.connected;
  }

  async call(type, data) {
    this.calls.push({ type, data });
    if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: 'Main Collection' };
    if (type === 'GetSceneList') {
      return { scenes: [{ sceneUuid: 'sc-main', sceneName: 'Gaming' }] };
    }
    if (type === 'GetInputList') {
      return { inputs: [] };
    }
    if (type === 'CreateInput') {
      return { inputUuid: 'new-browser-uuid' };
    }
    if (type === 'GetSceneItemList') {
      return { sceneItems: [] };
    }
    return {};
  }
}

test('createObsService manages state, onStateChange callback, and listScenes', async () => {
  const client = new MockClient();
  const stateChanges = [];

  const service = createObsService({
    client,
    appVersion: '0.4.0',
    onStateChange: state => stateChanges.push(state),
  });

  assert.deepEqual(service.getStatus(), { ok: false, connected: false, scenes: [] });

  // List scenes
  const res = await service.listScenes('mypassword');
  assert.equal(res.ok, true);
  assert.equal(res.connected, true);
  assert.equal(res.scenes.length, 1);
  assert.equal(res.scenes[0].sceneName, 'Gaming');

  // Verify getStatus and onStateChange were updated
  assert.equal(service.getStatus().connected, true);
  assert.equal(stateChanges.length >= 1, true);
});

test('createObsService addScene, removeScene and mutation queue', async () => {
  const client = new MockClient();
  const service = createObsService({ client });

  const addRes = await service.addScene('', 'Gaming');
  assert.equal(addRes.ok, true);
  assert.equal(addRes.addedScene, 'Gaming');
  assert.equal(addRes.inputUuid, 'new-browser-uuid');

  // Test sceneCollectionChanging blocks mutations
  client.emit('CurrentSceneCollectionChanging');

  const blockedRes = await service.addScene('', 'Gaming');
  assert.equal(blockedRes.ok, false);
  assert.equal(blockedRes.paused, true);
  assert.match(blockedRes.error, /переключается/);

  // Unblock
  client.emit('CurrentSceneCollectionChanged');
  const unblockedRes = await service.removeScene('', 'Gaming');
  assert.equal(unblockedRes.ok, true);
  assert.equal(unblockedRes.removedScene, 'Gaming');

  await service.destroy();
});

test('createObsService fitOverlayToCanvas normalizes input settings and transform', async () => {
  const client = new MockClient();
  // Override call for fitOverlayToCanvas scenario
  client.call = async function (type, data) {
    this.calls.push({ type, data });
    if (type === 'GetVideoSettings') return { baseWidth: 2560, baseHeight: 1440 };
    if (type === 'GetInputList') return { inputs: [{ inputUuid: 'chat-uuid', inputName: 'Boosty Chat' }] };
    if (type === 'GetInputSettings') return { inputSettings: { url: 'http://127.0.0.1:17369/overlay/', width: 1920, height: 1080 } };
    if (type === 'GetSceneList') return { scenes: [{ sceneUuid: 'sc-main', sceneName: 'Gaming' }] };
    if (type === 'GetSceneItemList') return { sceneItems: [{ sceneItemId: 10, sourceUuid: 'chat-uuid' }] };
    if (type === 'SetInputSettings') return {};
    if (type === 'SetSceneItemTransform') return {};
    return {};
  };

  const service = createObsService({ client });
  const res = await service.fitOverlayToCanvas('mypassword');
  assert.equal(res.ok, true);
  assert.equal(res.baseWidth, 2560);
  assert.equal(res.baseHeight, 1440);
  assert.deepEqual(res.affectedScenes, ['Gaming']);

  const setInputCall = client.calls.find(c => c.type === 'SetInputSettings');
  assert.ok(setInputCall);
  assert.equal(setInputCall.data.inputSettings.width, 2560);
  assert.equal(setInputCall.data.inputSettings.height, 1440);

  await service.destroy();
});

test('createObsService refreshOverlay triggers refreshOverlayInput on canonical browser source', async () => {
  const client = new MockClient();
  client.call = async function (type, data) {
    this.calls.push({ type, data });
    if (type === 'GetSceneList') return { scenes: [] };
    if (type === 'GetInputList') return { inputs: [{ inputUuid: 'chat-uuid-service', inputName: 'Boosty Chat' }] };
    if (type === 'GetInputSettings') return { inputSettings: { url: 'http://127.0.0.1:17369/overlay/?v=0.4.0' } };
    if (type === 'PressInputPropertiesButton') return {};
    return {};
  };

  const service = createObsService({ client });
  const res = await service.refreshOverlay();
  assert.equal(res.ok, true);
  assert.equal(res.refreshed, true);
  assert.equal(res.inputUuid, 'chat-uuid-service');

  const pressCall = client.calls.find(c => c.type === 'PressInputPropertiesButton');
  assert.ok(pressCall);
  assert.equal(pressCall.data.inputUuid, 'chat-uuid-service');
  assert.equal(pressCall.data.propertyName, 'refreshnocache');

  await service.destroy();
});

test('self-heal refreshes canonical Browser Source (not legacy duplicate) exactly once when overlayClients === 0, OBS source exists, and server ready', async () => {
  const client = new MockClient();
  client.connected = true; // Already connected (no new Connected event required)
  const inputs = [
    { inputUuid: 'legacy-small', inputName: 'Boosty Chat QA', inputKind: 'browser_source', settings: { url: 'http://127.0.0.1:17369/overlay/', width: 900, height: 700 } },
    { inputUuid: 'chat-uuid-heal', inputName: 'Boosty Chat', inputKind: 'browser_source', settings: { url: 'http://127.0.0.1:17369/overlay/?v=0.4.0', width: 1920, height: 1080 } },
  ];
  client.call = async function (type, data) {
    this.calls.push({ type, data });
    if (type === 'GetVideoSettings') return { baseWidth: 1920, baseHeight: 1080 };
    if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: 'Main' };
    if (type === 'GetSceneList') return { scenes: [{ sceneUuid: 'sc-main', sceneName: 'Gaming' }] };
    if (type === 'GetInputList') return { inputs };
    if (type === 'GetInputSettings') {
      const f = inputs.find(i => i.inputUuid === data.inputUuid);
      return f ? { inputSettings: f.settings } : {};
    }
    if (type === 'GetSceneItemList') return { sceneItems: [{ sceneItemId: 1, sourceUuid: 'chat-uuid-heal', sceneItemEnabled: true }] };
    if (type === 'RemoveInput') {
      const idx = inputs.findIndex(i => i.inputUuid === data.inputUuid);
      if (idx >= 0) inputs.splice(idx, 1);
      return {};
    }
    if (type === 'PressInputPropertiesButton') return {};
    return {};
  };

  let fakeNow = 1000;
  const service = createObsService({
    client,
    isServerReady: () => true,
    getOverlayClients: () => 0,
    selfHealCooldownMs: 15000,
    now: () => fakeNow,
  });

  // Multiple state polls while overlayClients stays 0 must trigger refreshnocache strictly once on the canonical input
  await service.listScenes();
  fakeNow += 5000;
  await service.listScenes();
  fakeNow += 20000; // Even after cooldown, if overlayClients never recovered > 0, do not loop
  await service.listScenes();

  const pressCalls = client.calls.filter(c => c.type === 'PressInputPropertiesButton');
  assert.equal(pressCalls.length, 1);
  assert.equal(pressCalls[0].data.inputUuid, 'chat-uuid-heal');
  assert.equal(pressCalls[0].data.propertyName, 'refreshnocache');

  await service.destroy();
});

test('self-heal does NOT call refresh when overlayClients > 0', async () => {
  const client = new MockClient();
  client.connected = true;
  client.call = async function (type, data) {
    this.calls.push({ type, data });
    if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: 'Main' };
    if (type === 'GetSceneList') return { scenes: [{ sceneUuid: 'sc-main', sceneName: 'Gaming' }] };
    if (type === 'GetInputList') return { inputs: [{ inputUuid: 'chat-uuid-active', inputName: 'Boosty Chat' }] };
    if (type === 'GetInputSettings') return { inputSettings: { url: 'http://127.0.0.1:17369/overlay/?v=0.4.0', width: 1920, height: 1080 } };
    if (type === 'GetSceneItemList') return { sceneItems: [{ sceneItemId: 1, sourceUuid: 'chat-uuid-active', sceneItemEnabled: true }] };
    if (type === 'PressInputPropertiesButton') return {};
    return {};
  };

  const service = createObsService({
    client,
    isServerReady: () => true,
    getOverlayClients: () => 1,
  });

  await service.listScenes();
  await service.listScenes();

  const pressCalls = client.calls.filter(c => c.type === 'PressInputPropertiesButton');
  assert.equal(pressCalls.length, 0);

  await service.destroy();
});

test('Idempotency across setup runs, desktop restarts, and OBS reconnects (strictly 1 overlay input)', async () => {
  const obsWorld = {
    inputs: [],
    scenes: [{ sceneUuid: 'sc-1', sceneName: 'Main Scene' }],
    sceneItems: { 'sc-1': [] },
    createInputCount: 0,
  };

  function makeFakeClient() {
    const client = new MockClient();
    client.call = async function (type, data) {
      this.calls.push({ type, data });
      if (type === 'GetVideoSettings') return { baseWidth: 1920, baseHeight: 1080 };
      if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: 'Default' };
      if (type === 'GetSceneList') return { scenes: obsWorld.scenes };
      if (type === 'GetInputList') return { inputs: obsWorld.inputs };
      if (type === 'GetInputSettings') {
        const found = obsWorld.inputs.find(i => i.inputUuid === data.inputUuid);
        return found ? { inputSettings: { ...found.settings } } : {};
      }
      if (type === 'GetSceneItemList') {
        return { sceneItems: [...(obsWorld.sceneItems[data.sceneUuid] || [])] };
      }
      if (type === 'GetSceneItemTransform') {
        const item = (obsWorld.sceneItems[data.sceneUuid] || []).find(i => i.sceneItemId === data.sceneItemId);
        return { sceneItemTransform: item?.transform || null };
      }
      if (type === 'CreateInput') {
        obsWorld.createInputCount++;
        const newInput = {
          inputUuid: `canon-uuid-${obsWorld.createInputCount}`,
          inputName: data.inputName,
          inputKind: data.inputKind,
          settings: { ...data.inputSettings },
        };
        obsWorld.inputs.push(newInput);
        obsWorld.sceneItems[data.sceneUuid].push({
          sceneItemId: 1,
          sourceUuid: newInput.inputUuid,
          sourceName: newInput.inputName,
          sceneItemEnabled: true,
          transform: {},
        });
        return { inputUuid: newInput.inputUuid, sceneItemId: 1 };
      }
      if (type === 'SetInputSettings') {
        const found = obsWorld.inputs.find(i => i.inputUuid === data.inputUuid);
        if (found) found.settings = { ...found.settings, ...data.inputSettings };
        return {};
      }
      if (type === 'SetSceneItemTransform') {
        const item = (obsWorld.sceneItems[data.sceneUuid] || []).find(i => i.sceneItemId === data.sceneItemId);
        if (item) item.transform = { ...item.transform, ...data.sceneItemTransform };
        return {};
      }
      return {};
    };
    return client;
  }

  // 1. Run setup once -> 1 overlay input
  const client1 = makeFakeClient();
  const service1 = createObsService({ client: client1, getOverlayClients: () => 1 });
  await service1.addScene('', 'Main Scene');
  assert.equal(obsWorld.inputs.length, 1);
  assert.equal(obsWorld.createInputCount, 1);

  // 2. Run setup again -> still 1 overlay input
  await service1.addScene('', 'Main Scene');
  assert.equal(obsWorld.inputs.length, 1);
  assert.equal(obsWorld.createInputCount, 1);
  await service1.destroy();

  // 3. Restart desktop (new ObsService instance) -> still 1 overlay input
  const client2 = makeFakeClient();
  const service2 = createObsService({ client: client2, getOverlayClients: () => 1 });
  const stateAfterRestart = await service2.listScenes();
  assert.equal(stateAfterRestart.matchingOverlayInputs.length, 1);
  assert.equal(obsWorld.inputs.length, 1);
  assert.equal(obsWorld.createInputCount, 1);

  // 4. Reconnect OBS -> still 1 overlay input
  await client2.disconnect();
  client2.emit('Connected');
  const stateAfterReconnect = await service2.listScenes();
  assert.equal(stateAfterReconnect.matchingOverlayInputs.length, 1);
  assert.equal(obsWorld.inputs.length, 1);
  assert.equal(obsWorld.createInputCount, 1);

  await service2.destroy();
});
