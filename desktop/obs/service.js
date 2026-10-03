const { getObsExecutablePath, launchObs } = require('./config.js');
const { createObsClient } = require('./client.js');
const {
  fetchScenesState,
  addSceneTarget,
  removeSceneTarget,
  createMutationQueue,
} = require('./scenes.js');

/**
 * Creates the high-level OBS Service façade for Electron Main process.
 *
 * @param {object} [options]
 * @param {object} [options.client] Custom OBS client instance
 * @param {string} [options.appVersion='0.4.0']
 * @param {number} [options.overlayPort=17369]
 * @param {Function} [options.onStateChange] Callback invoked when OBS state changes (e.g., to notify renderer)
 */
function createObsService(options = {}) {
  const client = options.client || createObsClient(options);
  const appVersion = options.appVersion || '0.4.0';
  const overlayPort = options.overlayPort || 17369;
  const onStateChange = options.onStateChange || null;

  const mutationQueue = createMutationQueue();

  let lastObsState = { ok: false, connected: false, scenes: [] };
  let currentPassword = '';

  let refreshTimer = null;
  let refreshInFlight = false;
  let refreshPending = false;
  let syncIntervalTimer = null;

  function notifyStateChanged(state) {
    lastObsState = state;
    if (typeof onStateChange === 'function') {
      try {
        onStateChange(state);
      } catch {}
    }
  }

  /**
   * Debounced background refresh of actual OBS state.
   */
  function scheduleRefresh(delay = 60) {
    if (mutationQueue.isBlocked()) return;

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (refreshInFlight) {
        refreshPending = true;
        return;
      }
      refreshInFlight = true;
      try {
        const state = await fetchState(currentPassword);
        notifyStateChanged(state);
      } catch {} finally {
        refreshInFlight = false;
        if (refreshPending) {
          refreshPending = false;
          scheduleRefresh(10);
        }
      }
    }, delay);
  }

  // Bind client lifecycle events
  client.on('SceneCreated', () => scheduleRefresh(60));
  client.on('SceneRemoved', () => scheduleRefresh(60));
  client.on('SceneNameChanged', () => scheduleRefresh(60));
  client.on('SceneListChanged', () => scheduleRefresh(60));

  client.on('SceneItemCreated', () => scheduleRefresh(60));
  client.on('SceneItemRemoved', () => scheduleRefresh(60));
  client.on('SceneItemEnableStateChanged', () => scheduleRefresh(60));

  client.on('InputCreated', () => scheduleRefresh(60));
  client.on('InputRemoved', () => scheduleRefresh(60));
  client.on('InputNameChanged', () => scheduleRefresh(60));
  client.on('InputSettingsChanged', () => scheduleRefresh(60));

  client.on('CurrentSceneCollectionChanging', () => {
    mutationQueue.setBlocked(true);
    clearTimeout(refreshTimer);
  });
  client.on('CurrentSceneCollectionChanged', () => {
    mutationQueue.setBlocked(false);
    scheduleRefresh(50);
  });

  client.on('ConnectionClosed', () => {
    const disconnectedState = { ok: false, connected: false, scenes: [] };
    notifyStateChanged(disconnectedState);
  });

  client.on('Connected', () => {
    scheduleRefresh(0);
  });

  /**
   * Connects to OBS and queries current scenes state.
   */
  async function fetchState(password = '') {
    currentPassword = String(password || '');
    let state;
    try {
      const conn = await client.connect(currentPassword);
      if (conn.restartRequired) {
        state = { ok: false, connected: false, restartRequired: true, scenes: [] };
      } else {
        state = await fetchScenesState(client, { port: overlayPort });
      }
    } catch (error) {
      state = {
        ok: false,
        connected: false,
        scenes: [],
        error: error?.message || String(error),
      };
    }
    notifyStateChanged(state);
    return state;
  }

  return {
    /**
     * Start periodic sync interval (e.g., every 60 seconds).
     */
    startPeriodicSync(intervalMs = 60000) {
      this.stopPeriodicSync();
      syncIntervalTimer = setInterval(() => scheduleRefresh(0), intervalMs);
    },

    /**
     * Stop periodic sync and cancel pending refresh timers.
     */
    stopPeriodicSync() {
      if (syncIntervalTimer) {
        clearInterval(syncIntervalTimer);
        syncIntervalTimer = null;
      }
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    },

    /**
     * Shuts down service and disconnects OBS client.
     */
    async destroy() {
      this.stopPeriodicSync();
      await client.disconnect();
    },

    /**
     * Triggers a debounced refresh.
     */
    scheduleRefresh(delay = 60) {
      scheduleRefresh(delay);
    },

    /**
     * Returns last known OBS state.
     */
    getStatus() {
      return lastObsState;
    },

    /**
     * Checks if OBS executable exists on this system.
     */
    hasObsExecutable() {
      return Boolean(getObsExecutablePath());
    },

    /**
     * Launches OBS Studio executable.
     */
    launchObs() {
      return launchObs();
    },

    /**
     * Connects to OBS and fetches scene list.
     */
    async listScenes(password = '') {
      return fetchState(password);
    },

    /**
     * Adds overlay browser source to the given scene.
     */
    async addScene(password = '', sceneIdentifier = '') {
      return mutationQueue.enqueue(async () => {
        try {
          currentPassword = String(password || '');
          const conn = await client.connect(currentPassword);
          if (conn.restartRequired) return { ok: false, restartRequired: true };

          const res = await addSceneTarget(client, sceneIdentifier, {
            appVersion,
            port: overlayPort,
          });
          scheduleRefresh(0);
          return res;
        } catch (error) {
          scheduleRefresh(0);
          return { ok: false, error: error?.message || String(error) };
        }
      });
    },

    /**
     * Removes overlay browser source from the given scene.
     */
    async removeScene(password = '', sceneIdentifier = '') {
      return mutationQueue.enqueue(async () => {
        try {
          currentPassword = String(password || '');
          const conn = await client.connect(currentPassword);
          if (conn.restartRequired) return { ok: false, restartRequired: true };

          const res = await removeSceneTarget(client, sceneIdentifier, {
            port: overlayPort,
          });
          scheduleRefresh(0);
          return res;
        } catch (error) {
          scheduleRefresh(0);
          return { ok: false, error: error?.message || String(error) };
        }
      });
    },

    /**
     * Reference to underlying client.
     */
    getClient() {
      return client;
    },
  };
}

module.exports = {
  createObsService,
};
