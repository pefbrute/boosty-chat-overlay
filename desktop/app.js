let selectedBrowser = localStorage.getItem('selectedBrowser') || '';
const open = url => window.boostyOverlay.openUrl(url, selectedBrowser);

async function renderBrowsers() {
  const container = document.querySelector('#browser-buttons');
  const resultNode = document.querySelector('#browser-result');
  const browsers = await window.boostyOverlay.listBrowsers();
  if (!browsers.length) {
    resultNode.textContent = 'Brave, Chrome, Chromium или Firefox не найден.';
    return;
  }
  if (!browsers.some(browser => browser.id === selectedBrowser)) selectedBrowser = browsers[0].id;
  for (const browser of browsers) {
    const button = document.createElement('button');
    button.textContent = `Настроить ${browser.name}`;
    button.classList.toggle('primary', browser.id === selectedBrowser);
    button.addEventListener('click', async () => {
      selectedBrowser = browser.id;
      localStorage.setItem('selectedBrowser', selectedBrowser);
      container.querySelectorAll('button').forEach(item => item.classList.remove('primary'));
      button.classList.add('primary');
      const result = await window.boostyOverlay.prepareBrowserExtension(browser.id);
      if (!result.ok) {
        resultNode.textContent = result.error;
        return;
      }
      resultNode.innerHTML = '';
      const lines = result.firefox
        ? [
            `Адрес ${result.managerUrl} скопирован — вставь его в адресную строку Firefox.`,
            'Нажми «Загрузить временное дополнение» и выбери manifest.json в открытой папке.',
          ]
        : [
            `Адрес ${result.managerUrl} скопирован — вставь его в адресную строку ${result.browser}.`,
            'Включи «Режим разработчика», нажми «Загрузить распакованное» и выбери открытую папку extension.',
          ];
      for (const line of lines) {
        const row = document.createElement('span');
        row.textContent = line;
        resultNode.append(row, document.createElement('br'));
      }
    });
    container.append(button);
  }
}

document.querySelector('#boosty').addEventListener('click', () => open('https://boosty.to/'));
document.querySelector('#overlay').addEventListener('click', () => open('http://127.0.0.1:17369/overlay/'));

let latestObsScenes = [];

function updateObsActionButton() {
  const select = document.querySelector('#obs-scene');
  const btn = document.querySelector('#toggle-obs-scene');
  const selectedSceneUuid = select.value;
  const currentScene = latestObsScenes.find(s => s.sceneUuid === selectedSceneUuid);

  if (!selectedSceneUuid || !currentScene) {
    btn.textContent = 'Добавить в сцену';
    btn.className = 'primary';
    return;
  }

  if (currentScene.hasChat) {
    btn.textContent = 'Убрать из сцены';
    btn.className = 'secondary danger';
  } else {
    btn.textContent = 'Добавить в сцену';
    btn.className = 'primary';
  }
}

function renderObsUi(result) {
  const select = document.querySelector('#obs-scene');
  const targetsHint = document.querySelector('#obs-targets-hint');
  const badge = document.querySelector('#overlay-status');
  const resultNode = document.querySelector('#obs-result');

  if (!result || !result.ok || !result.connected) {
    if (!select.options.length || !select.value) {
      select.innerHTML = '<option value="">OBS не найден или WebSocket выключен</option>';
    }
    badge.textContent = 'OBS не подключён';
    badge.classList.remove('connected');
    if (result?.restartRequired) {
      resultNode.textContent = 'WebSocket включён в конфиге. Перезапусти OBS один раз.';
    }
    latestObsScenes = [];
    updateObsActionButton();
    return;
  }

  badge.textContent = 'OBS подключён';
  badge.classList.add('connected');
  latestObsScenes = result.scenes || [];

  const targeted = latestObsScenes.filter(s => s.hasChat).map(s => s.sceneName);
  if (targeted.length > 0) {
    targetsHint.textContent = `Чат подключён в сценах: ${targeted.join(', ')}.`;
  } else {
    targetsHint.textContent = 'Чат пока не добавлен ни в одну сцену.';
  }

  const previousChoice = select.value;
  select.innerHTML = '<option value="">Выбери сцену OBS…</option>';
  let selectedFound = false;

  for (const scene of latestObsScenes) {
    const option = document.createElement('option');
    option.value = scene.sceneUuid;
    option.textContent = scene.hasChat ? `${scene.sceneName} ✓` : scene.sceneName;
    if (scene.sceneUuid === previousChoice || (!previousChoice && latestObsScenes.length === 1)) {
      option.selected = true;
      selectedFound = true;
    }
    select.append(option);
  }

  if (!selectedFound && latestObsScenes.length > 0 && previousChoice) {
    const stillExists = latestObsScenes.find(s => s.sceneUuid === previousChoice);
    if (stillExists) select.value = previousChoice;
    else if (latestObsScenes.length === 1) select.value = latestObsScenes[0].sceneUuid;
  } else if (!selectedFound && latestObsScenes.length === 1) {
    select.value = latestObsScenes[0].sceneUuid;
  }

  updateObsActionButton();
}

async function loadObsScenes() {
  const password = document.querySelector('#obs-password').value;
  const result = await window.boostyOverlay.listObsScenes(password);
  renderObsUi(result);
}

document.querySelector('#obs-scene').addEventListener('change', updateObsActionButton);

document.querySelector('#refresh-obs').addEventListener('click', async () => {
  const btn = document.querySelector('#refresh-obs');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    await loadObsScenes();
  } finally {
    btn.textContent = '🔄';
    btn.disabled = false;
  }
});

