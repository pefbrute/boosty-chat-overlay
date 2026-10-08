'use strict';

/**
 * Built-in Appearance Presets for Boosty Chat Overlay
 *
 * Appearance presets control strictly visual styling:
 * typography, colors, padding, borders, opacity, and avatars.
 * They are completely decoupled from stream layout and stack size.
 */

(function () {
  const PRESETS = {
    compact: {
      fontSize: 16,
      authorFontSize: 13,
      accentColor: '#f15f2c',
      textColor: '#ffffff',
      backgroundColor: '#121216',
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
      accentColor: '#f15f2c',
      textColor: '#ffffff',
      backgroundColor: '#121216',
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
      accentColor: '#f15f2c',
      textColor: '#ffffff',
      backgroundColor: '#121216',
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
      accentColor: '#f15f2c',
      textColor: '#ffffff',
      backgroundColor: '#121216',
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

  const STYLE_KEYS = [
    'fontSize',
    'authorFontSize',
    'accentColor',
    'textColor',
    'backgroundColor',
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

  PRESETS.standard = PRESETS.clean;

  const PRESET_LABELS = {
    clean: 'Стандартный',
    standard: 'Стандартный',
    compact: 'Компактный',
    large: 'Крупный',
    glass: 'Стекло',
  };

  function detectActivePreset(config) {
    if (!config) return null;
    for (const [name, preset] of Object.entries(PRESETS)) {
      let matches = true;
      for (const key of STYLE_KEYS) {
        if (config[key] !== preset[key]) {
          matches = false;
          break;
        }
      }
      if (matches) return name;
    }
    return null;
  }

  const BoostyPresets = {
    PRESETS,
    STYLE_KEYS,
    PRESET_LABELS,
    detectActivePreset,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoostyPresets;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.BoostyPresets = BoostyPresets;
  }
})();
