/**
 * Status Hub - Unified System Status Derivation and Helpers.
 */

/**
 * Derives user-facing system status from backend telemetry and OBS state.
 *
 * @param {object} [state]
 * @param {object} [state.health] State from /health endpoint
 * @param {object} [state.obs] State from OBS listScenes/getStatus
 * @param {boolean} [state.hasObsExecutable=true]
 * @param {boolean} [state.isChecking=false]
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
  const isExtConnected = Boolean(health.extensionConnected);
  const isOutdated = Boolean(health.isOutdated);

  let extItem = {
    key: 'extension',
    status: 'not-detected',
    badgeClass: 'pending',
    title: 'Расширение Boosty',
    text: 'Не обнаружено',
    detail: 'Установите расширение в браузер',
    action: {
      id: 'setup-ext',
      label: 'Настроить',
      primary: true,
    },
  };

  if (isExtConnected) {
    if (isOutdated) {
      extItem = {
        key: 'extension',
        status: 'outdated',
        badgeClass: 'warning',
        title: 'Расширение Boosty',
        text: 'Требует обновления',
        detail: `Доступна v${health.bundledExtensionVersion || '0.4.0'}`,
        action: {
          id: 'update-ext',
          label: 'Обновить расширение',
          primary: true,
        },
      };
    } else {
      extItem = {
        key: 'extension',
        status: 'connected',
        badgeClass: 'ready',
        title: 'Расширение Boosty',
        text: 'Активно',
        detail: health.extensionVersion ? `v${health.extensionVersion}` : 'Связь установлена',
        action: null,
      };
    }
  } else if (isChecking) {
    extItem = {
      key: 'extension',
      status: 'checking',
      badgeClass: 'pending',
      title: 'Расширение Boosty',
      text: 'Проверка…',
      detail: 'Ищем связь с браузером',
      action: null,
    };
  }

  // 3. Boosty Stream Page Status
  const isBoostyConnected = Boolean(health.boostyConnected);

  let streamItem = {
    key: 'stream',
    status: 'disabled',
    badgeClass: 'pending',
    title: 'Стрим Boosty',
    text: 'Недоступно',
    detail: 'Сначала подключите расширение',
    action: null,
  };

  if (isBoostyConnected) {
    const rawUrl = health.boostyTabUrl || '';
    const cleanUrl = rawUrl ? rawUrl.replace(/^https?:\/\/(www\.)?boosty\.to\//, 'boosty.to/') : 'Страница открыта';
    streamItem = {
      key: 'stream',
      status: 'connected',
      badgeClass: 'ready',
      title: 'Стрим Boosty',
      text: 'Обнаружен',
      detail: cleanUrl,
      action: null,
    };
  } else if (isExtConnected) {
    streamItem = {
      key: 'stream',
      status: 'not-found',
      badgeClass: 'pending',
      title: 'Стрим Boosty',
      text: 'Не открыт',
      detail: 'Откройте вкладку со стримом',
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
    if (scenesWithChat.length > 0) {
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
  const allReady = (
    obsItem.status === 'connected' &&
    extItem.status === 'connected' &&
    streamItem.status === 'connected' &&
    overlayItem.status === 'ready'
  );

  let overall = {
    ready: false,
    status: isChecking ? 'connecting' : 'setup-required',
    title: isChecking ? 'Проверяем подключения…' : 'Требуется настройка',
    desc: isChecking ? 'Ищем расширение браузера и связь с OBS…' : 'Подключите компоненты для запуска чата',
  };

  if (allReady) {
    overall = {
      ready: true,
      status: 'ready',
      title: 'Готово к стриму',
      desc: 'Все компоненты активны и получают сообщения',
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
  };
} else {
  globalThis.BoostyStatusHub = {
    deriveSystemStatus,
  };
}
