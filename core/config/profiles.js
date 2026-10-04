'use strict';

/**
 * Built-in Stream Profiles v1 for Boosty Chat Overlay
 *
 * Each profile is a cohesive bundle designed for a specific usage scenario:
 * 1. content: primary recommended profile for watching streams/videos with minimal chat footprint in bottom-right
 * 2. gaming: compact unobtrusive chat in bottom-left, short stack, doesn't hide gameplay HUD
 * 3. talking: prominent readable chat in bottom-right for active community discussion
 * 4. minimal: ultra-compact low-density chat in bottom-left with only 2 messages
 *
 * Architectural Invariants:
 * 1. Profile != Appearance Preset: Profile applies a bundle (preset + layout + stack limits).
 *    Appearance presets remain independent and control visual appearance only.
 * 2. Production Source of Truth: Production overlay and OBS continue to read raw config values.
 *    activeProfile is derived dynamically or used purely for UI indicator.
 * 3. Bidirectional Detection: If any profile-specific value is altered (e.g. dragging chat or changing preset),
 *    detectProfile returns null ('custom'), while the appearance preset remains valid.
 */

(function () {
  const PROFILE_DEFINITIONS = {
    content: {
      id: 'content',
      name: 'Просмотр контента',
      subtitle: 'Минимум помех поверх видео',
      badge: 'Компактный · Справа снизу · 3 сообщ.',
      recommended: true,
      icon: 'icon-play',
      appearancePreset: 'compact',
      layout: {
        horizontalAnchor: 'right',
        verticalAnchor: 'bottom',
        offsetX: 20,
        offsetY: 20,
        newMessagePosition: 'bottom',
        textAlign: 'left',
        maxStackHeight: 360,
      },
      stack: {
        maxMessages: 3,
        durationSeconds: 12,
      },
    },
    gaming: {
      id: 'gaming',
      name: 'Игры',
      subtitle: 'Не закрывает интерфейс игры',
      badge: 'Компактный · Слева снизу · 4 сообщ.',
      recommended: false,
      icon: 'icon-gamepad',
      appearancePreset: 'compact',
      layout: {
        horizontalAnchor: 'left',
        verticalAnchor: 'bottom',
        offsetX: 24,
        offsetY: 24,
        newMessagePosition: 'bottom',
        textAlign: 'left',
        maxStackHeight: 500,
      },
      stack: {
        maxMessages: 4,
        durationSeconds: 15,
      },
    },
    talking: {
      id: 'talking',
      name: 'Разговорный',
      subtitle: 'Заметный чат для общения',
      badge: 'Чистый · Справа снизу · 6 сообщ.',
      recommended: false,
      icon: 'icon-chat',
      appearancePreset: 'clean',
      layout: {
        horizontalAnchor: 'right',
        verticalAnchor: 'bottom',
        offsetX: 32,
        offsetY: 32,
        newMessagePosition: 'bottom',
        textAlign: 'right',
        maxStackHeight: 800,
      },
      stack: {
        maxMessages: 6,
        durationSeconds: 25,
      },
    },
    minimal: {
      id: 'minimal',
      name: 'Минимализм',
      subtitle: 'Минимум деталей на экране',
      badge: 'Компактный · Слева снизу · 2 сообщ.',
      recommended: false,
      icon: 'icon-minimize',
      appearancePreset: 'compact',
      layout: {
        horizontalAnchor: 'left',
        verticalAnchor: 'bottom',
        offsetX: 20,
        offsetY: 20,
        newMessagePosition: 'bottom',
        textAlign: 'left',
        maxStackHeight: 300,
      },
      stack: {
        maxMessages: 2,
        durationSeconds: 10,
      },
    },
  };

  function getPresetsModule() {
    if (typeof require === 'function') {
      try {
        return require('./presets.js');
      } catch {}
    }
    if (typeof globalThis !== 'undefined' && globalThis.BoostyPresets) {
      return globalThis.BoostyPresets;
    }
    return { PRESETS: {}, STYLE_KEYS: [] };
  }

  function getSchemaModule() {
    if (typeof require === 'function') {
      try {
        return require('./schema.js');
      } catch {}
    }
    if (typeof globalThis !== 'undefined' && globalThis.BoostySchema) {
      return globalThis.BoostySchema;
    }
    return { normalizeConfig: (c) => c };
  }

  function normalizeProfileId(profileId) {
    if (typeof profileId === 'string' && Object.prototype.hasOwnProperty.call(PROFILE_DEFINITIONS, profileId)) {
      return profileId;
    }
    return null;
  }

  function applyProfile(currentConfig = {}, profileId) {
    const profile = PROFILE_DEFINITIONS[profileId];
    if (!profile) {
      throw new Error(`Unknown profile ID: "${profileId}"`);
    }

    const { PRESETS } = getPresetsModule();
    const presetValues = PRESETS[profile.appearancePreset] || {};

    const merged = {
      ...currentConfig,
      ...presetValues,
      ...profile.layout,
      ...profile.stack,
    };

    const { normalizeConfig } = getSchemaModule();
    return normalizeConfig(merged);
  }

  function detectProfile(config) {
    if (!config) return null;
    const { PRESETS, STYLE_KEYS } = getPresetsModule();
    if (!PRESETS || !STYLE_KEYS) return null;

    for (const [id, profile] of Object.entries(PROFILE_DEFINITIONS)) {
      const preset = PRESETS[profile.appearancePreset];
      if (!preset) continue;

      // 1. Check appearance preset matching
      let styleMatch = true;
      for (const key of STYLE_KEYS) {
        if (config[key] !== preset[key]) {
          styleMatch = false;
          break;
        }
      }
      if (!styleMatch) continue;

      // 2. Check layout matching
      let layoutMatch = true;
      for (const [key, val] of Object.entries(profile.layout)) {
        if (config[key] !== val) {
          layoutMatch = false;
          break;
        }
      }
      if (!layoutMatch) continue;

      // 3. Check stack matching
      let stackMatch = true;
      for (const [key, val] of Object.entries(profile.stack)) {
        if (config[key] !== val) {
          stackMatch = false;
          break;
        }
      }
      if (!stackMatch) continue;

      return id;
    }

    return null;
  }

  const BoostyProfiles = {
    PROFILE_DEFINITIONS,
    normalizeProfileId,
    applyProfile,
    detectProfile,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoostyProfiles;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.BoostyProfiles = BoostyProfiles;
  }
})();
