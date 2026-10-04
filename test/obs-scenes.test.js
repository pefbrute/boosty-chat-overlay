const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isOurOverlayUrl,
  findUniqueInputName,
  selectCanonicalOverlayInput,
  migrateOverlayInputs,
  fetchScenesState,
  addSceneTarget,
  removeSceneTarget,
  normalizeOverlayTransform,
  refreshOverlayInput,
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

test('fetchScenesState parses scenes, detects canonical input, and populates diagnostics', async () => {
  const fakeClient = {
    async call(type, data) {
      if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: 'My Stream' };
      if (type === 'GetVideoSettings') return { baseWidth: 1920, baseHeight: 1080 };
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
            { inputUuid: 'inp-1', inputName: 'Boosty Chat', inputKind: 'browser_source' },
            { inputUuid: 'inp-other', inputName: 'Camera', inputKind: 'browser_source' },
          ],
        };
      }
      if (type === 'GetInputSettings') {
        if (data.inputUuid === 'inp-1') {
          return { inputSettings: { url: 'http://127.0.0.1:17369/overlay/', width: 1920, height: 1080 } };
        }
        return { inputSettings: { url: 'https://twitch.tv/alerts' } };
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

  // Diagnostics contract check (Requirement 19)
  assert.ok(state.diagnostics);
  assert.equal(state.diagnostics.canonicalOverlayInput.inputUuid, 'inp-1');
  assert.equal(state.diagnostics.matchingOverlayInputs.length, 1);
  assert.equal(state.diagnostics.duplicateCount, 0);
  assert.equal(state.diagnostics.sceneReferences.length, 1);
  assert.equal(state.diagnostics.isCanonicalGeometry, true);
});

test('addSceneTarget is idempotent and creates Browser Source only when none exists', async () => {
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
        return { inputUuid: 'new-uuid', sceneItemId: 10 };
      }
      return {};
    },
  };

  const res = await addSceneTarget(fakeClient, 'Gaming', { appVersion: '0.4.0' });
  assert.equal(res.ok, true);
  assert.equal(res.addedScene, 'Gaming');
  assert.equal(res.inputUuid, 'new-uuid');
  assert.equal(res.reused, false);

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

test('normalizeOverlayTransform updates input dimensions and sets canonical transform', async () => {
  const calls = [];
  const fakeClient = {
    async call(type, data) {
      calls.push({ type, data });
      if (type === 'GetVideoSettings') {
        return { baseWidth: 1920, baseHeight: 1080 };
      }
      if (type === 'GetInputList') {
        return { inputs: [{ inputUuid: 'chat-uuid', inputName: 'Boosty Chat' }] };
      }
      if (type === 'GetInputSettings') {
        return { inputSettings: { url: 'http://127.0.0.1:17369/overlay/', width: 900, height: 700 } };
      }
      if (type === 'GetSceneList') {
        return { scenes: [{ sceneUuid: 'sc-1', sceneName: 'Gaming' }] };
      }
      if (type === 'GetSceneItemList') {
        return {
          sceneItems: [
            { sceneItemId: 99, sourceUuid: 'chat-uuid', sourceName: 'Boosty Chat' },
          ],
        };
      }
      if (type === 'SetInputSettings') return {};
      if (type === 'SetSceneItemTransform') return {};
      return {};
    },
  };

  const res = await normalizeOverlayTransform(fakeClient);
  assert.equal(res.ok, true);
  assert.equal(res.baseWidth, 1920);
  assert.equal(res.baseHeight, 1080);
  assert.deepEqual(res.affectedScenes, ['Gaming']);

  const setInputCall = calls.find(c => c.type === 'SetInputSettings');
  assert.ok(setInputCall);
  assert.equal(setInputCall.data.inputUuid, 'chat-uuid');
  assert.equal(setInputCall.data.inputSettings.width, 1920);
  assert.equal(setInputCall.data.inputSettings.height, 1080);

  const setTransformCall = calls.find(c => c.type === 'SetSceneItemTransform');
  assert.ok(setTransformCall);
  assert.equal(setTransformCall.data.sceneUuid, 'sc-1');
  assert.equal(setTransformCall.data.sceneItemId, 99);
  assert.equal(setTransformCall.data.sceneItemTransform.positionX, 0);
  assert.equal(setTransformCall.data.sceneItemTransform.positionY, 0);
  assert.equal(setTransformCall.data.sceneItemTransform.scaleX, 1);
  assert.equal(setTransformCall.data.sceneItemTransform.scaleY, 1);
  assert.equal(setTransformCall.data.sceneItemTransform.alignment, 5);
  assert.equal(setTransformCall.data.sceneItemTransform.boundsType, 'OBS_BOUNDS_NONE');
});

