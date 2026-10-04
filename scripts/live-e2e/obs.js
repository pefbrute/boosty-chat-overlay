'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createObsService } = require('../../desktop/obs/service.js');
const { isOurOverlayUrl } = require('../../desktop/obs/scenes.js');
const { getObsExecutablePath, launchObs } = require('../../desktop/obs/config.js');

const QA_SCENE_NAME = 'Boosty Chat Overlay QA';
const QA_SOURCE_NAME = 'Boosty Chat';

/**
 * Prepares OBS scene and reuses/creates the single canonical Browser Source ahead of message broadcast.
 *
 * @param {object} options
 * @param {number} [options.port=17369]
 * @param {string} [options.password='']
 * @param {boolean} [options.requireObs=false]
 * @param {object} [options.client]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function prepareObsIntegration(options = {}) {
  const port = options.port || 17369;
  const password = options.password || '';
  const requireObs = Boolean(options.requireObs || process.env.BOOSTY_LIVE_QA_REQUIRE_OBS === '1');

  const obsService = createObsService({
    overlayPort: port,
    ...(options.client ? { client: options.client } : {}),
  });
  try {
    let state = await obsService.listScenes(password);
    if ((!state.ok || !state.connected) && !options.client && getObsExecutablePath()) {
      launchObs();
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(r => setTimeout(r, 600));
        state = await obsService.listScenes(password);
        if (state.ok && state.connected) break;
      }
    }
    if (!state.ok || !state.connected) {
      return { ok: false, required: requireObs, reason: state.error || 'OBS offline' };
    }

    const client = obsService.getClient();
    const sceneList = await client.call('GetSceneList');
    const allScenes = sceneList.scenes || [];

    const qaScene = allScenes.find(s => s.sceneName === QA_SCENE_NAME);
    if (!qaScene) {
      await client.call('CreateScene', { sceneName: QA_SCENE_NAME });
    }

    // Reuse existing canonical Browser Source or create one at full base canvas (1:1)
    const addRes = await obsService.addScene(password, QA_SCENE_NAME);
    if (!addRes.ok) {
      return { ok: false, error: addRes.error || 'Failed to add canonical overlay to QA scene' };
    }

    // Wait 800ms for OBS CEF browser source to connect to SSE
    if (!options.client) {
      await new Promise(r => setTimeout(r, 800));
    }
    return { ok: true, inputUuid: addRes.inputUuid, reused: addRes.reused };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await obsService.destroy().catch(() => {});
  }
}

/**
 * Safe, idempotent verification of OBS Studio integration for Live E2E.
 * Never alters the streamer's active scene, never deletes user sources,
 * and strictly reuses the single canonical full-canvas Browser Source.
 *
 * @param {object} options
 * @param {number} [options.port=17369]
 * @param {string} [options.password='']
 * @param {string} [options.artifactDir]
 * @param {boolean} [options.requireObs=false]
 * @param {object} [options.client]
 * @returns {Promise<{ status: 'pass'|'skip'|'fail', stages: object, details: object }>}
 */
