const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  getObsWebSocketConfigPath,
  readObsWebSocketConfig,
  ensureObsWebSocketEnabled,
  getObsExecutablePath,
  launchObs,
} = require('../desktop/obs/config.js');

test('getObsWebSocketConfigPath resolves paths correctly across platforms', () => {
  const linuxPath = getObsWebSocketConfigPath({
    platform: 'linux',
    homeDir: '/home/tester',
  });
  assert.equal(linuxPath, '/home/tester/.config/obs-studio/plugin_config/obs-websocket/config.json');

  const winPath = getObsWebSocketConfigPath({
    platform: 'win32',
    appDataDir: 'C:\\Users\\tester\\AppData\\Roaming',
  });
  assert.equal(winPath, path.win32.join('C:\\Users\\tester\\AppData\\Roaming', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json'));

  const macPath = getObsWebSocketConfigPath({
    platform: 'darwin',
    homeDir: '/Users/tester',
  });
  assert.equal(macPath, '/Users/tester/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json');
});

test('readObsWebSocketConfig and ensureObsWebSocketEnabled', () => {
  let writtenData = null;
  let writtenMode = null;

  const fakeFs = {
    existsSync(p) {
      return p.includes('config.json');
    },
    readFileSync() {
      return JSON.stringify({
        server_enabled: false,
        server_port: 4455,
        auth_required: true,
        server_password: 'secret_password',
      });
    },
    writeFileSync(p, data, opts) {
      writtenData = JSON.parse(data);
      writtenMode = opts.mode;
    },
  };

  const result = ensureObsWebSocketEnabled({
    platform: 'linux',
    homeDir: '/home/tester',
    fsModule: fakeFs,
  });

  assert.equal(result.enabled, true);
  assert.equal(result.restartRequired, true);
  assert.equal(result.port, 4455);
  assert.equal(result.password, 'secret_password');
  assert.equal(writtenData.server_enabled, true);
  assert.equal(writtenMode, 0o600);
});

test('getObsExecutablePath resolves existing executable', () => {
  const fakeFs = {
    existsSync(p) {
      return p === 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe';
    },
  };

  const exe = getObsExecutablePath({
    platform: 'win32',
    env: { PROGRAMFILES: 'C:\\Program Files' },
    fsModule: fakeFs,
  });

  assert.equal(exe, 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe');
});

test('launchObs handles success and failure', () => {
  // Not found
  const notFound = launchObs({ executablePath: null });
  assert.equal(notFound.ok, false);
  assert.match(notFound.error, /не найден/i);

  // Success with mock spawn
  let spawnArgs = null;
  const mockSpawn = (exe, args, opts) => {
    spawnArgs = { exe, args, opts };
    return { unref() {} };
  };

  const success = launchObs({
    executablePath: '/usr/bin/obs',
    spawnFn: mockSpawn,
  });
  assert.equal(success.ok, true);
  assert.equal(spawnArgs.exe, '/usr/bin/obs');
  assert.equal(spawnArgs.opts.detached, true);
});
