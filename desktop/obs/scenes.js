/**
 * OBS Scenes and Browser Source Management Module.
 */

/**
 * Checks if a given URL belongs to our local overlay.
 *
 * @param {string} rawUrl
 * @param {number|string} [expectedPort=17369]
 * @returns {boolean}
 */
function isOurOverlayUrl(rawUrl, expectedPort = 17369) {
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      String(parsed.port) === String(expectedPort) &&
      parsed.pathname === '/overlay/'
    );
  } catch {
    return false;
  }
}

/**
 * Generates an unused input name in OBS starting with "Boosty Chat".
 *
 * @param {object} client OBS client with .call() method
 * @returns {Promise<string>}
 */
async function findUniqueInputName(client) {
  const allInputs = await client.call('GetInputList').catch(() => ({ inputs: [] }));
  const existingNames = new Set((allInputs.inputs || []).map(i => i.inputName));

  const base = 'Boosty Chat';
  if (!existingNames.has(base)) return base;

  let suffix = 1;
  while (existingNames.has(`${base} (Overlay${suffix === 1 ? '' : ' ' + suffix})`)) {
    suffix++;
  }
  return `${base} (Overlay${suffix === 1 ? '' : ' ' + suffix})`;
}

/**
 * Queries current OBS scene collection, scene list, and overlays status.
 *
 * @param {object} client OBS client with .call() method
 * @param {object} [options]
 * @param {number} [options.port=17369]
 * @returns {Promise<{ ok: boolean, connected: boolean, currentCollection: string, scenes: Array<object>, ourInput: object | null }>}
 */
async function fetchScenesState(client, options = {}) {
  const port = options.port || 17369;

  const [collectionData, sceneListData, inputListData] = await Promise.all([
    client.call('GetSceneCollectionList').catch(() => ({ currentSceneCollectionName: '' })),
    client.call('GetSceneList'),
    client.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] })),
  ]);

  const currentCollection = collectionData.currentSceneCollectionName || '';
  const inputs = inputListData.inputs || [];

  let ourInput = null;
  for (const input of inputs) {
    const settings = await client.call('GetInputSettings', { inputUuid: input.inputUuid }).catch(() => null);
    if (settings?.inputSettings?.url && isOurOverlayUrl(settings.inputSettings.url, port)) {
      ourInput = {
        inputUuid: input.inputUuid,
        inputName: input.inputName,
        url: settings.inputSettings.url,
      };
      break;
    }
  }

  const rawScenes = sceneListData.scenes || [];
  const userScenes = rawScenes.filter(s => s.sceneName !== 'Boosty Chat Overlay');

  const scenesWithStatus = await Promise.all(userScenes.map(async s => {
    let hasChat = false;
    let sceneItemId = null;
    let sceneItemEnabled = true;

    try {
      const items = await client.call('GetSceneItemList', { sceneUuid: s.sceneUuid });
      for (const item of (items.sceneItems || [])) {
        if (ourInput && item.sourceUuid === ourInput.inputUuid) {
          hasChat = true;
          sceneItemId = item.sceneItemId;
          sceneItemEnabled = item.sceneItemEnabled !== false;
          break;
        }
      }
    } catch {}

    return {
      sceneUuid: s.sceneUuid,
      sceneName: s.sceneName,
      hasChat,
      sceneItemId,
      sceneItemEnabled,
    };
  }));

  return {
    ok: true,
    connected: true,
    currentCollection,
    scenes: scenesWithStatus,
    ourInput,
  };
}

/**
 * Adds overlay Browser Source to a specified scene.
 *
 * @param {object} client
 * @param {string} sceneIdentifier
 * @param {object} [options]
 * @param {string} [options.appVersion='0.4.0']
 * @param {number} [options.port=17369]
 * @returns {Promise<{ ok: boolean, addedScene?: string, inputUuid?: string, error?: string }>}
 */
