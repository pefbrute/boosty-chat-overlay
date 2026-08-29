// --- State & Storage ---
let selectedBrowser = localStorage.getItem('selectedBrowser') || '';
let onboardingCompleted = localStorage.getItem('onboardingCompleted') === 'true';
let currentStep = 1;
let latestObsScenes = [];
let latestObsStatus = null;
let latestHealth = null;
let addedSceneName = '';
let saveTimer = null;
let lastNonZeroDuration = 20;

// --- Extension Installation Flow Module ---
const extensionFlow = {
  mode: 'unpacked', // 'unpacked' | 'store'
  storeUrls: {
    chrome: 'https://chromewebstore.google.com/',
    brave: 'https://chromewebstore.google.com/',
    edge: 'https://microsoftedge.microsoft.com/addons/',
    firefox: 'https://addons.mozilla.org/firefox/',
  },

  async startInstall(browserId) {
    if (this.mode === 'store' && this.storeUrls[browserId]) {
      await window.boostyOverlay.openUrl(this.storeUrls[browserId], browserId);
      return { ok: true, mode: 'store' };
    }
    return await window.boostyOverlay.prepareBrowserExtension(browserId);
  },

  async openFolder() {
    return await window.boostyOverlay.openExtensionFolder();
  },

  async openExtensionsPage(browserId) {
    return await window.boostyOverlay.openBrowserExtensionsPage(browserId);
  },
};

// --- View & Navigation Control ---
function showView(viewName) {
  const onboardingView = document.querySelector('#onboarding-view');
  const mainView = document.querySelector('#main-view');

  if (viewName === 'onboarding') {
    onboardingView.style.display = 'block';
    mainView.style.display = 'none';
  } else {
    onboardingView.style.display = 'none';
    mainView.style.display = 'block';
  }
}

function setWizardStep(step) {
  currentStep = Math.max(1, Math.min(4, step));

  document.querySelectorAll('.wizard-step').forEach(el => {
    const s = Number(el.getAttribute('data-step'));
    el.classList.toggle('active', s === currentStep);
    el.classList.toggle('completed', s < currentStep);
  });

  document.querySelectorAll('.wizard-panel').forEach((el, index) => {
    el.classList.toggle('active', index + 1 === currentStep);
  });

  if (currentStep === 3) {
    loadObsScenes();
  } else if (currentStep === 4) {
    updateSummaryScreen();
  }
}

