const { EventEmitter } = require('node:events');
const { ensureObsWebSocketEnabled } = require('./config.js');

/**
 * Classifies an OBS error into auth failure vs connection failure.
 *
 * @param {any} err
 * @returns {{ isAuthError: boolean, isConnectionError: boolean, code: number, message: string }}
 */
function classifyObsError(err) {
  if (!err) {
    return { isAuthError: false, isConnectionError: false, code: 0, message: '' };
  }
  const code = Number(err.code);
  const rawMsg = String(err.message || '');
  const msg = rawMsg.toLowerCase();

  const isAuthError = Boolean(
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

  const isConnectionError = Boolean(
    code === -1 ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('connection refused') ||
    msg.includes('connect econnrefused')
  );

  return {
    isAuthError,
    isConnectionError,
    code,
    message: rawMsg,
  };
}

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
  let activeHost = '127.0.0.1';
  let activePort = 4455;
  let activePassword = '';
  let connectingPromise = null;
  let connectingTarget = null;
  let connected = false;
  let connectionGeneration = 0;

  function bindEvents(obs, gen) {
    const isCurrent = () => gen === connectionGeneration && activeObs === obs;

    // Scene events
    obs.on('SceneCreated', data => { if (isCurrent()) emitter.emit('SceneCreated', data); });
    obs.on('SceneRemoved', data => { if (isCurrent()) emitter.emit('SceneRemoved', data); });
    obs.on('SceneNameChanged', data => { if (isCurrent()) emitter.emit('SceneNameChanged', data); });
    obs.on('SceneListChanged', data => { if (isCurrent()) emitter.emit('SceneListChanged', data); });

    // Scene Item events
    obs.on('SceneItemCreated', data => { if (isCurrent()) emitter.emit('SceneItemCreated', data); });
    obs.on('SceneItemRemoved', data => { if (isCurrent()) emitter.emit('SceneItemRemoved', data); });
    obs.on('SceneItemEnableStateChanged', data => { if (isCurrent()) emitter.emit('SceneItemEnableStateChanged', data); });

    // Input events
    obs.on('InputCreated', data => { if (isCurrent()) emitter.emit('InputCreated', data); });
    obs.on('InputRemoved', data => { if (isCurrent()) emitter.emit('InputRemoved', data); });
    obs.on('InputNameChanged', data => { if (isCurrent()) emitter.emit('InputNameChanged', data); });
    obs.on('InputSettingsChanged', data => { if (isCurrent()) emitter.emit('InputSettingsChanged', data); });

    // Scene Collection events
    obs.on('CurrentSceneCollectionChanging', data => { if (isCurrent()) emitter.emit('CurrentSceneCollectionChanging', data); });
    obs.on('CurrentSceneCollectionChanged', data => { if (isCurrent()) emitter.emit('CurrentSceneCollectionChanged', data); });

    // Connection events: only emit if this instance actually became the active connected session
    obs.on('ConnectionClosed', () => {
      if (isCurrent()) {
        activeObs = null;
        connected = false;
        emitter.emit('ConnectionClosed');
      }
    });
  }

  return {
    /**
     * Connects to OBS Studio WebSocket.
     *
     * @param {string | object} [optionsOrPassword]
     * @returns {Promise<{ obs: object | null, restartRequired: boolean, host: string, port: number, password: string }>}
     */
    async connect(optionsOrPassword = '') {
      let reqHost;
      let reqPort;
      let reqPassword;

      if (typeof optionsOrPassword === 'object' && optionsOrPassword !== null) {
        reqHost = optionsOrPassword.host;
        reqPort = optionsOrPassword.port;
        reqPassword = optionsOrPassword.password;
      } else {
        reqPassword = optionsOrPassword;
      }

      const configState = configResolver();
      if (configState.restartRequired) {
        return {
          obs: null,
          restartRequired: true,
          host: reqHost || '127.0.0.1',
          port: reqPort || configState.port || 4455,
          password: reqPassword !== undefined ? String(reqPassword) : (configState.password || ''),
        };
      }

      const host = String(reqHost || '127.0.0.1').trim();
      const port = Number(reqPort || configState.port || 4455);
      const effectivePassword = String(reqPassword || configState.password || '');

      if (activeObs && connected && activeHost === host && activePort === port && activePassword === effectivePassword) {
        return {
          obs: activeObs,
          restartRequired: false,
          host,
          port,
          password: effectivePassword,
        };
      }

      if (
        connectingPromise &&
        connectingTarget &&
        connectingTarget.host === host &&
        connectingTarget.port === port &&
        connectingTarget.password === effectivePassword
      ) {
        return connectingPromise;
      }

      if (connectingPromise) {
        try {
          await connectingPromise;
        } catch {}
      }

      const myGeneration = ++connectionGeneration;
      connectingTarget = { host, port, password: effectivePassword };

      const currentAttempt = (async () => {
        try {
          if (activeObs) {
            const staleObs = activeObs;
            activeObs = null;
            connected = false;
            await staleObs.disconnect().catch(() => {});
          }

          if (!OBSWebSocket) {
            throw new Error('Модуль obs-websocket-js не доступен');
          }

          const obs = new OBSWebSocket();
          bindEvents(obs, myGeneration);

          await obs.connect(`ws://${host}:${port}`, effectivePassword);

          if (myGeneration !== connectionGeneration) {
            await obs.disconnect().catch(() => {});
            throw new Error('Попытка подключения устарела');
          }

          activeObs = obs;
          activeHost = host;
          activePort = port;
          activePassword = effectivePassword;
          connected = true;

          emitter.emit('Connected');

          return {
            obs: activeObs,
            restartRequired: false,
            host,
            port,
            password: effectivePassword,
          };
        } catch (err) {
          if (myGeneration === connectionGeneration) {
            activeObs = null;
            connected = false;
          }
          const classified = classifyObsError(err);
          err.isAuthError = classified.isAuthError;
          err.isConnectionError = classified.isConnectionError;
          throw err;
        } finally {
          if (connectingPromise === currentAttempt) {
            connectingPromise = null;
            connectingTarget = null;
          }
        }
      })();

      connectingPromise = currentAttempt;
      return currentAttempt;
    },

    /**
     * Disconnects current active connection if any.
     */
    async disconnect() {
      connectionGeneration++;
      connectingPromise = null;
      connectingTarget = null;
      if (activeObs) {
        const obsToClose = activeObs;
        activeObs = null;
        connected = false;
        try {
          await obsToClose.disconnect();
        } catch {}
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
  classifyObsError,
};
