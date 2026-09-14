'use strict';

const { FIXTURE_MESSAGES, FIXTURE_BROWSERS, FIXTURE_OBS_SCENES } = require('./fixtures');

/**
 * Canonical 10 states strictly ordered 01 -> 10.
 * Default capture executes these and ONLY these in this exact order.
 */
const CANONICAL_STATES = [
  {
    index: 1,
    id: 'ready',
    section: 'dashboard',
    width: 1280,
    height: 800,
    filename: '01__dashboard__ready__1280x800.png',
    description: 'Main dashboard with OBS, Boosty and extension connected',
    type: 'desktop',
    mock: {
      view: 'main',
      health: {
        extensionConnected: true,
        boostyConnected: true,
        extensionVersion: '0.4.0',
        appVersion: '0.4.0',
        receivedMessages: 42,
      },
      obs: {
        ok: true,
        connected: true,
        scenes: FIXTURE_OBS_SCENES.connected,
      },
    },
    expected: {
      view: 'main',
      obsConnected: true,
      extensionConnected: true,
      boostyConnected: true,
      bannerVisible: false,
    },
  },
  {
    index: 2,
    id: 'nothing-connected',
    section: 'dashboard',
    width: 1280,
    height: 800,
    filename: '02__dashboard__nothing-connected__1280x800.png',
    description: 'Main dashboard initial state: OBS disconnected, Boosty disconnected, extension missing',
    type: 'desktop',
    mock: {
      view: 'main',
      health: {
        extensionConnected: false,
        boostyConnected: false,
        extensionLastSeenAt: null,
        receivedMessages: 0,
      },
      obs: {
        ok: false,
        connected: false,
        scenes: [],
      },
    },
    expected: {
      view: 'main',
      obsConnected: false,
      extensionConnected: false,
      boostyConnected: false,
      bannerVisible: true,
    },
  },
  {
    index: 3,
    id: 'no-obs',
    section: 'dashboard',
    width: 1000,
    height: 700,
    filename: '03__dashboard__no-obs__1000x700.png',
    description: 'Main dashboard with Boosty and extension connected, OBS disconnected',
    type: 'desktop',
    mock: {
      view: 'main',
      health: {
        extensionConnected: true,
        boostyConnected: true,
        extensionVersion: '0.4.0',
        appVersion: '0.4.0',
        receivedMessages: 18,
      },
      obs: {
        ok: false,
        connected: false,
        scenes: [],
      },
    },
    expected: {
      view: 'main',
      obsConnected: false,
      extensionConnected: true,
      boostyConnected: true,
      bannerVisible: true,
    },
  },
  {
    index: 4,
    id: 'no-boosty',
    section: 'dashboard',
    width: 1000,
    height: 700,
    filename: '04__dashboard__no-boosty__1000x700.png',
    description: 'Main dashboard with OBS connected, extension connected, Boosty stream tab not detected',
    type: 'desktop',
    mock: {
      view: 'main',
      health: {
        extensionConnected: true,
        boostyConnected: false,
        extensionVersion: '0.4.0',
        appVersion: '0.4.0',
        receivedMessages: 0,
      },
      obs: {
        ok: true,
        connected: true,
        scenes: FIXTURE_OBS_SCENES.connected,
      },
    },
    expected: {
      view: 'main',
      obsConnected: true,
      extensionConnected: true,
      boostyConnected: false,
      bannerVisible: true,
    },
  },
  {
    index: 5,
    id: 'welcome',
    section: 'onboarding',
    width: 1280,
    height: 800,
    filename: '05__onboarding__welcome__1280x800.png',
    description: 'Onboarding step 1: browser choice, extension connection instructions',
    type: 'desktop',
    mock: {
      view: 'onboarding',
      step: 1,
      health: {
        extensionConnected: false,
        boostyConnected: false,
        receivedMessages: 0,
      },
      obs: {
        ok: false,
        connected: false,
        scenes: [],
      },
    },
    expected: {
      view: 'onboarding',
      step: 1,
      obsConnected: false,
      extensionConnected: false,
      boostyConnected: false,
    },
  },
  {
    index: 6,
    id: 'obs-setup',
    section: 'onboarding',
    width: 1280,
    height: 800,
    filename: '06__onboarding__obs-setup__1280x800.png',
    description: 'Onboarding step 3: OBS Studio connection and scene selection',
    type: 'desktop',
    mock: {
      view: 'onboarding',
      step: 3,
      health: {
        extensionConnected: true,
        boostyConnected: true,
        receivedMessages: 5,
      },
      obs: {
        ok: true,
        connected: true,
        scenes: FIXTURE_OBS_SCENES.unconfigured,
      },
    },
    expected: {
      view: 'onboarding',
      step: 3,
      obsConnected: true,
      extensionConnected: true,
      boostyConnected: true,
    },
  },
  {
    index: 7,
    id: 'default',
    section: 'settings',
    width: 1280,
    height: 800,
    filename: '07__settings__default__1280x800.png',
    description: 'Settings panel with default appearance parameters',
    type: 'desktop',
    mock: {
      view: 'main',
      focusSettings: true,
      config: {
        durationSeconds: 20,
        maxMessages: 6,
        cardWidth: 520,
        fontSize: 21,
        authorFontSize: 16,
        accentColor: '#f15f2c',
        textColor: '#ffffff',
        backgroundColor: '#121216',
        backgroundOpacity: 88,
        borderRadius: 10,
        cardPadding: 10,
        messageGap: 10,
        showAvatars: true,
        avatarSize: 42,
        shadow: true,
        backdropBlur: 0,
      },
      health: {
        extensionConnected: true,
        boostyConnected: true,
        receivedMessages: 10,
      },
      obs: {
        ok: true,
        connected: true,
        scenes: FIXTURE_OBS_SCENES.connected,
      },
    },
    expected: {
      activePreset: 'clean',
    },
  },
  {
    index: 8,
    id: 'appearance-custom',
    section: 'settings',
    width: 1280,
    height: 800,
    filename: '08__settings__appearance-custom__1280x800.png',
    description: 'Settings panel with customized appearance values',
    type: 'desktop',
    mock: {
      view: 'main',
      focusSettings: true,
      config: {
        durationSeconds: 0, // Always show
        maxMessages: 10,
        fontSize: 28,
        accentColor: '#3a86ff',
        backgroundOpacity: 45,
        showAvatars: false,
      },
      health: {
        extensionConnected: true,
        boostyConnected: true,
        receivedMessages: 10,
      },
      obs: {
        ok: true,
        connected: true,
        scenes: FIXTURE_OBS_SCENES.connected,
      },
    },
    expected: {
      activePreset: null,
    },
  },
  {
    index: 9,
    id: 'three-messages',
    section: 'overlay',
    width: 1920,
    height: 1080,
    filename: '09__overlay__three-messages__1920x1080.png',
    description: 'Overlay with 3 typical messages on 16:9 test stream background',
    type: 'overlay',
    mock: {
      messages: FIXTURE_MESSAGES.standard,
      config: {
        durationSeconds: 0,
        maxMessages: 6,
        fontSize: 21,
        accentColor: '#f15f2c',
        backgroundOpacity: 88,
        showAvatars: true,
      },
    },
  },
  {
    index: 10,
    id: 'stress-test',
    section: 'overlay',
    width: 1920,
    height: 1080,
    filename: '10__overlay__stress-test__1920x1080.png',
    description: 'Overlay visual stress test: long username, multi-line Cyrillic text, emojis, stacked cards',
    type: 'overlay',
    mock: {
      messages: FIXTURE_MESSAGES.stress,
      config: {
        durationSeconds: 0,
        maxMessages: 10,
        fontSize: 24,
        accentColor: '#e63946',
        backgroundOpacity: 75,
        showAvatars: true,
      },
    },
  },
];

