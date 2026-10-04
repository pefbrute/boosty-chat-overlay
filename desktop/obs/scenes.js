/**
 * OBS Scenes and Canonical Browser Source Management Module.
 *
 * Enforces the Single Canonical Browser Source Invariant:
 * - Input = Browser Source resource (identified primarily by inputKind === 'browser_source' && isOurOverlayUrl(url))
 * - Scene Item = placement of that input inside a scene (validated for canonical 1:1 geometry)
 */

const {
  buildCanonicalOverlayTransform,
  isObsOverlayTransformCanonical,
} = require('./transform.js');

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
 * Checks whether the overlay URL uses the canonical 127.0.0.1 host.
 *
 * @param {string} rawUrl
 * @param {number|string} [expectedPort=17369]
 * @returns {boolean}
 */
function isCanonicalOverlayUrlFormat(rawUrl, expectedPort = 17369) {
  if (!isOurOverlayUrl(rawUrl, expectedPort)) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === '127.0.0.1';
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
 * Evaluates scene item transform criteria for canonical candidate ranking.
 *
 * @param {Array<object>} sceneReferences
 * @returns {{ hasUnitScale: boolean, hasNoCrop: boolean, hasCanonicalPlacement: boolean }}
 */
function evaluateCandidateTransformTraits(sceneReferences = []) {
  if (!Array.isArray(sceneReferences) || sceneReferences.length === 0) {
    return {
      hasUnitScale: false,
      hasNoCrop: true,
      hasCanonicalPlacement: false,
    };
  }

  let hasUnitScale = false;
  let hasNoCrop = false;
  let hasCanonicalPlacement = false;

  for (const ref of sceneReferences) {
    const tr = ref.transform;
    if (!tr) {
      hasUnitScale = true;
      hasNoCrop = true;
      continue;
    }
    const scaleOk = Math.abs(Number(tr.scaleX ?? 1) - 1) <= 0.005 &&
                    Math.abs(Number(tr.scaleY ?? 1) - 1) <= 0.005;
    const cropOk = Number(tr.cropLeft || 0) === 0 &&
                   Number(tr.cropTop || 0) === 0 &&
                   Number(tr.cropRight || 0) === 0 &&
                   Number(tr.cropBottom || 0) === 0;
    if (scaleOk) hasUnitScale = true;
    if (cropOk) hasNoCrop = true;
    if (ref.isCanonical) hasCanonicalPlacement = true;
  }

  return { hasUnitScale, hasNoCrop, hasCanonicalPlacement };
}

/**
 * Selects the single canonical Browser Source input among matching candidates.
 *
 * Priority rules:
 * 1. Already uses canonical overlay URL (127.0.0.1:<port>/overlay/)
 * 2. Internal width/height equal to base OBS canvas (baseWidth x baseHeight)
 * 3. Scene item transform has scaleX/scaleY = 1
 * 4. Scene item transform has no crop (and canonical placement)
 * 5. Largest number of scene references
 * 6. Deterministic tie-breaker: canonical name "Boosty Chat", then oldest/first index in OBS
 *
 * @param {Array<object>} candidates
 * @param {object|null} [videoSettings]
 * @param {number|string} [expectedPort=17369]
 * @returns {object|null}
 */
function selectCanonicalOverlayInput(candidates, videoSettings = null, expectedPort = 17369) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const baseWidth = Number(videoSettings?.baseWidth || 1920);
  const baseHeight = Number(videoSettings?.baseHeight || 1080);

  const scored = candidates.map((cand, idx) => {
    const canonicalUrl = isCanonicalOverlayUrlFormat(cand.url, expectedPort) ? 1 : 0;
    const matchesBaseCanvas = (Number(cand.width) === baseWidth && Number(cand.height) === baseHeight) ? 1 : 0;
    const traits = evaluateCandidateTransformTraits(cand.sceneReferences);
    const unitScale = traits.hasUnitScale ? 1 : 0;
    const noCrop = traits.hasNoCrop ? 1 : 0;
    const canonicalPlacement = traits.hasCanonicalPlacement ? 1 : 0;
    const sceneRefCount = Array.isArray(cand.sceneReferences) ? cand.sceneReferences.length : 0;
    const isPrimaryName = cand.inputName === 'Boosty Chat' ? 1 : 0;
    const orderIndex = typeof cand.index === 'number' ? cand.index : idx;

    return {
      cand,
      canonicalUrl,
      matchesBaseCanvas,
      unitScale,
      noCrop,
      canonicalPlacement,
      sceneRefCount,
      isPrimaryName,
      orderIndex,
    };
  });

  scored.sort((a, b) => {
    if (a.canonicalUrl !== b.canonicalUrl) return b.canonicalUrl - a.canonicalUrl;
    if (a.matchesBaseCanvas !== b.matchesBaseCanvas) return b.matchesBaseCanvas - a.matchesBaseCanvas;
    if (a.unitScale !== b.unitScale) return b.unitScale - a.unitScale;
    if (a.noCrop !== b.noCrop) return b.noCrop - a.noCrop;
    if (a.canonicalPlacement !== b.canonicalPlacement) return b.canonicalPlacement - a.canonicalPlacement;
    if (a.sceneRefCount !== b.sceneRefCount) return b.sceneRefCount - a.sceneRefCount;
    if (a.isPrimaryName !== b.isPrimaryName) return b.isPrimaryName - a.isPrimaryName;
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
    return String(a.cand.inputUuid || '').localeCompare(String(b.cand.inputUuid || ''));
  });

  return scored[0].cand;
}

