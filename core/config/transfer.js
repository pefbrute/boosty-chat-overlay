'use strict';

const { normalizeConfig } = require('./schema.js');

const EXPORT_SCHEMA_VERSION = 1;

/**
 * List of keys safe and appropriate to export and share.
 * Strictly excludes secrets (obsPassword), server endpoints (obsHost, obsPort),
 * private credentials, local paths, and runtime history.
 */
const EXPORTABLE_CONFIG_KEYS = [
  'durationSeconds',
  'maxMessages',
  'fontSize',
  'authorFontSize',
  'cardWidth',
  'borderRadius',
  'cardPadding',
  'messageGap',
  'avatarSize',
  'backdropBlur',
  'backgroundOpacity',
  'accentColor',
  'textColor',
  'backgroundColor',
  'showAvatars',
  'shadow',
  'horizontalAnchor',
  'verticalAnchor',
  'newMessagePosition',
  'offsetX',
  'offsetY',
  'textAlign',
  'maxStackHeight',
  'animationType',
  'animationDurationMs',
  'autoOpenChatMonitor',
];

/**
 * Builds an export payload from active configuration.
 *
 * @param {object} config
 * @returns {object} Clean, portable JSON export structure without secrets.
 */
function createExportPayload(config = {}) {
  const safeSettings = {};
  for (const key of EXPORTABLE_CONFIG_KEYS) {
    if (config[key] !== undefined) {
      safeSettings[key] = config[key];
    }
  }

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appName: 'Boosty Chat Overlay',
    exportedAt: new Date().toISOString(),
    settings: safeSettings,
  };
}

/**
 * Validates and parses an imported configuration object or JSON string.
 *
 * @param {string|object} rawInput
 * @param {object} currentConfig
 * @returns {{ ok: true, config: object, diff: object } | { ok: false, error: string }}
 */
function validateImportPayload(rawInput, currentConfig = {}) {
  let parsed = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      return { ok: false, error: 'Файл содержит некорректный JSON' };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Конфигурация должна быть JSON-объектом' };
  }

  // Support both wrapped export payload { schemaVersion, settings: {...} } and direct flat config
  let candidateSettings = parsed;
  if (parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)) {
    if (parsed.schemaVersion !== undefined) {
      const ver = Number(parsed.schemaVersion);
      if (!Number.isFinite(ver) || ver < 1 || ver > EXPORT_SCHEMA_VERSION) {
        return { ok: false, error: `Неподдерживаемая версия схемы конфигурации (${parsed.schemaVersion})` };
      }
    }
    candidateSettings = parsed.settings;
  }

  // Filter out any forbidden keys (passwords, tokens, hidden fields)
  const sanitizedInput = {};
  for (const key of EXPORTABLE_CONFIG_KEYS) {
    if (candidateSettings[key] !== undefined) {
      sanitizedInput[key] = candidateSettings[key];
    }
  }

  if (Object.keys(sanitizedInput).length === 0) {
    return { ok: false, error: 'В файле не найдено допустимых настроек для импорта' };
  }

  // Normalize using canonical schema, retaining current unexported settings (e.g. obsHost, obsPort, obsPassword)
  const normalized = normalizeConfig(sanitizedInput, currentConfig);

  // Compute what actually changed
  const diff = {};
  for (const key of EXPORTABLE_CONFIG_KEYS) {
    if (normalized[key] !== currentConfig[key]) {
      diff[key] = {
        previous: currentConfig[key],
        next: normalized[key],
      };
    }
  }

  return {
    ok: true,
    config: normalized,
    diff,
  };
}

function exportSettings(config = {}) {
  const payload = createExportPayload(config);
  return {
    app: 'boosty-chat-overlay',
    schemaVersion: payload.schemaVersion,
    exportedAt: payload.exportedAt,
    config: payload.settings,
  };
}

function importSettings(rawInput, currentConfig = {}) {
  let input = rawInput;
  if (typeof rawInput === 'string') {
    try {
      input = JSON.parse(rawInput);
    } catch {
      return { success: false, error: 'Файл содержит некорректный JSON', config: currentConfig, changed: false };
    }
  }

  // Handle { app, schemaVersion, config: {...} } format as well
  let targetInput = input;
  if (input && typeof input === 'object' && input.config && typeof input.config === 'object') {
    targetInput = {
      schemaVersion: input.schemaVersion,
      settings: input.config,
    };
  }

  const res = validateImportPayload(targetInput, currentConfig);
  if (!res.ok) {
    return {
      success: false,
      error: res.error,
      config: currentConfig,
      changed: false,
    };
  }
  return {
    success: true,
    config: res.config,
    changed: Object.keys(res.diff || {}).length > 0,
    diff: res.diff,
  };
}

module.exports = {
  EXPORT_SCHEMA_VERSION,
  EXPORTABLE_CONFIG_KEYS,
  createExportPayload,
  validateImportPayload,
  exportSettings,
  importSettings,
};

if (typeof globalThis !== 'undefined') {
  globalThis.BoostyTransfer = {
    EXPORT_SCHEMA_VERSION,
    EXPORTABLE_CONFIG_KEYS,
    createExportPayload,
    validateImportPayload,
    exportSettings,
    importSettings,
  };
}
