const https = require('node:https');
const { compareSemver } = require('../browser/extension-deployer.js');

const DEFAULT_REPO = 'pefbrute/boosty-chat-overlay';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const REQUEST_TIMEOUT_MS = 3500; // 3.5 seconds

/**
 * Creates lightweight GitHub Releases update checker.
 *
 * @param {object} [options]
 * @param {string} [options.currentVersion]
 * @param {string} [options.repo]
 * @param {Function} [options.fetchFn]
 * @param {number} [options.checkIntervalMs]
 * @param {number} [options.timeoutMs]
 */
function createUpdateChecker(options = {}) {
  const currentVersion = options.currentVersion || '0.5.1';
  const repo = options.repo || DEFAULT_REPO;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const intervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS;

  let state = 'idle'; // 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error'
  let latestVersion = null;
  let releaseUrl = `https://github.com/${repo}/releases`;
  let releaseNotes = '';
  let lastCheckedAt = 0;
  let lastError = null;

  function getStatus() {
    return {
      state,
      currentVersion,
      latestVersion,
      updateAvailable: state === 'update-available',
      releaseUrl,
      releaseNotes,
      lastCheckedAt,
      error: lastError,
    };
  }

  function fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      if (typeof options.fetchFn === 'function') {
        return options.fetchFn().then(resolve, reject);
      }

      const url = `https://api.github.com/repos/${repo}/releases/latest`;
      const req = https.get(url, {
        headers: {
          'User-Agent': `BoostyChatOverlay/${currentVersion}`,
          Accept: 'application/vnd.github.v3+json',
        },
        timeout: timeoutMs,
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(new Error('Invalid JSON in release response'));
            }
          } else if (res.statusCode === 404) {
            resolve(null); // No releases found yet
          } else {
            reject(new Error(`GitHub API returned status ${res.statusCode}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('Update check timed out'));
      });
      req.on('error', (err) => {
        reject(err);
      });
    });
  }

  async function checkForUpdates(force = false) {
    const now = Date.now();
    if (!force && lastCheckedAt > 0 && (now - lastCheckedAt < intervalMs)) {
      return getStatus();
    }

    state = 'checking';
    lastError = null;

    try {
      const release = await fetchLatestRelease();
      lastCheckedAt = Date.now();

      if (!release || !release.tag_name) {
        state = 'up-to-date';
        latestVersion = currentVersion;
        return getStatus();
      }

      // Ignore drafts or prereleases unless tag is valid
      if (release.draft) {
        state = 'up-to-date';
        latestVersion = currentVersion;
        return getStatus();
      }

      const remoteTag = String(release.tag_name).replace(/^v/i, '').trim();
      latestVersion = remoteTag;
      releaseUrl = release.html_url || `https://github.com/${repo}/releases/tag/${release.tag_name}`;
      releaseNotes = release.body || '';

      if (compareSemver(remoteTag, currentVersion) > 0) {
        state = 'update-available';
      } else {
        state = 'up-to-date';
      }
    } catch (err) {
      lastCheckedAt = Date.now();
      state = 'error';
      lastError = err?.message || 'Check failed';
    }

    return getStatus();
  }

  function validateReleaseUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && parsed.pathname.startsWith(`/${repo}/releases`);
    } catch {
      return false;
    }
  }

  return {
    getStatus,
    checkForUpdates,
    validateReleaseUrl,
  };
}

module.exports = {
  createUpdateChecker,
  DEFAULT_REPO,
};
