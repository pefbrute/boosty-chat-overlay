'use strict';

const path = require('node:path');

const PRODUCTION_VARIANT = Object.freeze({
  id: 'production',
  isLab: false,
  name: 'Boosty Chat Overlay',
  appId: 'ru.pefbrute.boosty-chat-overlay',
  userDataDirName: 'Boosty Chat Overlay',
  mainWindowTitle: 'Boosty Chat Overlay',
  monitorWindowTitle: 'Boosty Chat Monitor',
  badge: null,
  isMessageLabEnabled: false,
  iconFileName: 'icon.png',
});

const LAB_VARIANT = Object.freeze({
  id: 'lab',
  isLab: true,
  name: 'Boosty Chat Overlay Lab',
  appId: 'ru.pefbrute.boosty-chat-overlay.lab',
  userDataDirName: 'Boosty Chat Overlay Lab',
  mainWindowTitle: 'Boosty Chat Overlay Lab',
  monitorWindowTitle: 'Boosty Chat Monitor — Lab',
  badge: 'LAB',
  isMessageLabEnabled: true,
  iconFileName: 'icon-lab.png',
});

/**
 * Resolves current app variant based on environment variables.
 *
 * @param {object} [env=process.env]
 * @returns {object} App variant configuration
 */
function getAppVariant(env = process.env) {
  const isLab = env.BOOSTY_OVERLAY_MESSAGE_LAB === '1' ||
    env.BOOSTY_APP_VARIANT === 'lab';

  const base = isLab ? LAB_VARIANT : PRODUCTION_VARIANT;
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

  // Isolate userData for Lab to prevent collision with production data/settings,
  // unless an explicit custom user data path was requested (e.g. in test suites).
  if (!env.BOOSTY_OVERLAY_USER_DATA && typeof app.setPath === 'function' && typeof app.getPath === 'function') {
    try {
      const appData = app.getPath('appData');
      const targetUserData = path.join(appData, targetVariant.userDataDirName);
      app.setPath('userData', targetUserData);
      app.setPath('sessionData', path.join(targetUserData, 'sessionData'));
    } catch {
      // getPath('appData') might not be ready in early lifecycle or mock setups
    }
  }
}

module.exports = {
  PRODUCTION_VARIANT,
  LAB_VARIANT,
  getAppVariant,
  applyAppVariant,
};
