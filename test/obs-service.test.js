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
