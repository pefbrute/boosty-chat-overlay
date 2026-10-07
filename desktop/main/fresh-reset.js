'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FRESH_USER_DATA_DIR_NAME = 'Boosty Chat Overlay Fresh';

/**
 * Returns default OS appData path.
 *
 * @returns {string}
 */
function getDefaultAppDataDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/**
 * Resolves the target userData path for Fresh variant.
 *
 * @param {object} [options={}]
 * @returns {string} Absolute normalized path
 */
function getFreshUserDataPath(options = {}) {
  const env = options.env || process.env;
  if (env.BOOSTY_OVERLAY_USER_DATA) {
    return path.resolve(env.BOOSTY_OVERLAY_USER_DATA);
  }
  if (options.app && typeof options.app.getPath === 'function') {
    try {
      const appData = options.app.getPath('appData');
      return path.resolve(path.join(appData, FRESH_USER_DATA_DIR_NAME));
    } catch {
      // Fallback if appData is not ready
    }
  }
  const appData = options.appData || getDefaultAppDataDir();
  return path.resolve(path.join(appData, FRESH_USER_DATA_DIR_NAME));
}

/**
 * Validates that the target path is strictly safe to reset as a Fresh userData directory.
 * CRITICAL SAFETY GUARD:
 * Prevents wiping Production, Lab, root, home, or arbitrary directories.
 *
 * @param {string} targetPath
 * @returns {boolean} True if strictly safe to reset
 */
function isPathSafeForFreshReset(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return false;
  }

  const normalized = path.resolve(targetPath);
  const homeDir = path.resolve(os.homedir());
  const rootDir = path.resolve(path.parse(normalized).root);

  // Blacklist: Never allow root directory
  if (normalized === rootDir) {
    return false;
  }

  // Blacklist: Never allow user's home directory
  if (normalized === homeDir) {
    return false;
  }

  // Blacklist: Never allow appData directory itself
  const appData = path.resolve(getDefaultAppDataDir());
  if (normalized === appData) {
    return false;
  }

  const baseName = path.basename(normalized);

  // Blacklist: Must NEVER touch Lab or Production
  if (baseName === 'Boosty Chat Overlay Lab' || baseName === 'boosty-chat-overlay-lab') {
    return false;
  }
  if (baseName === 'Boosty Chat Overlay' || baseName === 'boosty-chat-overlay') {
    return false;
  }

  // Whitelist: Must explicitly be a Fresh variant directory or end with fresh identifier
  const isFreshNamed = baseName === FRESH_USER_DATA_DIR_NAME ||
    baseName === 'boosty-chat-overlay-fresh' ||
    baseName.toLowerCase().includes('fresh');

  if (!isFreshNamed) {
    return false;
  }

  // Must have a parent directory and not be at root level
  const parent = path.dirname(normalized);
  if (parent === normalized || parent === rootDir) {
    return false;
  }

  return true;
}

/**
 * Checks whether an active Fresh process is currently running and holding the lock.
 *
 * @param {string} userDataPath
 * @returns {boolean}
 */
function isFreshRunning(userDataPath) {
  try {
    const lockPath = path.join(userDataPath, 'SingletonLock');
    if (!fs.existsSync(lockPath)) {
      return false;
    }

    const stat = fs.lstatSync(lockPath);
    if (stat.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(lockPath);
      // Link target is typically host-pid on Unix
      const parts = linkTarget.split('-');
      const pidStr = parts[parts.length - 1];
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid) && pid > 0) {
        try {
          process.kill(pid, 0); // Throws ESRCH if process is dead
          return true; // Process is actively alive
        } catch (e) {
          if (e.code === 'ESRCH') {
            return false; // Dead process, stale lock
          }
          // EPERM means process exists but owned by someone else
          return true;
        }
      }
    }
  } catch {
    // If checking fails, assume not running
  }
  return false;
}

/**
 * Safely resets the Fresh variant user data directory.
 *
 * @param {string} [customPath]
 * @param {object} [options={}]
 * @returns {{ reset: boolean, path: string, reason?: string }}
 */
function resetFreshUserData(customPath, options = {}) {
  const env = options.env || process.env;
  const keepState = Boolean(
    options.keepState ||
    env.BOOSTY_FRESH_KEEP_STATE === '1' ||
    env.BOOSTY_FRESH_KEEP_STATE === 'true'
  );

  const targetPath = customPath ? path.resolve(customPath) : getFreshUserDataPath(options);

  if (keepState) {
    console.log(`[Fresh QA] Keep-state enabled; preserving Fresh state at: ${targetPath}`);
    return { reset: false, path: targetPath, reason: 'keep_state' };
  }

  if (!isPathSafeForFreshReset(targetPath)) {
    throw new Error(`CRITICAL SAFETY ERROR: Attempted to reset unsafe path for Fresh QA: "${targetPath}". Aborting reset to protect user data.`);
  }

  if (isFreshRunning(targetPath)) {
    console.log(`[Fresh QA] Fresh instance is already running; skipping reset to preserve active session at: ${targetPath}`);
    return { reset: false, path: targetPath, reason: 'already_running' };
  }

  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    fs.mkdirSync(targetPath, { recursive: true });
    console.log(`[Fresh QA] Clean slate: successfully reset Fresh state at: ${targetPath}`);
    return { reset: true, path: targetPath };
  } catch (err) {
    console.error(`[Fresh QA] Failed to reset Fresh state at ${targetPath}:`, err);
    throw err;
  }
}

module.exports = {
  FRESH_USER_DATA_DIR_NAME,
  getDefaultAppDataDir,
  getFreshUserDataPath,
  isPathSafeForFreshReset,
  isFreshRunning,
  resetFreshUserData,
};
