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
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const obs = new OBSWebSocket();
  try {
    await obs.connect(
      `ws://127.0.0.1:${config.server_port || 4455}`,
      config.auth_required ? config.server_password : '',
    );
    const scenes = await obs.call('GetSceneList');
    const currentSceneName = scenes.currentProgramSceneName || scenes.scenes[0].sceneName;
    const inputName = 'Boosty Chat';
    const overlaySceneName = 'Boosty Chat Overlay';
    if (!scenes.scenes.some(scene => scene.sceneName === overlaySceneName)) {
      await obs.call('CreateScene', { sceneName: overlaySceneName });
    }
    const inputSettings = {
      url: `http://127.0.0.1:17369/overlay/?v=${version}`,
      width: 900,
      height: 700,
      shutdown: false,
      restart_when_active: false,
    };
    const inputs = await obs.call('GetInputList');
    const existing = inputs.inputs.find(input => input.inputName === inputName);
    if (existing) {
      await obs.call('SetInputSettings', { inputName, inputSettings, overlay: true });
      const overlayItems = await obs.call('GetSceneItemList', { sceneName: overlaySceneName });
      if (!overlayItems.sceneItems.some(item => item.sourceName === inputName)) {
        await obs.call('CreateSceneItem', { sceneName: overlaySceneName, sourceName: inputName, sceneItemEnabled: true });
      }
    } else {
      await obs.call('CreateInput', {
        sceneName: overlaySceneName,
        inputName,
        inputKind: 'browser_source',
        inputSettings,
        sceneItemEnabled: true,
      });
    }
    if (currentSceneName !== overlaySceneName) {
      const currentItems = await obs.call('GetSceneItemList', { sceneName: currentSceneName });
      if (!currentItems.sceneItems.some(item => item.sourceName === overlaySceneName)) {
        await obs.call('CreateSceneItem', { sceneName: currentSceneName, sourceName: overlaySceneName, sceneItemEnabled: true });
      }
      for (const item of currentItems.sceneItems.filter(item => item.sourceName === inputName)) {
        await obs.call('RemoveSceneItem', { sceneName: currentSceneName, sceneItemId: item.sceneItemId });
      }
    }
    console.log(JSON.stringify({ ok: true, overlaySceneName, currentSceneName, inputName, updated: Boolean(existing) }));
  } finally {
    await obs.disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
