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
let hasObsExecutableCached = true;

// --- Connectivity Progress & ETA Timing State ---
const appStartTime = Date.now();
let serverReadyAt = appStartTime;
let extensionDetectedAt = null;
let boostyTabDetectedAt = null;
let chatDetectedAt = null;
let readyAt = null;
let reconnectStartTime = null;
let recoveryDurationMs = null;
let recoveryTimestamp = null;
let simulatedStartupTiming = null;
let progressTicker = null;
const RECOVERY_FLASH_DURATION_MS = 2000;

function getStartupElapsedMs() {
  if (simulatedStartupTiming && typeof simulatedStartupTiming.elapsedMs === 'number') {
    return simulatedStartupTiming.elapsedMs;
  }
  if (reconnectStartTime) {
    return Date.now() - reconnectStartTime;
  }
  return Date.now() - appStartTime;
}

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
  async copyPath() {
    return await window.boostyOverlay?.copyExtensionPath?.();
  },
  async getInfo() {
    return await window.boostyOverlay?.getExtensionInfo?.();
  },
  async openFolder() {
    return await window.boostyOverlay.openExtensionFolder();
  },
  async openExtensionsPage(browserId) {
    return await window.boostyOverlay.openBrowserExtensionsPage(browserId);
  },
};

function getApiOrigin() {
  return window.BOOSTY_API_ORIGIN || window.boostyOverlay?.apiOrigin || 'http://127.0.0.1:17369';
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
    updatePreviewScale();
    initDragAndDropPositioning();
    updateHitboxGeometry();
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

function renderStatusHubUi() {
  if (typeof BoostyStatusHub === 'undefined' || typeof BoostyStatusHub.deriveSystemStatus !== 'function') {
    return;
  }

  const isExtActive = Boolean(latestHealth && (latestHealth.extensionConnected || latestHealth.extension?.state === 'connected'));
  const isBoostyActive = Boolean(latestHealth && (latestHealth.boostyConnected || latestHealth.boosty?.state === 'chat-detected' || latestHealth.boosty?.state === 'tab-detected'));
  const isChecking = (!isExtActive || !isBoostyActive) && Date.now() < checkGraceDeadline;

  const obsState = {
    ...(latestObsStatus || {}),
    scenes: (latestObsStatus && Array.isArray(latestObsStatus.scenes) && latestObsStatus.scenes.length > 0)
      ? latestObsStatus.scenes
      : (latestObsScenes || []),
  };

  const elapsedMs = getStartupElapsedMs();
  const isRecoveredRecently = simulatedStartupTiming?.isRecoveredRecently !== undefined
    ? simulatedStartupTiming.isRecoveredRecently
    : Boolean(recoveryTimestamp && (Date.now() - recoveryTimestamp < RECOVERY_FLASH_DURATION_MS));

  const effRecoveryDuration = simulatedStartupTiming?.recoveryDurationMs !== undefined
    ? simulatedStartupTiming.recoveryDurationMs
    : recoveryDurationMs;

  const derived = BoostyStatusHub.deriveSystemStatus({
    health: latestHealth || {},
    obs: obsState,
    hasObsExecutable: typeof hasObsExecutableCached === 'boolean' ? hasObsExecutableCached : true,
    isChecking,
    elapsedMs,
    recoveryDurationMs: effRecoveryDuration,
    isRecoveredRecently,
  });

  // 1. OBS Pill
  const dashObsPill = document.querySelector('#dash-obs-pill');
  const dashObsText = document.querySelector('#dash-obs-text');
  const dashObsDetail = document.querySelector('#dash-obs-detail');
  const dashObsLaunchBtn = document.querySelector('#dash-obs-launch-btn');

  if (dashObsPill) {
    setDomClass(dashObsPill, `summary-pill ${derived.obs.badgeClass}`);
    setDomText(dashObsText, derived.obs.text);
    if (dashObsDetail) setDomText(dashObsDetail, derived.obs.detail);

    if (dashObsLaunchBtn) {
      if (derived.obs.action) {
        setDomDisplay(dashObsLaunchBtn, 'inline-flex');
        setDomText(dashObsLaunchBtn, derived.obs.action.label);
        dashObsLaunchBtn.setAttribute('data-action-id', derived.obs.action.id);
      } else {
        setDomDisplay(dashObsLaunchBtn, 'none');
      }
    }
  }

  // 2. Extension Pill
  const dashExtPill = document.querySelector('#dash-ext-pill');
  const dashExtText = document.querySelector('#dash-ext-text');
  const dashExtDetail = document.querySelector('#dash-ext-detail');
  const dashExtFixBtn = document.querySelector('#dash-ext-fix-btn');

  if (dashExtPill) {
    setDomClass(dashExtPill, `summary-pill ${derived.extension.badgeClass}`);
    setDomText(dashExtText, derived.extension.text);
    if (dashExtDetail) setDomText(dashExtDetail, derived.extension.detail);

    if (dashExtFixBtn) {
      if (derived.extension.action) {
        setDomDisplay(dashExtFixBtn, 'inline-flex');
        setDomText(dashExtFixBtn, derived.extension.action.label);
        dashExtFixBtn.setAttribute('data-action-id', derived.extension.action.id);
      } else {
        setDomDisplay(dashExtFixBtn, 'none');
      }
    }
  }

  // 3. Boosty Pill
  const dashBoostyPill = document.querySelector('#dash-boosty-pill');
  const dashBoostyText = document.querySelector('#dash-boosty-text');
  const dashBoostyDetail = document.querySelector('#dash-boosty-detail');
  const dashBoostyOpenBtn = document.querySelector('#dash-boosty-open-btn');

  if (dashBoostyPill) {
    setDomClass(dashBoostyPill, `summary-pill ${derived.stream.badgeClass}`);
    setDomText(dashBoostyText, derived.stream.text);
    if (dashBoostyDetail) setDomText(dashBoostyDetail, derived.stream.detail);

    if (dashBoostyOpenBtn) {
      if (derived.stream.action) {
        setDomDisplay(dashBoostyOpenBtn, 'inline-flex');
        setDomText(dashBoostyOpenBtn, derived.stream.action.label);
        dashBoostyOpenBtn.setAttribute('data-action-id', derived.stream.action.id);
      } else {
        setDomDisplay(dashBoostyOpenBtn, 'none');
      }
    }
  }

  // 4. Overlay Pill
  const dashOverlayPill = document.querySelector('#dash-overlay-pill');
  const dashOverlayText = document.querySelector('#dash-overlay-text');
  const dashOverlayDetail = document.querySelector('#dash-overlay-detail');
  const dashOverlayActionBtn = document.querySelector('#dash-overlay-action-btn');

  if (dashOverlayPill) {
    setDomClass(dashOverlayPill, `summary-pill ${derived.overlay.badgeClass}`);
    setDomText(dashOverlayText, derived.overlay.text);
    if (dashOverlayDetail) setDomText(dashOverlayDetail, derived.overlay.detail);

    if (dashOverlayActionBtn) {
      if (derived.overlay.action) {
        setDomDisplay(dashOverlayActionBtn, 'inline-flex');
        setDomText(dashOverlayActionBtn, derived.overlay.action.label);
        dashOverlayActionBtn.setAttribute('data-action-id', derived.overlay.action.id);
      } else {
        setDomDisplay(dashOverlayActionBtn, 'none');
      }
    }
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
  const setupLaunchBtn = document.querySelector('#dash-obs-launch-btn-setup');

  const isConnected = Boolean(result && result.ok && result.connected);

  renderStatusHubUi();

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
    updateObsCanvasStatusUi(null);
    updateContextualActionCard();
    renderStatusHubUi();
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
  updateObsCanvasStatusUi(result);
  updateContextualActionCard();
  renderStatusHubUi();
}

function updateObsCanvasStatusUi(result) {
  const canvasPanel = document.querySelector('#obs-canvas-status-panel');
  const panelIndicator = document.querySelector('#obs-canvas-status-indicator');
  const panelTitle = document.querySelector('#obs-canvas-status-title');
  const panelDesc = document.querySelector('#obs-canvas-status-desc');
  const panelBtn = document.querySelector('#obs-fit-canvas-btn');

  const layoutHint = document.querySelector('#layout-canvas-hint');
  const layoutIcon = document.querySelector('#layout-canvas-hint-icon');
  const layoutText = document.querySelector('#layout-canvas-hint-text');
  const layoutBtn = document.querySelector('#layout-fit-canvas-btn');

  const isConnected = Boolean(result && result.ok && result.connected);

  if (!isConnected) {
    if (canvasPanel) setDomDisplay(canvasPanel, 'none');
    if (layoutHint) setDomClass(layoutHint, 'layout-canvas-hint');
    if (layoutIcon) setDomText(layoutIcon, '💡');
    if (layoutText) {
      setDomText(layoutText, 'Положение чата рассчитывается относительно области Browser Source в OBS. Для предсказуемого результата источник рекомендуется подогнать под весь холст OBS.');
    }
    if (layoutBtn) setDomDisplay(layoutBtn, 'none');
    return;
  }

  const cs = result?.canvasStatus || {};
  const isCanonical = cs.canonical !== false;
  const baseW = cs.baseWidth || 1920;
  const baseH = cs.baseHeight || 1080;
  const inputW = cs.inputWidth || baseW;
  const inputH = cs.inputHeight || baseH;
  const scaleX = cs.scaleX;

  if (canvasPanel) setDomDisplay(canvasPanel, 'flex');

  if (isCanonical) {
    if (canvasPanel) setDomClass(canvasPanel, 'canvas-status-panel canonical');
    if (panelIndicator) setDomText(panelIndicator, '✓');
    if (panelTitle) setDomText(panelTitle, `Размер оверлея совпадает с холстом OBS (${baseW}×${baseH})`);
    if (panelDesc) setDomText(panelDesc, 'Источник отображается 1:1 без искажений. Настроено правильно.');
    if (panelBtn) setDomDisplay(panelBtn, 'none');

    if (layoutHint) setDomClass(layoutHint, 'layout-canvas-hint canonical');
    if (layoutIcon) setDomText(layoutIcon, '✓');
    if (layoutText) {
      setDomText(layoutText, `Оверлей занимает весь холст OBS (${baseW}×${baseH}) — положение чата на стриме совпадает с предпросмотром.`);
    }
    if (layoutBtn) setDomDisplay(layoutBtn, 'none');
  } else {
    if (canvasPanel) setDomClass(canvasPanel, 'canvas-status-panel warning');
    if (panelIndicator) setDomText(panelIndicator, '⚠');
    if (panelTitle) setDomText(panelTitle, 'Размер источника в OBS отличается от холста');
    const scaleInfo = (scaleX && Math.abs(scaleX - 1) > 0.01) ? `, масштаб: ${Number(scaleX).toFixed(2)}×` : '';
    if (panelDesc) {
      setDomText(panelDesc, `Холст: ${baseW}×${baseH}, источник: ${inputW}×${inputH}${scaleInfo}. Текст и позиция могут масштабироваться средствами OBS.`);
    }
    if (panelBtn) setDomDisplay(panelBtn, 'inline-flex');

    if (layoutHint) setDomClass(layoutHint, 'layout-canvas-hint warning');
    if (layoutIcon) setDomText(layoutIcon, '⚠');
    if (layoutText) {
      setDomText(layoutText, `Размер источника в OBS (${inputW}×${inputH}) отличается от холста (${baseW}×${baseH}). Из-за этого текст и позиция могут масштабироваться средствами OBS.`);
    }
    if (layoutBtn) setDomDisplay(layoutBtn, 'inline-block');
  }
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
  const isExtActive = Boolean(latestHealth && (latestHealth.extensionConnected || latestHealth.extension?.state === 'connected'));
  const isBoostyActive = Boolean(latestHealth && (latestHealth.boostyConnected || latestHealth.boosty?.state === 'chat-detected' || latestHealth.boosty?.state === 'tab-detected'));
  const isChecking = (!isExtActive || !isBoostyActive) && Date.now() < checkGraceDeadline;

  const obsState = {
    ...(latestObsStatus || {}),
    scenes: (latestObsStatus && Array.isArray(latestObsStatus.scenes) && latestObsStatus.scenes.length > 0)
      ? latestObsStatus.scenes
      : (latestObsScenes || []),
  };

  const elapsedMs = getStartupElapsedMs();
  const isRecoveredRecently = simulatedStartupTiming?.isRecoveredRecently !== undefined
    ? simulatedStartupTiming.isRecoveredRecently
    : Boolean(recoveryTimestamp && (Date.now() - recoveryTimestamp < RECOVERY_FLASH_DURATION_MS));

  const effRecoveryDuration = simulatedStartupTiming?.recoveryDurationMs !== undefined
    ? simulatedStartupTiming.recoveryDurationMs
    : recoveryDurationMs;

  if (typeof BoostyStatusHub !== 'undefined' && typeof BoostyStatusHub.deriveSystemStatus === 'function') {
    const derived = BoostyStatusHub.deriveSystemStatus({
      health: latestHealth || {},
      obs: obsState,
      hasObsExecutable: typeof hasObsExecutableCached === 'boolean' ? hasObsExecutableCached : true,
      isChecking,
      elapsedMs,
      recoveryDurationMs: effRecoveryDuration,
      isRecoveredRecently,
    });
    return derived.overall;
  }

  if (isChecking) {
    return { status: 'connecting', title: 'Восстанавливаем подключение', desc: 'Проверяем браузер и расширение…' };
  }
  if (isExtActive && isBoostyActive && Boolean(latestObsStatus?.connected)) {
    return { status: 'ready', title: 'Готово к стриму', desc: 'Boosty и OBS подключены' };
  }
  return { status: 'setup-required', title: 'Требуется настройка', desc: 'Подключите компоненты для запуска чата' };
}

function updateContextualActionCard() {
  const readiness = getSystemReadiness();
  const readinessBanner = document.querySelector('#readiness-status');
  const readinessTitle = document.querySelector('#readiness-title');
  const readinessDesc = document.querySelector('#readiness-desc');
  const milestonesContainer = document.querySelector('#readiness-milestones');
  const progressEtaContainer = document.querySelector('#readiness-progress-eta');
  const elapsedEl = document.querySelector('#readiness-elapsed');
  const expectedEl = document.querySelector('#readiness-expected');

  if (readinessBanner) {
    let bannerClasses = `readiness-banner ${readiness.status}`;
    if (readiness.progress?.isLongerThanUsual) {
      bannerClasses += ' longer-than-usual';
    }
    if (readiness.progress?.phase === 'recovered') {
      bannerClasses += ' recovered';
    }
    setDomClass(readinessBanner, bannerClasses);
  }

  if (readinessTitle) setDomText(readinessTitle, readiness.title);

  if (readiness.status === 'connecting' && readiness.progress?.milestones?.length) {
    if (readinessDesc) setDomDisplay(readinessDesc, 'none');
    if (milestonesContainer) {
      setDomDisplay(milestonesContainer, 'flex');
      milestonesContainer.innerHTML = '';
      for (const m of readiness.progress.milestones) {
        const item = document.createElement('span');
        item.className = `milestone ${m.state}`;
        const iconSymbol = m.state === 'done' ? '✓' : (m.state === 'active' ? '●' : '○');
        item.innerHTML = `<span class="m-icon">${iconSymbol}</span> <span>${m.label}</span>`;
        milestonesContainer.append(item);
      }
    }
    if (progressEtaContainer) {
      setDomDisplay(progressEtaContainer, 'flex');
      if (elapsedEl) setDomText(elapsedEl, readiness.progress.elapsedText || '');
      if (expectedEl) setDomText(expectedEl, readiness.progress.expectedText || '');
    }
  } else {
    if (milestonesContainer) setDomDisplay(milestonesContainer, 'none');
    if (progressEtaContainer) setDomDisplay(progressEtaContainer, 'none');
    if (readinessDesc) {
      setDomDisplay(readinessDesc, 'block');
      setDomText(readinessDesc, readiness.desc);
    }
  }

  const isExtConnected = Boolean(latestHealth && (latestHealth.extensionConnected || latestHealth.extension?.state === 'connected'));
  const isBoostyConnected = Boolean(latestHealth && (latestHealth.boostyConnected || latestHealth.boosty?.state === 'chat-detected' || latestHealth.boosty?.state === 'tab-detected'));
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

  if (isChecking) {
    if (icon) icon.innerHTML = '<svg class="icon-svg icon-lg" aria-hidden="true"><use href="#icon-clock"/></svg>';
    if (title) setDomText(title, readiness.title || 'Восстанавливаем подключение');
    if (desc) setDomText(desc, readiness.desc || 'Проверяем браузер и расширение…');
    return;
  }

  if (!isExtConnected) {
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

  if (!isBoostyConnected) {
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

  if (!isObsConnected) {
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
    author: 'Мария',
    text: 'Очень крутой момент сейчас был!',
    avatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%238b5cf6"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">М</text></svg>',
  },
  {
    id: 'prev-3',
    author: 'Streamer_123',
    text: '🚀🎉',
    avatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%2310b981"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">S</text></svg>',
  },
  {
    id: 'prev-4',
    author: 'ОченьДлинноеИмяПользователя',
    text: 'Проверяем, как выглядит более длинное сообщение в несколько строк.',
    avatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%233a86ff"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">О</text></svg>',
  },
];

let previewReady = false;

function updatePreviewScale() {
  const backdrop = document.querySelector('#preview-backdrop');
  if (!backdrop) return;
  const w = backdrop.clientWidth;
  const h = backdrop.clientHeight;
  if (!w || !h) return;
  const scale = Math.min(w / 1920, h / 1080);
  backdrop.style.setProperty('--preview-scale', String(scale));
}

function initPreviewIframe() {
  updatePreviewScale();
  const iframe = document.querySelector('#preview-iframe');
  if (!iframe) return;

  const targetSrc = `${getApiOrigin()}/overlay/preview.html`;
  if (!iframe.src || !iframe.src.includes('/overlay/preview.html')) {
    iframe.src = targetSrc;
    iframe.onload = () => {
      previewReady = true;
      updatePreviewScale();
      sendFixturesToPreview();
      sendConfigToPreview(gatherCurrentConfig());
    };
  } else if (previewReady) {
    updatePreviewScale();
    sendConfigToPreview(gatherCurrentConfig());
  }
}

// --- Positioning Math Reference ---
const Positioning = (typeof BoostyPositioning !== 'undefined')
  ? BoostyPositioning
  : (typeof require === 'function' ? require('../core/layout/positioning.js') : null);

// --- Stream Profiles Reference ---
const Profiles = (typeof BoostyProfiles !== 'undefined')
  ? BoostyProfiles
  : (typeof require === 'function' ? require('../core/config/profiles.js') : null);

// --- Visual Overlay Positioning Drag & Drop State ---
let isHitboxDragging = false;
let dragPointerId = null;
let dragGrabOffsetX = 0;
let dragGrabOffsetY = 0;
let currentHitboxBox = { left: 20, top: 800, width: 548, height: 260 };

function getHitboxElements() {
  return {
    hitbox: document.querySelector('#chat-drag-hitbox'),
    dragLayer: document.querySelector('#preview-drag-layer'),
    wrapper: document.querySelector('#preview-scale-wrapper'),
    backdrop: document.querySelector('#preview-backdrop'),
    guideX: document.querySelector('#guide-center-x'),
    guideY: document.querySelector('#guide-center-y'),
    badgeAnchor: document.querySelector('#drag-badge-anchor'),
    badgeCoords: document.querySelector('#drag-badge-coords'),
    iframe: document.querySelector('#preview-iframe'),
  };
}

function updateBadgeText(anchorText, offsetX, offsetY) {
  const { badgeAnchor, badgeCoords } = getHitboxElements();
  if (badgeAnchor) setDomText(badgeAnchor, anchorText);
  if (badgeCoords) setDomText(badgeCoords, `X: ${offsetX} · Y: ${offsetY}`);
}

function updateHitboxGeometry(config = gatherCurrentConfig()) {
  const { hitbox, iframe } = getHitboxElements();
  if (!hitbox || !Positioning) return;

  let boxWidth = (config.cardWidth || 520) + 28;
  let boxHeight = 260;

  try {
    const doc = iframe?.contentDocument;
    const container = doc?.querySelector('#messages');
    if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
      boxWidth = container.offsetWidth;
      boxHeight = container.offsetHeight;
    }
  } catch {}

  const pos = Positioning.positionFromConfig(config, { width: boxWidth, height: boxHeight });
  hitbox.style.left = `${pos.left}px`;
  hitbox.style.top = `${pos.top}px`;
  hitbox.style.width = `${pos.width}px`;
  hitbox.style.height = `${pos.height}px`;
  hitbox.classList.toggle('badge-bottom', pos.top < 60);

  currentHitboxBox = { left: pos.left, top: pos.top, width: pos.width, height: pos.height };
  const cornerKey = `${config.horizontalAnchor || 'left'}-${config.verticalAnchor || 'bottom'}`;
  updateBadgeText(CORNER_LABELS[cornerKey] || 'Слева снизу', config.offsetX, config.offsetY);
}

let dragDropInitialized = false;

function initDragAndDropPositioning() {
  if (dragDropInitialized) return;
  const { hitbox, wrapper, guideX, guideY, iframe, dragLayer } = getHitboxElements();
  if (!hitbox || !wrapper || !Positioning) return;
  dragDropInitialized = true;

  function onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();

    isHitboxDragging = true;
    dragPointerId = event.pointerId;

    if (typeof hitbox.setPointerCapture === 'function') {
      try {
        hitbox.setPointerCapture(event.pointerId);
      } catch {}
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const scale = Math.min(wrapperRect.width / 1920, wrapperRect.height / 1080) || 1;
    const logicalX = (event.clientX - wrapperRect.left) / scale;
    const logicalY = (event.clientY - wrapperRect.top) / scale;

    const currentLeft = parseFloat(hitbox.style.left) || currentHitboxBox.left || 0;
    const currentTop = parseFloat(hitbox.style.top) || currentHitboxBox.top || 0;

    dragGrabOffsetX = logicalX - currentLeft;
    dragGrabOffsetY = logicalY - currentTop;

    hitbox.classList.add('is-dragging');
    dragLayer?.classList.add('is-dragging');
  }

  function onPointerMove(event) {
    if (!isHitboxDragging || (dragPointerId !== null && event.pointerId !== dragPointerId)) return;
    event.preventDefault();

    const wrapperRect = wrapper.getBoundingClientRect();
    const scale = Math.min(wrapperRect.width / 1920, wrapperRect.height / 1080) || 1;
    const logicalX = (event.clientX - wrapperRect.left) / scale;
    const logicalY = (event.clientY - wrapperRect.top) / scale;

    const rawLeft = logicalX - dragGrabOffsetX;
    const rawTop = logicalY - dragGrabOffsetY;

    // 1. Soft snapping to center lines and standard corner edge offsets
    const { position: snappedPos, guides } = Positioning.snapPosition({
      left: rawLeft,
      top: rawTop,
      width: currentHitboxBox.width,
      height: currentHitboxBox.height,
    });

    // 2. Clamping strictly inside 1920x1080
    const clamped = Positioning.clampPosition(snappedPos);

    // 3. Derive production config { horizontalAnchor, verticalAnchor, offsetX, offsetY }
    const derived = Positioning.configFromPosition(clamped);

    // Update hitbox in DOM
    hitbox.style.left = `${clamped.left}px`;
    hitbox.style.top = `${clamped.top}px`;
    hitbox.classList.toggle('badge-bottom', clamped.top < 60);

    // Update center guide lines
    if (guideX) guideX.classList.toggle('snapped', guides.snapCenterX);
    if (guideY) guideY.classList.toggle('snapped', guides.snapCenterY);

    // Update live badge text
    const cornerKey = `${derived.horizontalAnchor}-${derived.verticalAnchor}`;
    updateBadgeText(CORNER_LABELS[cornerKey] || 'Слева снизу', derived.offsetX, derived.offsetY);

    // Live update profile UI (drag alters position -> profile becomes Custom)
    const liveConfig = { ...gatherCurrentConfig(), ...derived };
    const liveProfile = Profiles ? Profiles.detectProfile(liveConfig) : null;
    updateProfileUi(liveProfile);

    // 4. Update sidebar controls in real time
    if (appearanceInputs.offsetX) appearanceInputs.offsetX.value = derived.offsetX;
    if (appearanceInputs.offsetXSlider) appearanceInputs.offsetXSlider.value = derived.offsetX;
    if (appearanceInputs.offsetY) appearanceInputs.offsetY.value = derived.offsetY;
    if (appearanceInputs.offsetYSlider) appearanceInputs.offsetYSlider.value = derived.offsetY;
    setDomText(document.querySelector('#offset-x-val'), String(derived.offsetX));
    setDomText(document.querySelector('#offset-y-val'), String(derived.offsetY));

    document.querySelectorAll('.corner-btn').forEach(btn => {
      const isMatch = btn.getAttribute('data-corner') === cornerKey;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });
    setDomText(document.querySelector('#corner-active-label'), CORNER_LABELS[cornerKey] || 'Слева снизу');

    // 5. Update iframe live preview directly for 60fps smoothness
    try {
      const doc = iframe?.contentDocument;
      if (doc) {
        const rootEl = doc.documentElement;
        rootEl.style.setProperty('--overlay-offset-x', `${derived.offsetX}px`);
        rootEl.style.setProperty('--overlay-offset-y', `${derived.offsetY}px`);
        const msgContainer = doc.querySelector('#messages');
        if (msgContainer) {
          msgContainer.classList.toggle('anchor-left', derived.horizontalAnchor === 'left');
          msgContainer.classList.toggle('anchor-right', derived.horizontalAnchor === 'right');
          msgContainer.classList.toggle('anchor-top', derived.verticalAnchor === 'top');
          msgContainer.classList.toggle('anchor-bottom', derived.verticalAnchor === 'bottom');
        }
      }
    } catch {}
  }

  function onPointerUp(event) {
    if (!isHitboxDragging) return;
    if (dragPointerId !== null && event.pointerId !== dragPointerId) return;

    if (dragPointerId !== null && typeof hitbox.releasePointerCapture === 'function') {
      try {
        hitbox.releasePointerCapture(dragPointerId);
      } catch {}
    }

    isHitboxDragging = false;
    dragPointerId = null;

    hitbox.classList.remove('is-dragging');
    dragLayer?.classList.remove('is-dragging');
    if (guideX) guideX.classList.remove('snapped');
    if (guideY) guideY.classList.remove('snapped');

    // Commit to persistent configuration (debounced disk write and SSE broadcast)
    triggerSave();
    sendConfigToPreview(gatherCurrentConfig());
  }

  hitbox.addEventListener('pointerdown', onPointerDown);
  hitbox.addEventListener('pointermove', onPointerMove);
  hitbox.addEventListener('pointerup', onPointerUp);
  hitbox.addEventListener('pointercancel', onPointerUp);

  // Keyboard accessibility for fine-tuning positioning directly on hitbox
  hitbox.addEventListener('keydown', e => {
    let deltaX = 0;
    let deltaY = 0;
    const step = e.shiftKey ? 50 : (e.altKey ? 1 : 10);

    if (e.key === 'ArrowLeft') deltaX = -step;
    else if (e.key === 'ArrowRight') deltaX = step;
    else if (e.key === 'ArrowUp') deltaY = -step;
    else if (e.key === 'ArrowDown') deltaY = step;
    else return;

    e.preventDefault();
    const currentLeft = parseFloat(hitbox.style.left) || currentHitboxBox.left || 0;
    const currentTop = parseFloat(hitbox.style.top) || currentHitboxBox.top || 0;

    const clamped = Positioning.clampPosition({
      left: currentLeft + deltaX,
      top: currentTop + deltaY,
      width: currentHitboxBox.width,
      height: currentHitboxBox.height,
    });

    const derived = Positioning.configFromPosition(clamped);
    syncInputsFromConfig(derived);
    sendConfigToPreview(gatherCurrentConfig());
    triggerSave();
  });
}

function sendFixturesToPreview(config = gatherCurrentConfig()) {
  const iframe = document.querySelector('#preview-iframe');
  if (!iframe || !iframe.contentWindow) return;
  const maxMsg = Math.max(1, Number(config?.maxMessages) || 6);
  iframe.contentWindow.postMessage({
    type: 'preview:set-fixtures',
    fixtures: PREVIEW_FIXTURES.slice(0, maxMsg),
  }, '*');
}

function sendConfigToPreview(config) {
  const iframe = document.querySelector('#preview-iframe');
  if (!iframe || !iframe.contentWindow) return;
  sendFixturesToPreview(config);
  iframe.contentWindow.postMessage({
    type: 'preview:set-config',
    config,
  }, '*');
  updateHitboxGeometry(config);
}

function replayPreviewAnimation(config = gatherCurrentConfig()) {
  const iframe = document.querySelector('#preview-iframe');
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage({
    type: 'preview:replay-animation',
    config,
  }, '*');
}

let previewAckResolvers = [];

function waitForPreviewAck(timeoutMs = 1500) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      previewAckResolvers = previewAckResolvers.filter(r => r !== onAck);
      resolve();
    }, timeoutMs);

    function onAck() {
      clearTimeout(timer);
      resolve();
    }
    previewAckResolvers.push(onAck);
  });
}

