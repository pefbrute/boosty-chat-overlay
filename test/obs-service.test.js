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

  async connect(optionsOrPassword) {
    let pwd = typeof optionsOrPassword === 'object' ? optionsOrPassword?.password : optionsOrPassword;
    if (pwd === 'bad' || pwd === 'wrong_password') {
      const err = new Error('Authentication failed');
      err.code = 4005;
      err.isAuthError = true;
      throw err;
    }
    if (pwd === 'network_fail') {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:4455');
      err.code = -1;
      err.isConnectionError = true;
      throw err;
    }
    this.connected = true;
    return { obs: this, restartRequired: false, port: 4455, password: pwd };
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

  assert.deepEqual(service.getStatus(), {
    ok: false,
    connected: false,
    authFailed: false,
    unavailable: false,
    host: '127.0.0.1',
    port: 4455,
    scenes: [],
  });

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

test('createObsService classifies authentication failure vs network failure cleanly', async () => {
  const client = new MockClient();
  const service = createObsService({ client });

  // 1. Authentication failure
  const authState = await service.listScenes('wrong_password');
  assert.equal(authState.ok, false);
  assert.equal(authState.connected, false);
  assert.equal(authState.authFailed, true);
  assert.equal(authState.unavailable, false);
  assert.match(authState.error, /авторизоваться/);

  // Status check matches
  assert.equal(service.getStatus().authFailed, true);

  // 2. Network connection failure
  const connState = await service.listScenes('network_fail');
  assert.equal(connState.ok, false);
  assert.equal(connState.connected, false);
  assert.equal(connState.authFailed, false);
  assert.equal(connState.unavailable, true);
  assert.match(connState.error, /подключиться/);

  // 3. Successful connection clears authFailed
  const okState = await service.listScenes('good_password');
  assert.equal(okState.ok, true);
  assert.equal(okState.connected, true);
  assert.equal(okState.authFailed, false);
  assert.equal(okState.unavailable, false);

  await service.destroy();
});

test('createObsService supports connection config get/set with configStore persistence', async () => {
  const client = new MockClient();
  let savedConfig = {};
  const mockConfigStore = {
    get() {
      return { obsHost: '127.0.0.1', obsPort: 4455, obsPassword: 'initial_pass' };
    },
    update(partial) {
      savedConfig = { ...savedConfig, ...partial };
      return savedConfig;
    },
  };

  const service = createObsService({ client, configStore: mockConfigStore });

  // Initial values match configStore
  assert.deepEqual(service.getConnectionConfig(), {
    host: '127.0.0.1',
    port: 4455,
    password: 'initial_pass',
  });

  // Update connection config
  const updateRes = service.updateConnectionConfig({
    host: '192.168.1.55',
    port: 4456,
    password: 'new_secret_pwd',
  });

  assert.equal(updateRes.ok, true);
  assert.deepEqual(service.getConnectionConfig(), {
    host: '192.168.1.55',
    port: 4456,
    password: 'new_secret_pwd',
  });

  // Verify saved into configStore
  assert.equal(savedConfig.obsHost, '192.168.1.55');
  assert.equal(savedConfig.obsPort, 4456);
  assert.equal(savedConfig.obsPassword, 'new_secret_pwd');

  await service.destroy();
});

test('updateConnectionConfig preserves active OBS connection when host/port/password are unchanged', async () => {
  const client = new MockClient();
  let disconnectCount = 0;
  const origDisconnect = client.disconnect.bind(client);
  client.disconnect = async () => {
    disconnectCount++;
    return origDisconnect();
  };
  client.isConnecting = () => false;

  const service = createObsService({ client });
  await service.listScenes({ host: '127.0.0.1', port: 4455, password: 'same_password' });
  assert.equal(service.getStatus().connected, true);
  assert.equal(disconnectCount, 0);

  // Calling updateConnectionConfig with identical parameters (e.g. on onboarding Finish) must NOT disconnect
  service.updateConnectionConfig({ host: '127.0.0.1', port: 4455, password: 'same_password' });
  assert.equal(disconnectCount, 0);
  assert.equal(service.getStatus().connected, true);

  await service.destroy();
});
