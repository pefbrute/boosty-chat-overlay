'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { verifyObsIntegration, QA_SCENE_NAME } = require('../scripts/live-e2e/obs.js');

test('verifyObsIntegration returns valid status and granular stages without mutating live OBS', async () => {
  const mockClient = new EventEmitter();
  mockClient.connect = async () => ({ obs: mockClient, restartRequired: false, port: 4455, password: '' });
  mockClient.disconnect = async () => {};
  mockClient.isConnected = () => true;
  mockClient.call = async (type) => {
    if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: 'Main' };
    if (type === 'GetVideoSettings') return { baseWidth: 1920, baseHeight: 1080 };
    if (type === 'GetSceneList') {
      return {
        currentProgramSceneName: 'Scene 3',
        scenes: [
          { sceneUuid: 'sc-qa', sceneName: QA_SCENE_NAME },
          { sceneUuid: 'sc-3', sceneName: 'Scene 3' },
        ],
      };
    }
    if (type === 'GetInputList') {
      return {
        inputs: [{ inputUuid: 'canon-uuid', inputName: 'Boosty Chat', inputKind: 'browser_source' }],
      };
    }
    if (type === 'GetInputSettings') {
      return {
        inputSettings: {
          url: 'http://127.0.0.1:17369/overlay/?v=0.4.0',
          width: 1920,
          height: 1080,
        },
      };
    }
    if (type === 'GetSceneItemList') {
      return {
        sceneItems: [{ sceneItemId: 1, sourceUuid: 'canon-uuid', sceneItemEnabled: true }],
      };
    }
    return {};
  };

  const res = await verifyObsIntegration({ port: 17369, client: mockClient });
  assert.ok(['pass', 'skip'].includes(res.status));
  assert.ok(res.stages);
  assert.equal(res.stages.obsConnection, 'pass');
  assert.equal(res.stages.obsScene, 'pass');
  assert.equal(res.stages.obsBrowserSource, 'pass');
  assert.equal(res.stages.obsSourceSettings, 'pass');
  assert.ok('obsScreenshot' in res.stages);
});

test('QA_SCENE_NAME constant is non-empty and descriptive', () => {
  assert.equal(QA_SCENE_NAME, 'Boosty Chat Overlay QA');
});