/**
 * Discovers all Browser Source inputs matching our local overlay URL,
 * their scene references across all scenes, and selects the canonical input.
 * Never matches or touches non-overlay Browser Sources.
 *
 * @param {object} client OBS client with .call() method
 * @param {object} [options]
 * @param {number} [options.port=17369]
 * @returns {Promise<object>}
 */
async function discoverOverlayInputs(client, options = {}) {
  const port = options.port || 17369;

  const [collectionData, sceneListData, inputListData, videoSettings] = await Promise.all([
    client.call('GetSceneCollectionList').catch(() => ({ currentSceneCollectionName: '' })),
    client.call('GetSceneList'),
    client.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] })),
    client.call('GetVideoSettings').catch(() => null),
  ]);

  const currentCollection = collectionData?.currentSceneCollectionName || '';
  const rawScenes = sceneListData?.scenes || [];
  const rawInputs = inputListData?.inputs || [];
  const baseWidth = Number(videoSettings?.baseWidth || 1920);
  const baseHeight = Number(videoSettings?.baseHeight || 1080);
  const effectiveVideoSettings = videoSettings || { baseWidth, baseHeight };

  const matchingInputs = [];

  for (let i = 0; i < rawInputs.length; i++) {
    const input = rawInputs[i];
    if (input.inputKind && input.inputKind !== 'browser_source') continue;

    const settings = await client.call('GetInputSettings', { inputUuid: input.inputUuid }).catch(() => null);
    const url = settings?.inputSettings?.url;
    if (url && isOurOverlayUrl(url, port)) {
      const width = settings.inputSettings.width;
      const height = settings.inputSettings.height;
      const matchesDimensions = Number(width) === baseWidth && Number(height) === baseHeight;
      matchingInputs.push({
        inputUuid: input.inputUuid,
        inputName: input.inputName,
        inputKind: 'browser_source',
        url,
        width,
        height,
        inputSettings: settings.inputSettings,
        index: i,
        matchesDimensions,
        sceneReferences: [],
        isCanonicalGeometry: videoSettings ? matchesDimensions : true,
      });
    }
  }

  const matchingByUuid = new Map();
  const matchingByName = new Map();
  for (const m of matchingInputs) {
    if (m.inputUuid) matchingByUuid.set(m.inputUuid, m);
    if (m.inputName) matchingByName.set(m.inputName, m);
  }

  const sceneItemsBySceneUuid = new Map();
  const allSceneReferences = [];
  let extraSceneItemsInSameScene = 0;

  for (const sc of rawScenes) {
    let items = [];
    try {
      const res = await client.call('GetSceneItemList', { sceneUuid: sc.sceneUuid });
      items = res?.sceneItems || [];
    } catch {}
    sceneItemsBySceneUuid.set(sc.sceneUuid, items);

    let overlayItemsInThisScene = 0;
    for (const item of items) {
      const matchedInput = (item.sourceUuid && matchingByUuid.get(item.sourceUuid)) ||
                           (!item.sourceUuid && item.sourceName && matchingByName.get(item.sourceName)) ||
                           null;
      if (!matchedInput) continue;

      overlayItemsInThisScene++;
      let transform = item.sceneItemTransform || null;
      let isCanonical = true;
      let reason = undefined;

      try {
        const tr = await client.call('GetSceneItemTransform', {
          sceneUuid: sc.sceneUuid,
          sceneItemId: item.sceneItemId,
        });
        if (tr?.sceneItemTransform) {
          transform = tr.sceneItemTransform;
        }
      } catch {}

      if (transform && videoSettings) {
        const check = isObsOverlayTransformCanonical(transform, matchedInput.inputSettings, effectiveVideoSettings);
        isCanonical = check.canonical;
        reason = check.reason;
      } else if (videoSettings && !matchedInput.matchesDimensions) {
        isCanonical = false;
        reason = 'viewport_mismatch';
      }

      if (!isCanonical) {
        matchedInput.isCanonicalGeometry = false;
      }

      const refRecord = {
        sceneUuid: sc.sceneUuid,
        sceneName: sc.sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: item.sceneItemEnabled !== false,
        sourceUuid: matchedInput.inputUuid,
        sourceName: matchedInput.inputName,
        transform,
        isCanonical,
        reason,
      };
      matchedInput.sceneReferences.push(refRecord);
      allSceneReferences.push(refRecord);
    }

    if (overlayItemsInThisScene > 1) {
      extraSceneItemsInSameScene += (overlayItemsInThisScene - 1);
    }
  }

  const canonicalInput = selectCanonicalOverlayInput(matchingInputs, effectiveVideoSettings, port);
  const duplicateInputs = canonicalInput
    ? matchingInputs.filter(i => i.inputUuid !== canonicalInput.inputUuid)
    : [];

  // Duplicate count counts extra overlay inputs + any duplicate scene items of the canonical input within the same scene
  const sameCanonicalExtraItems = rawScenes.reduce((acc, sc) => {
    if (!canonicalInput) return acc;
    const refs = canonicalInput.sceneReferences.filter(r => r.sceneUuid === sc.sceneUuid);
    return acc + Math.max(0, refs.length - 1);
  }, 0);

  const duplicateCount = duplicateInputs.length + sameCanonicalExtraItems;

  return {
    currentCollection,
    rawScenes,
    sceneItemsBySceneUuid,
    videoSettings,
    baseWidth,
    baseHeight,
    matchingInputs,
    canonicalInput,
    duplicateInputs,
    duplicateCount,
    extraSceneItemsInSameScene,
    allSceneReferences,
  };
}

