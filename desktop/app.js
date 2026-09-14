// --- State & Storage ---
let selectedBrowser = localStorage.getItem('selectedBrowser') || '';
let onboardingCompleted = localStorage.getItem('onboardingCompleted') === 'true';
let currentStep = 1;
let currentView = 'dashboard';
let latestObsScenes = [];
let latestObsStatus = null;
let latestHealth = null;
let addedSceneName = '';
let saveTimer = null;
let lastNonZeroDuration = 20;
let checkGraceDeadline = Date.now() + 6000;
let isModalGuideOpen = false;
let currentSaveRevision = 0;
let lastSavedConfig = null;
let appVersion = '0.4.0';

// --- Russian Time Formatting Helper ---
function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diffSec = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 10) return 'только что';
  if (diffSec < 60) return `${diffSec} сек. назад`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    const last = diffMin % 10;
    const last2 = diffMin % 100;
    let unit = 'минут';
    if (last === 1 && last2 !== 11) unit = 'минуту';
    else if ([2, 3, 4].includes(last) && ![12, 13, 14].includes(last2)) unit = 'минуты';
    return `${diffMin} ${unit} назад`;
  }
  const diffHours = Math.floor(diffMin / 60);
  let unit = 'часов';
  const last = diffHours % 10;
  const last2 = diffHours % 100;
  if (last === 1 && last2 !== 11) unit = 'час';
  else if ([2, 3, 4].includes(last) && ![12, 13, 14].includes(last2)) unit = 'часа';
  return `${diffHours} ${unit} назад`;
}

// --- Extension Flow Module ---
const extensionFlow = {
  mode: 'unpacked',
  async startInstall(browserId) {
    return await window.boostyOverlay.prepareBrowserExtension(browserId);
  },
  async copyUrl(browserId) {
    return await window.boostyOverlay.copyExtensionsUrl(browserId);
  },
  async openFolder() {
    return await window.boostyOverlay.openExtensionFolder();
  },
  async openExtensionsPage(browserId) {
    return await window.boostyOverlay.openBrowserExtensionsPage(browserId);
  },
};

function getApiOrigin() {
  return window.BOOSTY_API_ORIGIN || 'http://127.0.0.1:17369';
}

// --- DOM Helpers ---
function setDomText(el, text) {
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

function setDomClass(el, className) {
  if (el && el.className !== className) {
    el.className = className;
  }
}

function setDomDisplay(el, display) {
  if (el && el.style.display !== display) {
    el.style.display = display;
  }
}

// --- View Navigation Control ---
const viewTitles = {
  dashboard: 'Главная',
  appearance: 'Внешний вид',
  setup: 'Настройка',
  extra: 'Дополнительно',
};

function showView(viewName) {
  const onboardingView = document.querySelector('#onboarding-view');
  const mainAppShell = document.querySelector('#main-app-shell');

  if (viewName === 'onboarding') {
    setDomDisplay(onboardingView, 'block');
    setDomDisplay(mainAppShell, 'none');
    return;
  }

  setDomDisplay(onboardingView, 'none');
  setDomDisplay(mainAppShell, 'grid');

  let targetView = viewName;
  if (targetView === 'main') targetView = 'dashboard';
  if (!viewTitles[targetView]) targetView = 'dashboard';
  currentView = targetView;

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    const v = btn.getAttribute('data-view');
    btn.classList.toggle('active', v === targetView);
  });

  const pageTitle = document.querySelector('#page-title');
  if (pageTitle) {
    pageTitle.textContent = viewTitles[targetView] || 'Boosty Chat';
  }

  const views = {
    dashboard: document.querySelector('#view-dashboard'),
    appearance: document.querySelector('#view-appearance'),
    setup: document.querySelector('#view-setup'),
    extra: document.querySelector('#view-extra'),
  };

  for (const [name, el] of Object.entries(views)) {
    if (el) {
      setDomDisplay(el, name === targetView ? 'block' : 'none');
    }
  }

  if (targetView === 'appearance') {
    initPreviewIframe();
  }

  if (window.boostyAudit) {
    updateAuditDiagnosticState();
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

// --- Browser Selection ---
let availableBrowsers = [];

async function renderBrowserSelection() {
  const obContainer = document.querySelector('#ob-browser-options');
  const obPrompt = document.querySelector('#ob-browser-prompt');
  const setupContainer = document.querySelector('#setup-browser-options');
  const modalContainer = document.querySelector('#modal-browser-options');
  const modalPrompt = document.querySelector('#modal-browser-prompt');

  availableBrowsers = await window.boostyOverlay.listBrowsers();

  [obContainer, setupContainer, modalContainer].forEach(c => {
    if (c) c.innerHTML = '';
  });

  if (!availableBrowsers.length) {
    const fallbackText = 'Поддерживаемый браузер не найден. Будет использован системный браузер.';
    if (obPrompt) obPrompt.textContent = fallbackText;
    if (modalPrompt) modalPrompt.textContent = fallbackText;
    selectedBrowser = '';
    return;
  }

  if (!availableBrowsers.some(b => b.id === selectedBrowser)) {
    selectedBrowser = availableBrowsers[0].id;
    localStorage.setItem('selectedBrowser', selectedBrowser);
  }

  const promptText = availableBrowsers.length === 1
    ? `Выбран браузер ${availableBrowsers[0].name}`
    : 'В каком браузере вы открываете Boosty?';

  if (obPrompt) obPrompt.textContent = promptText;
  if (modalPrompt) modalPrompt.textContent = promptText;

  [obContainer, setupContainer, modalContainer].forEach(c => {
    if (!c) return;
    for (const browser of availableBrowsers) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `browser-choice-btn ${browser.id === selectedBrowser ? 'selected' : ''}`;
      btn.innerHTML = `<span>🌐</span> <span>${browser.name}</span>`;
      btn.addEventListener('click', () => {
        selectedBrowser = browser.id;
        localStorage.setItem('selectedBrowser', selectedBrowser);
        document.querySelectorAll('.browser-choice-btn').forEach(b => {
          b.classList.toggle('selected', b.textContent.includes(browser.name));
        });
        updateBrowserActionButtons();
      });
      c.append(btn);
    }
  });

  updateBrowserActionButtons();
}

function updateBrowserActionButtons() {
  const current = availableBrowsers.find(b => b.id === selectedBrowser) || availableBrowsers[0];
  const name = current ? current.name : 'браузер';
  const obOpenBrowser = document.querySelector('#ob-open-browser-btn');
  const setupOpenBrowser = document.querySelector('#setup-open-browser-btn');
  if (obOpenBrowser) setDomText(obOpenBrowser, `🌐 Открыть ${name}`);
  if (setupOpenBrowser) setDomText(setupOpenBrowser, `🌐 Открыть ${name}`);
}

// --- OBS Integration ---
function areObsScenesEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const s1 = a[i];
    const s2 = b[i];
    if (
      s1.sceneUuid !== s2.sceneUuid ||
      s1.sceneName !== s2.sceneName ||
      Boolean(s1.hasChat) !== Boolean(s2.hasChat) ||
      Boolean(s1.sceneItemEnabled) !== Boolean(s2.sceneItemEnabled)
    ) {
      return false;
    }
  }
  return true;
}