window.addEventListener('message', event => {
  if (event.data && event.data.type === 'preview:ready') {
    previewReady = true;
    sendFixturesToPreview();
    sendConfigToPreview(gatherCurrentConfig());
    initDragAndDropPositioning();
    updateHitboxGeometry(gatherCurrentConfig());
  } else if (event.data && event.data.type === 'preview:ack') {
    updateHitboxGeometry(gatherCurrentConfig());
    const resolvers = previewAckResolvers;
    previewAckResolvers = [];
    for (const r of resolvers) r();
  }
});

// --- Appearance Presets Reference ---
const Presets = (typeof BoostyPresets !== 'undefined')
  ? BoostyPresets
  : (typeof require === 'function' ? require('../core/config/presets.js') : null);

// --- Size Presets Reference (Focus Mode) ---
const SizePresets = (typeof BoostySizePresets !== 'undefined')
  ? BoostySizePresets
  : (typeof require === 'function' ? require('../core/config/size-presets.js') : null);

// --- Focus Mode vs Advanced Mode State ---
let appearanceUiMode = 'basic';
const UI_MODE_STORAGE_KEY = 'boosty_appearance_ui_mode';

function initAppearanceUiMode() {
  try {
    const saved = localStorage.getItem(UI_MODE_STORAGE_KEY);
    if (saved === 'advanced' || saved === 'basic') {
      appearanceUiMode = saved;
    } else {
      appearanceUiMode = 'basic';
    }
  } catch {
    appearanceUiMode = 'basic';
  }
  setAppearanceUiMode(appearanceUiMode, false);
}

