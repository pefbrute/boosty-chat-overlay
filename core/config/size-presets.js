'use strict';

/**
 * Built-in Size Presets for Boosty Chat Overlay
 * Focus Mode chat card sizing layer: Compact, Normal, Large.
 *
 * Maps directly to existing canonical configuration keys:
 * cardWidth, fontSize, authorFontSize, cardPadding, messageGap, borderRadius, avatarSize.
 */

(function () {
  const SIZE_PRESETS = {
    compact: {
      cardWidth: 380,
      fontSize: 16,
      authorFontSize: 13,
      cardPadding: 8,
      messageGap: 6,
      borderRadius: 6,
      avatarSize: 32,
    },
    normal: {
      cardWidth: 520,
      fontSize: 21,
      authorFontSize: 16,
      cardPadding: 10,
      messageGap: 10,
      borderRadius: 10,
      avatarSize: 42,
    },
    large: {
      cardWidth: 640,
      fontSize: 26,
      authorFontSize: 18,
      cardPadding: 14,
      messageGap: 14,
      borderRadius: 14,
      avatarSize: 48,
    },
  };

  const SIZE_KEYS = [
    'cardWidth',
    'fontSize',
    'authorFontSize',
    'cardPadding',
    'messageGap',
    'borderRadius',
    'avatarSize',
  ];

  const SIZE_LABELS = {
    compact: 'Компактный',
    normal: 'Обычный',
    large: 'Крупный',
  };

  function detectSizePreset(config) {
    if (!config) return null;
    for (const [name, preset] of Object.entries(SIZE_PRESETS)) {
      let matches = true;
      for (const key of SIZE_KEYS) {
        if (config[key] !== preset[key]) {
          matches = false;
          break;
        }
      }
      if (matches) return name;
    }
    return null;
  }

  function applySizePreset(currentConfig = {}, sizePresetId) {
    const preset = SIZE_PRESETS[sizePresetId];
    if (!preset) {
      throw new Error(`Unknown size preset: "${sizePresetId}"`);
    }
    return {
      ...currentConfig,
      ...preset,
    };
  }

  const BoostySizePresets = {
    SIZE_PRESETS,
    SIZE_KEYS,
    SIZE_LABELS,
    detectSizePreset,
    applySizePreset,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoostySizePresets;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.BoostySizePresets = BoostySizePresets;
  }
})();