function updateObsActionButton(selectId, btnId) {
  const select = document.querySelector(selectId);
  const btn = document.querySelector(btnId);
  if (!select || !btn) return;

  const selectedSceneUuid = select.value;
  const currentScene = latestObsScenes.find(s => s.sceneUuid === selectedSceneUuid);

  if (btnId === '#ob-add-obs-btn') {
    // In onboarding Step 3, we guide the user to add the chat source to the chosen scene
    if (currentScene && currentScene.hasChat) {
      setDomText(btn, 'Чат уже добавлен');
      setDomClass(btn, 'secondary');
    } else {
      setDomText(btn, 'Добавить чат');
      setDomClass(btn, 'primary');
    }
    return;
  }

  if (!selectedSceneUuid || !currentScene) {
    setDomText(btn, 'Добавить в сцену');
    setDomClass(btn, 'primary');
    return;
  }

  if (currentScene.hasChat) {
    setDomText(btn, 'Убрать из сцены');
    setDomClass(btn, 'secondary');
  } else {
    setDomText(btn, 'Добавить в сцену');
    setDomClass(btn, 'primary');
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
  const dashObsLaunchBtn = document.querySelector('#dash-obs-launch-btn');
  const setupLaunchBtn = document.querySelector('#dash-obs-launch-btn-setup');

  const isConnected = Boolean(result && result.ok && result.connected);

  if (dashObsPill) {
    if (isConnected) {
      setDomClass(dashObsPill, 'summary-pill ready');
      setDomText(dashObsText, 'Подключено');
      setDomDisplay(dashObsLaunchBtn, 'none');
    } else {
      setDomClass(dashObsPill, 'summary-pill pending');
      setDomText(dashObsText, 'Не подключён');
      setDomDisplay(dashObsLaunchBtn, 'none');
    }
  }

  if (setupLaunchBtn) {
    setDomDisplay(setupLaunchBtn, isConnected ? 'none' : 'inline-flex');
  }

  if (!isConnected) {
    latestObsScenes = [];
    if (obBadge) setDomClass(obBadge, 'badge pending');
    if (obBadgeText) setDomText(obBadgeText, 'OBS не подключён');
    if (dashBadge) {
      setDomClass(dashBadge, 'badge pending');
      setDomText(dashBadge, 'OBS не подключён');
    }
    if (dashTargetsHint) setDomText(dashTargetsHint, '');
    if (launchContainer) setDomDisplay(launchContainer, 'flex');

    [obSelect, dashSelect].forEach(select => {
      if (select) {
        select.innerHTML = '<option value="">Запустите OBS Studio…</option>';
        select.disabled = true;
      }
    });

    updateObsActionButton('#ob-obs-scene-select', '#ob-add-obs-btn');
    updateObsActionButton('#dash-obs-scene', '#dash-toggle-obs-scene');
    updateContextualActionCard();
    return;
  }

  if (launchContainer) setDomDisplay(launchContainer, 'none');
  if (obBadge) setDomClass(obBadge, 'badge connected');
  if (obBadgeText) setDomText(obBadgeText, 'OBS Studio подключён');
  if (dashBadge) {
    setDomClass(dashBadge, 'badge connected');
    setDomText(dashBadge, 'OBS подключён');
  }

  const rawScenes = Array.isArray(result.scenes) ? result.scenes : [];
  if (!areObsScenesEqual(rawScenes, latestObsScenes)) {
    latestObsScenes = rawScenes;
    [obSelect, dashSelect].forEach(select => {
      if (!select) return;
      const prevVal = select.value;
      select.disabled = false;
      select.innerHTML = '';

      if (!latestObsScenes.length) {
        select.innerHTML = '<option value="">Сцены не найдены</option>';
        return;
      }

      for (const scene of latestObsScenes) {
        const opt = document.createElement('option');
        opt.value = scene.sceneUuid;
        const mark = scene.hasChat ? ' (чат добавлен)' : '';
        opt.textContent = `${scene.sceneName}${mark}`;
        select.append(opt);
      }

      const hasPrev = latestObsScenes.some(s => s.sceneUuid === prevVal);
      if (hasPrev) {
        select.value = prevVal;
      } else {
        const withChat = latestObsScenes.find(s => s.hasChat);
        select.value = withChat ? withChat.sceneUuid : latestObsScenes[0].sceneUuid;
      }
    });
  }

  const addedScenes = latestObsScenes.filter(s => s.hasChat).map(s => s.sceneName);
  if (dashTargetsHint) {
    setDomText(dashTargetsHint, addedScenes.length > 0
      ? `Чат добавлен в сцены: ${addedScenes.join(', ')}`
      : 'Чат пока не добавлен ни в одну сцену.');
  }

  updateObsActionButton('#ob-obs-scene-select', '#ob-add-obs-btn');
  updateObsActionButton('#dash-obs-scene', '#dash-toggle-obs-scene');
  updateObsStep3State();
  updateContextualActionCard();
}

function updateObsStep3State() {
  const step3Btn = document.querySelector('#ob-step3-next-btn');
  const step3Reason = document.querySelector('#ob-step3-reason');
  const hasChatInAnyScene = Boolean(addedSceneName || (Array.isArray(latestObsScenes) && latestObsScenes.some(s => s.hasChat)));

  if (step3Btn) {
    step3Btn.disabled = !hasChatInAnyScene;
  }
  if (step3Reason) {
    setDomDisplay(step3Reason, hasChatInAnyScene ? 'none' : 'inline');
  }
}

async function loadObsScenes() {
  const password = document.querySelector('#dash-obs-password')?.value ||
                   document.querySelector('#ob-obs-password')?.value || '';
  try {
    const result = await window.boostyOverlay.listObsScenes(password);
    renderObsUi(result);
  } catch (err) {
    renderObsUi({ ok: false, connected: false, error: err?.message });
  }
}

// --- Contextual Action Card & Readiness State ---
function getSystemReadiness() {
  const isExtConnected = Boolean(latestHealth?.extensionConnected);
  const isBoostyConnected = Boolean(latestHealth?.boostyConnected);
  const isObsConnected = Boolean(latestObsStatus?.connected);
  const isChecking = !isExtConnected && Date.now() < checkGraceDeadline;

  if (isChecking) {
    return { status: 'connecting', title: 'Проверяем подключения…', desc: 'Ищем расширение браузера…' };
  }
  if (isExtConnected && isBoostyConnected && isObsConnected) {
    return { status: 'ready', title: 'Готово к стриму', desc: 'Boosty и OBS подключены' };
  }

  let missingCount = 0;
  if (!isExtConnected) missingCount++;
  if (!isBoostyConnected) missingCount++;
  if (!isObsConnected) missingCount++;

  if (missingCount > 1) {
    if (!isExtConnected) {
      return { status: 'setup-required', title: 'Требуется настройка', desc: `Нужно исправить ${missingCount} пункта` };
    }
    return { status: 'setup-required', title: 'Требуется настройка', desc: 'Подключите Boosty и OBS' };
  }

  if (!isObsConnected) {
    return { status: 'setup-required', title: 'Требуется настройка', desc: 'Нужно подключить OBS' };
  }
  if (!isBoostyConnected) {
    return { status: 'setup-required', title: 'Требуется настройка', desc: 'Откройте вкладку со стримом Boosty' };
  }
  return { status: 'setup-required', title: 'Требуется настройка', desc: 'Нужно подключить расширение' };
}

function updateContextualActionCard() {
  const readiness = getSystemReadiness();
  const readinessBanner = document.querySelector('#readiness-status');
  const readinessTitle = document.querySelector('#readiness-title');
  const readinessDesc = document.querySelector('#readiness-desc');

  if (readinessBanner) {
    setDomClass(readinessBanner, `readiness-banner ${readiness.status}`);
  }
  if (readinessTitle) setDomText(readinessTitle, readiness.title);
  if (readinessDesc) setDomText(readinessDesc, readiness.desc);

  const isExtConnected = Boolean(latestHealth?.extensionConnected);
  const isBoostyConnected = Boolean(latestHealth?.boostyConnected);
  const isObsConnected = Boolean(latestObsStatus?.connected);
  const isChecking = readiness.status === 'connecting';

  // Action card elements
  const icon = document.querySelector('#action-card-icon');
  const title = document.querySelector('#action-card-title');
  const desc = document.querySelector('#action-card-desc');
  const meta = document.querySelector('#action-card-meta');
  const metaMsgCount = document.querySelector('#meta-msg-count');
  const metaObsScene = document.querySelector('#meta-obs-scene');
  const actionsContainer = document.querySelector('#main-action-actions');

  if (!actionsContainer) return;

  if (metaMsgCount) setDomText(metaMsgCount, String(latestHealth?.receivedMessages || 0));

  const activeScene = latestObsScenes.find(s => s.hasChat) || latestObsScenes[0];
  if (metaObsScene) {
    setDomText(metaObsScene, isObsConnected && activeScene ? activeScene.sceneName : (isObsConnected ? 'Не выбрана' : 'Не подключён'));
  }

  actionsContainer.innerHTML = '';

  if (readiness.status === 'ready') {
    if (icon) icon.innerHTML = '<svg class="icon-svg icon-lg" aria-hidden="true"><use href="#icon-sparkles"/></svg>';
    if (title) setDomText(title, 'Оверлей работает');
    if (desc) setDomText(desc, 'Все компоненты активны и готовы к показу сообщений на стриме.');
    if (meta) setDomDisplay(meta, 'flex');

    const previewBtn = document.createElement('button');
    previewBtn.className = 'secondary';
    previewBtn.innerHTML = '<svg class="icon-svg" aria-hidden="true"><use href="#icon-palette"/></svg> <span>Предпросмотр</span>';
    previewBtn.addEventListener('click', () => showView('appearance'));

    const testBtn = document.createElement('button');
    testBtn.className = 'secondary';
    testBtn.innerHTML = '<svg class="icon-svg" aria-hidden="true"><use href="#icon-chat"/></svg> <span>Тестовое сообщение</span>';
    testBtn.addEventListener('click', () => {
      fetch(`${getApiOrigin()}/test`).catch(() => {});
    });

    actionsContainer.append(previewBtn, testBtn);
    return;
  }

  if (meta) setDomDisplay(meta, 'none');

  if (!isExtConnected && !isChecking) {
    if (icon) icon.innerHTML = '<svg class="icon-svg icon-lg" aria-hidden="true"><use href="#icon-extension"/></svg>';
    if (title) setDomText(title, 'Установи расширение');
    if (desc) setDomText(desc, 'Оно читает сообщения из открытого чата Boosty и передаёт их локально приложению.');

    const installBtn = document.createElement('button');
    installBtn.className = 'primary';
    installBtn.textContent = 'Установить расширение';
    installBtn.addEventListener('click', () => {
      openExtensionModal('setup');
    });

    const openBrowserBtn = document.createElement('button');
    openBrowserBtn.className = 'secondary';
    openBrowserBtn.textContent = 'Открыть браузер';
    openBrowserBtn.addEventListener('click', () => {
      window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
    });

    actionsContainer.append(installBtn, openBrowserBtn);
    return;
  }

  if (!isBoostyConnected && !isChecking) {
    if (icon) icon.innerHTML = '<svg class="icon-svg icon-lg" aria-hidden="true"><use href="#icon-boosty"/></svg>';
    if (title) setDomText(title, 'Открой стрим Boosty');
    if (desc) setDomText(desc, 'Расширение установлено, но вкладка со стримом сейчас не найдена.');

    const openBoostyBtn = document.createElement('button');
    openBoostyBtn.className = 'primary';
    openBoostyBtn.textContent = 'Открыть Boosty';
    openBoostyBtn.addEventListener('click', () => {
      window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
    });

    actionsContainer.append(openBoostyBtn);
    return;
  }

  if (!isObsConnected && !isChecking) {
    if (icon) icon.innerHTML = '<svg class="icon-svg icon-lg" aria-hidden="true"><use href="#icon-obs"/></svg>';
    if (title) setDomText(title, 'Подключи OBS Studio');
    if (desc) setDomText(desc, 'Boosty уже работает. Осталось подключить OBS, чтобы вывести чат на сцену.');

    const connectObsBtn = document.createElement('button');
    connectObsBtn.className = 'primary';
    connectObsBtn.textContent = 'Подключить OBS';
    connectObsBtn.addEventListener('click', () => {
      showView('setup');
    });

    const launchBtn = document.createElement('button');
    launchBtn.className = 'secondary';
    launchBtn.textContent = 'Запустить OBS';
    launchBtn.addEventListener('click', () => {
      window.boostyOverlay.launchObs();
    });

    actionsContainer.append(connectObsBtn, launchBtn);
    return;
  }

  // Connecting / checking state
  if (icon) icon.innerHTML = '<svg class="icon-svg icon-lg" aria-hidden="true"><use href="#icon-clock"/></svg>';
  if (title) setDomText(title, 'Проверяем подключения…');
  if (desc) setDomText(desc, 'Ищем расширение браузера и связь с OBS Studio…');
}

// --- Live Preview Controller ---
const PREVIEW_FIXTURES = [
  {
    id: 'prev-1',
    author: 'Алексей',
    text: 'Привет! Отличный стрим 🔥',
    avatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23f15f2c"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">А</text></svg>',
  },
  {
    id: 'prev-2',
    author: 'ОченьДлинноеИмяПользователя',
    text: 'Проверяем, как выглядит более длинное сообщение в несколько строк.',
    avatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%233a86ff"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">О</text></svg>',
  },
  {
    id: 'prev-3',
    author: 'Streamer_123',
    text: '🚀🎉',
    avatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%2310b981"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">S</text></svg>',
  },
];

let previewReady = false;

function initPreviewIframe() {
  const iframe = document.querySelector('#preview-iframe');
  if (!iframe) return;

  const targetSrc = `${getApiOrigin()}/overlay/preview.html`;
  if (!iframe.src || !iframe.src.includes('/overlay/preview.html')) {
    iframe.src = targetSrc;
    iframe.onload = () => {
      previewReady = true;
      sendFixturesToPreview();
      sendConfigToPreview(gatherCurrentConfig());
    };
  } else if (previewReady) {
    sendConfigToPreview(gatherCurrentConfig());
  }
}

function sendConfigToPreview(config) {
  const iframe = document.querySelector('#preview-iframe');
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage({
    type: 'preview:set-config',
    config,
  }, '*');
}

function sendFixturesToPreview() {
  const iframe = document.querySelector('#preview-iframe');
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage({
    type: 'preview:set-fixtures',
    fixtures: PREVIEW_FIXTURES,
  }, '*');
}

window.addEventListener('message', event => {
  if (event.data && event.data.type === 'preview:ready') {
    previewReady = true;
    sendFixturesToPreview();
    sendConfigToPreview(gatherCurrentConfig());
  }
});

// --- Appearance Presets ---
const PRESETS = {
  compact: {
    fontSize: 16,
    authorFontSize: 13,
    cardWidth: 380,
    borderRadius: 6,
    cardPadding: 8,
    messageGap: 6,
    avatarSize: 32,
    backgroundOpacity: 90,
    showAvatars: true,
    backdropBlur: 0,
    shadow: true,
  },
  clean: {
    fontSize: 21,
    authorFontSize: 16,
    cardWidth: 520,
    borderRadius: 10,
    cardPadding: 10,
    messageGap: 10,
    avatarSize: 42,
    backgroundOpacity: 88,
    showAvatars: true,
    backdropBlur: 0,
    shadow: true,
  },
  large: {
    fontSize: 26,
    authorFontSize: 18,
    cardWidth: 640,
    borderRadius: 14,
    cardPadding: 14,
    messageGap: 14,
    avatarSize: 48,
    backgroundOpacity: 88,
    showAvatars: true,
    backdropBlur: 0,
    shadow: true,
  },
  glass: {
    fontSize: 20,
    authorFontSize: 15,
    cardWidth: 520,
    borderRadius: 16,
    cardPadding: 12,
    messageGap: 12,
    avatarSize: 40,
    backgroundOpacity: 45,
    showAvatars: true,
    backdropBlur: 10,
    shadow: true,
  },
};

const appearanceInputs = {
  maxMessages: document.querySelector('#max-messages'),
  maxMessagesSlider: document.querySelector('#max-messages-slider'),
  alwaysShow: document.querySelector('#always-show'),
  duration: document.querySelector('#duration'),
  durationSlider: document.querySelector('#duration-slider'),
  cardWidth: document.querySelector('#card-width'),
  cardWidthSlider: document.querySelector('#card-width-slider'),
  fontSize: document.querySelector('#font-size'),
  fontSizeSlider: document.querySelector('#font-size-slider'),
  authorFontSize: document.querySelector('#author-font-size'),
  authorFontSizeSlider: document.querySelector('#author-font-size-slider'),
  accentColor: document.querySelector('#accent'),
  accentColorHex: document.querySelector('#accent-hex'),
  textColor: document.querySelector('#text-color'),
  textColorHex: document.querySelector('#text-color-hex'),
  backgroundOpacity: document.querySelector('#opacity'),
  backgroundColor: document.querySelector('#background-color'),
  backgroundColorHex: document.querySelector('#background-color-hex'),
  borderRadius: document.querySelector('#border-radius'),
  borderRadiusSlider: document.querySelector('#border-radius-slider'),
  cardPadding: document.querySelector('#card-padding'),
  cardPaddingSlider: document.querySelector('#card-padding-slider'),
  messageGap: document.querySelector('#message-gap'),
  messageGapSlider: document.querySelector('#message-gap-slider'),
  showAvatars: document.querySelector('#avatars'),
  avatarSize: document.querySelector('#avatar-size'),
  avatarSizeSlider: document.querySelector('#avatar-size-slider'),
  shadow: document.querySelector('#card-shadow'),
  backdropBlur: document.querySelector('#backdrop-blur'),
  backdropBlurSlider: document.querySelector('#backdrop-blur-slider'),
};

function gatherCurrentConfig() {
  const alwaysShow = Boolean(appearanceInputs.alwaysShow?.checked);
  const durationVal = Number(appearanceInputs.duration?.value) || lastNonZeroDuration;

  return {
    durationSeconds: alwaysShow ? 0 : Math.max(1, durationVal),
    maxMessages: Math.max(1, Math.min(20, Number(appearanceInputs.maxMessages?.value) || 6)),
    cardWidth: Math.max(280, Math.min(760, Number(appearanceInputs.cardWidth?.value) || 520)),
    fontSize: Math.max(12, Math.min(48, Number(appearanceInputs.fontSize?.value) || 21)),
    authorFontSize: Math.max(12, Math.min(28, Number(appearanceInputs.authorFontSize?.value) || 16)),
    accentColor: appearanceInputs.accentColor?.value || '#f15f2c',
    textColor: appearanceInputs.textColor?.value || '#ffffff',
    backgroundColor: appearanceInputs.backgroundColor?.value || '#121216',
    backgroundOpacity: Math.max(0, Math.min(100, Number(appearanceInputs.backgroundOpacity?.value) ?? 88)),
    borderRadius: Math.max(0, Math.min(24, Number(appearanceInputs.borderRadius?.value) ?? 10)),
    cardPadding: Math.max(6, Math.min(24, Number(appearanceInputs.cardPadding?.value) ?? 10)),
    messageGap: Math.max(4, Math.min(24, Number(appearanceInputs.messageGap?.value) ?? 10)),
    showAvatars: Boolean(appearanceInputs.showAvatars?.checked),
    avatarSize: Math.max(24, Math.min(64, Number(appearanceInputs.avatarSize?.value) || 42)),
    shadow: Boolean(appearanceInputs.shadow?.checked),
    backdropBlur: Math.max(0, Math.min(20, Number(appearanceInputs.backdropBlur?.value) || 0)),
  };
}

function updateAppearanceLabels(config) {
  setDomText(document.querySelector('#duration-val'), String(config.durationSeconds || lastNonZeroDuration));
  setDomText(document.querySelector('#max-messages-val'), String(config.maxMessages));
  setDomText(document.querySelector('#card-width-val'), String(config.cardWidth));
  setDomText(document.querySelector('#font-size-val'), String(config.fontSize));
  setDomText(document.querySelector('#author-font-size-val'), String(config.authorFontSize));
  setDomText(document.querySelector('#opacity-val'), String(config.backgroundOpacity));
  setDomText(document.querySelector('#border-radius-val'), String(config.borderRadius));
  setDomText(document.querySelector('#card-padding-val'), String(config.cardPadding));
  setDomText(document.querySelector('#message-gap-val'), String(config.messageGap));
  setDomText(document.querySelector('#avatar-size-val'), String(config.avatarSize));
  setDomText(document.querySelector('#backdrop-blur-val'), String(config.backdropBlur));

  const durationContainer = document.querySelector('#duration-container');
  if (durationContainer) {
    durationContainer.classList.toggle('disabled', config.durationSeconds === 0);
  }

  const avatarSizeContainer = document.querySelector('#avatar-size-container');
  if (avatarSizeContainer) {
    avatarSizeContainer.classList.toggle('disabled', !config.showAvatars);
    if (appearanceInputs.avatarSize) appearanceInputs.avatarSize.disabled = !config.showAvatars;
    if (appearanceInputs.avatarSizeSlider) appearanceInputs.avatarSizeSlider.disabled = !config.showAvatars;
  }
}

function syncInputsFromConfig(config) {
  if (!config) return;

  if (config.durationSeconds === 0) {
    if (appearanceInputs.alwaysShow) appearanceInputs.alwaysShow.checked = true;
    if (appearanceInputs.duration) appearanceInputs.duration.value = lastNonZeroDuration;
    if (appearanceInputs.durationSlider) appearanceInputs.durationSlider.value = lastNonZeroDuration;
  } else if (config.durationSeconds !== undefined) {
    lastNonZeroDuration = config.durationSeconds;
    if (appearanceInputs.alwaysShow) appearanceInputs.alwaysShow.checked = false;
    if (appearanceInputs.duration) appearanceInputs.duration.value = config.durationSeconds;
    if (appearanceInputs.durationSlider) appearanceInputs.durationSlider.value = config.durationSeconds;
  }

  const syncNum = (input, slider, val) => {
    if (val === undefined || val === null) return;
    if (input) input.value = val;
    if (slider) slider.value = val;
  };

  syncNum(appearanceInputs.maxMessages, appearanceInputs.maxMessagesSlider, config.maxMessages);
  syncNum(appearanceInputs.cardWidth, appearanceInputs.cardWidthSlider, config.cardWidth ?? 520);
  syncNum(appearanceInputs.fontSize, appearanceInputs.fontSizeSlider, config.fontSize);
  syncNum(appearanceInputs.authorFontSize, appearanceInputs.authorFontSizeSlider, config.authorFontSize ?? 16);
  syncNum(appearanceInputs.borderRadius, appearanceInputs.borderRadiusSlider, config.borderRadius ?? 10);
  syncNum(appearanceInputs.cardPadding, appearanceInputs.cardPaddingSlider, config.cardPadding ?? 10);
  syncNum(appearanceInputs.messageGap, appearanceInputs.messageGapSlider, config.messageGap ?? 10);
  syncNum(appearanceInputs.avatarSize, appearanceInputs.avatarSizeSlider, config.avatarSize ?? 42);
  syncNum(appearanceInputs.backdropBlur, appearanceInputs.backdropBlurSlider, config.backdropBlur ?? 0);

  if (appearanceInputs.backgroundOpacity && config.backgroundOpacity !== undefined) {
    appearanceInputs.backgroundOpacity.value = config.backgroundOpacity;
  }

  const syncColor = (picker, text, val) => {
    if (!val) return;
    if (picker) picker.value = val;
    if (text) text.value = val;
  };

  syncColor(appearanceInputs.accentColor, appearanceInputs.accentColorHex, config.accentColor);
  syncColor(appearanceInputs.textColor, appearanceInputs.textColorHex, config.textColor ?? '#ffffff');
  syncColor(appearanceInputs.backgroundColor, appearanceInputs.backgroundColorHex, config.backgroundColor ?? '#121216');

  if (appearanceInputs.showAvatars && config.showAvatars !== undefined) {
    appearanceInputs.showAvatars.checked = Boolean(config.showAvatars);
  }
  if (appearanceInputs.shadow && config.shadow !== undefined) {
    appearanceInputs.shadow.checked = Boolean(config.shadow);
  }

  const current = gatherCurrentConfig();
  updateAppearanceLabels(current);
}

// Russian localized preset display names (storage and logic use slugs: clean, compact, large, glass)
const PRESET_LABELS = {
  clean: 'Чистый',
  compact: 'Компактный',
  large: 'Крупный',
  glass: 'Стекло',
};

const APPEARANCE_KEYS = [
  'fontSize',
  'authorFontSize',
  'cardWidth',
  'borderRadius',
  'cardPadding',
  'messageGap',
  'avatarSize',
  'backgroundOpacity',
  'showAvatars',
  'backdropBlur',
  'shadow',
];

// Preset matching helper — strictly compares normalized appearance fields
function detectActivePreset(config) {
  if (!config) return null;
  for (const [name, preset] of Object.entries(PRESETS)) {
    let matches = true;
    for (const key of APPEARANCE_KEYS) {
      if (config[key] !== preset[key]) {
        matches = false;
        break;
      }
    }
    if (matches) return name;
  }
  return null;
}

function updatePresetUi(activePresetName) {
  const badge = document.querySelector('#preset-status-badge');
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-preset') === activePresetName);
  });

  if (badge) {
    if (activePresetName && PRESET_LABELS[activePresetName]) {
      badge.textContent = PRESET_LABELS[activePresetName];
    } else {
      badge.textContent = 'Кастомный';
    }
  }
}