function setAppearanceUiMode(mode, persist = true) {
  appearanceUiMode = mode === 'advanced' ? 'advanced' : 'basic';
  if (persist) {
    try {
      localStorage.setItem(UI_MODE_STORAGE_KEY, appearanceUiMode);
    } catch {}
  }

  const col = document.querySelector('#appearance-settings-col');
  if (col) {
    col.classList.toggle('mode-basic', appearanceUiMode === 'basic');
    col.classList.toggle('mode-advanced', appearanceUiMode === 'advanced');
  }

  const basicBtn = document.querySelector('#mode-btn-basic');
  const advancedBtn = document.querySelector('#mode-btn-advanced');
  if (basicBtn && advancedBtn) {
    const isBasic = appearanceUiMode === 'basic';
    basicBtn.classList.toggle('active', isBasic);
    basicBtn.setAttribute('aria-pressed', String(isBasic));
    advancedBtn.classList.toggle('active', !isBasic);
    advancedBtn.setAttribute('aria-pressed', String(!isBasic));
  }

  const hint = document.querySelector('#appearance-mode-hint');
  if (hint) {
    hint.textContent = appearanceUiMode === 'basic' ? 'Быстрая настройка' : 'Полный редактор';
  }
}

function updateSizePresetUi(config) {
  const activeSize = SizePresets ? SizePresets.detectSizePreset(config) : null;
  const badge = document.querySelector('#size-status-badge');

  document.querySelectorAll('.size-preset-btn').forEach(btn => {
    const isMatch = btn.getAttribute('data-size') === activeSize;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', String(isMatch));
  });

  if (badge) {
    if (activeSize && SizePresets && SizePresets.SIZE_LABELS[activeSize]) {
      badge.textContent = SizePresets.SIZE_LABELS[activeSize];
      badge.classList.remove('custom');
    } else {
      badge.textContent = 'Пользовательский';
      badge.classList.add('custom');
    }
  }
}