/**
 * Queries current OBS scene collection, scene list, canonical overlay input, and diagnostics.
 *
 * @param {object} client OBS client with .call() method
 * @param {object} [options]
 * @param {number} [options.port=17369]
 * @returns {Promise<object>}
 */
async function fetchScenesState(client, options = {}) {
  const discovery = await discoverOverlayInputs(client, options);
  const {
    currentCollection,
    rawScenes,
    videoSettings,
    baseWidth,
    baseHeight,
    matchingInputs,
    canonicalInput,
    duplicateCount,
    allSceneReferences,
  } = discovery;

  const ourInput = canonicalInput ? {
    inputUuid: canonicalInput.inputUuid,
    inputName: canonicalInput.inputName,
    url: canonicalInput.url,
    width: canonicalInput.width,
    height: canonicalInput.height,
  } : null;

  const userScenes = rawScenes.filter(s => s.sceneName !== 'Boosty Chat Overlay');

  const scenesWithStatus = userScenes.map(s => {
    const canonicalRef = canonicalInput
      ? canonicalInput.sceneReferences.find(r => r.sceneUuid === s.sceneUuid)
      : null;
    const fallbackRef = !canonicalRef
      ? allSceneReferences.find(r => r.sceneUuid === s.sceneUuid)
      : null;
    const activeRef = canonicalRef || fallbackRef || null;

    return {
      sceneUuid: s.sceneUuid,
      sceneName: s.sceneName,
      hasChat: Boolean(activeRef),
      sceneItemId: activeRef ? activeRef.sceneItemId : null,
      sceneItemEnabled: activeRef ? activeRef.sceneItemEnabled : true,
      isCanonical: activeRef ? activeRef.isCanonical : true,
      transformReason: activeRef ? activeRef.reason : undefined,
      transform: activeRef ? activeRef.transform : null,
    };
  });

  let overallCanonical = true;
  let firstMismatchReason = undefined;
  let hasAnyChatScene = false;
  let firstTransform = null;

  for (const sc of scenesWithStatus) {
    if (sc.hasChat) {
      hasAnyChatScene = true;
      if (!firstTransform && sc.transform) {
        firstTransform = sc.transform;
      }
      if (!sc.isCanonical) {
        overallCanonical = false;
        if (!firstMismatchReason) firstMismatchReason = sc.transformReason;
      }
    }
  }

  if (canonicalInput && videoSettings) {
    if (Number(canonicalInput.width) !== baseWidth || Number(canonicalInput.height) !== baseHeight) {
      overallCanonical = false;
      if (!firstMismatchReason) firstMismatchReason = 'viewport_mismatch';
    }
  }

  const isCanonicalGeometry = hasAnyChatScene
    ? overallCanonical
    : (canonicalInput ? overallCanonical : true);

  const canvasStatus = {
    canonical: isCanonicalGeometry,
    hasChat: hasAnyChatScene,
    reason: firstMismatchReason,
    baseWidth,
    baseHeight,
    inputWidth: canonicalInput?.width,
    inputHeight: canonicalInput?.height,
    scaleX: firstTransform?.scaleX,
    scaleY: firstTransform?.scaleY,
  };

  const canonicalOverlayInputSummary = canonicalInput ? {
    inputUuid: canonicalInput.inputUuid,
    inputName: canonicalInput.inputName,
    inputKind: canonicalInput.inputKind,
    url: canonicalInput.url,
    width: canonicalInput.width,
    height: canonicalInput.height,
    isCanonicalGeometry: canonicalInput.isCanonicalGeometry,
  } : null;

  const matchingOverlayInputsSummary = matchingInputs.map(i => ({
    inputUuid: i.inputUuid,
    inputName: i.inputName,
    inputKind: i.inputKind,
    url: i.url,
    width: i.width,
    height: i.height,
    sceneReferencesCount: i.sceneReferences.length,
    isCanonicalGeometry: i.isCanonicalGeometry,
  }));

  const sceneReferencesSummary = allSceneReferences.map(r => ({
    sceneUuid: r.sceneUuid,
    sceneName: r.sceneName,
    sceneItemId: r.sceneItemId,
    sceneItemEnabled: r.sceneItemEnabled,
    sourceUuid: r.sourceUuid,
    sourceName: r.sourceName,
    isCanonical: r.isCanonical,
    reason: r.reason,
    transform: r.transform,
  }));

  const diagnostics = {
    canonicalOverlayInput: canonicalOverlayInputSummary,
    matchingOverlayInputs: matchingOverlayInputsSummary,
    duplicateCount,
    sceneReferences: sceneReferencesSummary,
    isCanonicalGeometry,
  };

  return {
    ok: true,
    connected: true,
    currentCollection,
    scenes: scenesWithStatus,
    ourInput,
    canonicalOverlayInput: canonicalOverlayInputSummary,
    matchingOverlayInputs: matchingOverlayInputsSummary,
    duplicateCount,
    sceneReferences: sceneReferencesSummary,
    isCanonicalGeometry,
    diagnostics,
    videoSettings: videoSettings ? {
      baseWidth: videoSettings.baseWidth,
      baseHeight: videoSettings.baseHeight,
      outputWidth: videoSettings.outputWidth,
      outputHeight: videoSettings.outputHeight,
    } : null,
    canvasStatus,
  };
}

