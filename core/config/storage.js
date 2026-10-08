'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { defaultConfig } = require('./defaults.js');
const { normalizeConfig } = require('./schema.js');

/**
 * Safely writes content to a file atomically via a temporary file in the same directory.
 *
 * @param {string} targetPath
 * @param {string} content
 * @param {number} [mode=0o600]
 */
function writeFileSyncAtomic(targetPath, content, mode = 0o600) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, { mode });
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {}
    throw err;
  }
}

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
        try {
          const parsed = JSON.parse(raw);
          currentConfig = normalize(parsed, defaults);
        } catch (parseErr) {
          console.warn('[ConfigStore] Failed to parse config JSON, preserving corrupt file as backup:', parseErr.message);
          try {
            const corruptBackup = `${configFile}.corrupt.${Date.now()}`;
            fs.copyFileSync(configFile, corruptBackup);
          } catch {}
          currentConfig = { ...defaults };
        }
      }
    } catch (readErr) {
      console.warn('[ConfigStore] Error reading config file, retaining defaults:', readErr.message);
      currentConfig = { ...defaults };
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
     * Updates configuration with new values, saves to disk atomically if configFile is specified,
     * and returns the normalized result.
     *
     * @param {object} partialInput
     * @returns {object}
     */
    update(partialInput) {
      currentConfig = normalize(partialInput, currentConfig);
      if (configFile) {
        const serialized = `${JSON.stringify(currentConfig, null, 2)}\n`;
        writeFileSyncAtomic(configFile, serialized, 0o600);
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
        const serialized = `${JSON.stringify(currentConfig, null, 2)}\n`;
        writeFileSyncAtomic(configFile, serialized, 0o600);
      }
      return { ...currentConfig };
    },

    /**
     * Creates an in-place backup copy of the current config file if it exists.
     * @returns {string|null} Backup path if created, null otherwise.
     */
    backup() {
      if (!configFile || !fs.existsSync(configFile)) return null;
      try {
        const backupPath = `${configFile}.bak.${Date.now()}`;
        fs.copyFileSync(configFile, backupPath);
        return backupPath;
      } catch (err) {
        console.warn('[ConfigStore] Failed to create backup:', err.message);
        return null;
      }
    },

    /**
     * Force reload from disk.
     * @returns {object}
     */
    reload() {
      loadInitial();
      return { ...currentConfig };
    },

    /**
     * Returns configured file path.
     * @returns {string|null}
     */
    getFilePath() {
      return configFile;
    },
  };
}

module.exports = {
  createConfigStore,
  writeFileSyncAtomic,
};