const PRESETS = Presets?.PRESETS || {};
const STYLE_KEYS = Presets?.STYLE_KEYS || [];

const LAYOUT_KEYS = [
  'horizontalAnchor',
  'verticalAnchor',
  'newMessagePosition',
  'offsetX',
  'offsetY',
  'textAlign',
  'maxStackHeight',
];

const APPEARANCE_KEYS = STYLE_KEYS;

const DEFAULT_LAYOUT = {
  horizontalAnchor: 'left',
  verticalAnchor: 'bottom',
  newMessagePosition: 'bottom',
  offsetX: 20,
  offsetY: 20,
  textAlign: 'left',
  maxStackHeight: 800,
};

const CORNER_LABELS = {
  'left-top': 'Слева сверху',
  'right-top': 'Справа сверху',
  'left-bottom': 'Слева снизу',
  'right-bottom': 'Справа снизу',
};

const VALID_ANIMATION_TYPES = ['none', 'fade', 'slide-up', 'slide-side'];

function normalizeUiAnimationType(val, fallback = 'fade') {
  if (typeof val === 'string' && VALID_ANIMATION_TYPES.includes(val.trim().toLowerCase())) {
    return val.trim().toLowerCase();
  }
  return fallback;
}

function normalizeUiAnimationDuration(val, fallback = 280) {
  const num = Number(val);
  if (!Number.isFinite(num) || val === '' || val === null || val === undefined || typeof val === 'boolean') {
    return fallback;
  }
  return Math.round(Math.min(1000, Math.max(150, num)));
}

function formatAnimationSpeedLabel(durationMs, animType) {
  if (animType === 'none') {
    return 'Мгновенно';
  }
  const ms = normalizeUiAnimationDuration(durationMs, 280);
  let tier = 'Плавно';
  if (ms <= 220) tier = 'Быстро';
  else if (ms <= 340) tier = 'Обычно';
  else if (ms <= 550) tier = 'Плавно';
  else tier = 'Медленно';
  return `${tier} · ${ms} мс`;
}

function getActiveSpeedBucket(durationMs) {
  const ms = normalizeUiAnimationDuration(durationMs, 280);
  if (ms <= 220) return '180';
  if (ms <= 340) return '280';
  return '450';
}

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
  offsetX: document.querySelector('#offset-x'),
  offsetXSlider: document.querySelector('#offset-x-slider'),
  offsetY: document.querySelector('#offset-y'),
  offsetYSlider: document.querySelector('#offset-y-slider'),
  maxStackHeight: document.querySelector('#max-stack-height'),
  maxStackHeightSlider: document.querySelector('#max-stack-height-slider'),
  animationDurationSlider: document.querySelector('#animation-duration-slider'),
};

