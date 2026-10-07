'use strict';

const path = require('node:path');

const PRODUCTION_VARIANT = Object.freeze({
  id: 'production',
  isFresh: false,
  isLab: false,
  name: 'Boosty Chat Overlay',
  appId: 'ru.pefbrute.boosty-chat-overlay',
  userDataDirName: 'Boosty Chat Overlay',
  mainWindowTitle: 'Boosty Chat Overlay',
  monitorWindowTitle: 'Boosty Chat Monitor',
  badge: null,
  isMessageLabEnabled: false,
  iconFileName: 'icon.png',
  desktopName: 'boosty-chat-overlay.desktop',
  wmClass: 'Boosty Chat Overlay',
});

const LAB_VARIANT = Object.freeze({
  id: 'lab',
  isFresh: false,
  isLab: true,
  name: 'Boosty Chat Overlay Lab',
  appId: 'ru.pefbrute.boosty-chat-overlay.lab',
  userDataDirName: 'Boosty Chat Overlay Lab',
  mainWindowTitle: 'Boosty Chat Overlay Lab',
  monitorWindowTitle: 'Boosty Chat Monitor — Lab',
  badge: 'LAB',
  isMessageLabEnabled: true,
  iconFileName: 'icon-lab.png',
  desktopName: 'boosty-chat-overlay-lab.desktop',
  wmClass: 'Boosty Chat Overlay Lab',
});

const FRESH_VARIANT = Object.freeze({
  id: 'fresh',
  isFresh: true,
  isLab: false,
  name: 'Boosty Chat Overlay Fresh',
  appId: 'ru.pefbrute.boosty-chat-overlay.fresh',
  userDataDirName: 'Boosty Chat Overlay Fresh',
  mainWindowTitle: 'Boosty Chat Overlay Fresh',
  monitorWindowTitle: 'Boosty Chat Monitor — С нуля',
  badge: 'С нуля',
  isMessageLabEnabled: false,
  iconFileName: 'icon-fresh.png',
  desktopName: 'boosty-chat-overlay-fresh.desktop',
  wmClass: 'Boosty Chat Overlay Fresh',
});

/**
 * Resolves current app variant based on environment variables and arguments.
 *
 * @param {object} [env=process.env]
 * @returns {object} App variant configuration
 */
function getAppVariant(env = process.env) {
  const isFresh = env.BOOSTY_APP_VARIANT === 'fresh' ||
    env.BOOSTY_OVERLAY_APP_VARIANT === 'fresh';

  const isLab = !isFresh && (
    env.BOOSTY_OVERLAY_MESSAGE_LAB === '1' ||
    env.BOOSTY_APP_VARIANT === 'lab'
  );

  let base = PRODUCTION_VARIANT;
  if (isFresh) {
    base = FRESH_VARIANT;
  } else if (isLab) {
    base = LAB_VARIANT;
  }

  const iconPath = path.resolve(__dirname, '../../build', base.iconFileName);

  return {
    ...base,
    iconPath,
  };
}

/**
 * Applies variant configuration to the Electron app instance.
 * Must be invoked before single-instance lock and window creation.
 *
 * @param {object} app Electron app module or mock
 * @param {object} [variant] Variant object from getAppVariant()
 * @param {object} [env=process.env]
 */
function applyAppVariant(app, variant, env = process.env) {
  if (!app) return;
  const targetVariant = variant || getAppVariant(env);

  if (typeof app.setName === 'function') {
    app.setName(targetVariant.name);
  }

  if (typeof app.setAppUserModelId === 'function') {
    app.setAppUserModelId(targetVariant.appId);
  }

  // Isolate userData for Lab and Fresh to prevent collision with production data/settings,
  // unless an explicit custom user data path was requested (e.g. in test suites).
  if (!env.BOOSTY_OVERLAY_USER_DATA && typeof app.setPath === 'function' && typeof app.getPath === 'function') {
    try {
      const appData = app.getPath('appData');
      if (targetVariant.id !== 'production') {
        const targetUserData = path.join(appData, targetVariant.userDataDirName);
        app.setPath('userData', targetUserData);
        app.setPath('sessionData', path.join(targetUserData, 'sessionData'));
      }
    } catch {
      // getPath('appData') might not be ready in early lifecycle or mock setups
    }
  }
}

module.exports = {
  PRODUCTION_VARIANT,
  LAB_VARIANT,
  FRESH_VARIANT,
  getAppVariant,
  applyAppVariant,
};