test('refreshOverlayInput refreshes strictly the canonical overlay input, not legacy duplicate', async () => {
  const calls = [];
  const fakeClient = {
    async call(type, data) {
      calls.push({ type, data });
      if (type === 'GetVideoSettings') return { baseWidth: 1920, baseHeight: 1080 };
      if (type === 'GetSceneList') return { scenes: [] };
      if (type === 'GetInputList') {
        return {
          inputs: [
            // Legacy 900x700 listed FIRST
            { inputUuid: 'legacy-small-uuid', inputName: 'Boosty Chat QA', inputKind: 'browser_source' },
            // Canonical 1920x1080 listed SECOND
            { inputUuid: 'canonical-full-uuid', inputName: 'Boosty Chat', inputKind: 'browser_source' },
          ],
        };
      }
      if (type === 'GetInputSettings') {
        if (data.inputUuid === 'legacy-small-uuid') {
          return { inputSettings: { url: 'http://127.0.0.1:17369/overlay/', width: 900, height: 700 } };
        }
        return { inputSettings: { url: 'http://127.0.0.1:17369/overlay/?v=0.4.0', width: 1920, height: 1080 } };
      }
      if (type === 'PressInputPropertiesButton') return {};
      return {};
    },
  };

  const res = await refreshOverlayInput(fakeClient, { port: 17369 });
  assert.equal(res.ok, true);
  assert.equal(res.refreshed, true);
  assert.equal(res.inputUuid, 'canonical-full-uuid');

  const pressCalls = calls.filter(c => c.type === 'PressInputPropertiesButton');
  assert.equal(pressCalls.length, 1);
  assert.equal(pressCalls[0].data.inputUuid, 'canonical-full-uuid');
  assert.equal(pressCalls[0].data.propertyName, 'refreshnocache');
});

test('selectCanonicalOverlayInput follows strict priority rules (dimensions -> scale -> crop -> sceneRefs -> oldest)', () => {
  const videoSettings = { baseWidth: 1920, baseHeight: 1080 };

  // 1. 1920x1080 beats 900x700
  const chosenByDim = selectCanonicalOverlayInput([
    { inputUuid: 'small', inputName: 'Boosty Chat QA', url: 'http://127.0.0.1:17369/overlay/', width: 900, height: 700, sceneReferences: [{ transform: { scaleX: 1, scaleY: 1 } }], index: 0 },
    { inputUuid: 'full', inputName: 'Boosty Chat', url: 'http://127.0.0.1:17369/overlay/?v=0.4.0', width: 1920, height: 1080, sceneReferences: [{ transform: { scaleX: 1, scaleY: 1 } }], index: 1 },
  ], videoSettings, 17369);
  assert.equal(chosenByDim.inputUuid, 'full');

  // 2. When dimensions match, higher sceneReferences count wins
  const chosenByRefs = selectCanonicalOverlayInput([
    { inputUuid: 'one-ref', inputName: 'Boosty Chat 1', url: 'http://127.0.0.1:17369/overlay/', width: 1920, height: 1080, sceneReferences: [{ transform: { scaleX: 1, scaleY: 1 } }], index: 0 },
    { inputUuid: 'two-refs', inputName: 'Boosty Chat 2', url: 'http://127.0.0.1:17369/overlay/', width: 1920, height: 1080, sceneReferences: [{ transform: { scaleX: 1, scaleY: 1 } }, { transform: { scaleX: 1, scaleY: 1 } }], index: 1 },
  ], videoSettings, 17369);
  assert.equal(chosenByRefs.inputUuid, 'two-refs');
});