document.querySelector('#toggle-obs-scene').addEventListener('click', async event => {
  const resultNode = document.querySelector('#obs-result');
  const select = document.querySelector('#obs-scene');
  const sceneIdentifier = select.value;
  if (!sceneIdentifier) {
    resultNode.textContent = 'Сначала выбери сцену в списке.';
    await loadObsScenes();
    return;
  }

  const currentScene = latestObsScenes.find(s => s.sceneUuid === sceneIdentifier);
  const isRemove = Boolean(currentScene && currentScene.hasChat);
  const password = document.querySelector('#obs-password').value;
  const btn = event.currentTarget;
  btn.disabled = true;
  btn.textContent = isRemove ? 'Удаляем…' : 'Добавляем…';
  resultNode.textContent = '';

  try {
    const result = isRemove
      ? await window.boostyOverlay.removeObsScene(password, sceneIdentifier)
      : await window.boostyOverlay.addObsScene(password, sceneIdentifier);

    if (result.ok) {
      resultNode.textContent = isRemove
        ? `Чат убран из сцены «${result.removedScene}».`
        : `Готово: источник «Boosty Chat» добавлен в сцену «${result.addedScene}».`;
      await loadObsScenes();
    } else if (result.restartRequired) {
      resultNode.textContent = 'WebSocket включён. Перезапусти OBS и нажми кнопку снова.';
    } else {
      resultNode.textContent = `Ошибка: ${result.error || 'Не удалось выполнить команду'}`;
    }
  } catch (err) {
    resultNode.textContent = `Ошибка: ${err?.message || 'Сбой запроса к OBS'}`;
  } finally {
    btn.disabled = false;
    updateObsActionButton();
  }
});

window.boostyOverlay.onObsStateChanged(state => {
  renderObsUi(state);
});

async function refreshStatus() {
  try {
    const response = await fetch('http://127.0.0.1:17369/health');
    const state = await response.json();
    document.querySelector('#message-count').textContent = `Получено сообщений: ${state.receivedMessages}`;
    const obsState = await window.boostyOverlay.getObsStatus();
    const badge = document.querySelector('#overlay-status');
    if (obsState?.ok && obsState.connected) {
      badge.textContent = 'OBS подключён';
      badge.classList.add('connected');
    } else {
      badge.textContent = 'OBS не подключён';
      badge.classList.remove('connected');
    }
    const browser = document.querySelector('#browser-status');
    browser.textContent = state.connectorConnected ? 'Расширение работает' : 'Не подключено';
    browser.classList.toggle('connected', state.connectorConnected);
    browser.classList.toggle('pending', !state.connectorConnected);
    const boosty = document.querySelector('#boosty-status');
    boosty.textContent = state.connectorConnected ? 'Boosty открыт' : 'Открой страницу чата';
    boosty.classList.toggle('connected', state.connectorConnected);
    boosty.classList.toggle('pending', !state.connectorConnected);
  } catch {
    document.querySelector('.status').textContent = 'Ошибка локального сервера';
  }
}

const alwaysShowCheckbox = document.querySelector('#always-show');
const durationContainer = document.querySelector('#duration-container');
const durationInput = document.querySelector('#duration');

const settingInputs = {
  maxMessages: document.querySelector('#max-messages'),
  fontSize: document.querySelector('#font-size'),
  backgroundOpacity: document.querySelector('#opacity'),
  accentColor: document.querySelector('#accent'),
  showAvatars: document.querySelector('#avatars'),
};
let lastNonZeroDuration = 20;
let saveTimer;

async function loadSettings() {
  const config = await fetch('http://127.0.0.1:17369/config').then(response => response.json()).catch(() => ({}));
  if (config.durationSeconds === 0) {
    alwaysShowCheckbox.checked = true;
    durationContainer.classList.add('disabled');
    durationInput.value = lastNonZeroDuration;
  } else {
    alwaysShowCheckbox.checked = false;
    durationContainer.classList.remove('disabled');
    lastNonZeroDuration = config.durationSeconds ?? 20;
    durationInput.value = lastNonZeroDuration;
  }

  for (const [name, input] of Object.entries(settingInputs)) {
    if (input.type === 'checkbox') {
      input.checked = config[name] ?? true;
    } else {
      input.value = config[name] ?? input.value;
    }
  }
}

async function saveSettings() {
  const config = {};
  for (const [name, input] of Object.entries(settingInputs)) {
    config[name] = input.type === 'checkbox' ? input.checked : input.value;
  }
  config.durationSeconds = alwaysShowCheckbox.checked
    ? 0
    : Math.max(1, Number(durationInput.value) || lastNonZeroDuration);

  const response = await fetch('http://127.0.0.1:17369/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  document.querySelector('#settings-result').textContent = response.ok ? 'Настройки сохранены' : 'Не удалось сохранить настройки';
}

alwaysShowCheckbox.addEventListener('change', () => {
  if (alwaysShowCheckbox.checked) {
    durationContainer.classList.add('disabled');
  } else {
    durationContainer.classList.remove('disabled');
    if (!Number(durationInput.value)) durationInput.value = lastNonZeroDuration;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 100);
});

durationInput.addEventListener('input', () => {
  const parsed = Number(durationInput.value);
  if (parsed > 0) lastNonZeroDuration = parsed;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 250);
});

Object.values(settingInputs).forEach(input => input.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 250);
}));

document.querySelector('#test-message').addEventListener('click', () => {
  fetch('http://127.0.0.1:17369/test').catch(() => {});
});

refreshStatus();
setInterval(refreshStatus, 1500);
renderBrowsers();
loadSettings();
loadObsScenes();
setInterval(loadObsScenes, 10_000);