// --- Browser Detection & Rendering ---
async function renderBrowserSelection() {
  const container = document.querySelector('#ob-browser-options');
  const prompt = document.querySelector('#ob-browser-prompt');
  const browsers = await window.boostyOverlay.listBrowsers();

  container.innerHTML = '';

  if (!browsers.length) {
    prompt.textContent = 'Поддерживаемый браузер не найден. Расширение будет настроено для системного браузера.';
    selectedBrowser = '';
    return;
  }

  if (!browsers.some(b => b.id === selectedBrowser)) {
    selectedBrowser = browsers[0].id;
    localStorage.setItem('selectedBrowser', selectedBrowser);
  }

  if (browsers.length === 1) {
    prompt.textContent = `Найден браузер ${browsers[0].name}`;
  } else {
    prompt.textContent = 'В каком браузере вы открываете Boosty?';
  }

  for (const browser of browsers) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `browser-choice-btn ${browser.id === selectedBrowser ? 'selected' : ''}`;
    btn.innerHTML = `<span>🌐</span> <span>${browser.name}</span>`;
    btn.addEventListener('click', () => {
      selectedBrowser = browser.id;
      localStorage.setItem('selectedBrowser', selectedBrowser);
      container.querySelectorAll('.browser-choice-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    container.append(btn);
  }
}

// --- OBS Integration (Actual State Only) ---
function updateObsActionButton(selectId, btnId) {
  const select = document.querySelector(selectId);
  const btn = document.querySelector(btnId);
  if (!select || !btn) return;

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
  latestObsStatus = result;

  const obSelect = document.querySelector('#ob-obs-scene-select');
  const dashSelect = document.querySelector('#dash-obs-scene');
  const obBadge = document.querySelector('#ob-obs-status-badge');
  const obBadgeText = document.querySelector('#ob-obs-status-text');
  const dashBadge = document.querySelector('#dash-obs-badge');
  const dashTargetsHint = document.querySelector('#dash-obs-targets-hint');
  const launchContainer = document.querySelector('#ob-obs-launch-container');
  const dashObsPill = document.querySelector('#dash-obs-pill');
  const dashObsText = document.querySelector('#dash-obs-text');

  if (!result || !result.ok || !result.connected) {
    latestObsScenes = [];
    if (obBadge) {
      obBadge.className = 'badge pending';
      obBadgeText.textContent = 'OBS не подключён';
    }
    if (dashBadge) {
      dashBadge.className = 'badge';
      dashBadge.textContent = 'OBS не подключён';
    }
    if (dashObsPill) {
      dashObsPill.className = 'status-pill pending';
      dashObsText.textContent = 'Не запущен';
    }
    if (launchContainer) {
      launchContainer.style.display = 'flex';
    }
    if (obSelect) obSelect.innerHTML = '<option value="">Сначала запустите OBS…</option>';
    if (dashSelect) dashSelect.innerHTML = '<option value="">Сначала запустите OBS…</option>';
    if (dashTargetsHint) dashTargetsHint.textContent = '';
    updateObsActionButton('#dash-obs-scene', '#dash-toggle-obs-scene');
    return;
  }

  // Connected to OBS
  latestObsScenes = result.scenes || [];
  if (launchContainer) launchContainer.style.display = 'none';

  if (obBadge) {
    obBadge.className = 'badge connected';
    obBadgeText.textContent = 'OBS подключён';
  }
  if (dashBadge) {
    dashBadge.className = 'badge connected';
    dashBadge.textContent = 'OBS подключён';
  }

  const targetedScenes = latestObsScenes.filter(s => s.hasChat).map(s => s.sceneName);

  if (dashObsPill) {
    dashObsPill.className = 'status-pill connected';
    dashObsText.textContent = targetedScenes.length > 0 ? `Подключён (${targetedScenes.join(', ')})` : 'Подключён';
  }

  if (dashTargetsHint) {
    dashTargetsHint.textContent = targetedScenes.length > 0
      ? `Чат подключён в сценах: ${targetedScenes.join(', ')}.`
      : 'Чат пока не добавлен ни в одну сцену.';
  }

  // Populate Selects
  [obSelect, dashSelect].forEach(select => {
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '<option value="">Выберите сцену OBS…</option>';
    let found = false;

    for (const scene of latestObsScenes) {
      const opt = document.createElement('option');
      opt.value = scene.sceneUuid;
      opt.textContent = scene.hasChat ? `${scene.sceneName} ✓` : scene.sceneName;
      if (scene.sceneUuid === prev || (!prev && latestObsScenes.length === 1)) {
        opt.selected = true;
        found = true;
      }
      select.append(opt);
    }

    if (!found && latestObsScenes.length > 0 && prev) {
      const exists = latestObsScenes.find(s => s.sceneUuid === prev);
      if (exists) select.value = prev;
      else if (latestObsScenes.length === 1) select.value = latestObsScenes[0].sceneUuid;
    } else if (!found && latestObsScenes.length === 1) {
      select.value = latestObsScenes[0].sceneUuid;
    }
  });

  updateObsActionButton('#dash-obs-scene', '#dash-toggle-obs-scene');
}

async function loadObsScenes() {
  const password = document.querySelector('#dash-obs-password')?.value || document.querySelector('#ob-obs-password')?.value || '';
  const result = await window.boostyOverlay.listObsScenes(password);
  renderObsUi(result);
}

window.boostyOverlay.onObsStateChanged(state => {
  renderObsUi(state);
});

// --- Health and Heartbeat Status Checker ---
async function refreshStatus() {
  try {
    const response = await fetch('http://127.0.0.1:17369/health');
    const health = await response.json();
    latestHealth = health;

    const isExtActive = Boolean(health.extensionConnected);
    const isBoostyActive = Boolean(health.boostyConnected);

    // 1. Onboarding Step 1 Status
    const obExtBadge = document.querySelector('#ob-ext-status-badge');
    const obExtText = document.querySelector('#ob-ext-status-text');
    const obExtSuccess = document.querySelector('#ob-ext-success-msg');

    if (obExtBadge) {
      obExtBadge.className = isExtActive ? 'badge connected' : 'badge pending';
      obExtText.textContent = isExtActive ? 'Расширение подключено' : 'Расширение не подключено';
      obExtSuccess.classList.toggle('visible', isExtActive);
    }

    // 2. Onboarding Step 2 Status
    const obBoostyBadge = document.querySelector('#ob-boosty-status-badge');
    const obBoostyText = document.querySelector('#ob-boosty-status-text');
    const obBoostyHint = document.querySelector('#ob-boosty-hint');

    if (obBoostyBadge) {
      obBoostyBadge.className = isBoostyActive ? 'badge connected' : 'badge pending';
      obBoostyText.textContent = isBoostyActive ? 'Boosty подключён' : 'Ждём открытие страницы Boosty…';
      if (obBoostyHint) {
        obBoostyHint.textContent = isBoostyActive
          ? 'Чат трансляции активен и передаёт сообщения.'
          : (isExtActive ? 'Расширение установлено. Осталось открыть страницу чата на Boosty.' : 'Сначала установите расширение.');
      }
    }

    // 3. Dashboard Status Pills
    const dashExtPill = document.querySelector('#dash-ext-pill');
    const dashExtText = document.querySelector('#dash-ext-text');
    const dashExtFixBtn = document.querySelector('#dash-ext-fix-btn');

    if (dashExtPill) {
      dashExtPill.className = isExtActive ? 'status-pill connected' : 'status-pill pending';
      dashExtText.textContent = isExtActive ? 'Подключено' : 'Не подключено';
      dashExtFixBtn.style.display = isExtActive ? 'none' : 'inline-block';
    }

    const dashBoostyPill = document.querySelector('#dash-boosty-pill');
    const dashBoostyText = document.querySelector('#dash-boosty-text');
    const dashBoostyOpenBtn = document.querySelector('#dash-boosty-open-btn');

    if (dashBoostyPill) {
      dashBoostyPill.className = isBoostyActive ? 'status-pill connected' : 'status-pill pending';
      dashBoostyText.textContent = isBoostyActive ? 'Открыт' : 'Не открыт';
      dashBoostyOpenBtn.style.display = isBoostyActive ? 'none' : 'inline-block';
    }

    // 4. Tech Details
    const techExt = document.querySelector('#tech-ext-status');
    const techBoosty = document.querySelector('#tech-boosty-status');
    const techMsg = document.querySelector('#tech-msg-count');
    const msgCount = document.querySelector('#message-count');

    if (techExt) techExt.textContent = isExtActive ? 'Активно (heartbeat ok)' : 'Нет связи';
    if (techBoosty) techBoosty.textContent = isBoostyActive ? 'Вкладка активна' : 'Не открыта';
    if (techMsg) techMsg.textContent = String(health.receivedMessages || 0);
    if (msgCount) msgCount.textContent = `Получено сообщений: ${health.receivedMessages || 0}`;

  } catch {
    // Local server error
  }
}

function updateSummaryScreen() {
  const boostySummary = document.querySelector('#ob-summary-boosty');
  const sceneSummary = document.querySelector('#ob-summary-scene');

  if (boostySummary) {
    boostySummary.textContent = latestHealth?.boostyConnected
      ? 'Страница Boosty подключена'
      : 'Расширение готово к открытию Boosty';
  }

  if (sceneSummary) {
    sceneSummary.textContent = addedSceneName
      ? `Чат добавлен в сцену «${addedSceneName}»`
      : 'Оверлей чата подключён к OBS';
  }
}

// --- Appearance Settings ---
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

async function loadSettings() {
  const config = await fetch('http://127.0.0.1:17369/config').then(r => r.json()).catch(() => ({}));
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
    if (!input) continue;
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
    if (!input) continue;
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
  const resNode = document.querySelector('#settings-result');
  if (resNode) {
    resNode.textContent = response.ok ? 'Настройки сохранены' : 'Не удалось сохранить настройки';
  }
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Step 1: Install Extension
  document.querySelector('#ob-install-ext-btn')?.addEventListener('click', async () => {
    const guideBox = document.querySelector('#ob-guide-box');
    guideBox.classList.add('visible');
    await extensionFlow.startInstall(selectedBrowser);
  });

  document.querySelector('#ob-reopen-folder-btn')?.addEventListener('click', async () => {
    await extensionFlow.openFolder();
  });

  document.querySelector('#ob-reopen-browser-btn')?.addEventListener('click', async () => {
    await extensionFlow.openExtensionsPage(selectedBrowser);
  });

  document.querySelector('#ob-step1-next-btn')?.addEventListener('click', () => {
    setWizardStep(2);
  });

  // Step 2: Boosty
  document.querySelector('#ob-open-boosty-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  document.querySelector('#ob-step2-prev-btn')?.addEventListener('click', () => {
    setWizardStep(1);
  });

  document.querySelector('#ob-step2-next-btn')?.addEventListener('click', () => {
    setWizardStep(3);
  });

  // Step 3: OBS
  document.querySelector('#ob-launch-obs-btn')?.addEventListener('click', async () => {
    const res = await window.boostyOverlay.launchObs();
    const resNode = document.querySelector('#ob-obs-result');
    if (!res.ok && resNode) {
      resNode.textContent = res.error || 'Не удалось запустить OBS Studio';
    }
  });

  document.querySelector('#ob-refresh-obs-btn')?.addEventListener('click', async () => {
    const btn = document.querySelector('#ob-refresh-obs-btn');
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      await loadObsScenes();
    } finally {
      btn.textContent = '🔄';
      btn.disabled = false;
    }
  });

  document.querySelector('#ob-add-obs-btn')?.addEventListener('click', async () => {
    const select = document.querySelector('#ob-obs-scene-select');
    const resultNode = document.querySelector('#ob-obs-result');
    const sceneId = select.value;
    if (!sceneId) {
      resultNode.textContent = 'Сначала выберите сцену из списка.';
      return;
    }

    const password = document.querySelector('#ob-obs-password')?.value || '';
    const btn = document.querySelector('#ob-add-obs-btn');
    btn.disabled = true;
    btn.textContent = 'Добавляем…';
    resultNode.textContent = '';

    try {
      const res = await window.boostyOverlay.addObsScene(password, sceneId);
      if (res.ok) {
        addedSceneName = res.addedScene;
        resultNode.textContent = `✓ Чат успешно добавлен в сцену «${res.addedScene}».`;
        await loadObsScenes();
      } else if (res.restartRequired) {
        resultNode.textContent = 'WebSocket включён. Перезапустите OBS Studio один раз.';
      } else {
        resultNode.textContent = `Ошибка: ${res.error || 'Не удалось добавить источник'}`;
      }
    } catch (err) {
      resultNode.textContent = `Ошибка: ${err?.message || 'Сбой запроса к OBS'}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Добавить чат';
    }
  });

  document.querySelector('#ob-step3-prev-btn')?.addEventListener('click', () => {
    setWizardStep(2);
  });

  document.querySelector('#ob-step3-next-btn')?.addEventListener('click', () => {
    setWizardStep(4);
  });

  // Step 4: Finish
  document.querySelector('#ob-test-btn')?.addEventListener('click', () => {
    fetch('http://127.0.0.1:17369/test').catch(() => {});
  });

  document.querySelector('#ob-finish-btn')?.addEventListener('click', () => {
    localStorage.setItem('onboardingCompleted', 'true');
    onboardingCompleted = true;
    showView('main');
  });

  // Dashboard Actions
  document.querySelector('#dash-ext-fix-btn')?.addEventListener('click', () => {
    showView('onboarding');
    setWizardStep(1);
  });

  document.querySelector('#dash-boosty-open-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  document.querySelector('#dash-test-message-btn')?.addEventListener('click', () => {
    fetch('http://127.0.0.1:17369/test').catch(() => {});
  });

  document.querySelector('#dash-open-overlay-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('http://127.0.0.1:17369/overlay/', selectedBrowser);
  });

  document.querySelector('#dash-open-boosty-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  document.querySelector('#dash-obs-scene')?.addEventListener('change', () => {
    updateObsActionButton('#dash-obs-scene', '#dash-toggle-obs-scene');
  });

  document.querySelector('#dash-refresh-obs')?.addEventListener('click', async () => {
    const btn = document.querySelector('#dash-refresh-obs');
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      await loadObsScenes();
    } finally {
      btn.textContent = '🔄';
      btn.disabled = false;
    }
  });

  document.querySelector('#dash-toggle-obs-scene')?.addEventListener('click', async () => {
    const resultNode = document.querySelector('#dash-obs-result');
    const select = document.querySelector('#dash-obs-scene');
    const sceneId = select.value;
    if (!sceneId) {
      resultNode.textContent = 'Сначала выберите сцену в списке.';
      return;
    }

    const currentScene = latestObsScenes.find(s => s.sceneUuid === sceneId);
    const isRemove = Boolean(currentScene && currentScene.hasChat);
    const password = document.querySelector('#dash-obs-password')?.value || '';
    const btn = document.querySelector('#dash-toggle-obs-scene');
    btn.disabled = true;
    btn.textContent = isRemove ? 'Удаляем…' : 'Добавляем…';
    resultNode.textContent = '';

    try {
      const res = isRemove
        ? await window.boostyOverlay.removeObsScene(password, sceneId)
        : await window.boostyOverlay.addObsScene(password, sceneId);

      if (res.ok) {
        resultNode.textContent = isRemove
          ? `Чат убран из сцены «${res.removedScene}».`
          : `Готово: источник «Boosty Chat» добавлен в сцену «${res.addedScene}».`;
        await loadObsScenes();
      } else if (res.restartRequired) {
        resultNode.textContent = 'WebSocket включён в настройках OBS. Перезапустите OBS Studio один раз.';
      } else {
        resultNode.textContent = `Ошибка: ${res.error || 'Не удалось выполнить команду'}`;
      }
    } catch (err) {
      resultNode.textContent = `Ошибка: ${err?.message || 'Сбой запроса к OBS'}`;
    } finally {
      btn.disabled = false;
      updateObsActionButton('#dash-obs-scene', '#dash-toggle-obs-scene');
    }
  });

  document.querySelector('#dash-restart-onboarding-btn')?.addEventListener('click', () => {
    showView('onboarding');
    setWizardStep(1);
  });

  document.querySelector('#dash-copy-url-btn')?.addEventListener('click', async () => {
    await window.boostyOverlay.copyOverlayUrl();
    const btn = document.querySelector('#dash-copy-url-btn');
    const orig = btn.textContent;
    btn.textContent = 'Скопировано!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  // Appearance Settings Listeners
  alwaysShowCheckbox?.addEventListener('change', () => {
    if (alwaysShowCheckbox.checked) {
      durationContainer.classList.add('disabled');
    } else {
      durationContainer.classList.remove('disabled');
      if (!Number(durationInput.value)) durationInput.value = lastNonZeroDuration;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, 100);
  });

  durationInput?.addEventListener('input', () => {
    const parsed = Number(durationInput.value);
    if (parsed > 0) lastNonZeroDuration = parsed;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, 250);
  });

  Object.values(settingInputs).forEach(input => {
    input?.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveSettings, 250);
    });
  });
}

// --- Initialization ---
async function init() {
  setupEventListeners();
  await renderBrowserSelection();
  await loadSettings();

  if (onboardingCompleted) {
    showView('main');
  } else {
    showView('onboarding');
    setWizardStep(1);
  }

  await refreshStatus();
  setInterval(refreshStatus, 1500);
  await loadObsScenes();
  setInterval(loadObsScenes, 10000);
}

init();