async function addSceneTarget(client, sceneIdentifier, options = {}) {
  const appVersion = options.appVersion || '0.4.0';
  const port = options.port || 17369;

  const sceneListData = await client.call('GetSceneList');
  const rawScenes = sceneListData.scenes || [];
  const targetScene = rawScenes.find(s => s.sceneUuid === sceneIdentifier || s.sceneName === sceneIdentifier);
  if (!targetScene) {
    return { ok: false, error: 'Выбранная сцена не найдена в OBS' };
  }

  const inputListData = await client.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] }));
  let ourInput = null;
  for (const input of (inputListData.inputs || [])) {
    const settings = await client.call('GetInputSettings', { inputUuid: input.inputUuid }).catch(() => null);
    if (settings?.inputSettings?.url && isOurOverlayUrl(settings.inputSettings.url, port)) {
      ourInput = input;
      break;
    }
  }

  const inputSettings = {
    url: `http://127.0.0.1:${port}/overlay/?v=${appVersion}`,
    width: 900,
    height: 700,
    shutdown: false,
    restart_when_active: false,
  };

  let inputUuid;
  if (ourInput) {
    inputUuid = ourInput.inputUuid;
    await client.call('SetInputSettings', { inputUuid, inputSettings, overlay: true }).catch(() => {});
    const items = await client.call('GetSceneItemList', { sceneUuid: targetScene.sceneUuid });
    const exists = (items.sceneItems || []).some(item => item.sourceUuid === inputUuid);
    if (!exists) {
      await client.call('CreateSceneItem', {
        sceneUuid: targetScene.sceneUuid,
        sourceUuid: inputUuid,
        sceneItemEnabled: true,
      });
    }
  } else {
    const inputName = await findUniqueInputName(client);
    const created = await client.call('CreateInput', {
      sceneUuid: targetScene.sceneUuid,
      inputName,
      inputKind: 'browser_source',
      inputSettings,
      sceneItemEnabled: true,
    });
    inputUuid = created.inputUuid;
  }

  return { ok: true, addedScene: targetScene.sceneName, inputUuid };
}

/**
 * Removes overlay Browser Source item from a specified scene.
 *
 * @param {object} client
 * @param {string} sceneIdentifier
 * @param {object} [options]
 * @param {number} [options.port=17369]
 * @returns {Promise<{ ok: boolean, removedScene?: string, error?: string }>}
 */
async function removeSceneTarget(client, sceneIdentifier, options = {}) {
  const port = options.port || 17369;

  const sceneListData = await client.call('GetSceneList');
  const rawScenes = sceneListData.scenes || [];
  const targetScene = rawScenes.find(s => s.sceneUuid === sceneIdentifier || s.sceneName === sceneIdentifier);
  if (!targetScene) {
    return { ok: true, removedScene: sceneIdentifier };
  }

  const inputListData = await client.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] }));
  let ourInput = null;
  for (const input of (inputListData.inputs || [])) {
    const settings = await client.call('GetInputSettings', { inputUuid: input.inputUuid }).catch(() => null);
    if (settings?.inputSettings?.url && isOurOverlayUrl(settings.inputSettings.url, port)) {
      ourInput = input;
      break;
    }
  }

  const items = await client.call('GetSceneItemList', { sceneUuid: targetScene.sceneUuid });
  for (const item of (items.sceneItems || [])) {
    if ((ourInput && item.sourceUuid === ourInput.inputUuid) || item.sourceName === 'Boosty Chat' || item.sourceName === 'Boosty Chat Overlay') {
      await client.call('RemoveSceneItem', {
        sceneUuid: targetScene.sceneUuid,
        sceneItemId: item.sceneItemId,
      });
    }
  }

  return { ok: true, removedScene: targetScene.sceneName };
}

/**
 * Creates a serialized user mutation queue that rejects tasks when scene collection is changing.
 */
function createMutationQueue() {
  let queue = Promise.resolve();
  let isBlocked = false;

  return {
    setBlocked(blocked) {
      isBlocked = Boolean(blocked);
    },
    isBlocked() {
      return isBlocked;
    },
    enqueue(task) {
      if (isBlocked) {
        return Promise.resolve({
          ok: false,
          paused: true,
          error: 'Коллекция сцен OBS переключается...',
        });
      }
      const next = queue.catch(() => {}).then(() => task());
      queue = next.catch(() => {});
      return next;
    },
  };
}

module.exports = {
  isOurOverlayUrl,
  findUniqueInputName,
  fetchScenesState,
  addSceneTarget,
  removeSceneTarget,
  createMutationQueue,
};
