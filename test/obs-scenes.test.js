const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isOurOverlayUrl,
  findUniqueInputName,
  fetchScenesState,
  addSceneTarget,
  removeSceneTarget,
  createMutationQueue,
} = require('../desktop/obs/scenes.js');

test('isOurOverlayUrl matches localhost overlay correctly', () => {
  assert.equal(isOurOverlayUrl('http://127.0.0.1:17369/overlay/'), true);
  assert.equal(isOurOverlayUrl('http://127.0.0.1:17369/overlay/?v=0.4.0'), true);
  assert.equal(isOurOverlayUrl('http://127.0.0.1:17369/other/'), false);
  assert.equal(isOurOverlayUrl('http://google.com/overlay/'), false);
  assert.equal(isOurOverlayUrl('not-a-url'), false);
});

test('findUniqueInputName increments suffix when names exist', async () => {
  const fakeClient = {
    async call(type) {
      if (type === 'GetInputList') {
        return {
          inputs: [
            { inputName: 'Boosty Chat' },
            { inputName: 'Boosty Chat (Overlay)' },
            { inputName: 'Boosty Chat (Overlay 2)' },
          ],
        };
      }
      return {};
    },
  };

  const name = await findUniqueInputName(fakeClient);
  assert.equal(name, 'Boosty Chat (Overlay 3)');
});

test('fetchScenesState parses scenes and detects ourInput', async () => {
  const fakeClient = {
    async call(type, data) {
      if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: 'My Stream' };
      if (type === 'GetSceneList') {
        return {
          scenes: [
            { sceneUuid: 'sc-1', sceneName: 'Gaming' },
            { sceneUuid: 'sc-2', sceneName: 'Just Chatting' },
            { sceneUuid: 'sc-service', sceneName: 'Boosty Chat Overlay' },
          ],
        };
      }
      if (type === 'GetInputList') {
        return {
          inputs: [
            { inputUuid: 'inp-1', inputName: 'Boosty Chat' },
            { inputUuid: 'inp-other', inputName: 'Camera' },
          ],
        };
      }
      if (type === 'GetInputSettings') {
        if (data.inputUuid === 'inp-1') {
          return { inputSettings: { url: 'http://127.0.0.1:17369/overlay/' } };
        }
        return {};
      }
      if (type === 'GetSceneItemList') {
        if (data.sceneUuid === 'sc-1') {
          return { sceneItems: [{ sceneItemId: 101, sourceUuid: 'inp-1', sceneItemEnabled: true }] };
        }
        return { sceneItems: [] };
      }
      return {};
    },
  };

  const state = await fetchScenesState(fakeClient);
  assert.equal(state.ok, true);
  assert.equal(state.currentCollection, 'My Stream');
  assert.equal(state.scenes.length, 2); // 'Boosty Chat Overlay' filtered out
  assert.equal(state.scenes[0].sceneName, 'Gaming');
  assert.equal(state.scenes[0].hasChat, true);
  assert.equal(state.scenes[0].sceneItemId, 101);
  assert.equal(state.scenes[1].sceneName, 'Just Chatting');
  assert.equal(state.scenes[1].hasChat, false);
});

test('addSceneTarget is idempotent and creates Browser Source', async () => {
  const calls = [];
  const fakeClient = {
    async call(type, data) {
      calls.push({ type, data });
      if (type === 'GetSceneList') {
        return {
          scenes: [{ sceneUuid: 'sc-1', sceneName: 'Gaming' }],
        };
      }
      if (type === 'GetInputList') return { inputs: [] };
      if (type === 'CreateInput') {
        return { inputUuid: 'new-uuid' };
      }
      return {};
    },
  };

  const res = await addSceneTarget(fakeClient, 'Gaming', { appVersion: '0.4.0' });
  assert.equal(res.ok, true);
  assert.equal(res.addedScene, 'Gaming');
  assert.equal(res.inputUuid, 'new-uuid');

  const createInputCall = calls.find(c => c.type === 'CreateInput');
  assert.ok(createInputCall);
  assert.equal(createInputCall.data.inputKind, 'browser_source');
  assert.match(createInputCall.data.inputSettings.url, /127\.0\.0\.1:17369\/overlay\/\?v=0\.4\.0/);
});

test('removeSceneTarget removes matching scene item', async () => {
  const calls = [];
  const fakeClient = {
    async call(type, data) {
      calls.push({ type, data });
      if (type === 'GetSceneList') {
        return { scenes: [{ sceneUuid: 'sc-1', sceneName: 'Gaming' }] };
      }
      if (type === 'GetInputList') {
        return { inputs: [{ inputUuid: 'chat-uuid', inputName: 'Boosty Chat' }] };
      }
      if (type === 'GetInputSettings') {
        return { inputSettings: { url: 'http://127.0.0.1:17369/overlay/' } };
      }
      if (type === 'GetSceneItemList') {
        return {
          sceneItems: [
            { sceneItemId: 42, sourceUuid: 'chat-uuid', sourceName: 'Boosty Chat' },
          ],
        };
      }
      return {};
    },
  };

  const res = await removeSceneTarget(fakeClient, 'Gaming');
  assert.equal(res.ok, true);
  const removeCall = calls.find(c => c.type === 'RemoveSceneItem');
  assert.ok(removeCall);
  assert.equal(removeCall.data.sceneItemId, 42);
});

test('createMutationQueue enforces serialization and sceneCollectionChanging guard', async () => {
  const queue = createMutationQueue();
  const executionOrder = [];

  const task1 = queue.enqueue(async () => {
    await new Promise(r => setTimeout(r, 20));
    executionOrder.push(1);
    return 't1';
  });

  const task2 = queue.enqueue(async () => {
    executionOrder.push(2);
    return 't2';
  });

  const [r1, r2] = await Promise.all([task1, task2]);
  assert.equal(r1, 't1');
  assert.equal(r2, 't2');
  assert.deepEqual(executionOrder, [1, 2]);

  // Block during scene collection changing
  queue.setBlocked(true);
  const rejected = await queue.enqueue(async () => {
    executionOrder.push(3);
  });

  assert.equal(rejected.ok, false);
  assert.equal(rejected.paused, true);
  assert.equal(executionOrder.includes(3), false);
});