function gatherCurrentConfig() {
  const alwaysShow = Boolean(appearanceInputs.alwaysShow?.checked);
  const durationVal = Number(appearanceInputs.duration?.value) || lastNonZeroDuration;

  const activeCornerBtn = document.querySelector('.corner-btn.active');
  const cornerVal = activeCornerBtn ? activeCornerBtn.getAttribute('data-corner') : 'left-bottom';
  const [hAnchor, vAnchor] = cornerVal ? cornerVal.split('-') : ['left', 'bottom'];

  const activePosBtn = document.querySelector('[data-new-msg-pos].active');
  const newMsgPos = activePosBtn ? activePosBtn.getAttribute('data-new-msg-pos') : 'bottom';

  const activeAlignBtn = document.querySelector('[data-text-align].active');
  const textAlign = activeAlignBtn ? activeAlignBtn.getAttribute('data-text-align') : 'left';

  const activeAnimTypeBtn = document.querySelector('[data-animation-type].active');
  const animationType = normalizeUiAnimationType(
    activeAnimTypeBtn ? activeAnimTypeBtn.getAttribute('data-animation-type') : 'fade',
    'fade'
  );
  const animationDurationMs = normalizeUiAnimationDuration(
    appearanceInputs.animationDurationSlider?.value,
    280
  );

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

    horizontalAnchor: hAnchor === 'right' ? 'right' : 'left',
    verticalAnchor: vAnchor === 'top' ? 'top' : 'bottom',
    newMessagePosition: newMsgPos === 'top' ? 'top' : 'bottom',
    offsetX: Math.max(0, Math.min(1000, Number(appearanceInputs.offsetX?.value) ?? 20)),
    offsetY: Math.max(0, Math.min(800, Number(appearanceInputs.offsetY?.value) ?? 20)),
    textAlign: ['left', 'center', 'right'].includes(textAlign) ? textAlign : 'left',
    maxStackHeight: Math.max(160, Math.min(2160, Number(appearanceInputs.maxStackHeight?.value) || 800)),
    animationType,
    animationDurationMs,
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
  setDomText(document.querySelector('#offset-x-val'), String(config.offsetX ?? 20));
  setDomText(document.querySelector('#offset-y-val'), String(config.offsetY ?? 20));
  setDomText(document.querySelector('#max-stack-height-val'), String(config.maxStackHeight ?? 800));

  const animType = normalizeUiAnimationType(config.animationType ?? config.animation?.type, 'fade');
  const animDuration = normalizeUiAnimationDuration(config.animationDurationMs ?? config.animation?.durationMs, 280);
  setDomText(
    document.querySelector('#animation-speed-label'),
    formatAnimationSpeedLabel(animDuration, animType)
  );

  const activeBucket = getActiveSpeedBucket(animDuration);
  document.querySelectorAll('[data-animation-speed]').forEach(btn => {
    const isMatch = animType !== 'none' && btn.getAttribute('data-animation-speed') === activeBucket;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', String(isMatch));
    btn.disabled = animType === 'none';
  });

  const animSpeedContainer = document.querySelector('#animation-speed-container');
  if (animSpeedContainer) {
    animSpeedContainer.classList.toggle('disabled', animType === 'none');
  }
  if (appearanceInputs.animationDurationSlider) {
    appearanceInputs.animationDurationSlider.disabled = animType === 'none';
  }

  const cornerKey = `${config.horizontalAnchor || 'left'}-${config.verticalAnchor || 'bottom'}`;
  setDomText(document.querySelector('#corner-active-label'), CORNER_LABELS[cornerKey] || 'Слева снизу');

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

  // Sync Focus Mode Stepper
  setDomText(document.querySelector('#basic-max-messages-val'), String(config.maxMessages));
  const decBtn = document.querySelector('#basic-max-msgs-dec');
  const incBtn = document.querySelector('#basic-max-msgs-inc');
  if (decBtn) decBtn.disabled = Number(config.maxMessages) <= 1;
  if (incBtn) incBtn.disabled = Number(config.maxMessages) >= 20;

  // Sync Focus Mode Duration display & pills
  const isAlways = config.durationSeconds === 0;
  const durSec = isAlways ? 0 : (config.durationSeconds || lastNonZeroDuration);
  const durText = isAlways ? 'Всегда' : `${durSec} сек.`;
  setDomText(document.querySelector('#basic-duration-display'), durText);

  document.querySelectorAll('.duration-pill-btn').forEach(btn => {
    const targetDuration = Number(btn.getAttribute('data-duration'));
    const isMatch = isAlways ? targetDuration === 0 : targetDuration === config.durationSeconds;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', String(isMatch));
  });

  // Sync Focus Mode Size presets
  updateSizePresetUi(config);
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

  if (config.maxMessages !== undefined) syncNum(appearanceInputs.maxMessages, appearanceInputs.maxMessagesSlider, config.maxMessages);
  if (config.cardWidth !== undefined) syncNum(appearanceInputs.cardWidth, appearanceInputs.cardWidthSlider, config.cardWidth);
  if (config.fontSize !== undefined) syncNum(appearanceInputs.fontSize, appearanceInputs.fontSizeSlider, config.fontSize);
  if (config.authorFontSize !== undefined) syncNum(appearanceInputs.authorFontSize, appearanceInputs.authorFontSizeSlider, config.authorFontSize);
  if (config.borderRadius !== undefined) syncNum(appearanceInputs.borderRadius, appearanceInputs.borderRadiusSlider, config.borderRadius);
  if (config.cardPadding !== undefined) syncNum(appearanceInputs.cardPadding, appearanceInputs.cardPaddingSlider, config.cardPadding);
  if (config.messageGap !== undefined) syncNum(appearanceInputs.messageGap, appearanceInputs.messageGapSlider, config.messageGap);
  if (config.avatarSize !== undefined) syncNum(appearanceInputs.avatarSize, appearanceInputs.avatarSizeSlider, config.avatarSize);
  if (config.backdropBlur !== undefined) syncNum(appearanceInputs.backdropBlur, appearanceInputs.backdropBlurSlider, config.backdropBlur);
  if (config.offsetX !== undefined) syncNum(appearanceInputs.offsetX, appearanceInputs.offsetXSlider, config.offsetX);
  if (config.offsetY !== undefined) syncNum(appearanceInputs.offsetY, appearanceInputs.offsetYSlider, config.offsetY);
  if (config.maxStackHeight !== undefined) syncNum(appearanceInputs.maxStackHeight, appearanceInputs.maxStackHeightSlider, config.maxStackHeight);

  const rawAnimType = config.animationType !== undefined ? config.animationType : config.animation?.type;
  if (rawAnimType !== undefined) {
    const validType = normalizeUiAnimationType(rawAnimType, 'fade');
    document.querySelectorAll('[data-animation-type]').forEach(btn => {
      const isMatch = btn.getAttribute('data-animation-type') === validType;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });
  }

  const rawAnimDuration = config.animationDurationMs !== undefined ? config.animationDurationMs : config.animation?.durationMs;
  if (rawAnimDuration !== undefined && appearanceInputs.animationDurationSlider) {
    appearanceInputs.animationDurationSlider.value = String(normalizeUiAnimationDuration(rawAnimDuration, 280));
  }

  if (config.backgroundOpacity !== undefined && appearanceInputs.backgroundOpacity) {
    appearanceInputs.backgroundOpacity.value = config.backgroundOpacity;
  }

  const syncColor = (picker, text, val) => {
    if (!val) return;
    if (picker) picker.value = val;
    if (text) text.value = val;
  };

  syncColor(appearanceInputs.accentColor, appearanceInputs.accentColorHex, config.accentColor);
  syncColor(appearanceInputs.textColor, appearanceInputs.textColorHex, config.textColor);
  syncColor(appearanceInputs.backgroundColor, appearanceInputs.backgroundColorHex, config.backgroundColor);

  if (appearanceInputs.showAvatars && config.showAvatars !== undefined) {
    appearanceInputs.showAvatars.checked = Boolean(config.showAvatars);
  }
  if (appearanceInputs.shadow && config.shadow !== undefined) {
    appearanceInputs.shadow.checked = Boolean(config.shadow);
  }

  if (config.horizontalAnchor || config.verticalAnchor) {
    const cornerKey = `${config.horizontalAnchor || 'left'}-${config.verticalAnchor || 'bottom'}`;
    document.querySelectorAll('.corner-btn').forEach(btn => {
      const isMatch = btn.getAttribute('data-corner') === cornerKey;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });
    setDomText(document.querySelector('#corner-active-label'), CORNER_LABELS[cornerKey] || 'Слева снизу');
  }

  if (config.newMessagePosition) {
    document.querySelectorAll('[data-new-msg-pos]').forEach(btn => {
      const isMatch = btn.getAttribute('data-new-msg-pos') === config.newMessagePosition;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });
  }

  if (config.textAlign) {
    document.querySelectorAll('[data-text-align]').forEach(btn => {
      const isMatch = btn.getAttribute('data-text-align') === config.textAlign;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', String(isMatch));
    });
  }

  const current = gatherCurrentConfig();
  updateAppearanceLabels(current);
  updateHitboxGeometry(current);

  const matchedPreset = detectActivePreset(current);
  updatePresetUi(matchedPreset);

  const matchedProfile = Profiles ? Profiles.detectProfile(current) : null;
  updateProfileUi(matchedProfile);
}

const PRESET_LABELS = Presets?.PRESET_LABELS || {
  clean: 'Чистый',
  compact: 'Компактный',
  large: 'Крупный',
  glass: 'Стекло',
};

