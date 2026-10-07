const { defaultConfig } = require('./defaults.js');

const ANIMATION_TYPES = ['none', 'fade', 'slide-up', 'slide-side'];
const ANIMATION_DURATION_MIN = 150;
const ANIMATION_DURATION_MAX = 1000;
const ANIMATION_DURATION_DEFAULT = 280;

/**
 * Validates and normalizes message animation type.
 *
 * @param {unknown} value
 * @param {string} [fallback='fade']
 * @returns {'none' | 'fade' | 'slide-up' | 'slide-side'}
 */
function normalizeAnimationType(value, fallback = 'fade') {
  const safeFallback =
    typeof fallback === 'string' && ANIMATION_TYPES.includes(fallback.trim().toLowerCase())
      ? fallback.trim().toLowerCase()
      : 'fade';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (ANIMATION_TYPES.includes(normalized)) {
      return normalized;
    }
  }
  return safeFallback;
}

/**
 * Validates and clamps message animation duration in milliseconds (150..1000).
 *
 * @param {unknown} value
 * @param {number} [fallback=280]
 * @returns {number}
 */
function normalizeAnimationDuration(value, fallback = ANIMATION_DURATION_DEFAULT) {
  const parsedFallback = Number(fallback);
  const safeFallback = Number.isFinite(parsedFallback)
    ? Math.round(Math.min(ANIMATION_DURATION_MAX, Math.max(ANIMATION_DURATION_MIN, parsedFallback)))
    : ANIMATION_DURATION_DEFAULT;
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') {
    return safeFallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return safeFallback;
  }
  return Math.round(Math.min(ANIMATION_DURATION_MAX, Math.max(ANIMATION_DURATION_MIN, parsed)));
}

/**
 * Validates and normalizes overlay configuration.
 *
 * @param {object} [input] Raw or partial configuration object.
 * @param {object} [current] Baseline configuration to fall back onto (defaults to defaultConfig).
 * @returns {object} Fully validated and normalized configuration.
 */
function normalizeConfig(input, current = defaultConfig) {
  const base = current || defaultConfig;
  const number = (value, min, max, fallback) => {
    if (value === undefined || value === null) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const hex = (value, fallback) => {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) {
      return value.trim().toLowerCase();
    }
    return fallback;
  };
  const bool = (value, fallback) => {
    if (value === undefined || value === null) return fallback;
    return Boolean(value);
  };
  const choice = (value, allowed, fallback) => {
    if (typeof value === 'string' && allowed.includes(value.trim().toLowerCase())) {
      return value.trim().toLowerCase();
    }
    return fallback;
  };

  const hostVal = (value, fallback) => {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return fallback || '127.0.0.1';
  };
  const portVal = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) ? Math.round(parsed) : fallback;
  };
  const passwordVal = (value, fallback) => {
    if (value === undefined || value === null) return fallback ?? '';
    return String(value);
  };

  const rawAnimType =
    input?.animationType !== undefined ? input.animationType : input?.animation?.type;
  const baseAnimType = normalizeAnimationType(
    base.animationType ?? base.animation?.type,
    defaultConfig.animationType ?? 'fade'
  );

  const rawAnimDuration =
    input?.animationDurationMs !== undefined
      ? input.animationDurationMs
      : input?.animation?.durationMs;
  const baseAnimDuration = normalizeAnimationDuration(
    base.animationDurationMs ?? base.animation?.durationMs,
    defaultConfig.animationDurationMs ?? ANIMATION_DURATION_DEFAULT
  );

  return {
    durationSeconds: Math.round(number(input?.durationSeconds, 0, 120, base.durationSeconds ?? 20)),
    maxMessages: Math.round(number(input?.maxMessages, 1, 20, base.maxMessages ?? 6)),
    fontSize: Math.round(number(input?.fontSize, 12, 48, base.fontSize ?? 21)),
    authorFontSize: Math.round(number(input?.authorFontSize, 12, 28, base.authorFontSize ?? 16)),
    cardWidth: Math.round(number(input?.cardWidth, 280, 760, base.cardWidth ?? 520)),
    borderRadius: Math.round(number(input?.borderRadius, 0, 24, base.borderRadius ?? 10)),
    cardPadding: Math.round(number(input?.cardPadding, 6, 24, base.cardPadding ?? 10)),
    messageGap: Math.round(number(input?.messageGap, 4, 24, base.messageGap ?? 10)),
    avatarSize: Math.round(number(input?.avatarSize, 24, 64, base.avatarSize ?? 42)),
    backdropBlur: Math.round(number(input?.backdropBlur, 0, 20, base.backdropBlur ?? 0)),
    backgroundOpacity: Math.round(number(input?.backgroundOpacity, 0, 100, base.backgroundOpacity ?? 88)),
    accentColor: hex(input?.accentColor, base.accentColor ?? '#f15f2c'),
    textColor: hex(input?.textColor, base.textColor ?? '#ffffff'),
    backgroundColor: hex(input?.backgroundColor, base.backgroundColor ?? '#121216'),
    showAvatars: bool(input?.showAvatars, base.showAvatars ?? true),
    shadow: bool(input?.shadow, base.shadow ?? true),
    horizontalAnchor: choice(input?.horizontalAnchor, ['left', 'right'], base.horizontalAnchor ?? 'left'),
    verticalAnchor: choice(input?.verticalAnchor, ['top', 'bottom'], base.verticalAnchor ?? 'bottom'),
    newMessagePosition: choice(input?.newMessagePosition, ['top', 'bottom'], base.newMessagePosition ?? 'bottom'),
    offsetX: Math.round(number(input?.offsetX, 0, 1000, base.offsetX ?? 20)),
    offsetY: Math.round(number(input?.offsetY, 0, 800, base.offsetY ?? 20)),
    textAlign: choice(input?.textAlign, ['left', 'center', 'right'], base.textAlign ?? 'left'),
    maxStackHeight: Math.round(number(input?.maxStackHeight, 160, 2160, base.maxStackHeight ?? 800)),
    animationType: normalizeAnimationType(rawAnimType, baseAnimType),
    animationDurationMs: normalizeAnimationDuration(rawAnimDuration, baseAnimDuration),
    obsHost: hostVal(input?.obsHost, base.obsHost ?? '127.0.0.1'),
    obsPort: portVal(input?.obsPort, base.obsPort ?? 4455),
    obsPassword: passwordVal(input?.obsPassword, base.obsPassword ?? ''),
    autoOpenChatMonitor: bool(input?.autoOpenChatMonitor, base.autoOpenChatMonitor ?? false),
  };
}

module.exports = {
  ANIMATION_TYPES,
  ANIMATION_DURATION_MIN,
  ANIMATION_DURATION_MAX,
  ANIMATION_DURATION_DEFAULT,
  normalizeAnimationType,
  normalizeAnimationDuration,
  normalizeConfig,
  normalizedConfig: normalizeConfig,
};

if (typeof globalThis !== 'undefined') {
  globalThis.BoostySchema = {
    ANIMATION_TYPES,
    ANIMATION_DURATION_MIN,
    ANIMATION_DURATION_MAX,
    ANIMATION_DURATION_DEFAULT,
    normalizeAnimationType,
    normalizeAnimationDuration,
    normalizeConfig,
    normalizedConfig: normalizeConfig,
  };
}
