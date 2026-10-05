const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

/**
 * Returns path to OBS WebSocket config.json file.
 *
 * @param {object} [options]
 * @param {string} [options.platform]
 * @param {string} [options.homeDir]
 * @param {string} [options.appDataDir]
 * @returns {string}
 */
function getObsWebSocketConfigPath(options = {}) {
  const platform = options.platform || process.platform;
  const home = options.homeDir || os.homedir();
  if (platform === 'linux') {
    return path.join(home, '.config', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
  }
  const appData = options.appDataDir || (process.env.APPDATA || path.join(home, 'AppData', 'Roaming'));
  return path.join(appData, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
}

/**
 * Reads and parses OBS WebSocket config file.
 *
 * @param {object} [options]
 * @returns {{ file: string, config: object } | null}
 */
function readObsWebSocketConfig(options = {}) {
  const fsMod = options.fsModule || fs;
  try {
    const file = getObsWebSocketConfigPath(options);
    if (!fsMod.existsSync(file)) return null;
    const raw = fsMod.readFileSync(file, 'utf8');
    return { file, config: JSON.parse(raw) };
  } catch {
    return null;
  }
}

/**
 * Ensures OBS WebSocket server is enabled in config.json.
 * If server_enabled was false, sets it to true and writes back to disk (mode 0o600).
 *
 * @param {object} [options]
 * @returns {{ enabled: boolean, restartRequired: boolean, port: number, password: string, file: string | null }}
 */
function ensureObsWebSocketEnabled(options = {}) {
  const fsMod = options.fsModule || fs;
  const localConfig = readObsWebSocketConfig(options);
  if (!localConfig) {
    return {
      enabled: false,
      restartRequired: false,
      port: 4455,
      password: '',
      file: null,
    };
  }

  const { file, config } = localConfig;
  const port = Number(config.server_port || 4455);
  const password = config.auth_required ? String(config.server_password || '') : '';

  if (!config.server_enabled) {
    config.server_enabled = true;
    try {
      fsMod.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
      return {
        enabled: true,
        restartRequired: true,
        port,
        password,
        file,
      };
    } catch {
      return {
        enabled: false,
        restartRequired: false,
        port,
        password,
        file,
      };
    }
  }

  return {
    enabled: true,
    restartRequired: false,
    port,
    password,
    file,
  };
}

/**
 * Resolves path to OBS Studio executable.
 *
 * @param {object} [options]
 * @param {string} [options.platform]
 * @param {object} [options.env]
 * @param {object} [options.fsModule]
 * @returns {string | null}
 */
function getObsExecutablePath(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fsMod = options.fsModule || fs;
  const pathMod = platform === 'win32' ? path.win32 : path.posix;

  if (platform === 'win32') {
    const programFiles = env.PROGRAMFILES || '';
    const programFilesX86 = env['PROGRAMFILES(X86)'] || '';
    const local = env.LOCALAPPDATA || '';
    const candidates = [
      pathMod.join(programFiles, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
      pathMod.join(programFilesX86, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
      pathMod.join(local, 'Programs', 'obs-studio', 'bin', '64bit', 'obs64.exe'),
      pathMod.join(programFiles, 'obs-studio', 'bin', '32bit', 'obs32.exe'),
    ];
    return candidates.find(c => Boolean(c) && fsMod.existsSync(c)) || null;
  }

  if (platform === 'darwin') {
    const candidate = '/Applications/OBS.app/Contents/MacOS/OBS';
    return fsMod.existsSync(candidate) ? candidate : null;
  }

  const candidate = '/usr/bin/obs';
  return fsMod.existsSync(candidate) ? candidate : null;
}

/**
 * Launches OBS Studio detached in background.
 *
 * @param {object} [options]
 * @param {string | null} [options.executablePath]
 * @param {Function} [options.spawnFn]
 * @returns {{ ok: boolean, error?: string }}
 */
function launchObs(options = {}) {
  const exe = 'executablePath' in options ? options.executablePath : getObsExecutablePath(options);
  if (!exe) return { ok: false, error: 'OBS Studio не найден' };

  const spawnFunc = options.spawnFn || spawn;
  try {
    const child = spawnFunc(exe, [], {
      detached: true,
      stdio: 'ignore',
      cwd: path.dirname(exe),
    });
    if (child && typeof child.unref === 'function') {
      child.unref();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Не удалось запустить OBS' };
  }
}

module.exports = {
  getObsWebSocketConfigPath,
  readObsWebSocketConfig,
  ensureObsWebSocketEnabled,
  getObsExecutablePath,
  launchObs,
};
