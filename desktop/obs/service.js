const { getObsExecutablePath, launchObs, readObsWebSocketConfig } = require('./config.js');
const { createObsClient } = require('./client.js');
const {
  fetchScenesState,
  migrateOverlayInputs,
  addSceneTarget,
  removeSceneTarget,
  normalizeOverlayTransform,
  refreshOverlayInput,
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
 * @param {Function} [options.getOverlayClients] Callback returning connected SSE overlay client count
 * @param {Function} [options.isServerReady] Callback returning boolean whether local HTTP server is listening
 * @param {number} [options.selfHealCooldownMs=15000] Cooldown between self-heal refreshes
 * @param {Function} [options.now] Custom clock function for deterministic testing
 */
function createObsService(options = {}) {
  const client = options.client || createObsClient(options);
  const appVersion = options.appVersion || '0.4.0';
  const overlayPort = options.overlayPort || 17369;
  const onStateChange = options.onStateChange || null;
  const getOverlayClients = typeof options.getOverlayClients === 'function' ? options.getOverlayClients : null;
  const isServerReady = typeof options.isServerReady === 'function' ? options.isServerReady : () => true;
  const selfHealCooldownMs = typeof options.selfHealCooldownMs === 'number' ? options.selfHealCooldownMs : 15000;
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();

  const mutationQueue = createMutationQueue();

  function resolveInitialPort(configuredPort) {
    const numPort = Number(configuredPort || 4455);
    if (numPort !== 4455) return numPort;
    const localObs = readObsWebSocketConfig(options);
    if (localObs?.config?.server_port) {
      const localPort = Number(localObs.config.server_port);
      if (Number.isFinite(localPort) && localPort > 0 && localPort <= 65535) {
        return localPort;
      }
    }
    return numPort;
  }

  let configStore = options.configStore || null;
  let currentHost = '127.0.0.1';
  let currentPort = resolveInitialPort(4455);
  let currentPassword = '';

  if (configStore && typeof configStore.get === 'function') {
    const cfg = configStore.get();
    if (cfg.obsHost) currentHost = String(cfg.obsHost).trim();
    if (cfg.obsPort) currentPort = resolveInitialPort(cfg.obsPort);
    if (cfg.obsPassword !== undefined) currentPassword = String(cfg.obsPassword);
  }

  let lastObsState = {
    ok: false,
    connected: false,
    authFailed: false,
    unavailable: false,
    host: currentHost,
    port: currentPort,
    scenes: [],
  };

  let refreshTimer = null;
  let refreshInFlight = false;
  let refreshPending = false;
  let syncIntervalTimer = null;

  let selfHealInFlight = false;
  let selfHealDoneForZeroClients = false;
  let lastSelfHealAt = 0;
  let migrationRanForCurrentConnection = false;

  function notifyStateChanged(state) {
    lastObsState = state;
    if (typeof onStateChange === 'function') {
      try {
        onStateChange(state);
      } catch {}
    }
  }

  /**
   * Bounded self-heal for OBS Browser Source when OBS WebSocket is connected,
   * local HTTP server is ready, our canonical Browser Source exists, and overlayClients === 0.
   * Guarded by single-flight, per-zero-episode latch, and cooldown to prevent refresh loops.
   */
  async function maybeSelfHealOverlay(state = lastObsState) {
    if (typeof getOverlayClients !== 'function') {
      return { ok: true, refreshed: false, reason: 'no_overlay_clients_provider' };
    }

    const overlayClients = Number(getOverlayClients());
    if (Number.isFinite(overlayClients) && overlayClients > 0) {
      selfHealDoneForZeroClients = false;
      return { ok: true, refreshed: false, reason: 'overlay_clients_active' };
    }

    if (!isServerReady()) {
      return { ok: true, refreshed: false, reason: 'server_not_ready' };
    }

    const canonical = state?.canonicalOverlayInput || state?.ourInput || null;
    if (!state?.ok || !state?.connected || !canonical) {
      return { ok: true, refreshed: false, reason: 'no_obs_source' };
    }

    if (selfHealInFlight) {
      return { ok: true, refreshed: false, reason: 'in_flight' };
    }

    if (selfHealDoneForZeroClients) {
      return { ok: true, refreshed: false, reason: 'already_refreshed' };
    }

    const now = nowFn();
    if (lastSelfHealAt > 0 && (now - lastSelfHealAt) < selfHealCooldownMs) {
      return { ok: true, refreshed: false, reason: 'cooldown' };
    }

    selfHealInFlight = true;
    selfHealDoneForZeroClients = true;
    lastSelfHealAt = now;
    try {
      return await refreshOverlayInput(client, { port: overlayPort });
    } catch (error) {
      return { ok: false, refreshed: false, error: error?.message || String(error) };
    } finally {
      selfHealInFlight = false;
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

  client.on('InputCreated', () => {
    migrationRanForCurrentConnection = false;
    scheduleRefresh(60);
  });
  client.on('InputRemoved', () => scheduleRefresh(60));
  client.on('InputNameChanged', () => scheduleRefresh(60));
  client.on('InputSettingsChanged', () => scheduleRefresh(60));

  client.on('CurrentSceneCollectionChanging', () => {
    mutationQueue.setBlocked(true);
    clearTimeout(refreshTimer);
  });
  client.on('CurrentSceneCollectionChanged', () => {
    mutationQueue.setBlocked(false);
    migrationRanForCurrentConnection = false;
    scheduleRefresh(50);
  });

  client.on('ConnectionClosed', () => {
    selfHealDoneForZeroClients = false;
    migrationRanForCurrentConnection = false;
    const disconnectedState = {
      ok: false,
      connected: false,
      authFailed: false,
      unavailable: true,
      host: currentHost,
      port: currentPort,
      scenes: [],
    };
    notifyStateChanged(disconnectedState);
  });

  client.on('Connected', () => {
    selfHealDoneForZeroClients = false;
    migrationRanForCurrentConnection = false;
    scheduleRefresh(0);
    if (typeof getOverlayClients !== 'function') {
      refreshOverlayInput(client, { port: overlayPort }).catch(() => {});
    }
  });

  /**
   * Connects to OBS, runs automatic idempotent duplicate migration if needed,
   * and queries current scenes state.
   */
  async function fetchState(override = '') {
    let host = currentHost;
    let port = currentPort;
    let password = currentPassword;

    if (typeof override === 'object' && override !== null) {
      if (override.host) {
        host = String(override.host).trim();
        currentHost = host;
      }
      if (override.port) {
        port = Number(override.port);
        currentPort = port;
      }
      if (override.password !== undefined) {
        password = String(override.password);
        currentPassword = password;
      }
    } else if (typeof override === 'string' && override !== '') {
      password = override;
      currentPassword = password;
    }

    let state;
    try {
      const conn = await client.connect({ host, port, password });
      if (conn.restartRequired) {
        state = {
          ok: false,
          connected: false,
          restartRequired: true,
          authFailed: false,
          unavailable: false,
          host,
          port,
          scenes: [],
        };
      } else {
        state = await fetchScenesState(client, { port: overlayPort });
        state.authFailed = false;
        state.unavailable = false;
        state.host = host;
        state.port = port;

        // Automatic one-time/idempotent duplicate & legacy migration on OBS startup/discovery
        if (!mutationQueue.isBlocked() && !migrationRanForCurrentConnection && state.duplicateCount > 0) {
          migrationRanForCurrentConnection = true;
          // Emit pre-migration state so UI can briefly reflect duplicate detection before auto-fix
          notifyStateChanged(state);
          const migration = await migrateOverlayInputs(client, {
            port: overlayPort,
            appVersion,
          });
          state = await fetchScenesState(client, { port: overlayPort });
          state.authFailed = false;
          state.unavailable = false;
          state.host = host;
          state.port = port;
          state.lastMigration = migration;
        } else if (state.canonicalOverlayInput) {
          migrationRanForCurrentConnection = true;
        }

        await maybeSelfHealOverlay(state);
      }
    } catch (error) {
      const code = Number(error?.code);
      const msg = String(error?.message || '').toLowerCase();
      const isAuth = Boolean(
        error?.isAuthError ||
        code === 4005 ||
        code === 4009 ||
        code === 4002 ||
        code === 4006 ||
        msg.includes('authentication failed') ||
        msg.includes('authentication required') ||
        msg.includes('auth failed') ||
        msg.includes('not identified') ||
        msg.includes('identify')
      );
      const isConn = Boolean(
        error?.isConnectionError ||
        code === -1 ||
        msg.includes('econnrefused') ||
        msg.includes('enotfound') ||
        msg.includes('etimedout') ||
        msg.includes('connection refused') ||
        msg.includes('connect econnrefused')
      );

      state = {
        ok: false,
        connected: false,
        authFailed: isAuth,
        unavailable: isConn || (!isAuth && !error?.restartRequired),
        host,
        port,
        scenes: [],
        error: isAuth
          ? 'OBS найден, но не удалось авторизоваться'
          : (isConn ? 'Не удалось подключиться к OBS' : (error?.message || String(error))),
        rawError: error?.message || String(error),
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
     * Connects to OBS and fetches scene list (running auto-migration if duplicates exist).
     */
    async listScenes(password = '') {
      return fetchState(password);
    },

    /**
     * Configures config store instance for persistence.
     */
    setConfigStore(store) {
      configStore = store;
      if (configStore && typeof configStore.get === 'function') {
        const cfg = configStore.get();
        if (cfg.obsHost) currentHost = String(cfg.obsHost).trim();
        if (cfg.obsPort) currentPort = resolveInitialPort(cfg.obsPort);
        if (cfg.obsPassword !== undefined) currentPassword = String(cfg.obsPassword);
      }
    },

    /**
     * Returns current connection parameters.
     */
    getConnectionConfig() {
      return {
        host: currentHost,
        port: currentPort,
        password: currentPassword,
      };
    },

    /**
     * Updates OBS connection parameters, optionally persisting to config store,
     * and triggers an immediate reconnect if parameters changed or if currently disconnected.
     */
    updateConnectionConfig(newConfig = {}, persist = true) {
      const nextHost = newConfig.host !== undefined ? String(newConfig.host || '127.0.0.1').trim() : currentHost;
      const nextPort = newConfig.port !== undefined ? Number(newConfig.port || 4455) : currentPort;
      const nextPassword = newConfig.password !== undefined ? String(newConfig.password || '') : currentPassword;

      const changed = nextHost !== currentHost || nextPort !== currentPort || nextPassword !== currentPassword;

      currentHost = nextHost;
      currentPort = nextPort;
      currentPassword = nextPassword;

      if (persist && configStore && typeof configStore.update === 'function') {
        configStore.update({
          obsHost: currentHost,
          obsPort: currentPort,
          obsPassword: currentPassword,
        });
      }

      if (changed) {
        // Disconnect previous active connection so new parameters take effect immediately
        Promise.resolve(client.disconnect())
          .catch(() => {})
          .finally(() => {
            scheduleRefresh(0);
          });
      } else if (!client.isConnected() && !client.isConnecting()) {
        scheduleRefresh(0);
      }

      return {
        ok: true,
        host: currentHost,
        port: currentPort,
        password: currentPassword,
      };
    },

    /**
     * Explicitly runs idempotent migration to consolidate duplicate overlay inputs into one canonical source.
     */
    async migrateOverlay(password = '') {
      return mutationQueue.enqueue(async () => {
        try {
          const effectivePwd = String(password || currentPassword || '');
          currentPassword = effectivePwd;
          const conn = await client.connect({ host: currentHost, port: currentPort, password: effectivePwd });
          if (conn.restartRequired) return { ok: false, restartRequired: true };

          const res = await migrateOverlayInputs(client, {
            port: overlayPort,
            appVersion,
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
     * Adds overlay browser source to the given scene (reusing canonical source if present).
     */
    async addScene(password = '', sceneIdentifier = '') {
      return mutationQueue.enqueue(async () => {
        try {
          const effectivePwd = String(password || currentPassword || '');
          currentPassword = effectivePwd;
          const conn = await client.connect({ host: currentHost, port: currentPort, password: effectivePwd });
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
          const effectivePwd = String(password || currentPassword || '');
          currentPassword = effectivePwd;
          const conn = await client.connect({ host: currentHost, port: currentPort, password: effectivePwd });
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
     * Fits the canonical overlay browser source to the OBS base canvas (width/height + 1:1 transform).
     */
    async fitOverlayToCanvas(password = '') {
      return mutationQueue.enqueue(async () => {
        try {
          const effectivePwd = String(password || currentPassword || '');
          currentPassword = effectivePwd;
          const conn = await client.connect({ host: currentHost, port: currentPort, password: effectivePwd });
          if (conn.restartRequired) return { ok: false, restartRequired: true };

          const res = await normalizeOverlayTransform(client, {
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
     * Refreshes canonical OBS Browser Source to recover from connection errors.
     */
    async refreshOverlay() {
      return refreshOverlayInput(client, { port: overlayPort });
    },

    /**
     * Checks and executes bounded self-heal on canonical source if server is ready and overlayClients === 0.
     */
    async maybeSelfHealOverlay(state = lastObsState) {
      return maybeSelfHealOverlay(state);
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
