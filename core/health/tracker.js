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

/**
 * Creates health and connector telemetry tracker.
 *
 * @param {object} [options]
 * @param {string} [options.appVersion]
 * @param {string} [options.bundledExtensionVersion]
 */
function createHealthTracker(options = {}) {
  const appVersion = options.appVersion || '0.0.0';
  const bundledExtensionVersion = options.bundledExtensionVersion || appVersion;

  let extensionVersion = null;
  let receivedMessages = 0;
  let lastMessageAt = null;
  let connectorLastSeenAt = null;
  let extensionLastSeenAt = null;
  let boostyLastSeenAt = null;
  let boostyTabUrl = null;

  return {
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
      }
    },

    /**
     * Updates tracker from POST /connector heartbeat.
     *
     * @param {object} [data]
     * @param {number} [now]
     */
    updateConnector(data = {}, now = Date.now()) {
      connectorLastSeenAt = now;
      extensionLastSeenAt = now;

      if (data && typeof data === 'object') {
        const incomingVer = data.extensionVersion || data.version;
        if (incomingVer && typeof incomingVer === 'string') {
          extensionVersion = incomingVer;
        }

        if (data.source === 'content_tab') {
          boostyLastSeenAt = now;
          if (typeof data.url === 'string') {
            boostyTabUrl = data.url;
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
      const overlayClients = stats.overlayClients ?? 0;
      const historyCount = stats.historyCount ?? 0;

      const isExtensionConnected = extensionLastSeenAt !== null && (now - extensionLastSeenAt < 60_000);
      const isBoostyConnected = boostyLastSeenAt !== null && (now - boostyLastSeenAt < 12_000);
      const isConnectorConnected = (connectorLastSeenAt !== null && (now - connectorLastSeenAt < 12_000)) || isBoostyConnected;
      const isOutdated = Boolean(
        isExtensionConnected &&
        extensionVersion &&
        compareSemver(extensionVersion, bundledExtensionVersion) < 0
      );

      return {
        ok: true,
        appVersion,
        bundledExtensionVersion,
        extensionVersion,
        isOutdated,
        overlayClients,
        receivedMessages,
        lastMessageAt,
        historyCount,
        connectorConnected: isConnectorConnected,
        extensionConnected: isExtensionConnected,
        boostyConnected: isBoostyConnected,
        connectorLastSeenAt,
        extensionLastSeenAt,
        boostyLastSeenAt,
        boostyTabUrl,
      };
    },
  };
}

module.exports = {
  compareSemver,
  createHealthTracker,
};
