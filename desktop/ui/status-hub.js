/**
 * Connectivity Progress & Expected Timing Constants.
 * Grounded in empirical measurement series across 10 real startup cycles:
 * Server ready: ~0.6s
 * Extension + Tab + Ready: median 2.55s, p90 2.58s, max cold 4.65s.
 */
const CONNECTIVITY_EXPECTED_READY_MS = 5000;
const CONNECTIVITY_NORMAL_THRESHOLD_MS = 5500;

function formatElapsedSeconds(ms) {
  const sec = Math.max(0, ms) / 1000;
  return sec < 10 ? sec.toFixed(1) : Math.round(sec).toString();
}

function compareSemver(v1, v2) {
  if (!v1 || !v2) return 0;
  const p1 = String(v1).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const p2 = String(v2).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Derives user-facing system status from backend telemetry and OBS state.
 *
 * @param {object} [state]
 * @param {object} [state.health] State from /health endpoint
 * @param {object} [state.obs] State from OBS listScenes/getStatus
 * @param {boolean} [state.hasObsExecutable=true]
 * @param {boolean} [state.isChecking=false]
 * @param {number} [state.elapsedMs=0]
 * @param {number} [state.recoveryDurationMs=null]
 * @param {boolean} [state.isRecoveredRecently=false]
 * @returns {object} Derived status tree with states, text, details, and actionable CTAs.
 */
function deriveSystemStatus(state = {}) {
  const health = state.health || {};
  const obs = state.obs || {};
  const hasObsExecutable = state.hasObsExecutable !== false;
  const isChecking = Boolean(state.isChecking);

  // 1. OBS Status
  const isObsConnected = Boolean(obs.ok && obs.connected);
  const isRestartRequired = Boolean(obs.restartRequired);
  const rawScenes = Array.isArray(obs.scenes) ? obs.scenes : [];
  const activeScene = rawScenes.find(s => s.hasChat) || rawScenes[0];

  let obsItem = {
    key: 'obs',
    status: 'not-running',
    badgeClass: 'pending',
    title: 'OBS Studio',
    text: 'Не запущен',
    detail: 'Запустите OBS Studio',
    action: {
      id: 'launch-obs',
      label: 'Запустить OBS',
      primary: true,
    },
  };

  if (isRestartRequired) {
    obsItem = {
      key: 'obs',
      status: 'restart-required',
      badgeClass: 'warning',
      title: 'OBS Studio',
      text: 'Требуется перезапуск',
      detail: 'OBS WebSocket включён. Перезапустите OBS',
      action: {
        id: 'restart-obs',
        label: 'Перезапустить OBS',
        primary: true,
      },
    };
  } else if (isObsConnected) {
    obsItem = {
      key: 'obs',
      status: 'connected',
      badgeClass: 'ready',
      title: 'OBS Studio',
      text: 'Подключено',
      detail: activeScene ? `Сцена: ${activeScene.sceneName}` : 'Сцены загружены',
      action: null,
    };
  } else if (!hasObsExecutable) {
    obsItem = {
      key: 'obs',
      status: 'not-installed',
      badgeClass: 'error',
      title: 'OBS Studio',
      text: 'Не найден',
      detail: 'Установите OBS Studio',
      action: null,
    };
  } else if (isChecking) {
    obsItem = {
      key: 'obs',
      status: 'connecting',
      badgeClass: 'pending',
      title: 'OBS Studio',
      text: 'Проверка…',
      detail: 'Ищем подключение к OBS',
      action: null,
    };
  }

  // 2. Extension Status
  // Read canonical lifecycle state: 'checking' | 'connected' | 'reconnecting' | 'unavailable'
  let extLifecycle = health.extension?.state;
  if (!extLifecycle) {
    if (health.extensionConnected) {
      extLifecycle = 'connected';
    } else if (isChecking) {
      extLifecycle = 'checking';
    } else {
      extLifecycle = 'unavailable';
    }
  }

  const elapsedMs = typeof state.elapsedMs === 'number' ? Math.max(0, state.elapsedMs) : 0;
  const elapsedSecStr = formatElapsedSeconds(elapsedMs);

  const isOutdated = Boolean(health.isOutdated);
  let extItem;

  if (extLifecycle === 'checking') {
    extItem = {
      key: 'extension',
      status: 'checking',
      badgeClass: 'pending',
      title: 'Расширение',
      text: elapsedMs >= 1500 ? `Проверяем… · ${elapsedSecStr} сек` : 'Проверяем…',
      detail: 'Ищем связь с браузером',
      action: null,
    };
  } else if (extLifecycle === 'connected') {
    const isMigrationRequired = Boolean(health.extensionMigrationRequired || health.isLegacyExtension);
    const runningVersion = health.extension?.version || health.extensionVersion;
    const isReloadRequired = Boolean(
      health.persistentExtensionVersion &&
      runningVersion &&
      compareSemver(health.persistentExtensionVersion, runningVersion) > 0
    );

    if (isMigrationRequired) {
      extItem = {
        key: 'extension',
        status: 'migration-required',
        badgeClass: 'warning',
        title: 'Расширение',
        text: 'Требуется обновление',
        detail: 'Установлена старая версия расширения. Обновите её, чтобы дальнейшие обновления работали корректно.',
        action: {
          id: 'migrate-ext',
          label: 'Обновить расширение',
          primary: true,
        },
      };
    } else if (isReloadRequired) {
      extItem = {
        key: 'extension',
        status: 'reload-required',
        badgeClass: 'warning',
        title: 'Расширение',
        text: 'Перезагрузите расширение',
        detail: 'Расширение обновлено на диске — перезагрузите его в браузере',
        action: {
          id: 'reload-ext',
          label: 'Перезагрузить',
          primary: true,
        },
      };
    } else if (isOutdated) {
      extItem = {
        key: 'extension',
        status: 'outdated',
        badgeClass: 'warning',
        title: 'Расширение',
        text: 'Требует обновления',
        detail: `Доступна v${health.bundledExtensionVersion || '0.4.0'}`,
        action: {
          id: 'update-ext',
          label: 'Обновить расширение',
          primary: true,
        },
      };
    } else {
      const ver = runningVersion;
      extItem = {
        key: 'extension',
        status: 'connected',
        badgeClass: 'ready',
        title: 'Расширение',
        text: 'Активно',
        detail: ver ? `v${ver}` : 'Связь установлена',
        action: null,
      };
    }
  } else if (extLifecycle === 'reconnecting') {
    const secAgo = health.extension?.lastSeenSecondsAgo;
    extItem = {
      key: 'extension',
      status: 'reconnecting',
      badgeClass: 'warning',
      title: 'Расширение',
      text: 'Переподключение…',
      detail: (typeof secAgo === 'number' && secAgo >= 0) ? `Последний сигнал ${secAgo} сек назад` : 'Восстанавливаем связь',
      action: null,
    };
  } else {
    // unavailable
    extItem = {
      key: 'extension',
      status: 'not-detected',
      badgeClass: 'pending',
      title: 'Расширение',
      text: 'Не обнаружено',
      detail: 'Установите расширение в браузер',
      action: {
        id: 'setup-ext',
        label: 'Настроить',
        primary: true,
      },
    };
  }

  // 3. Boosty Status
  // Read canonical lifecycle state: 'checking' | 'tab-detected' | 'chat-detected' | 'unavailable'
  let boostyLifecycle = health.boosty?.state;
  if (!boostyLifecycle) {
    if (health.boostyConnected) {
      boostyLifecycle = health.boosty?.hasChat ? 'chat-detected' : 'tab-detected';
    } else if (extLifecycle === 'checking' || isChecking) {
      boostyLifecycle = 'checking';
    } else {
      boostyLifecycle = 'unavailable';
    }
  }

  const rawUrl = health.boosty?.tabUrl || health.boostyTabUrl || '';
  const cleanUrl = rawUrl ? rawUrl.replace(/^https?:\/\/(www\.)?boosty\.to\//, 'boosty.to/') : '';

  let streamItem;

  // Sequential dependency: If extension is not yet connected, Boosty card shows "Ожидаем расширение"
  if (extLifecycle === 'checking') {
    streamItem = {
      key: 'stream',
      status: 'checking',
      badgeClass: 'pending',
      title: 'Boosty',
      text: 'Ожидаем расширение',
      detail: 'Сначала проверяем связь с браузером',
      action: null,
    };
  } else if (extLifecycle === 'reconnecting') {
    streamItem = {
      key: 'stream',
      status: 'checking',
      badgeClass: 'pending',
      title: 'Boosty',
      text: 'Ожидаем расширение',
      detail: 'Восстанавливаем связь с браузером',
      action: null,
    };
  } else if (extLifecycle === 'unavailable' && boostyLifecycle === 'unavailable') {
    streamItem = {
      key: 'stream',
      status: 'not-found',
      badgeClass: 'pending',
      title: 'Boosty',
      text: 'Вкладка не найдена',
      detail: 'Откройте Boosty в браузере',
      action: {
        id: 'open-boosty',
        label: 'Открыть Boosty',
        primary: true,
      },
    };
  } else if (boostyLifecycle === 'checking') {
    streamItem = {
      key: 'stream',
      status: 'checking',
      badgeClass: 'pending',
      title: 'Boosty',
      text: 'Ищем вкладку…',
      detail: 'Проверяем открытые страницы',
      action: null,
    };
  } else if (boostyLifecycle === 'chat-detected') {
    streamItem = {
      key: 'stream',
      status: 'connected',
      badgeClass: 'ready',
      title: 'Boosty',
      text: 'Чат подключён',
      detail: cleanUrl || 'Готов к захвату сообщений',
      action: null,
    };
  } else if (boostyLifecycle === 'tab-detected') {
    streamItem = {
      key: 'stream',
      status: 'tab-detected',
      badgeClass: 'ready',
      title: 'Boosty',
      text: 'Вкладка открыта',
      detail: cleanUrl ? `${cleanUrl} · Ожидаем чат` : 'Ожидаем чат',
      action: null,
    };
  } else {
    // unavailable
    streamItem = {
      key: 'stream',
      status: 'not-found',
      badgeClass: 'pending',
      title: 'Boosty',
      text: 'Вкладка не найдена',
      detail: extLifecycle === 'connected' ? 'Откройте вкладку со стримом' : 'Откройте Boosty в браузере',
      action: {
        id: 'open-boosty',
        label: 'Открыть Boosty',
        primary: true,
      },
    };
  }

  // 4. Overlay in OBS Status
  const scenesWithChat = rawScenes.filter(s => s.hasChat);
  let overlayItem = {
    key: 'overlay',
    status: 'obs-disconnected',
    badgeClass: 'pending',
    title: 'Оверлей в OBS',
    text: 'OBS не подключён',
    detail: 'Подключите OBS Studio',
    action: null,
  };

  if (isObsConnected) {
    if (Number(obs.duplicateCount) > 0) {
      overlayItem = {
        key: 'overlay',
        status: 'ready',
        badgeClass: 'warning',
        title: 'Оверлей в OBS',
        text: 'Обнаружены дубликаты оверлея OBS',
        detail: 'Автоматическое объединение в один источник…',
        action: null,
      };
    } else if (scenesWithChat.length > 0) {
      const names = scenesWithChat.map(s => s.sceneName).join(', ');
      overlayItem = {
        key: 'overlay',
        status: 'ready',
        badgeClass: 'ready',
        title: 'Оверлей в OBS',
        text: 'Добавлен в OBS',
        detail: `Сцена: ${names}`,
        action: {
          id: 'test-overlay',
          label: 'Тестовое сообщение',
          primary: false,
        },
      };
    } else {
      overlayItem = {
        key: 'overlay',
        status: 'not-added',
        badgeClass: 'pending',
        title: 'Оверлей в OBS',
        text: 'Не добавлен в сцену',
        detail: 'Добавьте оверлей в сцену стрима',
        action: {
          id: 'add-overlay',
          label: 'Добавить в сцену',
          primary: true,
        },
      };
    }
  }

  // 5. Overall System Readiness
  const isHealthyExt = (extLifecycle === 'connected');
  const isHealthyBoosty = (boostyLifecycle === 'chat-detected' || boostyLifecycle === 'tab-detected');
  const allReady = (
    obsItem.status === 'connected' &&
    isHealthyExt &&
    isHealthyBoosty &&
    overlayItem.status === 'ready'
  );

  let overall;

  const isRecoveredRecently = Boolean(state.isRecoveredRecently);
  const recoveryDurationMs = typeof state.recoveryDurationMs === 'number' ? state.recoveryDurationMs : null;

  let progress = {
    phase: 'idle',
    elapsedMs,
    elapsedText: '',
    expectedText: '',
    isLongerThanUsual: false,
    recoveryText: null,
    milestones: [],
  };

  if (allReady) {
    if (isRecoveredRecently && recoveryDurationMs !== null) {
      const recSec = formatElapsedSeconds(recoveryDurationMs);
      const recText = `Подключение восстановлено за ${recSec} сек`;
      progress.phase = 'recovered';
      progress.recoveryText = recText;
      overall = {
        ready: true,
        status: 'ready',
        title: 'Подключение восстановлено',
        desc: recText,
        progress,
      };
    } else {
      overall = {
        ready: true,
        status: 'ready',
        title: 'Готово к стриму',
        desc: 'Все компоненты активны и получают сообщения',
        progress,
      };
    }
  } else if (extLifecycle === 'checking' || boostyLifecycle === 'checking' || isChecking) {
    const isLonger = elapsedMs >= CONNECTIVITY_NORMAL_THRESHOLD_MS;
    progress.phase = 'checking';
    progress.isLongerThanUsual = isLonger;
    progress.elapsedText = `Прошло ${elapsedSecStr} сек`;
    progress.expectedText = 'Обычно занимает до 5 сек';

    const isExtDone = (extLifecycle === 'connected');
    const isTabDone = (boostyLifecycle === 'tab-detected' || boostyLifecycle === 'chat-detected');
    const isChatDone = (boostyLifecycle === 'chat-detected');

    progress.milestones = [
      { id: 'server', label: 'Локальный сервер готов', state: 'done' },
      {
        id: 'extension',
        label: isExtDone ? 'Расширение подключено' : 'Ищем расширение…',
        state: isExtDone ? 'done' : 'active',
      },
      {
        id: 'tab',
        label: isTabDone ? 'Вкладка Boosty найдена' : (isExtDone ? 'Ищем вкладку Boosty…' : 'Проверяем вкладку Boosty'),
        state: isTabDone ? 'done' : (isExtDone ? 'active' : 'pending'),
      },
      {
        id: 'chat',
        label: isChatDone ? 'Чат подключён' : (isTabDone ? 'Ожидаем чат…' : 'Проверяем чат'),
        state: isChatDone ? 'done' : (isTabDone ? 'active' : 'pending'),
      },
    ];

    overall = {
      ready: false,
      status: 'connecting',
      title: isLonger ? 'Это занимает чуть дольше обычного…' : 'Восстанавливаем подключение',
      desc: isLonger ? 'Проверяем браузер и расширение…' : 'Проверяем браузер и расширение…',
      progress,
    };
  } else if (extLifecycle === 'reconnecting') {
    progress.phase = 'reconnecting';
    progress.elapsedText = `Переподключаемся… ${elapsedSecStr} сек`;
    progress.expectedText = 'Обычно связь восстанавливается за несколько секунд';
    progress.milestones = [
      { id: 'server', label: 'Локальный сервер готов', state: 'done' },
      { id: 'extension', label: 'Восстанавливаем связь…', state: 'active' },
      { id: 'tab', label: 'Вкладка Boosty', state: 'pending' },
      { id: 'chat', label: 'Чат', state: 'pending' },
    ];

    overall = {
      ready: false,
      status: 'connecting',
      title: 'Переподключение…',
      desc: 'Связь с расширением кратковременно прервалась',
      progress,
    };
  } else if (!isHealthyExt) {
    overall = {
      ready: false,
      status: 'setup-required',
      title: 'Расширение не отвечает',
      desc: 'Проверьте браузер или установите расширение',
      progress,
    };
  } else if (!isHealthyBoosty) {
    overall = {
      ready: false,
      status: 'setup-required',
      title: 'Вкладка Boosty не найдена',
      desc: 'Откройте страницу со стримом в браузере',
      progress,
    };
  } else if (!isObsConnected) {
    overall = {
      ready: false,
      status: 'setup-required',
      title: 'OBS не подключён',
      desc: 'Запустите OBS Studio для отображения чата',
      progress,
    };
  } else {
    overall = {
      ready: false,
      status: 'setup-required',
      title: 'Требуется настройка',
      desc: 'Подключите компоненты для запуска чата',
      progress,
    };
  }

  return {
    obs: obsItem,
    extension: extItem,
    stream: streamItem,
    overlay: overlayItem,
    overall,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    deriveSystemStatus,
    CONNECTIVITY_EXPECTED_READY_MS,
    CONNECTIVITY_NORMAL_THRESHOLD_MS,
  };
} else {
  globalThis.BoostyStatusHub = {
    deriveSystemStatus,
    CONNECTIVITY_EXPECTED_READY_MS,
    CONNECTIVITY_NORMAL_THRESHOLD_MS,
  };
}