/**
 * Idempotently migrates legacy/duplicate overlay Browser Sources into a single canonical Browser Source:
 * 1. Selects the best canonical Browser Source input (never touches non-overlay user sources).
 * 2. Replaces any scene references to duplicate overlay inputs with the canonical input.
 * 3. Removes duplicate scene items from scenes that had multiple overlay items.
 * 4. Normalizes the canonical input (width = baseWidth, height = baseHeight) and its scene item transforms (1:1).
 * 5. Removes orphaned duplicate Browser Source inputs via RemoveInput.
 *
 * @param {object} client
 * @param {object} [options]
 * @param {number} [options.port=17369]
 * @param {string} [options.appVersion='0.4.0']
 * @param {boolean} [options.forceNormalize=false]
 * @returns {Promise<object>}
 */
async function migrateOverlayInputs(client, options = {}) {
  const port = options.port || 17369;
  const forceNormalize = Boolean(options.forceNormalize);

  const discovery = await discoverOverlayInputs(client, { port });
  const {
    rawScenes,
    baseWidth,
    baseHeight,
    canonicalInput,
    duplicateInputs,
    allSceneReferences,
  } = discovery;

  if (!canonicalInput) {
    return {
      ok: true,
      migrated: false,
      canonicalOverlayInput: null,
      removedSceneItems: [],
      removedInputs: [],
      affectedScenes: [],
    };
  }

  const canonicalTransform = buildCanonicalOverlayTransform({ baseWidth, baseHeight });
  const removedSceneItems = [];
  const removedInputs = [];
  const affectedScenes = [];
  let normalizedInputSettings = false;

  // 1. Ensure canonical input has exact baseWidth x baseHeight
  const needsDimensionUpdate = forceNormalize ||
    Number(canonicalInput.width) !== baseWidth ||
    Number(canonicalInput.height) !== baseHeight;

  if (needsDimensionUpdate) {
    await client.call('SetInputSettings', {
      inputUuid: canonicalInput.inputUuid,
      inputSettings: {
        width: baseWidth,
        height: baseHeight,
        shutdown: false,
        restart_when_active: false,
      },
      overlay: true,
    }).catch(() => {});
    normalizedInputSettings = true;
  }

  // 2. Reconcile scene items in every scene: keep/link 1 canonical item, remove duplicate items
  for (const sc of rawScenes) {
    const sceneRefs = allSceneReferences.filter(r => r.sceneUuid === sc.sceneUuid);
    if (sceneRefs.length === 0) continue;

    const canonicalRefsInScene = sceneRefs.filter(r => r.sourceUuid === canonicalInput.inputUuid);
    let keptSceneItemId = null;

    if (canonicalRefsInScene.length > 0) {
      const keptRef = canonicalRefsInScene[0];
      keptSceneItemId = keptRef.sceneItemId;

      if (forceNormalize || !keptRef.isCanonical || needsDimensionUpdate) {
        await client.call('SetSceneItemTransform', {
          sceneUuid: sc.sceneUuid,
          sceneItemId: keptSceneItemId,
          sceneItemTransform: canonicalTransform,
        }).catch(() => {});
      }
      affectedScenes.push(sc.sceneName);
    } else {
      // Scene only had a duplicate overlay input: link the canonical input before removing the duplicate item
      const enabledState = sceneRefs[0].sceneItemEnabled !== false;
      const createdItem = await client.call('CreateSceneItem', {
        sceneUuid: sc.sceneUuid,
        sourceUuid: canonicalInput.inputUuid,
        sceneItemEnabled: enabledState,
      }).catch(() => null);

      keptSceneItemId = createdItem?.sceneItemId ?? null;
      if (keptSceneItemId != null) {
        await client.call('SetSceneItemTransform', {
          sceneUuid: sc.sceneUuid,
          sceneItemId: keptSceneItemId,
          sceneItemTransform: canonicalTransform,
        }).catch(() => {});
      }
      affectedScenes.push(sc.sceneName);
    }

    // Remove all other overlay scene items in this scene (duplicates of canonical or items of duplicate inputs)
    for (const ref of sceneRefs) {
      if (ref.sceneItemId !== keptSceneItemId) {
        await client.call('RemoveSceneItem', {
          sceneUuid: sc.sceneUuid,
          sceneItemId: ref.sceneItemId,
        }).catch(() => {});
        removedSceneItems.push({
          sceneUuid: sc.sceneUuid,
          sceneName: sc.sceneName,
          sceneItemId: ref.sceneItemId,
          sourceUuid: ref.sourceUuid,
          sourceName: ref.sourceName,
        });
      }
    }
  }

  // 3. Remove orphaned duplicate Browser Source inputs (strictly verified to be our overlay URL)
  for (const dup of duplicateInputs) {
    if (
      dup.inputUuid !== canonicalInput.inputUuid &&
      dup.inputKind === 'browser_source' &&
      isOurOverlayUrl(dup.url, port)
    ) {
      await client.call('RemoveInput', {
        inputUuid: dup.inputUuid,
      }).catch(() => {});
      removedInputs.push({
        inputUuid: dup.inputUuid,
        inputName: dup.inputName,
        url: dup.url,
        width: dup.width,
        height: dup.height,
      });
    }
  }

  return {
    ok: true,
    migrated: Boolean(normalizedInputSettings || removedSceneItems.length > 0 || removedInputs.length > 0),
    baseWidth,
    baseHeight,
    canonicalOverlayInput: {
      inputUuid: canonicalInput.inputUuid,
      inputName: canonicalInput.inputName,
      url: canonicalInput.url,
      width: baseWidth,
      height: baseHeight,
    },
    affectedScenes,
    removedSceneItems,
    removedInputs,
  };
}