test('Legacy duplicate migration: 900x700 + 1920x1080 -> 1 canonical 1920x1080 input, duplicate removed, user sources untouched', async () => {
  const state = {
    inputs: [
      { inputUuid: 'user-yt', inputName: 'YouTube Chat', inputKind: 'browser_source', settings: { url: 'https://youtube.com/live_chat', width: 400, height: 600 } },
      { inputUuid: 'user-alerts', inputName: 'DonationAlerts', inputKind: 'browser_source', settings: { url: 'https://donationalerts.com/widget', width: 800, height: 600 } },
      { inputUuid: 'small-legacy', inputName: 'Boosty Chat QA', inputKind: 'browser_source', settings: { url: 'http://127.0.0.1:17369/overlay/', width: 900, height: 700 } },
      { inputUuid: 'full-canon', inputName: 'Boosty Chat', inputKind: 'browser_source', settings: { url: 'http://127.0.0.1:17369/overlay/?v=0.4.0', width: 1920, height: 1080 } },
    ],
    scenes: [
      { sceneUuid: 'sc-qa', sceneName: 'Boosty Chat Overlay QA' },
    ],
    sceneItems: {
      'sc-qa': [
        { sceneItemId: 1, sourceUuid: 'user-alerts', sourceName: 'DonationAlerts', sceneItemEnabled: true, sceneItemTransform: { scaleX: 1, scaleY: 1 } },
        { sceneItemId: 2, sourceUuid: 'full-canon', sourceName: 'Boosty Chat', sceneItemEnabled: true, sceneItemTransform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 } },
        { sceneItemId: 5, sourceUuid: 'small-legacy', sourceName: 'Boosty Chat QA', sceneItemEnabled: true, sceneItemTransform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 } },
      ],
    },
  };

  const fakeClient = {
    async call(type, data) {
      if (type === 'GetVideoSettings') return { baseWidth: 1920, baseHeight: 1080 };
      if (type === 'GetSceneList') return { scenes: state.scenes };
      if (type === 'GetInputList') return { inputs: state.inputs };
      if (type === 'GetInputSettings') {
        const found = state.inputs.find(i => i.inputUuid === data.inputUuid);
        return found ? { inputSettings: { ...found.settings } } : {};
      }
      if (type === 'GetSceneItemList') {
        return { sceneItems: [...(state.sceneItems[data.sceneUuid] || [])] };
      }
      if (type === 'GetSceneItemTransform') {
        const item = (state.sceneItems[data.sceneUuid] || []).find(i => i.sceneItemId === data.sceneItemId);
        return { sceneItemTransform: item?.sceneItemTransform || null };
      }
      if (type === 'SetInputSettings') {
        const found = state.inputs.find(i => i.inputUuid === data.inputUuid);
        if (found) found.settings = { ...found.settings, ...data.inputSettings };
        return {};
      }
      if (type === 'SetSceneItemTransform') {
        const item = (state.sceneItems[data.sceneUuid] || []).find(i => i.sceneItemId === data.sceneItemId);
        if (item) item.sceneItemTransform = { ...item.sceneItemTransform, ...data.sceneItemTransform };
        return {};
      }
      if (type === 'RemoveSceneItem') {
        state.sceneItems[data.sceneUuid] = (state.sceneItems[data.sceneUuid] || []).filter(i => i.sceneItemId !== data.sceneItemId);
        return {};
      }
      if (type === 'RemoveInput') {
        state.inputs = state.inputs.filter(i => i.inputUuid !== data.inputUuid);
        return {};
      }
      return {};
    },
  };

  const migration = await migrateOverlayInputs(fakeClient, { port: 17369 });
  assert.equal(migration.ok, true);
  assert.equal(migration.migrated, true);
  assert.equal(migration.canonicalOverlayInput.inputUuid, 'full-canon');
  assert.equal(migration.removedInputs.length, 1);
  assert.equal(migration.removedInputs[0].inputUuid, 'small-legacy');
  assert.equal(migration.removedSceneItems.length, 1);
  assert.equal(migration.removedSceneItems[0].sceneItemId, 5);

  // Verify post-migration state
  const afterState = await fetchScenesState(fakeClient, { port: 17369 });
  assert.equal(afterState.matchingOverlayInputs.length, 1);
  assert.equal(afterState.canonicalOverlayInput.inputUuid, 'full-canon');
  assert.equal(afterState.canonicalOverlayInput.width, 1920);
  assert.equal(afterState.canonicalOverlayInput.height, 1080);
  assert.equal(afterState.duplicateCount, 0);
  assert.equal(afterState.isCanonicalGeometry, true);

  // User sources must remain completely untouched (Requirement 18)
  assert.equal(state.inputs.some(i => i.inputUuid === 'user-yt'), true);
  assert.equal(state.inputs.some(i => i.inputUuid === 'user-alerts'), true);
  assert.equal(state.sceneItems['sc-qa'].some(i => i.sourceUuid === 'user-alerts'), true);
});

