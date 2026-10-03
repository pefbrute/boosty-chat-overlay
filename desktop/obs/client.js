const { EventEmitter } = require('node:events');
const { ensureObsWebSocketEnabled } = require('./config.js');

/**
 * Creates an OBS WebSocket client wrapper managing connection lifecycle,
 * auto-enable configuration, and event dispatching.
 *
 * @param {object} [options]
 * @param {Function} [options.OBSWebSocketClass] Constructor for OBSWebSocket (defaults to require('obs-websocket-js').OBSWebSocket)
 * @param {Function} [options.configResolver] Custom config resolver function
 */
function createObsClient(options = {}) {
  const OBSWebSocket = options.OBSWebSocketClass || (() => {
    try {
      return require('obs-websocket-js').OBSWebSocket;
    } catch {
      return null;
    }
  })();

  const configResolver = options.configResolver || ensureObsWebSocketEnabled;
  const emitter = new EventEmitter();

  let activeObs = null;
  let activePassword = '';
  let connectingPromise = null;
  let connected = false;

  function bindEvents(obs) {
    // Scene events
    obs.on('SceneCreated', data => emitter.emit('SceneCreated', data));
    obs.on('SceneRemoved', data => emitter.emit('SceneRemoved', data));
    obs.on('SceneNameChanged', data => emitter.emit('SceneNameChanged', data));
    obs.on('SceneListChanged', data => emitter.emit('SceneListChanged', data));

    // Scene Item events
    obs.on('SceneItemCreated', data => emitter.emit('SceneItemCreated', data));
    obs.on('SceneItemRemoved', data => emitter.emit('SceneItemRemoved', data));
    obs.on('SceneItemEnableStateChanged', data => emitter.emit('SceneItemEnableStateChanged', data));

    // Input events
    obs.on('InputCreated', data => emitter.emit('InputCreated', data));
    obs.on('InputRemoved', data => emitter.emit('InputRemoved', data));
    obs.on('InputNameChanged', data => emitter.emit('InputNameChanged', data));
    obs.on('InputSettingsChanged', data => emitter.emit('InputSettingsChanged', data));

    // Scene Collection events
    obs.on('CurrentSceneCollectionChanging', data => emitter.emit('CurrentSceneCollectionChanging', data));
    obs.on('CurrentSceneCollectionChanged', data => emitter.emit('CurrentSceneCollectionChanged', data));

    // Connection events
    obs.on('ConnectionClosed', () => {
      if (activeObs === obs) {
        activeObs = null;
        connected = false;
      }
      emitter.emit('ConnectionClosed');
    });
  }

  return {
    /**
     * Connects to OBS Studio WebSocket.
     *
     * @param {string} [password]
     * @returns {Promise<{ obs: object | null, restartRequired: boolean, port: number, password: string }>}
     */
    async connect(password = '') {
      const configState = configResolver();
      if (configState.restartRequired) {
        return {
          obs: null,
          restartRequired: true,
          port: configState.port,
          password: configState.password,
        };
      }

      const port = Number(configState.port || 4455);
      const effectivePassword = String(password || configState.password || '');

      if (activeObs && connected && activePassword === effectivePassword) {
        return {
          obs: activeObs,
          restartRequired: false,
          port,
          password: effectivePassword,
        };
      }

      if (connectingPromise) {
        return connectingPromise;
      }

      connectingPromise = (async () => {
        try {
          if (activeObs) {
            await activeObs.disconnect().catch(() => {});
            activeObs = null;
            connected = false;
          }

          if (!OBSWebSocket) {
            throw new Error('Модуль obs-websocket-js не доступен');
          }

          const obs = new OBSWebSocket();
          bindEvents(obs);

          await obs.connect(`ws://127.0.0.1:${port}`, effectivePassword);
          activeObs = obs;
          activePassword = effectivePassword;
          connected = true;

          emitter.emit('Connected');

          return {
            obs: activeObs,
            restartRequired: false,
            port,
            password: effectivePassword,
          };
        } catch (err) {
          activeObs = null;
          connected = false;
          throw err;
        } finally {
          connectingPromise = null;
        }
      })();

      return connectingPromise;
    },

    /**
     * Disconnects current active connection if any.
     */
    async disconnect() {
      if (activeObs) {
        try {
          await activeObs.disconnect();
        } catch {}
        activeObs = null;
        connected = false;
        emitter.emit('ConnectionClosed');
      }
    },

    /**
     * Executes an OBS WebSocket call.
     *
     * @param {string} requestType
     * @param {object} [requestData]
     * @returns {Promise<any>}
     */
    async call(requestType, requestData) {
      if (!activeObs || !connected) {
        throw new Error('OBS WebSocket не подключен');
      }
      return activeObs.call(requestType, requestData);
    },

    /**
     * Checks if client is currently connected.
     * @returns {boolean}
     */
    isConnected() {
      return connected && Boolean(activeObs);
    },

    /**
     * Checks if connection is currently in flight.
     * @returns {boolean}
     */
    isConnecting() {
      return Boolean(connectingPromise);
    },

    /**
     * Event subscription.
     */
    on(event, handler) {
      emitter.on(event, handler);
      return this;
    },

    /**
     * Event unsubscription.
     */
    off(event, handler) {
      emitter.off(event, handler);
      return this;
    },

    /**
     * Returns raw active OBS WebSocket instance.
     */
    getRawClient() {
      return activeObs;
    },
  };
}

module.exports = {
  createObsClient,
};
