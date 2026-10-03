const { defaultConfig } = require('./defaults.js');

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
    offsetX: Math.round(number(input?.offsetX, 0, 300, base.offsetX ?? 20)),
    offsetY: Math.round(number(input?.offsetY, 0, 300, base.offsetY ?? 20)),
    textAlign: choice(input?.textAlign, ['left', 'center', 'right'], base.textAlign ?? 'left'),
    maxStackHeight: Math.round(number(input?.maxStackHeight, 160, 2160, base.maxStackHeight ?? 800)),
  };
}

module.exports = {
  normalizeConfig,
  normalizedConfig: normalizeConfig,
};