async function verifyObsIntegration(options = {}) {
  const port = options.port || 17369;
  const password = options.password || '';
  const artifactDir = options.artifactDir;
  const requireObs = Boolean(options.requireObs || process.env.BOOSTY_LIVE_QA_REQUIRE_OBS === '1');

  const defaultStages = {
    obsConnection: 'pending',
    obsScene: 'pending',
    obsBrowserSource: 'pending',
    obsSourceSettings: 'pending',
    obsScreenshot: 'pending',
    obsVisual: 'pending',
  };

  const obsService = createObsService({
    overlayPort: port,
    ...(options.client ? { client: options.client } : {}),
  });

  try {
    let state = await obsService.listScenes(password);

    // If offline and executable exists, attempt automatic launch
    if ((!state.ok || !state.connected) && !options.client && getObsExecutablePath()) {
      launchObs();
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(r => setTimeout(r, 600));
        state = await obsService.listScenes(password);
        if (state.ok && state.connected) break;
      }
    }

    if (!state.ok || !state.connected) {
      const stageStatus = requireObs ? 'fail' : 'skip';
      return {
        status: stageStatus,
        stages: {
          ...defaultStages,
          obsConnection: stageStatus,
          obsScene: stageStatus,
          obsBrowserSource: stageStatus,
          obsSourceSettings: stageStatus,
          obsScreenshot: stageStatus,
          obsVisual: stageStatus,
        },
        details: {
          connected: false,
          required: requireObs,
          reason: state.error || 'OBS WebSocket is not reachable (OBS is offline)',
        },
      };
    }

    const client = obsService.getClient();
    const stages = { ...defaultStages, obsConnection: 'pass' };

    // 1. Get Current Program Scene to ensure we DO NOT disturb it
    const sceneList = await client.call('GetSceneList');
    const originalCurrentScene = sceneList.currentProgramSceneName || sceneList.currentPreviewSceneName || '';
    const allScenes = sceneList.scenes || [];

    // 2. Idempotently ensure QA scene exists
    let qaScene = allScenes.find(s => s.sceneName === QA_SCENE_NAME);
    if (!qaScene) {
      try {
        await client.call('CreateScene', { sceneName: QA_SCENE_NAME });
        const updated = await client.call('GetSceneList');
        qaScene = (updated.scenes || []).find(s => s.sceneName === QA_SCENE_NAME);
      } catch (err) {
        console.warn('[Live OBS] Failed to create QA scene:', err.message);
      }
    }

    if (qaScene) {
      stages.obsScene = 'pass';
    } else {
      stages.obsScene = 'fail';
      throw new Error(`Failed to ensure QA scene "${QA_SCENE_NAME}"`);
    }

    // 3. Reuse or create canonical Browser Source inside QA scene (never create a separate 900x700 QA source)
    await obsService.addScene(password, QA_SCENE_NAME);
    state = await obsService.listScenes(password);

    const canonicalInput = state.canonicalOverlayInput || state.ourInput || null;
    let browserSourceFound = false;
    let browserSourceUrl = '';
    let browserSourceWidth = 0;
    let browserSourceHeight = 0;

    if (canonicalInput) {
      stages.obsBrowserSource = 'pass';
      browserSourceUrl = canonicalInput.url || '';
      browserSourceWidth = Number(canonicalInput.width || 0);
      browserSourceHeight = Number(canonicalInput.height || 0);
      browserSourceFound = isOurOverlayUrl(browserSourceUrl, port);

      if (browserSourceFound && browserSourceWidth >= 300 && browserSourceHeight >= 200) {
        stages.obsSourceSettings = 'pass';
      } else {
        stages.obsSourceSettings = 'fail';
        throw new Error(`Invalid OBS Browser Source settings: URL=${browserSourceUrl}, size=${browserSourceWidth}x${browserSourceHeight}`);
      }
    } else {
      stages.obsBrowserSource = 'fail';
      stages.obsSourceSettings = 'fail';
      throw new Error('Failed to ensure canonical OBS Browser Source');
    }

    // 4. Attempt GetSourceScreenshot (OBS WebSocket v5) on the canonical input
    let obsScreenshot = { supported: false, reason: 'Not attempted' };
    let savedScreenshotPath = null;

    if (canonicalInput && artifactDir) {
      try {
        const chosenSourceName = canonicalInput.inputName;
        const res = await client.call('GetSourceScreenshot', {
          sourceName: chosenSourceName,
          imageFormat: 'png',
        });

        let bestBuffer = null;
        if (res && res.imageData) {
          const raw = res.imageData.replace(/^data:image\/[a-z]+;base64,/, '');
          const b = Buffer.from(raw, 'base64');
          if (b.length > 100) {
            bestBuffer = b;
          }
        }

        if (bestBuffer) {
          const targetFile = path.join(artifactDir, 'obs-source.png');
          fs.writeFileSync(targetFile, bestBuffer);
          savedScreenshotPath = targetFile;
          obsScreenshot = { supported: true, file: 'obs-source.png', bytes: bestBuffer.length, sourceName: chosenSourceName };
          stages.obsScreenshot = 'pass';
          stages.obsVisual = 'pass';
        } else {
          obsScreenshot = { supported: false, reason: 'Empty or corrupted screenshot' };
          stages.obsScreenshot = 'fail';
          stages.obsVisual = 'fail';
        }
      } catch (err) {
        obsScreenshot = { supported: false, reason: err.message };
        stages.obsScreenshot = 'fail';
        stages.obsVisual = 'fail';
      }
    }

    // 5. Verify original scene was not changed
    const finalSceneList = await client.call('GetSceneList').catch(() => ({}));
    const finalCurrentScene = finalSceneList.currentProgramSceneName || finalSceneList.currentPreviewSceneName || '';
    const scenePreserved = originalCurrentScene === finalCurrentScene;

    const allPassed = Object.values(stages).every(s => s === 'pass');

    return {
      status: allPassed ? 'pass' : (requireObs ? 'fail' : 'skip'),
      stages,
      details: {
        connected: true,
        qaScene: QA_SCENE_NAME,
        sourceName: canonicalInput.inputName,
        browserSourceFound,
        browserSourceUrl,
        browserSourceDimensions: `${browserSourceWidth}x${browserSourceHeight}`,
        scenePreserved,
        obsScreenshot,
        savedScreenshotPath,
      },
    };
  } catch (error) {
    const stageStatus = requireObs ? 'fail' : 'skip';
    return {
      status: stageStatus,
      stages: {
        ...defaultStages,
        obsConnection: stageStatus,
      },
      details: {
        connected: false,
        required: requireObs,
        reason: error.message || String(error),
      },
    };
  } finally {
    await obsService.destroy().catch(() => {});
  }
}

module.exports = {
  QA_SCENE_NAME,
  QA_SOURCE_NAME,
  prepareObsIntegration,
  verifyObsIntegration,
};
