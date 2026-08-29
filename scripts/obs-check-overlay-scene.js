const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OBSWebSocket } = require('obs-websocket-js');

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(
    os.homedir(), '.config', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json',
  ), 'utf8'));
  const obs = new OBSWebSocket();
  try {
    await obs.connect(`ws://127.0.0.1:${config.server_port || 4455}`, config.auth_required ? config.server_password : '');
    const scenes = await obs.call('GetSceneList');
    const overlayExists = scenes.scenes.some(scene => scene.sceneName === 'Boosty Chat Overlay');
    console.log(JSON.stringify({ ok: true, overlayExists }));
    if (!overlayExists) process.exitCode = 1;
  } finally {
    await obs.disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
