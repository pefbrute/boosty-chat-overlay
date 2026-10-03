const fs = require('node:fs');
const path = require('node:path');
const { defaultConfig } = require('./defaults.js');
const { normalizeConfig } = require('./schema.js');

/**
 * Creates a configuration store that manages overlay configuration in memory and on disk.
 *
 * @param {object} [options]
 * @param {string} [options.configFile] Path to JSON config file.
 * @param {object} [options.defaults] Default fallback config.
 * @param {Function} [options.normalize] Normalizer function.
 */
function createConfigStore(options = {}) {
  const defaults = options.defaults || defaultConfig;
  const normalize = options.normalize || normalizeConfig;
  const configFile = options.configFile || null;

  let currentConfig = { ...defaults };

  function loadInitial() {
    if (!configFile) return;
    try {
      if (fs.existsSync(configFile)) {
        const raw = fs.readFileSync(configFile, 'utf8');
        currentConfig = normalize(JSON.parse(raw), defaults);
      }
    } catch {
      // First launch or invalid file: defaults are retained
    }
  }

  loadInitial();

  return {
    /**
     * Returns a copy of the current configuration.
     * @returns {object}
     */
    get() {
      return { ...currentConfig };
    },

    /**
     * Updates configuration with new values, saves to disk if configFile is specified,
     * and returns the normalized result.
     *
     * @param {object} partialInput
     * @returns {object}
     */
    update(partialInput) {
      currentConfig = normalize(partialInput, currentConfig);
      if (configFile) {
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        fs.writeFileSync(configFile, `${JSON.stringify(currentConfig, null, 2)}\n`, { mode: 0o600 });
      }
      return { ...currentConfig };
    },

    /**
     * Resets configuration to default values.
     *
     * @param {boolean} [saveToDisk=false]
     * @returns {object}
     */
    reset(saveToDisk = false) {
      currentConfig = { ...defaults };
      if (saveToDisk && configFile) {
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        fs.writeFileSync(configFile, `${JSON.stringify(currentConfig, null, 2)}\n`, { mode: 0o600 });
      }
      return { ...currentConfig };
    },

    /**
     * Force reload from disk.
     * @returns {object}
     */
    reload() {
      loadInitial();
      return { ...currentConfig };
    },
  };
}

module.exports = {
  createConfigStore,
};
