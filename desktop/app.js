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
  const previousChoice = select.value;
  const result = await window.boostyOverlay.listObsScenes(document.querySelector('#obs-password').value);
  if (!result.ok) {
    if (!select.options.length || !select.value) select.innerHTML = '<option value="">OBS не найден</option>';
    return;
  }
  const choice = result.scenes.includes(previousChoice) ? previousChoice : result.selectedScene;
  select.innerHTML = '<option value="">Выбери сцену OBS…</option>';
  for (const sceneName of result.scenes) {
    const option = document.createElement('option');
    option.value = sceneName;
    option.textContent = sceneName;
    option.selected = sceneName === choice;
    select.append(option);
  }
}

document.querySelector('#connect-obs').addEventListener('click', async event => {
  const resultNode = document.querySelector('#obs-result');
  const sceneName = document.querySelector('#obs-scene').value;
  if (!sceneName) {
    resultNode.textContent = 'Сначала выбери сцену, в которую нужно добавить чат.';
    await loadObsScenes();
    return;
  }
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = 'Подключаем…';
  resultNode.textContent = '';
  const result = await window.boostyOverlay.connectObs(document.querySelector('#obs-password').value, sceneName);
  if (result.ok) {
    resultNode.textContent = `Готово: создана сцена «${result.sceneName}» и добавлена в «${result.addedToScene}».`;
    document.querySelector('#overlay-status').textContent = 'OBS подключён';
    document.querySelector('#overlay-status').classList.add('connected');
  } else if (result.restartRequired) {
    resultNode.textContent = 'WebSocket включён. Один раз перезапусти OBS и нажми «Подключить OBS» снова.';
  } else {
    resultNode.textContent = `Не удалось подключиться: ${result.error}. Проверь, что OBS запущен и WebSocket включён.`;
  }
  event.currentTarget.disabled = false;
  event.currentTarget.textContent = 'Добавить в сцену';
});

async function refreshStatus() {
  try {
    const response = await fetch('http://127.0.0.1:17369/health');
    const state = await response.json();
    document.querySelector('#message-count').textContent = `Получено сообщений: ${state.receivedMessages}`;
    const badge = document.querySelector('#overlay-status');
    if (state.overlayClients) {
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
    if (obsState.ok) {
      const badge = document.querySelector('#overlay-status');
      badge.textContent = 'OBS подключён';
      badge.classList.add('connected');
      if (!document.querySelector('#obs-result').textContent) {
        document.querySelector('#obs-result').textContent = `Сцена «${obsState.sceneName}» подключена к «${obsState.addedToScene}».`;
      }
    }
  } catch {
    document.querySelector('.status').textContent = 'Ошибка локального сервера';
  }
}

const settingInputs = {
  durationSeconds: document.querySelector('#duration'),
  maxMessages: document.querySelector('#max-messages'),
  fontSize: document.querySelector('#font-size'),
  backgroundOpacity: document.querySelector('#opacity'),
  accentColor: document.querySelector('#accent'),
  showAvatars: document.querySelector('#avatars'),
};
let saveTimer;

async function loadSettings() {
  const config = await fetch('http://127.0.0.1:17369/config').then(response => response.json());
  for (const [name, input] of Object.entries(settingInputs)) {
    input.type === 'checkbox' ? input.checked = config[name] : input.value = config[name];
  }
}

async function saveSettings() {
  const config = {};
  for (const [name, input] of Object.entries(settingInputs)) {
    config[name] = input.type === 'checkbox' ? input.checked : input.value;
  }
  const response = await fetch('http://127.0.0.1:17369/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  document.querySelector('#settings-result').textContent = response.ok ? 'Настройки сохранены' : 'Не удалось сохранить настройки';
}

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
