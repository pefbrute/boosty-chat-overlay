/**
 * Semver comparison utility.
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if equal or indeterminate
 *
 * @param {string} v1
 * @param {string} v2
 * @returns {number}
 */
const { EXPECTED_EXTENSION_ID } = require('../constants');

function compareSemver(v1, v2) {
  if (!v1 || !v2) return 0;
  const p1 = String(v1).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const p2 = String(v2).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

const HEALTH_TIMINGS = {
  CONNECTED_THRESHOLD_MS: 5_000,
  RECONNECTING_THRESHOLD_MS: 15_000,
  DEFAULT_STARTUP_GRACE_MS: 6_000,
  TAB_TTL_MS: 15_000,
};

/**
 * Creates health and connector telemetry tracker.
 *
 * @param {object} [options]
 * @param {string} [options.appVersion]
 * @param {string} [options.bundledExtensionVersion]
 * @param {string} [options.persistentExtensionVersion]
 * @param {string} [options.expectedExtensionId]
 * @param {boolean} [options.allowAnyExtensionId=false]
 * @param {number} [options.startupGraceMs]
 * @param {number} [options.serverStartedAt]
 * @param {boolean} [options.silent=false]
 */
function createHealthTracker(options = {}) {
  const appVersion = options.appVersion || '0.0.0';
  const bundledExtensionVersion = options.bundledExtensionVersion || appVersion;
  const persistentExtensionVersion = options.persistentExtensionVersion || bundledExtensionVersion;
  const expectedExtensionId = options.expectedExtensionId || EXPECTED_EXTENSION_ID;
  const allowAnyExtensionId = Boolean(options.allowAnyExtensionId || process.env.BOOSTY_ALLOW_ANY_EXT_ID === '1');
  const startupGraceMs = options.startupGraceMs ?? HEALTH_TIMINGS.DEFAULT_STARTUP_GRACE_MS;
  let serverStartedAt = options.serverStartedAt ?? null;
  const silent = Boolean(options.silent);

  let extensionVersion = null;
  let extensionId = null;
  let receivedMessages = 0;
  let lastMessageAt = null;
  let connectorLastSeenAt = null;
  let extensionLastSeenAt = null;
  let boostyLastSeenAt = null;
  let boostyTabUrl = null;

  // Active WebSocket connections map: connectionId -> { connectionId, generation, connectedAt, meta, extensionId, isCanonical, isLegacy }
  const activeConnections = new Map();
  let connectionGeneration = 0;
  let activeWsClient = null; // Primary { connectionId, generation, connectedAt, meta, extensionId, isCanonical }
  let activeTransport = 'none'; // 'websocket' | 'http' | 'none'

  // Diagnostic trace ring buffer
  const MAX_TRACE_EVENTS = 200;
  const diagnosticTrace = [];

  function recordTrace(event, details = {}, connectionId = null) {
    const now = Date.now();
    const t_ms = serverStartedAt ? (now - serverStartedAt) : 0;
    const entry = {
      t: t_ms,
      ts: new Date(now).toISOString(),
      event,
      connectionId: connectionId || activeWsClient?.connectionId || null,
      generation: activeWsClient?.generation || connectionGeneration,
      ...details,
    };
    diagnosticTrace.push(entry);
    if (diagnosticTrace.length > MAX_TRACE_EVENTS) {
      diagnosticTrace.shift();
    }
    return entry;
  }

  if (serverStartedAt !== null) {
    recordTrace('server_init', { appVersion, bundledExtensionVersion });
  }

  // Active tabs registry: key -> { tabId, url, hasChat, isStream, title, lastSeenAt }
  const activeTabs = new Map();

  // For transition logging
  let lastExtensionState = 'checking';
  let lastBoostyState = 'checking';

  function logTransition(component, oldState, newState, reason) {
    if (silent) return;
    if (oldState !== newState) {
      const reasonStr = reason ? ` (${reason})` : '';
      console.info(`[Health Transition] ${component}: ${oldState} -> ${newState}${reasonStr}`);
    }
  }

  return {
    recordTrace,
    getDiagnosticTrace() {
      return [...diagnosticTrace];
    },

    /**
     * Registers a new active WebSocket connection from extension background.
     *
     * @param {string} connectionId
     * @param {object} [meta]
     * @param {number} [now]
     */
    registerWsConnection(connectionId, meta = {}, now = Date.now()) {
      if (serverStartedAt === null) serverStartedAt = now;
      connectionGeneration++;

      const connExtId = (meta.extensionId && typeof meta.extensionId === 'string') ? meta.extensionId : null;
      const isCanonical = Boolean(allowAnyExtensionId || (connExtId && connExtId === expectedExtensionId));
      const isLegacy = !isCanonical;

      const connEntry = {
        connectionId,
        generation: connectionGeneration,
        connectedAt: now,
        meta,
        extensionId: connExtId,
        isCanonical,
        isLegacy,
      };
      activeConnections.set(connectionId, connEntry);

      // Select primary active client: prefer canonical connection, otherwise newest
      const canonicalConn = Array.from(activeConnections.values()).find(c => c.isCanonical);
      activeWsClient = canonicalConn || connEntry;

      activeTransport = 'websocket';
      extensionLastSeenAt = now;
      connectorLastSeenAt = now;

      extensionId = activeWsClient.extensionId;
      const incomingVer = activeWsClient.meta.extensionVersion || activeWsClient.meta.version;
      if (incomingVer && typeof incomingVer === 'string') {
        extensionVersion = incomingVer;
      }

      if (Array.isArray(meta.tabs)) {
        for (const tab of meta.tabs) {
          if (tab && typeof tab === 'object') {
            const tabKey = tab.tabId ?? tab.url ?? 'tab';
            activeTabs.set(tabKey, {
              tabId: tab.tabId,
              url: tab.url || '',
              hasChat: Boolean(tab.hasChat),
              isStream: Boolean(tab.isStream),
              title: tab.title || '',
              lastSeenAt: now,
            });
            if (tab.url) boostyTabUrl = tab.url;
            boostyLastSeenAt = now;
          }
        }
      }

      recordTrace('extension_ws_connected', {
        version: extensionVersion,
        extensionId: connExtId,
        isCanonical,
        totalActiveConnections: activeConnections.size,
        tabsCount: activeTabs.size,
      }, connectionId);

      logTransition('extension', lastExtensionState, 'connected', `WebSocket active (${connectionId}, canonical=${isCanonical})`);
      lastExtensionState = 'connected';
    },

    /**
     * Unregisters a WebSocket connection on close/error with generation guard.
     *
     * @param {string} connectionId
     * @param {string} [reason='closed']
     * @param {number} [now]
     * @returns {boolean}
     */
    unregisterWsConnection(connectionId, reason = 'closed', now = Date.now()) {
      if (!activeConnections.has(connectionId) && (!activeWsClient || activeWsClient.connectionId !== connectionId)) {
        // Stale event from old connection generation — ignore
        return false;
      }

      recordTrace('extension_ws_disconnected', { reason }, connectionId);
      activeConnections.delete(connectionId);

      if (activeWsClient && activeWsClient.connectionId === connectionId) {
        // Switch primary to remaining canonical client, or another active client
        const canonicalConn = Array.from(activeConnections.values()).find(c => c.isCanonical);
        const remaining = Array.from(activeConnections.values());
        activeWsClient = canonicalConn || (remaining.length > 0 ? remaining[remaining.length - 1] : null);

        if (activeWsClient) {
          extensionId = activeWsClient.extensionId;
          const v = activeWsClient.meta.extensionVersion || activeWsClient.meta.version;
          if (v) extensionVersion = v;
        } else {
          extensionId = null;
          extensionVersion = null;
          extensionLastSeenAt = now;
          if (activeTransport === 'websocket') {
            activeTransport = 'none';
          }
          logTransition('extension', lastExtensionState, 'reconnecting', `WebSocket disconnected: ${reason}`);
          lastExtensionState = 'reconnecting';
        }
      }
      return true;
    },

    /**
     * Decides whether a message from this WebSocket connection should be accepted.
     * Prevents duplicate messages when both canonical and legacy connectors are connected.
     *
     * @param {string} connectionId
     * @returns {boolean}
     */
    shouldAcceptWsMessage(connectionId) {
      const conn = activeConnections.get(connectionId);
      const hasCanonical = Array.from(activeConnections.values()).some(c => c.isCanonical);
      if (!conn) {
        // If not in activeConnections, only drop if an active canonical connection is present
        return !hasCanonical;
      }
      if (conn.isCanonical) return true;
      // If legacy connection, but there is an active canonical connection, reject to prevent duplicate messages
      if (hasCanonical) return false;
      return true;
    },

    isCanonicalConnection(connectionId) {
      return Boolean(activeConnections.get(connectionId)?.isCanonical);
    },

    hasActiveCanonicalWsConnection() {
      return Array.from(activeConnections.values()).some(c => c.isCanonical);
    },

    hasMultipleConnectors() {
      return activeConnections.size > 1;
    },

    /**
     * Updates or registers an individual tab state from event-driven message.
     *
     * @param {object} tabData
     * @param {string} [connectionId]
     * @param {number} [now]
     */
    updateTabState(tabData, connectionId = null, now = Date.now()) {
      if (!tabData || typeof tabData !== 'object') return;
      const tabKey = tabData.tabId ?? tabData.tabSessionId ?? tabData.url ?? 'tab';
      activeTabs.set(tabKey, {
        tabId: tabData.tabId,
        url: tabData.url || '',
        hasChat: Boolean(tabData.hasChat),
        isStream: Boolean(tabData.isStream),
        title: tabData.title || '',
        lastSeenAt: now,
      });
      if (tabData.url) boostyTabUrl = tabData.url;
      boostyLastSeenAt = now;
      recordTrace('boosty_tab_updated', {
        tabId: tabData.tabId,
        hasChat: Boolean(tabData.hasChat),
        url: tabData.url,
      }, connectionId);
    },

    /**
     * Removes a tab from active registry on tab closed or port disconnect.
     *
     * @param {string|number} tabId
     * @param {string} [connectionId]
     */
    removeTab(tabId, connectionId = null) {
      if (tabId === undefined || tabId === null) return;
      if (activeTabs.has(tabId)) {
        activeTabs.delete(tabId);
        recordTrace('boosty_tab_removed', { tabId }, connectionId);
      }
    },

    /**
     * Records an incoming message received via POST /message or test message.
     *
     * @param {object} [params]
     * @param {string} [params.extensionVersion]
     * @param {number} [params.now]
     * @param {boolean} [params.isTest]
     */
    recordMessage(params = {}) {
      const now = params.now ?? Date.now();
      if (serverStartedAt === null) serverStartedAt = now;
      receivedMessages += 1;
      lastMessageAt = now;

      if (!params.isTest) {
        connectorLastSeenAt = now;
        extensionLastSeenAt = now;
        boostyLastSeenAt = now;

        const incomingVer = params.extensionVersion;
        if (incomingVer && typeof incomingVer === 'string') {
          extensionVersion = incomingVer;
        }

        // A message implies active chat in Boosty
        const tabKey = 'active_message_tab';
        activeTabs.set(tabKey, {
          url: boostyTabUrl || 'https://boosty.to/',
          hasChat: true,
          isStream: true,
          lastSeenAt: now,
        });

        recordTrace('message_received', {
          author: params.author,
          extensionVersion,
        });
      }
    },

    /**
     * Updates tracker from POST /connector heartbeat (HTTP fallback).
     *
     * @param {object} [data]
     * @param {number} [now]
     */
    updateConnector(data = {}, now = Date.now()) {
      if (serverStartedAt === null) serverStartedAt = now;
      connectorLastSeenAt = now;
      extensionLastSeenAt = now;
      if (activeTransport === 'none') {
        activeTransport = 'http';
      }

      if (data && typeof data === 'object') {
        const incomingVer = data.extensionVersion || data.version;
        if (incomingVer && typeof incomingVer === 'string') {
          extensionVersion = incomingVer;
        }
        if (data.extensionId && typeof data.extensionId === 'string') {
          extensionId = data.extensionId;
        }

        recordTrace('extension_http_heartbeat', {
          source: data.source || 'unknown',
          version: incomingVer,
          extensionId: data.extensionId || null,
          url: data.url || null,
        });

        // Direct content_tab heartbeat
        if (data.source === 'content_tab') {
          boostyLastSeenAt = now;
          if (typeof data.url === 'string') {
            boostyTabUrl = data.url;
          }
          const tabKey = data.tabSessionId || data.url || 'content_tab';
          activeTabs.set(tabKey, {
            tabId: data.tabId,
            url: data.url || '',
            hasChat: Boolean(data.hasChat),
            isStream: Boolean(data.isStream),
            title: data.title || '',
            lastSeenAt: now,
          });
        }

        // Aggregated tabs list from background service worker
        if (Array.isArray(data.tabs)) {
          for (const tab of data.tabs) {
            if (tab && typeof tab === 'object') {
              const tabKey = tab.tabId ?? tab.url ?? 'tab';
              const tabTime = tab.lastSeenAt || now;
              if (tabTime > (boostyLastSeenAt || 0)) {
                boostyLastSeenAt = tabTime;
              }
              if (tab.url && typeof tab.url === 'string') {
                boostyTabUrl = tab.url;
              }
              activeTabs.set(tabKey, {
                tabId: tab.tabId,
                url: tab.url || '',
                hasChat: Boolean(tab.hasChat),
                isStream: Boolean(tab.isStream),
                title: tab.title || '',
                lastSeenAt: tabTime,
              });
            }
          }
        }
      }
    },

    /**
     * Returns full health state report for /health endpoint.
     *
     * @param {object} [stats]
     * @param {number} [stats.overlayClients=0]
     * @param {number} [stats.historyCount=0]
     * @param {number} [stats.now]
     * @returns {object}
     */
    getHealthState(stats = {}) {
      const now = stats.now ?? Date.now();
      if (serverStartedAt === null) serverStartedAt = now;
      const overlayClients = stats.overlayClients ?? 0;
      const historyCount = stats.historyCount ?? 0;

      const startupElapsed = Math.max(0, now - serverStartedAt);
      const isStartupGrace = startupElapsed < startupGraceMs;

      // 1. Derive Extension State: checking -> connected -> reconnecting -> unavailable
      let extState = 'checking';
      let extReason = '';

      if (activeWsClient) {
        extState = 'connected';
        extReason = `WebSocket active (${activeWsClient.connectionId})`;
      } else if (extensionLastSeenAt !== null) {
        const extAge = now - extensionLastSeenAt;
        if (activeTransport === 'http' && extAge < HEALTH_TIMINGS.CONNECTED_THRESHOLD_MS) {
          extState = 'connected';
          extReason = `HTTP signal received ${extAge}ms ago`;
        } else if (extAge < HEALTH_TIMINGS.RECONNECTING_THRESHOLD_MS) {
          extState = 'reconnecting';
          extReason = `transport reconnecting (${Math.floor(extAge / 1000)}s)`;
        } else {
          extState = isStartupGrace ? 'checking' : 'unavailable';
          extReason = `timeout (${Math.floor(extAge / 1000)}s)`;
        }
      } else {
        extState = isStartupGrace ? 'checking' : 'unavailable';
        extReason = isStartupGrace ? 'within startup grace' : 'never seen';
      }

      logTransition('extension', lastExtensionState, extState, extReason);
      lastExtensionState = extState;

      // 2. Prune expired tabs from activeTabs only if using HTTP fallback polling
      if (!activeWsClient) {
        for (const [key, tab] of activeTabs.entries()) {
          // In reconnecting phase, retain tabs for safety unless reconnecting threshold is exceeded
          if (now - tab.lastSeenAt > HEALTH_TIMINGS.RECONNECTING_THRESHOLD_MS) {
            activeTabs.delete(key);
          }
        }
      }

      // 3. Derive Boosty State: checking -> tab-detected / chat-detected -> unavailable
      const liveTabs = Array.from(activeTabs.values());
      let boostyState = 'checking';
      let boostyReason = '';
      let bestTab = null;

      if (liveTabs.length > 0) {
        const chatTab = liveTabs.find(t => t.hasChat);
        bestTab = chatTab || liveTabs.sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
        if (chatTab) {
          boostyState = 'chat-detected';
          boostyReason = 'chat container active in DOM';
        } else {
          boostyState = 'tab-detected';
          boostyReason = 'Boosty page open, waiting for chat container';
        }
      } else if (boostyLastSeenAt !== null && (extState === 'reconnecting' || now - boostyLastSeenAt < HEALTH_TIMINGS.RECONNECTING_THRESHOLD_MS)) {
        // Tab retained during temporary transport reconnecting (Requirement 14)
        boostyState = 'tab-detected';
        boostyReason = 'tab retained during transport reconnecting';
      } else {
        if (extState === 'checking' || isStartupGrace) {
          boostyState = 'checking';
          boostyReason = 'startup grace period';
        } else {
          boostyState = 'unavailable';
          boostyReason = 'no active Boosty tab detected';
        }
      }

      logTransition('boosty', lastBoostyState, boostyState, boostyReason);
      lastBoostyState = boostyState;

      const isExtensionConnected = (extState === 'connected');
      const isBoostyConnected = (boostyState === 'chat-detected' || boostyState === 'tab-detected');
      const isConnectorConnected = isExtensionConnected || (extState === 'reconnecting');

      const isOutdated = Boolean(
        isExtensionConnected &&
        extensionVersion &&
        compareSemver(extensionVersion, bundledExtensionVersion) < 0
      );

      const effectiveTabUrl = bestTab?.url || boostyTabUrl || null;
      const extSecAgo = activeWsClient
        ? 0
        : (extensionLastSeenAt !== null ? Math.max(0, Math.floor((now - extensionLastSeenAt) / 1000)) : null);
      const boostySecAgo = boostyLastSeenAt !== null ? Math.max(0, Math.floor((now - boostyLastSeenAt) / 1000)) : null;

      const liveConns = Array.from(activeConnections.values());
      const hasCanonicalConn = liveConns.some(c => c.isCanonical) || (extensionId === expectedExtensionId);
      const hasLegacyConn = liveConns.some(c => c.isLegacy) || Boolean(extensionId && extensionId !== expectedExtensionId);
      const duplicateConnectors = (liveConns.length > 1 && hasCanonicalConn && liveConns.some(c => c.isLegacy));
      const isLegacyExtension = Boolean(isExtensionConnected && !hasCanonicalConn && hasLegacyConn);
      const extensionMigrationRequired = isLegacyExtension;

      // Check if open tab might be a stale content script (e.g. extension was reloaded without tab refresh)
      let staleTabScript = false;
      if (isExtensionConnected && liveTabs.length > 0) {
        const latestTabSeen = Math.max(...liveTabs.map(t => t.lastSeenAt || 0));
        if (latestTabSeen > 0 && (now - latestTabSeen > 35_000)) {
          staleTabScript = true;
        }
      }

      return {
        ok: true,
        appVersion,
        bundledExtensionVersion,
        persistentExtensionVersion,
        extensionVersion,
        extensionId,
        expectedExtensionId,
        detectedExtensionId: extensionId,
        detectedExtensionVersion: extensionVersion,
        extensionMigrationRequired,
        isLegacyExtension,
        duplicateConnectors,
        isOutdated,
        overlayClients,
        receivedMessages,
        lastMessageAt,
        historyCount,
        serverStartedAt,
        startupElapsed,
        transport: activeWsClient ? 'websocket' : (connectorLastSeenAt ? 'http' : 'none'),
        connectionId: activeWsClient?.connectionId || null,
        connectionGeneration: activeWsClient?.generation || connectionGeneration,
        extension: {
          state: extState,
          version: extensionVersion,
          extensionId,
          lastSeenAt: extensionLastSeenAt,
          lastSeenSecondsAgo: extSecAgo,
          isCanonical: Boolean(activeWsClient?.isCanonical || (extensionId === expectedExtensionId)),
          isLegacy: isLegacyExtension,
          migrationRequired: Boolean(extensionMigrationRequired || isLegacyExtension),
        },
        boosty: {
          state: boostyState,
          tabUrl: effectiveTabUrl,
          hasChat: Boolean(bestTab?.hasChat),
          isStream: Boolean(bestTab?.isStream),
          lastSeenAt: boostyLastSeenAt,
          lastSeenSecondsAgo: boostySecAgo,
          activeTabsCount: liveTabs.length,
          staleTabScript,
        },
        // Backward compatibility properties
        connectorConnected: isConnectorConnected,
        extensionConnected: isExtensionConnected,
        boostyConnected: isBoostyConnected,
        connectorLastSeenAt,
        extensionLastSeenAt,
        boostyLastSeenAt,
        boostyTabUrl: effectiveTabUrl,
      };
    },
  };
}

module.exports = {
  compareSemver,
  createHealthTracker,
  HEALTH_TIMINGS,
};