function detectActivePreset(config) {
  if (Presets && typeof Presets.detectActivePreset === 'function') {
    return Presets.detectActivePreset(config);
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

function updateProfileUi(activeProfileId) {
  const badge = document.querySelector('#profile-status-badge');
  document.querySelectorAll('.profile-btn').forEach(btn => {
    const isMatch = btn.getAttribute('data-profile') === activeProfileId;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', String(isMatch));
  });

  if (badge) {
    if (activeProfileId && Profiles && Profiles.PROFILE_DEFINITIONS[activeProfileId]) {
      badge.textContent = Profiles.PROFILE_DEFINITIONS[activeProfileId].name;
      badge.classList.remove('custom');
    } else {
      badge.textContent = 'Пользовательский';
      badge.classList.add('custom');
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

  const matchedProfile = Profiles ? Profiles.detectProfile(configToSave) : null;
  updateProfileUi(matchedProfile);

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
        const savedJson = await response.json();
        if (thisRevision !== currentSaveRevision) return;
        lastSavedConfig = savedJson;
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

  // Mode Switcher: Focus (Basic) vs Advanced
  document.querySelector('#mode-btn-basic')?.addEventListener('click', () => {
    setAppearanceUiMode('basic');
  });

  document.querySelector('#mode-btn-advanced')?.addEventListener('click', () => {
    setAppearanceUiMode('advanced');
  });

  document.querySelector('#basic-more-settings-btn')?.addEventListener('click', () => {
    setAppearanceUiMode('advanced');
  });

  document.querySelector('#advanced-back-to-basic-btn')?.addEventListener('click', () => {
    setAppearanceUiMode('basic');
  });

  // Focus Mode: Size Presets
  document.querySelectorAll('.size-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sizeId = btn.getAttribute('data-size');
      if (!sizeId || !SizePresets) return;
      const current = gatherCurrentConfig();
      const updated = SizePresets.applySizePreset(current, sizeId);
      syncInputsFromConfig(updated);
      triggerSave(true);
    });
  });

  // Focus Mode: Messages Stepper
  document.querySelector('#basic-max-msgs-dec')?.addEventListener('click', () => {
    const currentVal = Number(appearanceInputs.maxMessages?.value) || 6;
    const nextVal = Math.max(1, currentVal - 1);
    if (appearanceInputs.maxMessages) appearanceInputs.maxMessages.value = nextVal;
    if (appearanceInputs.maxMessagesSlider) appearanceInputs.maxMessagesSlider.value = nextVal;
    triggerSave(true);
  });

  document.querySelector('#basic-max-msgs-inc')?.addEventListener('click', () => {
    const currentVal = Number(appearanceInputs.maxMessages?.value) || 6;
    const nextVal = Math.min(20, currentVal + 1);
    if (appearanceInputs.maxMessages) appearanceInputs.maxMessages.value = nextVal;
    if (appearanceInputs.maxMessagesSlider) appearanceInputs.maxMessagesSlider.value = nextVal;
    triggerSave(true);
  });

  // Focus Mode: Duration Pills
  document.querySelectorAll('.duration-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dVal = Number(btn.getAttribute('data-duration'));
      if (isNaN(dVal)) return;
      if (dVal === 0) {
        if (appearanceInputs.alwaysShow) appearanceInputs.alwaysShow.checked = true;
      } else {
        if (appearanceInputs.alwaysShow) appearanceInputs.alwaysShow.checked = false;
        if (appearanceInputs.duration) appearanceInputs.duration.value = dVal;
        if (appearanceInputs.durationSlider) appearanceInputs.durationSlider.value = dVal;
        lastNonZeroDuration = dVal;
      }
      triggerSave(true);
    });
  });

  // Stream Profiles (Built-in Stream Profiles v1)
  document.querySelectorAll('.profile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const profileId = btn.getAttribute('data-profile');
      if (!profileId || !Profiles) return;
      const current = gatherCurrentConfig();
      const newConfig = Profiles.applyProfile(current, profileId);
      syncInputsFromConfig(newConfig);
      triggerSave(true);
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

  // Appearance Reset (resets only STYLE_KEYS)
  document.querySelector('#appearance-reset-btn')?.addEventListener('click', () => {
    syncInputsFromConfig(PRESETS.clean);
    updatePresetUi('clean');
    triggerSave(true);
  });

  // Layout Reset (resets only LAYOUT_KEYS)
  document.querySelector('#layout-reset-btn')?.addEventListener('click', () => {
    syncInputsFromConfig(DEFAULT_LAYOUT);
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
  pairInputs(appearanceInputs.offsetX, appearanceInputs.offsetXSlider);
  pairInputs(appearanceInputs.offsetY, appearanceInputs.offsetYSlider);
  pairInputs(appearanceInputs.maxStackHeight, appearanceInputs.maxStackHeightSlider);

  // Corner buttons click & 2D arrow keys navigation
  const cornerBtns = Array.from(document.querySelectorAll('.corner-btn'));
  cornerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      cornerBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      const cornerKey = btn.getAttribute('data-corner') || 'left-bottom';
      setDomText(document.querySelector('#corner-active-label'), CORNER_LABELS[cornerKey] || 'Слева снизу');
      sendConfigToPreview(gatherCurrentConfig());
      triggerSave();
    });

    btn.addEventListener('keydown', e => {
      const current = btn.getAttribute('data-corner');
      let target = null;
      if (e.key === 'ArrowRight') {
        if (current === 'left-top') target = 'right-top';
        if (current === 'left-bottom') target = 'right-bottom';
      } else if (e.key === 'ArrowLeft') {
        if (current === 'right-top') target = 'left-top';
        if (current === 'right-bottom') target = 'left-bottom';
      } else if (e.key === 'ArrowDown') {
        if (current === 'left-top') target = 'left-bottom';
        if (current === 'right-top') target = 'right-bottom';
      } else if (e.key === 'ArrowUp') {
        if (current === 'left-bottom') target = 'left-top';
        if (current === 'right-bottom') target = 'right-top';
      }
      if (target) {
        e.preventDefault();
        const targetBtn = document.querySelector(`.corner-btn[data-corner="${target}"]`);
        if (targetBtn) {
          targetBtn.focus();
          targetBtn.click();
        }
      }
    });
  });

  // Segmented controls: New Message Position
  document.querySelectorAll('[data-new-msg-pos]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-new-msg-pos]').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      triggerSave();
    });
  });

  // Segmented controls: Text Alignment
  document.querySelectorAll('[data-text-align]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-text-align]').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      triggerSave();
    });
  });

  // Segmented controls: Message Animation Type
  document.querySelectorAll('[data-animation-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-animation-type]').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      triggerSave();
      replayPreviewAnimation(gatherCurrentConfig());
    });
  });

  // Segmented controls: Message Animation Speed Presets (Быстро / Обычно / Плавно)
  document.querySelectorAll('[data-animation-speed]').forEach(btn => {
    btn.addEventListener('click', () => {
      const speedVal = btn.getAttribute('data-animation-speed');
      if (speedVal && appearanceInputs.animationDurationSlider) {
        appearanceInputs.animationDurationSlider.value = speedVal;
      }
      triggerSave();
      replayPreviewAnimation(gatherCurrentConfig());
    });
  });

  // Slider: Message Animation Duration (150..1000 ms)
  if (appearanceInputs.animationDurationSlider) {
    appearanceInputs.animationDurationSlider.addEventListener('input', () => {
      triggerSave();
    });
    appearanceInputs.animationDurationSlider.addEventListener('change', () => {
      replayPreviewAnimation(gatherCurrentConfig());
    });
  }

  // Button: Replay Animation in Preview
  document.querySelector('#animation-replay-btn')?.addEventListener('click', () => {
    replayPreviewAnimation(gatherCurrentConfig());
  });

  // Preview container scale observer
  const previewBackdropEl = document.querySelector('#preview-backdrop');
  if (previewBackdropEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      updatePreviewScale();
      updateHitboxGeometry();
    }).observe(previewBackdropEl);
  }
  window.addEventListener('resize', () => {
    updatePreviewScale();
    updateHitboxGeometry();
  });

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

  const handleFitCanvasClick = async (btn) => {
    if (!btn || btn.disabled) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Подгоняем…';
    try {
      const password = document.querySelector('#dash-obs-password')?.value ||
                       document.querySelector('#ob-obs-password')?.value || '';
      const res = await window.boostyOverlay.fitObsOverlay(password);
      if (res && res.ok) {
        await loadObsScenes();
      } else {
        alert(res?.error || 'Не удалось подогнать оверлей под холст OBS');
      }
    } catch (err) {
      alert(err?.message || 'Сбой запроса к OBS');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  };

  document.querySelector('#obs-fit-canvas-btn')?.addEventListener('click', e => {
    handleFitCanvasClick(e.currentTarget);
  });

  document.querySelector('#layout-fit-canvas-btn')?.addEventListener('click', e => {
    handleFitCanvasClick(e.currentTarget);
  });

  // Status Hub Action Buttons
  document.querySelector('#dash-obs-launch-btn')?.addEventListener('click', () => {
    window.boostyOverlay.launchObs();
  });

  document.querySelector('#dash-ext-fix-btn')?.addEventListener('click', (e) => {
    const actionId = e.currentTarget?.getAttribute('data-action-id');
    if (actionId === 'migrate-ext') {
      openExtensionModal('migration');
    } else if (actionId === 'reload-ext') {
      openExtensionModal('reload');
    } else if (actionId === 'update-ext') {
      openExtensionModal('update');
    } else {
      openExtensionModal('setup');
    }
  });

  document.querySelector('#dash-boosty-open-btn')?.addEventListener('click', () => {
    window.boostyOverlay.openUrl('https://boosty.to/', selectedBrowser);
  });

  document.querySelector('#dash-overlay-action-btn')?.addEventListener('click', (e) => {
    const actionId = e.currentTarget?.getAttribute('data-action-id');
    if (actionId === 'test-overlay') {
      fetch(`${getApiOrigin()}/test`).catch(() => {});
    } else {
      showView('setup');
    }
  });

  // Diagnostics / Extra View Actions
  document.querySelector('#dash-copy-url-btn')?.addEventListener('click', async () => {
    await window.boostyOverlay.copyOverlayUrl();
    const btn = document.querySelector('#dash-copy-url-btn');
    const orig = btn.textContent;
    btn.textContent = 'Скопировано!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  document.querySelector('#export-connectivity-diagnostic-btn')?.addEventListener('click', async () => {
    const btn = document.querySelector('#export-connectivity-diagnostic-btn');
    const statusEl = document.querySelector('#diagnostic-export-status');
    try {
      if (btn) btn.disabled = true;
      let data = null;
      if (window.boostyOverlay?.exportConnectivityDiagnostic) {
        data = await window.boostyOverlay.exportConnectivityDiagnostic();
      } else {
        const res = await fetch(`${getApiOrigin()}/diagnostic`);
        data = await res.json();
      }

      const jsonStr = JSON.stringify(data, null, 2);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jsonStr);
      }

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `boosty-connectivity-diagnostic-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      if (statusEl) {
        statusEl.textContent = '✓ Сохранено в файл и скопировано';
        setDomDisplay(statusEl, 'inline');
        setTimeout(() => setDomDisplay(statusEl, 'none'), 4000);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `Ошибка: ${err.message}`;
        setDomDisplay(statusEl, 'inline');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.querySelector('#tech-check-update-btn')?.addEventListener('click', async () => {
    const btn = document.querySelector('#tech-check-update-btn');
    if (btn) btn.disabled = true;
    await refreshUpdateStatus(true);
    if (btn) btn.disabled = false;
  });

  document.querySelector('#tech-copy-ext-path-btn')?.addEventListener('click', async () => {
    await extensionFlow.copyPath();
    const btn = document.querySelector('#tech-copy-ext-path-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Скопировано!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
  });

  document.querySelector('#tech-open-ext-folder-btn')?.addEventListener('click', async () => {
    await extensionFlow.openFolder();
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

  document.querySelector('#ob-copy-ext-path-btn')?.addEventListener('click', async () => {
    await extensionFlow.copyPath();
    const btn = document.querySelector('#ob-copy-ext-path-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Путь скопирован!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
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

  document.querySelector('#modal-copy-ext-path-btn')?.addEventListener('click', async () => {
    await extensionFlow.copyPath();
    const btn = document.querySelector('#modal-copy-ext-path-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Путь скопирован!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
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
  const modalMigration = document.querySelector('#modal-migration-box');
  const modalReload = document.querySelector('#modal-reload-box');
  const modalDoneBtn = document.querySelector('#modal-done-btn');
  const modalStartBtn = document.querySelector('#modal-start-setup-btn');

  if (!modal) return;
  modal.style.display = 'flex';

  if (mode === 'migration') {
    setDomDisplay(modalGuide, 'none');
    setDomDisplay(modalMigration, 'block');
    setDomDisplay(modalReload, 'none');
    setDomDisplay(modalDoneBtn, 'inline-flex');
    setDomDisplay(modalStartBtn, 'none');
    if (window.boostyOverlay?.prepareBrowserExtension) {
      window.boostyOverlay.prepareBrowserExtension(selectedBrowser);
    }
    if (window.boostyOverlay?.copyExtensionPath) {
      window.boostyOverlay.copyExtensionPath().catch(() => {});
    }
  } else if (mode === 'reload') {
    setDomDisplay(modalGuide, 'none');
    setDomDisplay(modalMigration, 'none');
    setDomDisplay(modalReload, 'block');
    setDomDisplay(modalDoneBtn, 'inline-flex');
    setDomDisplay(modalStartBtn, 'none');
  } else if (mode === 'update') {
    setDomDisplay(modalGuide, 'block');
    setDomDisplay(modalMigration, 'none');
    setDomDisplay(modalReload, 'none');
    setDomDisplay(modalDoneBtn, 'inline-flex');
    setDomDisplay(modalStartBtn, 'none');
  } else {
    setDomDisplay(modalGuide, 'none');
    setDomDisplay(modalMigration, 'none');
    setDomDisplay(modalReload, 'none');
    setDomDisplay(modalDoneBtn, 'none');
    setDomDisplay(modalStartBtn, 'inline-flex');
  }
}

function closeExtensionModal() {
  const modal = document.querySelector('#dash-ext-modal');
  if (modal) modal.style.display = 'none';
}

document.querySelector('#modal-migration-copy-path-btn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const orig = btn.textContent;
  if (window.boostyOverlay?.copyExtensionPath) {
    await window.boostyOverlay.copyExtensionPath();
  }
  btn.textContent = 'Скопировано!';
  setTimeout(() => { btn.textContent = orig; }, 1500);
});

document.querySelector('#modal-migration-open-folder-btn')?.addEventListener('click', () => {
  window.boostyOverlay?.openExtensionFolder();
});

document.querySelector('#modal-migration-open-browser-btn')?.addEventListener('click', () => {
  window.boostyOverlay?.prepareBrowserExtension(selectedBrowser);
});

document.querySelector('#modal-reload-open-browser-btn')?.addEventListener('click', () => {
  window.boostyOverlay?.prepareBrowserExtension(selectedBrowser);
});

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

    const extLifecycle = health.extension?.state || (health.extensionConnected ? 'connected' : (Date.now() < checkGraceDeadline ? 'checking' : 'unavailable'));
    const boostyLifecycle = health.boosty?.state || (health.boostyConnected ? 'tab-detected' : (Date.now() < checkGraceDeadline ? 'checking' : 'unavailable'));

    const isExtActive = (extLifecycle === 'connected');
    const isBoostyActive = (boostyLifecycle === 'chat-detected' || boostyLifecycle === 'tab-detected');
    const isOutdated = Boolean(health.isOutdated);

    if (isExtActive && isBoostyActive) {
      checkGraceDeadline = 0;
    }
    const isChecking = (extLifecycle === 'checking' || boostyLifecycle === 'checking') ||
                       ((!isExtActive || !isBoostyActive) && Date.now() < checkGraceDeadline);

    if (isExtActive && !extensionDetectedAt) {
      extensionDetectedAt = Date.now();
    }
    if ((boostyLifecycle === 'tab-detected' || boostyLifecycle === 'chat-detected') && !boostyTabDetectedAt) {
      boostyTabDetectedAt = Date.now();
    }
    if (boostyLifecycle === 'chat-detected' && !chatDetectedAt) {
      chatDetectedAt = Date.now();
    }

    if (extLifecycle === 'reconnecting' && !reconnectStartTime) {
      reconnectStartTime = Date.now();
      readyAt = null;
    }

    const isObsConnected = Boolean(latestObsStatus?.connected);
    const hasChatInAnyScene = Boolean(addedSceneName || (Array.isArray(latestObsScenes) && latestObsScenes.some(s => s.hasChat)));
    const allSystemsReady = isExtActive && isBoostyActive && isObsConnected && hasChatInAnyScene;

    if (allSystemsReady && !readyAt) {
      readyAt = Date.now();
      const startRef = reconnectStartTime || appStartTime;
      recoveryDurationMs = Math.max(100, readyAt - startRef);
      if (!window.__AUDIT_HEALTH_MOCK__ || simulatedStartupTiming?.isRecoveredRecently) {
        recoveryTimestamp = Date.now();
        setTimeout(() => {
          recoveryTimestamp = null;
          updateContextualActionCard();
          renderStatusHubUi();
          ensureProgressTicker();
        }, RECOVERY_FLASH_DURATION_MS);
      }
      reconnectStartTime = null;
    }

    // Dashboard Status Hub
    renderStatusHubUi();

    // Setup view status cards
    const setupExtBadge = document.querySelector('#setup-ext-badge');
    const setupBoostyBadge = document.querySelector('#setup-boosty-badge');
    const setupBoostyUrl = document.querySelector('#setup-boosty-url');

    if (setupExtBadge) {
      if (extLifecycle === 'connected') {
        setDomClass(setupExtBadge, 'badge connected');
        setDomText(setupExtBadge, health.extension?.version || health.extensionVersion ? `Установлено (v${health.extension?.version || health.extensionVersion})` : 'Установлено');
      } else if (extLifecycle === 'checking' || isChecking) {
        setDomClass(setupExtBadge, 'badge checking');
        setDomText(setupExtBadge, 'Проверка…');
      } else if (extLifecycle === 'reconnecting') {
        setDomClass(setupExtBadge, 'badge warning');
        setDomText(setupExtBadge, 'Переподключение…');
      } else {
        setDomClass(setupExtBadge, 'badge pending');
        setDomText(setupExtBadge, 'Не установлено');
      }
    }

    if (setupBoostyBadge) {
      if (boostyLifecycle === 'chat-detected') {
        setDomClass(setupBoostyBadge, 'badge connected');
        setDomText(setupBoostyBadge, 'Чат подключён');
      } else if (boostyLifecycle === 'tab-detected') {
        setDomClass(setupBoostyBadge, 'badge connected');
        setDomText(setupBoostyBadge, 'Вкладка открыта');
      } else if (boostyLifecycle === 'checking' || isChecking) {
        setDomClass(setupBoostyBadge, 'badge checking');
        setDomText(setupBoostyBadge, 'Проверка…');
      } else {
        setDomClass(setupBoostyBadge, 'badge pending');
        setDomText(setupBoostyBadge, 'Не открыт');
      }
    }

    if (setupBoostyUrl) {
      if (isBoostyActive) {
        const cleanUrl = health.boosty?.tabUrl || health.boostyTabUrl ? (health.boosty?.tabUrl || health.boostyTabUrl).replace(/^https?:\/\/(www\.)?boosty\.to\//, '') : 'Вкладка активна';
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

    if (techExt) setDomText(techExt, extLifecycle === 'connected' ? `Активно (v${health.extension?.version || health.extensionVersion || '?'})` : (extLifecycle === 'reconnecting' ? 'Переподключение' : (extLifecycle === 'checking' ? 'Проверка' : 'Не активно')));
    if (techBoosty) setDomText(techBoosty, boostyLifecycle === 'chat-detected' ? 'Чат активен' : (boostyLifecycle === 'tab-detected' ? 'Вкладка активна' : (boostyLifecycle === 'checking' ? 'Проверка' : 'Не открыта')));
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
      if (extLifecycle === 'connected') {
        setDomClass(obExtBadge, 'badge connected');
        setDomText(obExtText, health.extension?.version || health.extensionVersion ? `Расширение подключено (v${health.extension?.version || health.extensionVersion})` : 'Расширение подключено');
        setDomDisplay(obExtSuccess, 'block');
        setDomDisplay(obNotDetectedBox, 'none');
        setDomDisplay(obGuideBox, 'none');
        setDomDisplay(obConnectedActions, isBoostyActive ? 'none' : 'flex');
      } else if (extLifecycle === 'checking' || isChecking) {
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
      if (extLifecycle === 'connected') {
        setDomClass(modalBadge, 'badge connected');
        setDomText(modalText, 'Расширение подключено');
        setDomDisplay(modalSuccess, 'block');
        setDomDisplay(modalGuide, 'none');
        setDomDisplay(modalDoneBtn, 'inline-flex');
        setDomDisplay(modalStartBtn, 'none');
      } else if (extLifecycle === 'checking' || isChecking) {
        setDomClass(modalBadge, 'badge checking');
        setDomText(modalText, 'Проверяем расширение…');
        setDomDisplay(modalSuccess, 'none');
        setDomDisplay(modalDoneBtn, 'none');
        setDomDisplay(modalStartBtn, 'inline-flex');
      } else {
        setDomClass(modalBadge, 'badge pending');
        setDomText(modalText, 'Расширение не обнаружено');
        setDomDisplay(modalSuccess, 'none');
        setDomDisplay(modalDoneBtn, 'none');
        setDomDisplay(modalStartBtn, 'inline-flex');
      }
    }

    updateContextualActionCard();
    renderStatusHubUi();
    ensureProgressTicker();
    if (window.boostyAudit) {
      updateAuditDiagnosticState();
    }
  } catch (err) {
    // Network or offline
  }
}

function ensureProgressTicker() {
  const readiness = getSystemReadiness();
  const needsTicker = (readiness.status === 'connecting' || recoveryTimestamp);
  if (needsTicker && !progressTicker) {
    progressTicker = setInterval(() => {
      const cur = getSystemReadiness();
      if (cur.status === 'connecting' || recoveryTimestamp) {
        updateContextualActionCard();
        renderStatusHubUi();
      } else if (progressTicker) {
        clearInterval(progressTicker);
        progressTicker = null;
      }
    }, 200);
  } else if (!needsTicker && progressTicker) {
    clearInterval(progressTicker);
    progressTicker = null;
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

  const curCfg = gatherCurrentConfig();
  const topPosBtn = document.querySelector('[data-new-msg-pos="top"]');
  const bottomPosBtn = document.querySelector('[data-new-msg-pos="bottom"]');
  const rightAlignBtn = document.querySelector('[data-text-align="right"]');
  const leftAlignBtn = document.querySelector('[data-text-align="left"]');
  const animFadeBtn = document.querySelector('[data-animation-type="fade"]');
  const animSlideUpBtn = document.querySelector('[data-animation-type="slide-up"]');
  const animSlideSideBtn = document.querySelector('[data-animation-type="slide-side"]');
  const animNoneBtn = document.querySelector('[data-animation-type="none"]');

  window.__UI_AUDIT_RENDER_STATE__ = {
    view: activeView === 'dashboard' ? 'main' : activeView,
    step: currentStep,
    obsConnected: isObsConnected,
    extensionConnected: isExtConnected,
    boostyConnected: isBoostyConnected,
    bannerVisible,
    receivedMessages: latestHealth?.receivedMessages || 0,
    activePreset: detectActivePreset(curCfg),
    newMessagePosition: curCfg.newMessagePosition,
    textAlign: curCfg.textAlign,
    horizontalAnchor: curCfg.horizontalAnchor,
    verticalAnchor: curCfg.verticalAnchor,
    offsetX: curCfg.offsetX,
    offsetY: curCfg.offsetY,
    maxStackHeight: curCfg.maxStackHeight,
    animationType: curCfg.animationType,
    animationDurationMs: curCfg.animationDurationMs,
    ariaPressedTop: topPosBtn?.getAttribute('aria-pressed') === 'true',
    ariaPressedBottom: bottomPosBtn?.getAttribute('aria-pressed') === 'true',
    ariaPressedRight: rightAlignBtn?.getAttribute('aria-pressed') === 'true',
    ariaPressedLeft: leftAlignBtn?.getAttribute('aria-pressed') === 'true',
    ariaPressedAnimFade: animFadeBtn?.getAttribute('aria-pressed') === 'true',
    ariaPressedAnimSlideUp: animSlideUpBtn?.getAttribute('aria-pressed') === 'true',
    ariaPressedAnimSlideSide: animSlideSideBtn?.getAttribute('aria-pressed') === 'true',
    ariaPressedAnimNone: animNoneBtn?.getAttribute('aria-pressed') === 'true',
  };
}

// --- Update Status Rendering & Checking ---
function renderUpdateStatus(status) {
  if (!status) return;
  const updateBadge = document.querySelector('#update-badge');
  const updateBadgeText = document.querySelector('#update-badge-text');
  const updateBadgeBtn = document.querySelector('#update-badge-btn');
  const techUpdateStatus = document.querySelector('#tech-update-status');

  if (status.updateAvailable) {
    if (updateBadge) {
      setDomDisplay(updateBadge, 'inline-flex');
    }
    if (updateBadgeText) updateBadgeText.textContent = `Доступна v${status.latestVersion}`;
    if (updateBadgeBtn) {
      updateBadgeBtn.onclick = () => {
        window.boostyOverlay?.openReleaseUrl?.(status.releaseUrl);
      };
    }
    if (techUpdateStatus) {
      techUpdateStatus.textContent = `Доступна v${status.latestVersion}`;
      techUpdateStatus.style.color = 'var(--color-primary, #EF7829)';
    }
  } else if (status.state === 'checking') {
    if (techUpdateStatus) {
      techUpdateStatus.textContent = 'Проверка…';
      techUpdateStatus.style.color = 'var(--text-muted)';
    }
  } else if (status.state === 'error') {
    if (updateBadge) setDomDisplay(updateBadge, 'none');
    if (techUpdateStatus) {
      techUpdateStatus.textContent = 'Не удалось проверить';
      techUpdateStatus.style.color = 'var(--text-muted)';
    }
  } else {
    // up-to-date
    if (updateBadge) setDomDisplay(updateBadge, 'none');
    if (techUpdateStatus) {
      techUpdateStatus.textContent = 'Версия актуальна';
      techUpdateStatus.style.color = 'var(--color-success, #22c55e)';
    }
  }
}

async function refreshUpdateStatus(force = false) {
  if (!window.boostyOverlay?.getUpdateStatus) return;
  try {
    const status = force && window.boostyOverlay.checkForUpdates
      ? await window.boostyOverlay.checkForUpdates()
      : await window.boostyOverlay.getUpdateStatus();
    renderUpdateStatus(status);
  } catch {}
}

// --- App Initialization ---
async function init() {
  try {
    setupEventListeners();
    initAppearanceUiMode();
    await renderBrowserSelection();

    try {
      if (window.boostyOverlay?.getAppVersion) {
        appVersion = await window.boostyOverlay.getAppVersion();
      }
      if (window.boostyOverlay?.hasObsExecutable) {
        hasObsExecutableCached = await window.boostyOverlay.hasObsExecutable();
      }
      if (window.boostyOverlay?.getExtensionInfo) {
        const extInfo = await window.boostyOverlay.getExtensionInfo();
        const techExtPath = document.querySelector('#tech-ext-path');
        if (techExtPath && extInfo?.persistentPath) {
          techExtPath.textContent = extInfo.persistentPath;
        }
      }
    } catch {}

    const versionBadge = document.querySelector('#app-version-badge');
    const techAppVersion = document.querySelector('#tech-app-version');
    if (versionBadge) versionBadge.textContent = `v${appVersion}`;
    if (techAppVersion) techAppVersion.textContent = appVersion;

    // Listen for port conflict
    if (window.boostyOverlay?.onPortConflict) {
      window.boostyOverlay.onPortConflict(({ port }) => {
        const banner = document.querySelector('#system-readiness-banner');
        if (banner) {
          banner.className = 'status-banner banner-warning';
          banner.style.display = 'flex';
          banner.textContent = `Конфликт портов: порт ${port} уже занят другим приложением.`;
        }
      });
    }

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

    // Check updates
    await refreshUpdateStatus(false);
    setInterval(() => refreshUpdateStatus(false), 30 * 60 * 1000);
  } catch (err) {
    console.error('Init error:', err);
  } finally {
    window.__APP_INITIALIZED__ = true;
  }
}

const initPromise = init();

// --- UI Audit & Visual QA Automation Hook ---
if (window.boostyAudit) {
  async function applyAuditState(state) {
    await initPromise;
    const mock = (state && state.mock) ? state.mock : (state || {});

    if (typeof mock.hasObsExecutable === 'boolean') {
      hasObsExecutableCached = mock.hasObsExecutable;
    }

    if (mock.simulatedStartupTiming !== undefined) {
      simulatedStartupTiming = mock.simulatedStartupTiming;
    } else {
      recoveryTimestamp = null;
    }

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

    if (mock.appearanceUiMode) {
      setAppearanceUiMode(mock.appearanceUiMode, false);
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
      if (!previewReady) {
        initPreviewIframe();
      }
      sendConfigToPreview(effectiveConfig);
      updatePresetUi(detectActivePreset(effectiveConfig));
      await waitForPreviewAck(800);
    } else if (mock.view === 'appearance' || (mock.view === 'main' && mock.focusSettings)) {
      if (!previewReady) {
        initPreviewIframe();
      }
      await waitForPreviewAck(800);
    }

    updateContextualActionCard();
    renderStatusHubUi();
    updateAuditDiagnosticState();

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  window.boostyAudit.onApplyState(applyAuditState);

  window.__BOOSTY_UI_TEST__ = {
    setState: applyAuditState,
    applyState: applyAuditState,
    getState: () => ({
      currentView,
      currentStep,
      appearanceUiMode,
      latestHealth,
      latestObsStatus,
      latestObsScenes,
    }),
    setSimulatedStartupTiming: (timing) => {
      simulatedStartupTiming = timing;
      updateContextualActionCard();
      renderStatusHubUi();
    },
    getDiagnosticSnapshot: () => ({
      startupElapsedMs: getStartupElapsedMs(),
      serverReadyAt,
      extensionDetectedAt,
      boostyTabDetectedAt,
      chatDetectedAt,
      readyAt,
      expectedReadyMs: typeof BoostyStatusHub !== 'undefined' ? BoostyStatusHub.CONNECTIVITY_EXPECTED_READY_MS : 5000,
      normalThresholdMs: typeof BoostyStatusHub !== 'undefined' ? BoostyStatusHub.CONNECTIVITY_NORMAL_THRESHOLD_MS : 5500,
      recoveryDurationMs,
      extension: {
        state: latestHealth?.extension?.state || (latestHealth?.extensionConnected ? 'connected' : 'unavailable'),
        lastSeenAt: latestHealth?.extension?.lastSeenAt ?? latestHealth?.extensionLastSeenAt ?? null,
        version: latestHealth?.extension?.version ?? latestHealth?.extensionVersion ?? null,
      },
      boosty: {
        state: latestHealth?.boosty?.state || (latestHealth?.boostyConnected ? 'tab-detected' : 'unavailable'),
        lastSeenAt: latestHealth?.boosty?.lastSeenAt ?? latestHealth?.boostyLastSeenAt ?? null,
        tabUrl: latestHealth?.boosty?.tabUrl ?? latestHealth?.boostyTabUrl ?? null,
        hasChat: Boolean(latestHealth?.boosty?.hasChat),
      },
      activeTabs: latestHealth?.boosty?.activeTabsCount ?? (latestHealth?.boostyTabUrl ? 1 : 0),
      lastHeartbeat: latestHealth?.connectorLastSeenAt ?? null,
      startupElapsed: latestHealth?.startupElapsed ?? 0,
      isChecking: Date.now() < checkGraceDeadline,
    }),
  };

  document.fonts.ready.then(() => {
    window.boostyAudit.notifyReady();
  });
}