/**
 * Extra states that can be captured via --state <id>, but are not in the canonical 10
 */
const EXTRA_STATES = [
  {
    id: 'no-extension',
    section: 'dashboard',
    width: 1280,
    height: 800,
    filename: 'dashboard__no-extension__1280x800.png',
    description: 'Dashboard with OBS connected, but extension not detected',
    type: 'desktop',
    mock: {
      view: 'main',
      health: {
        extensionConnected: false,
        boostyConnected: false,
        receivedMessages: 0,
      },
      obs: {
        ok: true,
        connected: true,
        scenes: FIXTURE_OBS_SCENES.connected,
      },
    },
  },
  {
    id: 'connecting',
    section: 'dashboard',
    width: 1280,
    height: 800,
    filename: 'dashboard__connecting__1280x800.png',
    description: 'Dashboard checking initial connection grace period',
    type: 'desktop',
    mock: {
      view: 'main',
      isChecking: true,
      health: {
        extensionConnected: false,
        boostyConnected: false,
        receivedMessages: 0,
      },
      obs: {
        ok: false,
        connected: false,
        scenes: [],
      },
    },
  },
  {
    id: 'extension-outdated',
    section: 'dashboard',
    width: 1280,
    height: 800,
    filename: 'dashboard__extension-outdated__1280x800.png',
    description: 'Dashboard showing extension update available banner',
    type: 'desktop',
    mock: {
      view: 'main',
      health: {
        extensionConnected: true,
        boostyConnected: true,
        extensionVersion: '0.2.0',
        bundledExtensionVersion: '0.4.0',
        isOutdated: true,
        receivedMessages: 14,
      },
      obs: {
        ok: true,
        connected: true,
        scenes: FIXTURE_OBS_SCENES.connected,
      },
    },
  },
  {
    id: 'overlay-empty',
    section: 'overlay',
    width: 1920,
    height: 1080,
    filename: 'overlay__empty__1920x1080.png',
    description: 'Empty overlay on 16:9 test stream background',
    type: 'overlay',
    mock: {
      messages: [],
      config: {
        durationSeconds: 20,
        maxMessages: 6,
        fontSize: 21,
        accentColor: '#f15f2c',
        backgroundOpacity: 88,
        showAvatars: true,
      },
    },
  },
];

const ALL_STATES = [...CANONICAL_STATES, ...EXTRA_STATES];

function findStateById(id) {
  return ALL_STATES.find(s => s.id === id);
}

module.exports = {
  CANONICAL_STATES,
  EXTRA_STATES,
  ALL_STATES,
  findStateById,
  FIXTURE_BROWSERS,
  FIXTURE_OBS_SCENES,
};
