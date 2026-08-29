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

async function loadObsScenes() {
  const select = document.querySelector('#obs-scene');
  const targetsHint = document.querySelector('#obs-targets-hint');
  const previousChoice = select.value;
  const password = document.querySelector('#obs-password').value;
  const result = await window.boostyOverlay.listObsScenes(password);

  if (!result.ok) {
    if (!select.options.length || !select.value) select.innerHTML = '<option value="">OBS не найден или WebSocket выключен</option>';
    if (result.restartRequired) {
      document.querySelector('#obs-result').textContent = 'WebSocket включён в конфиге. Перезапусти OBS один раз.';
    }
    return;
  }

  if (result.collectionMismatch) {
    targetsHint.textContent = `Коллекция: «${result.currentCollection}» (чат был настроен для «${result.configuredCollection}»).`;
  } else if (result.targetScenes && result.targetScenes.length > 0) {
    const names = result.targetScenes.map(t => t.sceneName).join(', ');
    targetsHint.textContent = `Чат подключён в сценах: ${names}.`;
  } else {
    targetsHint.textContent = 'Чат пока не добавлен ни в одну сцену.';
  }

  select.innerHTML = '<option value="">Выбери сцену OBS…</option>';
  let selectedFound = false;
  for (const scene of result.scenes) {
    const option = document.createElement('option');
    option.value = scene.sceneUuid;
    option.textContent = scene.isTargeted ? `${scene.sceneName} ✓` : scene.sceneName;
    if (scene.sceneUuid === previousChoice || (!previousChoice && result.scenes.length === 1)) {
      option.selected = true;
      selectedFound = true;
    }
    select.append(option);
  }
  if (!selectedFound && result.scenes.length === 1) {
    select.value = result.scenes[0].sceneUuid;
  }
}

document.querySelector('#add-obs-scene').addEventListener('click', async event => {
  const resultNode = document.querySelector('#obs-result');
  const select = document.querySelector('#obs-scene');
  const sceneIdentifier = select.value;
  if (!sceneIdentifier) {
    resultNode.textContent = 'Сначала выбери сцену в списке.';
    await loadObsScenes();
    return;
  }
  const password = document.querySelector('#obs-password').value;
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = 'Добавляем…';
  resultNode.textContent = '';

  const result = await window.boostyOverlay.addObsScene(password, sceneIdentifier);
  if (result.ok) {
    resultNode.textContent = `Готово: источник «Boosty Chat» добавлен в сцену «${result.addedScene}».`;
    document.querySelector('#overlay-status').textContent = 'OBS подключён';
    document.querySelector('#overlay-status').classList.add('connected');
    await loadObsScenes();
  } else if (result.restartRequired) {
    resultNode.textContent = 'WebSocket включён. Перезапусти OBS и нажми кнопку снова.';
  } else {
    resultNode.textContent = `Ошибка: ${result.error || 'Не удалось подключиться к OBS'}`;
  }
  event.currentTarget.disabled = false;
  event.currentTarget.textContent = 'Добавить в сцену';
});

document.querySelector('#remove-obs-scene').addEventListener('click', async event => {
  const resultNode = document.querySelector('#obs-result');
  const select = document.querySelector('#obs-scene');
  const sceneIdentifier = select.value;
  if (!sceneIdentifier) {
    resultNode.textContent = 'Сначала выбери сцену в списке.';
    await loadObsScenes();
    return;
  }
  const password = document.querySelector('#obs-password').value;
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = 'Удаляем…';
  resultNode.textContent = '';

  const result = await window.boostyOverlay.removeObsScene(password, sceneIdentifier);
  if (result.ok) {
    resultNode.textContent = `Чат убран из сцены «${result.removedScene}».`;
    await loadObsScenes();
  } else {
    resultNode.textContent = `Ошибка: ${result.error || 'Не удалось удалить источник'}`;
  }
  event.currentTarget.disabled = false;
  event.currentTarget.textContent = 'Убрать из сцены';
});

async function refreshStatus() {
  try {
    const response = await fetch('http://127.0.0.1:17369/health');
    const state = await response.json();
    document.querySelector('#message-count').textContent = `Получено сообщений: ${state.receivedMessages}`;
    const badge = document.querySelector('#overlay-status');
    if (state.overlayClients > 0) {
      badge.textContent = 'Оверлей подключён';
      badge.classList.add('connected');
    }
    const browser = document.querySelector('#browser-status');
    browser.textContent = state.connectorConnected ? 'Расширение работает' : 'Не подключено';
    browser.classList.toggle('connected', state.connectorConnected);
    browser.classList.toggle('pending', !state.connectorConnected);
    const boosty = document.querySelector('#boosty-status');
    boosty.textContent = state.connectorConnected ? 'Boosty открыт' : 'Открой страницу чата';
    boosty.classList.toggle('connected', state.connectorConnected);
    boosty.classList.toggle('pending', !state.connectorConnected);

    const obsState = await window.boostyOverlay.getObsStatus();
    if (obsState?.ok && obsState.targetScenes?.length > 0) {
      badge.textContent = 'OBS подключён';
      badge.classList.add('connected');
    }
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