// --- Debounced Autosave State Machine with Race Protection ---
function showSaveStatus(type) {
  const statusPill = document.querySelector('#appearance-save-status');
  const retryBtn = document.querySelector('#appearance-retry-save-btn');
  if (!statusPill) return;

  if (type === 'saving') {
    setDomClass(statusPill, 'save-status-pill saving');
    setDomText(statusPill, 'Сохраняем…');
    setDomDisplay(retryBtn, 'none');
  } else if (type === 'saved') {
    setDomClass(statusPill, 'save-status-pill saved');
    setDomText(statusPill, '✓ Сохранено');
    setDomDisplay(retryBtn, 'none');
  } else if (type === 'error') {
    setDomClass(statusPill, 'save-status-pill error');
    setDomText(statusPill, 'Не удалось сохранить');
    setDomDisplay(retryBtn, 'inline-flex');
  }
}

async function triggerSave(immediate = false) {
  currentSaveRevision += 1;
  const thisRevision = currentSaveRevision;
  clearTimeout(saveTimer);

  const configToSave = gatherCurrentConfig();
  updateAppearanceLabels(configToSave);
  sendConfigToPreview(configToSave);

  const matchedPreset = detectActivePreset(configToSave);
  updatePresetUi(matchedPreset);

  showSaveStatus('saving');

  const executePost = async () => {
    try {
      const response = await fetch(`${getApiOrigin()}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configToSave),
      });

      if (thisRevision !== currentSaveRevision) return;

      if (response.ok) {
        lastSavedConfig = await response.json();
        showSaveStatus('saved');
      } else {
        showSaveStatus('error');
      }
    } catch {
      if (thisRevision !== currentSaveRevision) return;
      showSaveStatus('error');
    }
  };

  if (immediate) {
    await executePost();
  } else {
    saveTimer = setTimeout(executePost, 350);
  }
}

async function loadSettings() {
  const config = await fetch(`${getApiOrigin()}/config`).then(r => r.json()).catch(() => ({}));
  syncInputsFromConfig(config);
  lastSavedConfig = config;
  updatePresetUi(detectActivePreset(config) || 'clean');
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Navigation
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      if (view) showView(view);
    });
  });

  // Action card shortcuts
  document.querySelector('#action-btn-preview')?.addEventListener('click', () => {
    showView('appearance');
  });

  document.querySelector('#dash-test-message-btn')?.addEventListener('click', () => {
    fetch(`${getApiOrigin()}/test`).catch(() => {});
  });

  document.querySelector('#dash-open-overlay-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl(`${getApiOrigin()}/overlay/`, selectedBrowser);
  });

  document.querySelector('#dash-open-boosty-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  // Backdrop switcher
  document.querySelectorAll('.bg-selector-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-selector-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-bg');
      const backdrop = document.querySelector('#preview-backdrop');
      if (backdrop) {
        setDomClass(backdrop, `preview-backdrop backdrop-${mode}`);
      }
    });
  });

  // Appearance Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetName = btn.getAttribute('data-preset');
      const preset = PRESETS[presetName];
      if (preset) {
        syncInputsFromConfig(preset);
        updatePresetUi(presetName);
        triggerSave(true);
      }
    });
  });

  // Appearance Reset
  document.querySelector('#appearance-reset-btn')?.addEventListener('click', () => {
    const defaults = {
      durationSeconds: 20,
      maxMessages: 6,
      fontSize: 21,
      authorFontSize: 16,
      cardWidth: 520,
      borderRadius: 10,
      cardPadding: 10,
      messageGap: 10,
      avatarSize: 42,
      backdropBlur: 0,
      backgroundOpacity: 88,
      accentColor: '#f15f2c',
      textColor: '#ffffff',
      backgroundColor: '#121216',
      showAvatars: true,
      shadow: true,
    };
    syncInputsFromConfig(defaults);
    updatePresetUi('clean');
    triggerSave(true);
  });

  document.querySelector('#appearance-retry-save-btn')?.addEventListener('click', () => {
    triggerSave(true);
  });

  // Scroll to preview top button for compact screens
  const previewScrollTopBtn = document.querySelector('#preview-scroll-top-btn');
  if (previewScrollTopBtn) {
    previewScrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  window.addEventListener('scroll', () => {
    if (!previewScrollTopBtn) return;
    const isAppearance = currentView === 'appearance';
    const isCompact = window.innerWidth < 900;
    const isScrolledDown = window.scrollY > 250;
    setDomDisplay(previewScrollTopBtn, isAppearance && isCompact && isScrolledDown ? 'inline-flex' : 'none');
  }, { passive: true });

  // Paired slider <-> number input wiring
  const pairInputs = (input, slider) => {
    if (!input || !slider) return;
    slider.addEventListener('input', () => {
      input.value = slider.value;
      triggerSave();
    });
    input.addEventListener('input', () => {
      slider.value = input.value;
      triggerSave();
    });
  };

  pairInputs(appearanceInputs.maxMessages, appearanceInputs.maxMessagesSlider);
  pairInputs(appearanceInputs.duration, appearanceInputs.durationSlider);
  pairInputs(appearanceInputs.cardWidth, appearanceInputs.cardWidthSlider);
  pairInputs(appearanceInputs.fontSize, appearanceInputs.fontSizeSlider);
  pairInputs(appearanceInputs.authorFontSize, appearanceInputs.authorFontSizeSlider);
  pairInputs(appearanceInputs.borderRadius, appearanceInputs.borderRadiusSlider);
  pairInputs(appearanceInputs.cardPadding, appearanceInputs.cardPaddingSlider);
  pairInputs(appearanceInputs.messageGap, appearanceInputs.messageGapSlider);
  pairInputs(appearanceInputs.avatarSize, appearanceInputs.avatarSizeSlider);
  pairInputs(appearanceInputs.backdropBlur, appearanceInputs.backdropBlurSlider);

  // Opacity slider
  appearanceInputs.backgroundOpacity?.addEventListener('input', () => {
    triggerSave();
  });

  // Paired color picker <-> hex input
  const pairColors = (picker, text) => {
    if (!picker || !text) return;
    picker.addEventListener('input', () => {
      text.value = picker.value;
      triggerSave();
    });
    text.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) {
        picker.value = text.value.trim();
        triggerSave();
      }
    });
  };

  pairColors(appearanceInputs.accentColor, appearanceInputs.accentColorHex);
  pairColors(appearanceInputs.textColor, appearanceInputs.textColorHex);
  pairColors(appearanceInputs.backgroundColor, appearanceInputs.backgroundColorHex);

  // Checkboxes
  appearanceInputs.alwaysShow?.addEventListener('change', () => {
    const isAlways = appearanceInputs.alwaysShow.checked;
    document.querySelector('#duration-container')?.classList.toggle('disabled', isAlways);
    triggerSave();
  });

  appearanceInputs.showAvatars?.addEventListener('change', () => {
    const show = appearanceInputs.showAvatars.checked;
    const container = document.querySelector('#avatar-size-container');
    if (container) container.classList.toggle('disabled', !show);
    if (appearanceInputs.avatarSize) appearanceInputs.avatarSize.disabled = !show;
    if (appearanceInputs.avatarSizeSlider) appearanceInputs.avatarSizeSlider.disabled = !show;
    triggerSave();
  });

  appearanceInputs.shadow?.addEventListener('change', () => {
    triggerSave();
  });

  // Setup View Actions
  document.querySelector('#setup-open-ext-setup-btn')?.addEventListener('click', () => {
    openExtensionModal('setup');
  });

  document.querySelector('#setup-open-browser-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  document.querySelector('#setup-recheck-btn')?.addEventListener('click', () => {
    checkGraceDeadline = Date.now() + 6000;
    refreshStatus();
  });

  document.querySelector('#setup-open-boosty-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  document.querySelector('#dash-refresh-obs')?.addEventListener('click', async () => {
    const btn = document.querySelector('#dash-refresh-obs');
    btn.disabled = true;
    btn.innerHTML = '<svg class="icon-svg" aria-hidden="true"><use href="#icon-refresh"/></svg>';
    try {
      await loadObsScenes();
    } finally {
      btn.innerHTML = '<svg class="icon-svg" aria-hidden="true"><use href="#icon-refresh"/></svg>';
      btn.disabled = false;
    }
  });

  document.querySelector('#dash-obs-scene')?.addEventListener('change', () => {
    updateObsActionButton('#dash-obs-scene', '#dash-toggle-obs-scene');
  });

  document.querySelector('#dash-toggle-obs-scene')?.addEventListener('click', async () => {
    const resultNode = document.querySelector('#dash-obs-result');
    const select = document.querySelector('#dash-obs-scene');
    const sceneId = select.value;
    if (!sceneId) {
      if (resultNode) resultNode.textContent = 'Сначала выберите сцену в списке.';
      return;
    }

    const currentScene = latestObsScenes.find(s => s.sceneUuid === sceneId);
    const isRemove = Boolean(currentScene && currentScene.hasChat);
    const password = document.querySelector('#dash-obs-password')?.value || '';
    const btn = document.querySelector('#dash-toggle-obs-scene');
    btn.disabled = true;
    btn.textContent = isRemove ? 'Удаляем…' : 'Добавляем…';
    if (resultNode) resultNode.textContent = '';

    try {
      const res = isRemove
        ? await window.boostyOverlay.removeObsScene(password, sceneId)
        : await window.boostyOverlay.addObsScene(password, sceneId);

      if (res.ok) {
        if (resultNode) {
          resultNode.textContent = isRemove
            ? `Чат убран из сцены «${res.removedScene}».`
            : `Готово: источник «Boosty Chat» добавлен в сцену «${res.addedScene}».`;
        }
        await loadObsScenes();
      } else if (res.restartRequired) {
        if (resultNode) resultNode.textContent = 'WebSocket включён в OBS. Перезапустите OBS Studio один раз.';
      } else {
        if (resultNode) resultNode.textContent = `Ошибка: ${res.error || 'Не удалось выполнить команду'}`;
      }
    } catch (err) {
      if (resultNode) resultNode.textContent = `Ошибка: ${err?.message || 'Сбой запроса к OBS'}`;
    } finally {
      btn.disabled = false;
      updateObsActionButton('#dash-obs-scene', '#dash-toggle-obs-scene');
    }
  });

  document.querySelector('#dash-obs-launch-btn-setup')?.addEventListener('click', () => {
    window.boostyOverlay.launchObs();
  });

  // Diagnostics / Extra View Actions
  document.querySelector('#dash-copy-url-btn')?.addEventListener('click', async () => {
    await window.boostyOverlay.copyOverlayUrl();
    const btn = document.querySelector('#dash-copy-url-btn');
    const orig = btn.textContent;
    btn.textContent = 'Скопировано!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  document.querySelector('#dash-restart-onboarding-btn')?.addEventListener('click', () => {
    showView('onboarding');
    setWizardStep(1);
    checkGraceDeadline = Date.now() + 6000;
    refreshStatus();
  });

  // Onboarding Wizard Actions (Preserved)
  document.querySelector('#ob-recheck-btn')?.addEventListener('click', () => {
    checkGraceDeadline = Date.now() + 6000;
    refreshStatus();
  });

  document.querySelector('#ob-open-setup-btn')?.addEventListener('click', async () => {
    const guideBox = document.querySelector('#ob-guide-box');
    setDomDisplay(guideBox, 'block');
    checkGraceDeadline = Date.now() + 8000;
    await extensionFlow.startInstall(selectedBrowser);
    refreshStatus();
  });

  document.querySelector('#ob-open-browser-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  document.querySelector('#ob-copy-url-again-btn')?.addEventListener('click', async () => {
    await extensionFlow.copyUrl(selectedBrowser);
    const btn = document.querySelector('#ob-copy-url-again-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Скопировано!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  document.querySelector('#ob-reopen-folder-btn')?.addEventListener('click', async () => {
    await extensionFlow.openFolder();
  });

  document.querySelector('#ob-reopen-browser-btn')?.addEventListener('click', async () => {
    await extensionFlow.openExtensionsPage(selectedBrowser);
  });

  document.querySelector('#ob-ext-update-btn')?.addEventListener('click', async () => {
    const guideBox = document.querySelector('#ob-guide-box');
    setDomDisplay(guideBox, 'block');
    checkGraceDeadline = Date.now() + 8000;
    await extensionFlow.startInstall(selectedBrowser);
    refreshStatus();
  });

  document.querySelector('#ob-quick-open-boosty-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  document.querySelector('#ob-step1-next-btn')?.addEventListener('click', () => {
    setWizardStep(2);
  });

  document.querySelector('#ob-open-boosty-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  document.querySelector('#ob-step2-prev-btn')?.addEventListener('click', () => {
    setWizardStep(1);
  });

  document.querySelector('#ob-step2-next-btn')?.addEventListener('click', () => {
    setWizardStep(3);
  });

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
    btn.innerHTML = '<svg class="icon-svg" aria-hidden="true"><use href="#icon-refresh"/></svg><span>Обновляем…</span>';
    try {
      await loadObsScenes();
    } finally {
      btn.innerHTML = '<svg class="icon-svg" aria-hidden="true"><use href="#icon-refresh"/></svg><span>Обновить</span>';
      btn.disabled = false;
    }
  });

  document.querySelector('#ob-add-obs-btn')?.addEventListener('click', async () => {
    const select = document.querySelector('#ob-obs-scene-select');
    const resultNode = document.querySelector('#ob-obs-result');
    const sceneId = select.value;
    if (!sceneId) {
      if (resultNode) resultNode.textContent = 'Сначала выберите сцену из списка.';
      return;
    }

    const password = document.querySelector('#ob-obs-password')?.value || '';
    const btn = document.querySelector('#ob-add-obs-btn');
    btn.disabled = true;
    btn.textContent = 'Добавляем…';
    if (resultNode) resultNode.textContent = '';

    try {
      const res = await window.boostyOverlay.addObsScene(password, sceneId);
      if (res.ok) {
        addedSceneName = res.addedScene;
        if (resultNode) resultNode.textContent = `✓ Чат успешно добавлен в сцену «${res.addedScene}».`;
        await loadObsScenes();
      } else if (res.restartRequired) {
        if (resultNode) resultNode.textContent = 'WebSocket включён. Перезапустите OBS Studio один раз.';
      } else {
        if (resultNode) resultNode.textContent = `Ошибка: ${res.error || 'Не удалось добавить источник'}`;
      }
    } catch (err) {
      if (resultNode) resultNode.textContent = `Ошибка: ${err?.message || 'Сбой запроса к OBS'}`;
    } finally {
      btn.disabled = false;
      updateObsActionButton('#ob-obs-scene-select', '#ob-add-obs-btn');
      updateObsStep3State();
    }
  });

  document.querySelector('#ob-obs-scene-select')?.addEventListener('change', () => {
    updateObsActionButton('#ob-obs-scene-select', '#ob-add-obs-btn');
  });

  document.querySelector('#ob-step3-prev-btn')?.addEventListener('click', () => {
    setWizardStep(2);
  });

  document.querySelector('#ob-step3-next-btn')?.addEventListener('click', () => {
    setWizardStep(4);
  });

  document.querySelector('#ob-test-btn')?.addEventListener('click', () => {
    fetch(`${getApiOrigin()}/test`).catch(() => {});
  });

  document.querySelector('#ob-finish-btn')?.addEventListener('click', () => {
    localStorage.setItem('onboardingCompleted', 'true');
    onboardingCompleted = true;
    showView('dashboard');
  });

  // Modal actions
  document.querySelector('#modal-close-btn')?.addEventListener('click', closeExtensionModal);
  document.querySelector('#modal-done-btn')?.addEventListener('click', closeExtensionModal);
  document.querySelector('#dash-ext-modal')?.addEventListener('click', e => {
    if (e.target.id === 'dash-ext-modal') closeExtensionModal();
  });

  document.querySelector('#modal-start-setup-btn')?.addEventListener('click', async () => {
    const modalGuide = document.querySelector('#modal-guide-box');
    setDomDisplay(modalGuide, 'block');
    checkGraceDeadline = Date.now() + 8000;
    await extensionFlow.startInstall(selectedBrowser);
    refreshStatus();
  });

  document.querySelector('#modal-recheck-btn')?.addEventListener('click', () => {
    checkGraceDeadline = Date.now() + 6000;
    refreshStatus();
  });

  document.querySelector('#modal-copy-url-btn')?.addEventListener('click', async () => {
    await extensionFlow.copyUrl(selectedBrowser);
    const btn = document.querySelector('#modal-copy-url-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Скопировано!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  document.querySelector('#modal-open-folder-btn')?.addEventListener('click', async () => {
    await extensionFlow.openFolder();
  });

  document.querySelector('#modal-open-browser-btn')?.addEventListener('click', async () => {
    await extensionFlow.openExtensionsPage(selectedBrowser);
  });
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

function openExtensionModal(mode = 'setup') {
  const modal = document.querySelector('#dash-ext-modal');
  const modalGuide = document.querySelector('#modal-guide-box');
  const modalDoneBtn = document.querySelector('#modal-done-btn');
  const modalStartBtn = document.querySelector('#modal-start-setup-btn');

  if (!modal) return;
  modal.style.display = 'flex';

  if (mode === 'update') {
    setDomDisplay(modalGuide, 'block');
    setDomDisplay(modalDoneBtn, 'inline-flex');
    setDomDisplay(modalStartBtn, 'none');
  } else {
    setDomDisplay(modalGuide, 'none');
    setDomDisplay(modalDoneBtn, 'none');
    setDomDisplay(modalStartBtn, 'inline-flex');
  }
}

function closeExtensionModal() {
  const modal = document.querySelector('#dash-ext-modal');
  if (modal) modal.style.display = 'none';
}

// --- Health Status Refresh ---
async function refreshStatus() {
  try {
    let health;
    if (window.boostyAudit && window.__AUDIT_HEALTH_MOCK__) {
      health = window.__AUDIT_HEALTH_MOCK__;
    } else {
      const response = await fetch(`${getApiOrigin()}/health`);
      health = await response.json();
    }
    latestHealth = health;

    const isExtActive = Boolean(health.extensionConnected);
    const isBoostyActive = Boolean(health.boostyConnected);
    const isOutdated = Boolean(health.isOutdated);

    if (isExtActive) {
      checkGraceDeadline = 0;
    }
    const isChecking = !isExtActive && Date.now() < checkGraceDeadline;

    // Dashboard connection summary pills
    const dashExtPill = document.querySelector('#dash-ext-pill');
    const dashExtText = document.querySelector('#dash-ext-text');
    const dashBoostyPill = document.querySelector('#dash-boosty-pill');
    const dashBoostyText = document.querySelector('#dash-boosty-text');

    if (dashExtPill) {
      if (isExtActive) {
        setDomClass(dashExtPill, 'summary-pill ready');
        setDomText(dashExtText, health.extensionVersion ? `Подключено (v${health.extensionVersion})` : 'Подключено');
      } else if (isChecking) {
        setDomClass(dashExtPill, 'summary-pill pending');
        setDomText(dashExtText, 'Проверка…');
      } else {
        setDomClass(dashExtPill, 'summary-pill pending');
        setDomText(dashExtText, 'Не обнаружено');
      }
    }

    if (dashBoostyPill) {
      if (isBoostyActive) {
        setDomClass(dashBoostyPill, 'summary-pill ready');
        setDomText(dashBoostyText, 'Стрим открыт');
      } else if (isExtActive) {
        setDomClass(dashBoostyPill, 'summary-pill pending');
        setDomText(dashBoostyText, 'Не открыт');
      } else {
        setDomClass(dashBoostyPill, 'summary-pill pending');
        setDomText(dashBoostyText, 'Недоступно');
      }
    }

    // Setup view status cards
    const setupExtBadge = document.querySelector('#setup-ext-badge');
    const setupBoostyBadge = document.querySelector('#setup-boosty-badge');
    const setupBoostyUrl = document.querySelector('#setup-boosty-url');

    if (setupExtBadge) {
      if (isExtActive) {
        setDomClass(setupExtBadge, 'badge connected');
        setDomText(setupExtBadge, health.extensionVersion ? `Установлено (v${health.extensionVersion})` : 'Установлено');
      } else if (isChecking) {
        setDomClass(setupExtBadge, 'badge checking');
        setDomText(setupExtBadge, 'Проверка…');
      } else {
        setDomClass(setupExtBadge, 'badge pending');
        setDomText(setupExtBadge, 'Не установлено');
      }
    }

    if (setupBoostyBadge) {
      if (isBoostyActive) {
        setDomClass(setupBoostyBadge, 'badge connected');
        setDomText(setupBoostyBadge, 'Стрим открыт');
      } else {
        setDomClass(setupBoostyBadge, 'badge pending');
        setDomText(setupBoostyBadge, 'Не открыт');
      }
    }

    if (setupBoostyUrl) {
      if (isBoostyActive) {
        const cleanUrl = health.boostyTabUrl ? health.boostyTabUrl.replace(/^https?:\/\/(www\.)?boosty\.to\//, '') : 'Вкладка активна';
        setDomText(setupBoostyUrl, cleanUrl);
      } else {
        setDomText(setupBoostyUrl, 'Не обнаружена');
      }
    }

    // Diagnostics / Tech details
    const techExt = document.querySelector('#tech-ext-status');
    const techBoosty = document.querySelector('#tech-boosty-status');
    const techMsg = document.querySelector('#tech-msg-count');
    const techObs = document.querySelector('#tech-obs-status');
    const techPort = document.querySelector('#tech-port');
    const techUrl = document.querySelector('#tech-overlay-url');

    if (techExt) setDomText(techExt, isExtActive ? `Активно (v${health.extensionVersion || '?'})` : 'Не активно');
    if (techBoosty) setDomText(techBoosty, isBoostyActive ? 'Вкладка активна' : 'Не открыта');
    if (techMsg) setDomText(techMsg, String(health.receivedMessages || 0));
    if (techObs) setDomText(techObs, latestObsStatus?.connected ? 'Подключено' : 'Отключено');
    if (techPort) setDomText(techPort, String(new URL(getApiOrigin()).port || 17369));
    if (techUrl) setDomText(techUrl, `${getApiOrigin()}/overlay/`);

    // Onboarding step 1 status
    const obExtBadge = document.querySelector('#ob-ext-status-badge');
    const obExtText = document.querySelector('#ob-ext-status-text');
    const obExtHint = document.querySelector('#ob-ext-hint');
    const obExtSuccess = document.querySelector('#ob-ext-success-msg');
    const obExtBoostySub = document.querySelector('#ob-ext-boosty-substatus');
    const obExtWarning = document.querySelector('#ob-ext-version-warning');
    const obNotDetectedBox = document.querySelector('#ob-not-detected-box');
    const obGuideBox = document.querySelector('#ob-guide-box');
    const obConnectedActions = document.querySelector('#ob-connected-actions');

    if (obExtBadge) {
      if (isExtActive) {
        setDomClass(obExtBadge, 'badge connected');
        setDomText(obExtText, health.extensionVersion ? `Расширение подключено (v${health.extensionVersion})` : 'Расширение подключено');
        setDomDisplay(obExtSuccess, 'block');
        setDomDisplay(obNotDetectedBox, 'none');
        setDomDisplay(obGuideBox, 'none');
        setDomDisplay(obConnectedActions, isBoostyActive ? 'none' : 'flex');
      } else if (isChecking) {
        setDomClass(obExtBadge, 'badge checking');
        setDomText(obExtText, 'Проверяем расширение…');
        setDomDisplay(obExtSuccess, 'none');
        setDomDisplay(obNotDetectedBox, 'none');
        setDomDisplay(obGuideBox, 'none');
      } else {
        setDomClass(obExtBadge, 'badge pending');
        setDomText(obExtText, 'Расширение не обнаружено');
        setDomDisplay(obExtSuccess, 'none');
        setDomDisplay(obNotDetectedBox, 'block');
      }
    }

    const obStep1Btn = document.querySelector('#ob-step1-next-btn');
    const obStep1Reason = document.querySelector('#ob-step1-reason');
    if (obStep1Btn) {
      obStep1Btn.disabled = !isExtActive;
    }
    if (obStep1Reason) {
      setDomDisplay(obStep1Reason, isExtActive ? 'none' : 'inline');
    }

    // Modal status
    const modalBadge = document.querySelector('#modal-ext-badge');
    const modalText = document.querySelector('#modal-ext-text');
    const modalSuccess = document.querySelector('#modal-ext-success-msg');
    const modalGuide = document.querySelector('#modal-guide-box');
    const modalDoneBtn = document.querySelector('#modal-done-btn');
    const modalStartBtn = document.querySelector('#modal-start-setup-btn');

    if (modalBadge) {
      if (isExtActive) {
        setDomClass(modalBadge, 'badge connected');
        setDomText(modalText, 'Расширение подключено');
        setDomDisplay(modalSuccess, 'block');
        setDomDisplay(modalGuide, 'none');
        setDomDisplay(modalDoneBtn, 'inline-flex');
        setDomDisplay(modalStartBtn, 'none');
      } else {
        setDomClass(modalBadge, 'badge pending');
        setDomText(modalText, 'Расширение не обнаружено');
        setDomDisplay(modalSuccess, 'none');
        setDomDisplay(modalDoneBtn, 'none');
        setDomDisplay(modalStartBtn, 'inline-flex');
      }
    }

    updateContextualActionCard();
    if (window.boostyAudit) {
      updateAuditDiagnosticState();
    }
  } catch (err) {
    // Network or offline
  }
}

// --- Audit Diagnostic State ---
function updateAuditDiagnosticState() {
  if (!window.boostyAudit) return;
  const isExtConnected = Boolean(latestHealth?.extensionConnected);
  const isBoostyConnected = Boolean(latestHealth?.boostyConnected);
  const isObsConnected = Boolean(latestObsStatus?.connected);
  const onboardingVisible = document.querySelector('#onboarding-view')?.style.display !== 'none';
  const activeView = onboardingVisible ? 'onboarding' : (currentView || 'main');

  const isReady = isExtConnected && isBoostyConnected && isObsConnected;
  const bannerVisible = !isReady;

  window.__UI_AUDIT_RENDER_STATE__ = {
    view: activeView === 'dashboard' ? 'main' : activeView,
    step: currentStep,
    obsConnected: isObsConnected,
    extensionConnected: isExtConnected,
    boostyConnected: isBoostyConnected,
    bannerVisible,
    receivedMessages: latestHealth?.receivedMessages || 0,
    activePreset: detectActivePreset(gatherCurrentConfig()),
  };
}

// --- App Initialization ---
async function init() {
  try {
    setupEventListeners();
    await renderBrowserSelection();

    // Fetch dynamic app version (Directive 11)
    try {
      if (window.boostyOverlay?.getAppVersion) {
        appVersion = await window.boostyOverlay.getAppVersion();
      }
    } catch {}

    const versionBadge = document.querySelector('#app-version-badge');
    const techAppVersion = document.querySelector('#tech-app-version');
    if (versionBadge) versionBadge.textContent = `v${appVersion}`;
    if (techAppVersion) techAppVersion.textContent = appVersion;

    await loadSettings();

    if (onboardingCompleted) {
      showView('dashboard');
    } else {
      showView('onboarding');
      setWizardStep(1);
    }

    await refreshStatus();
    setInterval(refreshStatus, 1200);
    await loadObsScenes();
  } catch (err) {
    console.error('Init error:', err);
  } finally {
    window.__APP_INITIALIZED__ = true;
  }
}

const initPromise = init();

// --- UI Audit Automation Hook ---
if (window.boostyAudit) {
  window.boostyAudit.onApplyState(async state => {
    await initPromise;
    const mock = state.mock || {};

    if (mock.health) {
      window.__AUDIT_HEALTH_MOCK__ = { ...mock.health };
      latestHealth = { ...mock.health };
      checkGraceDeadline = mock.isChecking ? Date.now() + 10000 : 0;
      await refreshStatus();
    }

    if (mock.obs) {
      renderObsUi(mock.obs);
    }

    if (mock.view) {
      if (mock.view === 'main' || mock.view === 'dashboard') {
        showView(mock.focusSettings ? 'appearance' : 'dashboard');
      } else {
        showView(mock.view);
      }
    }

    if (mock.step) {
      setWizardStep(mock.step);
      if (mock.step === 1) {
        await renderBrowserSelection();
        const obNotDetectedBox = document.querySelector('#ob-not-detected-box');
        if (obNotDetectedBox && !latestHealth?.extensionConnected) {
          setDomDisplay(obNotDetectedBox, 'block');
        }
      }
    }

    if (mock.config) {
      syncInputsFromConfig(mock.config);
      const effectiveConfig = gatherCurrentConfig();
      sendConfigToPreview(effectiveConfig);
      updatePresetUi(detectActivePreset(effectiveConfig));
    }

    updateContextualActionCard();
    updateAuditDiagnosticState();

    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  document.fonts.ready.then(() => {
    window.boostyAudit.notifyReady();
  });
}
