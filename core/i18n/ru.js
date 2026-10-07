'use strict';

/**
 * Boosty Chat Overlay — Central Russian Localization Layer v1
 * Single source of truth for user-facing UI labels, statuses, roles, and error mappings.
 * All internal logic, API models, IPC channels, and database contracts remain in English.
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BoostyI18nRu = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  /**
   * Russian display titles for technical issue categories.
   */
  const TECHNICAL_ISSUE_TYPES = {
    audio_missing: 'Нет звука',
    audio_low: 'Слишком тихо',
    audio_high: 'Слишком громко',
    audio_sync: 'Рассинхрон',
    video_missing: 'Нет изображения',
    stream_freeze: 'Стрим завис',
    stream_lag: 'Лагает',
    quality: 'Проблемы с качеством',
  };

  /**
   * Russian severity labels (sentence case).
   */
  const SEVERITIES = {
    none: '',
    possible: 'Возможная проблема',
    probable: 'Вероятная проблема',
    critical: 'Критично',
  };

  /**
   * Russian severity labels (uppercase for sticky banner headers).
   */
  const SEVERITIES_UPPERCASE = {
    none: '',
    possible: 'ВОЗМОЖНАЯ ПРОБЛЕМА',
    probable: 'ВЕРОЯТНАЯ ПРОБЛЕМА',
    critical: 'КРИТИЧНО',
  };

  /**
   * Russian role display names.
   */
  const ROLES = {
    streamer: 'Стример',
    moderator: 'Модератор',
    user: 'Зритель',
    viewer: 'Зритель',
  };

  /**
   * Russian connection status labels.
   */
  const CONNECTION_STATUSES = {
    waiting: 'Ожидание сообщений',
    connecting: 'Подключение…',
    connected: 'Подключено',
    live: 'В эфире',
    reconnecting: 'Переподключение…',
    error: 'Ошибка',
    disconnected: 'Отключено',
    offline: 'Не в сети',
    paused: 'Пауза',
  };

  /**
   * Russian update checker states.
   */
  const UPDATE_STATUSES = {
    checking: 'Проверяем обновления…',
    update_available: 'Доступно обновление',
    up_to_date: 'Установлена актуальная версия',
    error: 'Не удалось проверить обновления',
  };

  /**
   * Patterns to translate raw OBS Studio errors to readable Russian sentences.
   */
  const OBS_ERRORS = [
    { pattern: /auth(entication)?[-_\s]*(failed|required)|not identified|identify/i, text: 'Не удалось авторизоваться в OBS' },
    { pattern: /connection[-_\s]?refused|econnrefused/i, text: 'OBS недоступен. Убедитесь, что OBS Studio запущен' },
    { pattern: /not[-_\s]?running/i, text: 'OBS Studio не запущен' },
    { pattern: /not[-_\s]?connected/i, text: 'Нет подключения к OBS Studio' },
    { pattern: /source[-_\s]?not[-_\s]?found/i, text: 'Источник оверлея не найден в OBS' },
    { pattern: /scene[-_\s]?not[-_\s]?found/i, text: 'Сцена не найдена в OBS' },
    { pattern: /timed?[-_\s]?out|etimedout/i, text: 'Превышено время ожидания ответа от OBS' },
    { pattern: /restart[-_\s]?required/i, text: 'Требуется перезапуск OBS' },
  ];

  /**
   * Russian pluralization helper.
   * Selects the correct form from an array of [one, few, many]:
   *   e.g. ['сообщение', 'сообщения', 'сообщений']
   *        ['зритель', 'зрителя', 'зрителей']
   *
   * @param {number} count
   * @param {[string, string, string]} forms
   * @returns {string}
   */
  function pluralize(count, forms) {
    if (!Array.isArray(forms) || forms.length < 3) return '';
    const n = Math.abs(Number(count) || 0);
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 19) return forms[2];
    if (mod10 === 1) return forms[0];
    if (mod10 >= 2 && mod10 <= 4) return forms[1];
    return forms[2];
  }

  /**
   * Formats a count with the pluralized Russian word.
   * e.g. formatPlural(5, ['сообщение', 'сообщения', 'сообщений']) => "5 сообщений"
   *
   * @param {number} count
   * @param {[string, string, string]} forms
   * @returns {string}
   */
  function formatPlural(count, forms) {
    const n = Number(count) || 0;
    return `${n} ${pluralize(n, forms)}`;
  }

  /**
   * Returns Russian label for technical issue type.
   * Enforces strict fallback: NEVER reveals raw enum slug (e.g. audio_missing).
   *
   * @param {string} type
   * @param {string} [fallback='Техническая проблема']
   * @returns {string}
   */
  function getTechnicalIssueLabel(type, fallback = 'Техническая проблема') {
    if (typeof type === 'string' && TECHNICAL_ISSUE_TYPES[type]) {
      return TECHNICAL_ISSUE_TYPES[type];
    }
    return fallback;
  }

  /**
   * Returns Russian label for severity level.
   *
   * @param {string} severity
   * @param {{ uppercase?: boolean }} [options]
   * @returns {string}
   */
  function getSeverityLabel(severity, options = {}) {
    const isUpper = Boolean(options && options.uppercase);
    const dict = isUpper ? SEVERITIES_UPPERCASE : SEVERITIES;
    if (typeof severity === 'string' && dict[severity] !== undefined) {
      return dict[severity];
    }
    return '';
  }

  /**
   * Returns Russian label for user role.
   *
   * @param {string} role
   * @param {string} [fallback='Зритель']
   * @returns {string}
   */
  function getRoleLabel(role, fallback = 'Зритель') {
    if (typeof role === 'string' && ROLES[role]) {
      return ROLES[role];
    }
    return fallback;
  }

  /**
   * Returns Russian label for connection status.
   *
   * @param {string} status
   * @param {string} [fallback='Подключение…']
   * @returns {string}
   */
  function getConnectionStatusLabel(status, fallback = 'Подключение…') {
    if (typeof status === 'string' && CONNECTION_STATUSES[status]) {
      return CONNECTION_STATUSES[status];
    }
    return fallback;
  }

  /**
   * Maps raw OBS error string or error object into user-friendly Russian message.
   *
   * @param {any} error
   * @param {string} [fallback='Не удалось подключиться к OBS']
   * @returns {string}
   */
  function getObsErrorMessage(error, fallback = 'Не удалось подключиться к OBS') {
    if (!error) return fallback;
    const msg = String(typeof error === 'object' && error.message ? error.message : error);
    for (const item of OBS_ERRORS) {
      if (item.pattern.test(msg)) {
        return item.text;
      }
    }
    return fallback;
  }

  /**
   * Returns Russian label for update checker state.
   *
   * @param {string} status
   * @param {string} [fallback='']
   * @returns {string}
   */
  function getUpdateStatusLabel(status, fallback = '') {
    if (typeof status === 'string' && UPDATE_STATUSES[status]) {
      return UPDATE_STATUSES[status];
    }
    return fallback;
  }

  return {
    TECHNICAL_ISSUE_TYPES,
    SEVERITIES,
    SEVERITIES_UPPERCASE,
    SEVERITY_LABELS: SEVERITIES,
    SEVERITY_LABELS_UPPER: SEVERITIES_UPPERCASE,
    ROLES,
    ROLE_LABELS: ROLES,
    CONNECTION_STATUSES,
    CONNECTION_STATUS_LABELS: CONNECTION_STATUSES,
    UPDATE_STATUSES,
    UPDATE_STATUS_LABELS: UPDATE_STATUSES,
    OBS_ERRORS,
    pluralize,
    formatPlural,
    getTechnicalIssueLabel,
    getSeverityLabel,
    getRoleLabel,
    getConnectionStatusLabel,
    getObsErrorMessage,
    getUpdateStatusLabel,
  };
});