/**
 * Adds overlay Browser Source to a specified scene.
 * Reuses the existing canonical overlay input if present; creates one only if none exists.
 *
 * @param {object} client
 * @param {string} sceneIdentifier
 * @param {object} [options]
 * @param {string} [options.appVersion='0.4.0']
 * @param {number} [options.port=17369]
 * @returns {Promise<{ ok: boolean, addedScene?: string, inputUuid?: string, reused?: boolean, error?: string }>}
 */
async function addSceneTarget(client, sceneIdentifier, options = {}) {
  const appVersion = options.appVersion || '0.4.0';
  const port = options.port || 17369;

  // Clean up any existing duplicates first so we always operate on a single canonical input
  let discovery = await discoverOverlayInputs(client, { port });
  const targetScene = discovery.rawScenes.find(
    s => s.sceneUuid === sceneIdentifier || s.sceneName === sceneIdentifier
  );
  if (!targetScene) {
    return { ok: false, error: 'Выбранная сцена не найдена в OBS' };
  }

  if (discovery.duplicateCount > 0) {
    await migrateOverlayInputs(client, { port, appVersion });
    discovery = await discoverOverlayInputs(client, { port });
  }

  const { baseWidth, baseHeight, canonicalInput } = discovery;

  const inputSettings = {
    url: `http://127.0.0.1:${port}/overlay/?v=${appVersion}`,
    width: baseWidth,
    height: baseHeight,
    shutdown: false,
    restart_when_active: false,
  };

  let inputUuid;
  let targetSceneItemId = null;
  let reused = false;

  if (canonicalInput) {
    reused = true;
    inputUuid = canonicalInput.inputUuid;
    await client.call('SetInputSettings', { inputUuid, inputSettings, overlay: true }).catch(() => {});
    const items = await client.call('GetSceneItemList', { sceneUuid: targetScene.sceneUuid }).catch(() => ({ sceneItems: [] }));
    const existingItems = (items.sceneItems || []).filter(item => item.sourceUuid === inputUuid);
    if (existingItems.length === 0) {
      const createdItem = await client.call('CreateSceneItem', {
        sceneUuid: targetScene.sceneUuid,
        sourceUuid: inputUuid,
        sceneItemEnabled: true,
      });
      targetSceneItemId = createdItem?.sceneItemId;
    } else {
      targetSceneItemId = existingItems[0].sceneItemId;
      for (let i = 1; i < existingItems.length; i++) {
        await client.call('RemoveSceneItem', {
          sceneUuid: targetScene.sceneUuid,
          sceneItemId: existingItems[i].sceneItemId,
        }).catch(() => {});
      }
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
    targetSceneItemId = created.sceneItemId;
  }

  // Ensure canonical 1:1 transform matching canvas
  if (targetSceneItemId != null) {
    const canonicalTransform = buildCanonicalOverlayTransform({ baseWidth, baseHeight });
    await client.call('SetSceneItemTransform', {
      sceneUuid: targetScene.sceneUuid,
      sceneItemId: targetSceneItemId,
      sceneItemTransform: canonicalTransform,
    }).catch(() => {});
  }

  return { ok: true, addedScene: targetScene.sceneName, inputUuid, reused };
}

/**
 * Normalizes the canonical overlay Browser Source to match the OBS base canvas
 * and cleans up any duplicate overlay inputs/scene items:
 * 1. Sets internal Browser Source width & height to OBS canvas baseWidth & baseHeight.
 * 2. Resets SceneItemTransform to canonical 1:1 (position=0,0, scale=1,1, alignment=5, bounds=NONE, crop=0).
 * 3. Removes duplicate overlay scene items and orphaned duplicate inputs.
 *
 * @param {object} client
 * @param {object} [options]
 * @param {number} [options.port=17369]
 * @returns {Promise<{ ok: boolean, baseWidth?: number, baseHeight?: number, affectedScenes?: string[], error?: string }>}
 */
async function normalizeOverlayTransform(client, options = {}) {
  const port = options.port || 17369;

  const videoSettings = await client.call('GetVideoSettings').catch(() => null);
  if (!videoSettings || !videoSettings.baseWidth || !videoSettings.baseHeight) {
    return { ok: false, error: 'Не удалось получить настройки видео (GetVideoSettings) из OBS' };
  }

  const migration = await migrateOverlayInputs(client, {
    port,
    forceNormalize: true,
  });

  if (!migration.canonicalOverlayInput) {
    return { ok: false, error: 'Оверлей Boosty Chat не найден в источниках OBS' };
  }

  return {
    ok: true,
    baseWidth: migration.baseWidth,
    baseHeight: migration.baseHeight,
    affectedScenes: migration.affectedScenes,
    inputUuid: migration.canonicalOverlayInput.inputUuid,
  };
}

/**
 * Removes overlay Browser Source item(s) from a specified scene.
 *
 * @param {object} client
 * @param {string} sceneIdentifier
 * @param {object} [options]
 * @param {number} [options.port=17369]
 * @returns {Promise<{ ok: boolean, removedScene?: string, error?: string }>}
 */
async function removeSceneTarget(client, sceneIdentifier, options = {}) {
  const port = options.port || 17369;

  const discovery = await discoverOverlayInputs(client, { port });
  const targetScene = discovery.rawScenes.find(
    s => s.sceneUuid === sceneIdentifier || s.sceneName === sceneIdentifier
  );
  if (!targetScene) {
    return { ok: true, removedScene: sceneIdentifier };
  }

  const matchingUuids = new Set(discovery.matchingInputs.map(i => i.inputUuid));
  const items = discovery.sceneItemsBySceneUuid.get(targetScene.sceneUuid) || [];

  for (const item of items) {
    if (
      (item.sourceUuid && matchingUuids.has(item.sourceUuid)) ||
      item.sourceName === 'Boosty Chat' ||
      item.sourceName === 'Boosty Chat Overlay'
    ) {
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

/**
 * Triggers a cacheless page reload in OBS Browser Source strictly on the canonical overlay input.
 * Fixes CEF ERR_CONNECTION_REFUSED when Desktop App was restarted.
 *
 * @param {object} client
 * @param {object} [options]
 * @param {number} [options.port=17369]
 * @returns {Promise<{ ok: boolean, refreshed?: boolean, inputUuid?: string, inputName?: string, error?: string }>}
 */
async function refreshOverlayInput(client, options = {}) {
  const port = options.port || 17369;
  try {
    const discovery = await discoverOverlayInputs(client, { port });
    const canonical = discovery.canonicalInput;
    if (!canonical) {
      return { ok: true, refreshed: false, reason: 'Overlay source not found' };
    }

    await client.call('PressInputPropertiesButton', {
      inputUuid: canonical.inputUuid,
      propertyName: 'refreshnocache',
    });

    return {
      ok: true,
      refreshed: true,
      inputUuid: canonical.inputUuid,
      inputName: canonical.inputName,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

module.exports = {
  isOurOverlayUrl,
  isCanonicalOverlayUrlFormat,
  findUniqueInputName,
  selectCanonicalOverlayInput,
  discoverOverlayInputs,
  migrateOverlayInputs,
  fetchScenesState,
  addSceneTarget,
  removeSceneTarget,
  normalizeOverlayTransform,
  refreshOverlayInput,
  createMutationQueue,
};
