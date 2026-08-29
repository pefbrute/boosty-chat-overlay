const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OBSWebSocket } = require('obs-websocket-js');
const { version } = require('../package.json');

async function main() {
  const configPath = path.join(
    os.homedir(),
    '.config',
    'obs-studio',
    'plugin_config',
    'obs-websocket',
    'config.json',
  );
  if (!fs.existsSync(configPath)) {
    console.log(JSON.stringify({ ok: false, error: 'OBS config not found' }));
    return;
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const obs = new OBSWebSocket();
  try {
    await obs.connect(
      `ws://127.0.0.1:${config.server_port || 4455}`,
      config.auth_required ? config.server_password : '',
    );
    const [sceneListData, inputListData] = await Promise.all([
      obs.call('GetSceneList'),
      obs.call('GetInputList', { inputKind: 'browser_source' }),
    ]);

    const currentScene = sceneListData.currentProgramSceneName || sceneListData.scenes[0]?.sceneName;
    const inputName = 'Boosty Chat';
    const inputSettings = {
      url: `http://127.0.0.1:17369/overlay/?v=${version}`,
      width: 900,
      height: 700,
      shutdown: false,
      restart_when_active: false,
    };

    const existingInput = (inputListData.inputs || []).find(input => input.inputName === inputName);
    let inputUuid = existingInput?.inputUuid;

    if (!existingInput && sceneListData.scenes.length > 0) {
      const created = await obs.call('CreateInput', {
        sceneUuid: sceneListData.scenes[0].sceneUuid,
        inputName,
        inputKind: 'browser_source',
        inputSettings,
        sceneItemEnabled: true,
      });
      inputUuid = created.inputUuid;
    } else if (existingInput) {
      await obs.call('SetInputSettings', { inputUuid, inputSettings, overlay: true });
    }

    console.log(JSON.stringify({
      ok: true,
      currentScene,
      inputName,
      inputUuid,
      totalScenes: sceneListData.scenes.length,
      updated: Boolean(existingInput),
    }));
  } finally {
    await obs.disconnect().catch(() => {});
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