test('Multiple scenes can share the single canonical overlay input (inputs = 1, scene items = 2)', async () => {
  const state = {
    inputs: [],
    scenes: [
      { sceneUuid: 'sc-a', sceneName: 'Scene A' },
      { sceneUuid: 'sc-b', sceneName: 'Scene B' },
    ],
    sceneItems: {
      'sc-a': [],
      'sc-b': [],
    },
    nextItemId: 1,
  };

  const fakeClient = {
    async call(type, data) {
      if (type === 'GetVideoSettings') return { baseWidth: 1920, baseHeight: 1080 };
      if (type === 'GetSceneList') return { scenes: state.scenes };
      if (type === 'GetInputList') return { inputs: state.inputs };
      if (type === 'GetInputSettings') {
        const found = state.inputs.find(i => i.inputUuid === data.inputUuid);
        return found ? { inputSettings: { ...found.settings } } : {};
      }
      if (type === 'GetSceneItemList') {
        return { sceneItems: [...(state.sceneItems[data.sceneUuid] || [])] };
      }
      if (type === 'GetSceneItemTransform') {
        const item = (state.sceneItems[data.sceneUuid] || []).find(i => i.sceneItemId === data.sceneItemId);
        return { sceneItemTransform: item?.sceneItemTransform || null };
      }
      if (type === 'CreateInput') {
        const newInput = {
          inputUuid: 'canon-shared-uuid',
          inputName: data.inputName,
          inputKind: data.inputKind,
          settings: { ...data.inputSettings },
        };
        state.inputs.push(newInput);
        const itemId = state.nextItemId++;
        state.sceneItems[data.sceneUuid].push({
          sceneItemId: itemId,
          sourceUuid: newInput.inputUuid,
          sourceName: newInput.inputName,
          sceneItemEnabled: true,
          sceneItemTransform: {},
        });
        return { inputUuid: newInput.inputUuid, sceneItemId: itemId };
      }
      if (type === 'CreateSceneItem') {
        const itemId = state.nextItemId++;
        state.sceneItems[data.sceneUuid].push({
          sceneItemId: itemId,
          sourceUuid: data.sourceUuid,
          sceneItemEnabled: data.sceneItemEnabled !== false,
          sceneItemTransform: {},
        });
        return { sceneItemId: itemId };
      }
      if (type === 'SetInputSettings') {
        const found = state.inputs.find(i => i.inputUuid === data.inputUuid);
        if (found) found.settings = { ...found.settings, ...data.inputSettings };
        return {};
      }
      if (type === 'SetSceneItemTransform') {
        const item = (state.sceneItems[data.sceneUuid] || []).find(i => i.sceneItemId === data.sceneItemId);
        if (item) item.sceneItemTransform = { ...item.sceneItemTransform, ...data.sceneItemTransform };
        return {};
      }
      return {};
    },
  };

  // Add to Scene A -> creates 1 input
  const resA = await addSceneTarget(fakeClient, 'Scene A');
  assert.equal(resA.ok, true);
  assert.equal(resA.reused, false);

  // Add to Scene B -> reuses existing canonical input
  const resB = await addSceneTarget(fakeClient, 'Scene B');
  assert.equal(resB.ok, true);
  assert.equal(resB.reused, true);
  assert.equal(resB.inputUuid, resA.inputUuid);

  // Run normalize/migration -> preserves 1 input and 2 scene items
  await normalizeOverlayTransform(fakeClient);
  const finalState = await fetchScenesState(fakeClient);

  assert.equal(finalState.matchingOverlayInputs.length, 1);
  assert.equal(finalState.duplicateCount, 0);
  assert.equal(finalState.sceneReferences.length, 2);
  assert.equal(finalState.scenes[0].hasChat, true);
  assert.equal(finalState.scenes[1].hasChat, true);
});
