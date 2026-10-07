'use strict';

/**
 * First-Class Browser Metadata & Instruction Catalog.
 * Centralized registry for browser identification, detection rules, extension URLs,
 * drag-and-drop capability flags, and localized 3-step onboarding / recovery flows across platforms.
 */
const SUPPORTED_BROWSERS = {
  yandex: {
    id: 'yandex',
    name: 'Яндекс Браузер',
    label: 'Яндекс Браузер',
    extensionsUrl: 'browser://extensions/',
    extensionsUrlDisplay: 'browser://extensions',
    openExtensionsBtnText: '🌐 Открыть расширения Яндекс Браузера',
    openBrowserBtnText: '🌐 Открыть Яндекс Браузер',
    supportsDragDropInstall: true,
    devModeHint: 'Переключатель находится в правом верхнем углу страницы расширений.',
    guideTitle: 'Установите расширение',
    guideSubtitle: 'Три простых шага — займёт меньше минуты.',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений',
        desc: 'В Яндекс Браузере откроется вкладка со списком установленных расширений.',
        ctaText: '🌐 Открыть расширения Яндекс Браузера',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'Переключатель находится в правом верхнем углу страницы расширений.',
      },
      {
        num: '③',
        title: 'Перетащите папку extension',
        desc: 'Откройте папку расширения и перетащите именно папку extension в окно страницы расширений браузера.',
        ctaText: '📁 Открыть папку extension',
        dndHint: 'Зажмите папку extension мышью и перетащите её на страницу расширений.',
      },
    ],
    recoveryCardTitle: 'Расширение не подключилось?',
    recoverySteps: [
      'Убедитесь, что расширение включено на странице <code id="ob-recovery-url" class="ob-code-pill">browser://extensions</code> в Яндекс Браузере.',
      'Обновите вкладку со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Нажмите «Проверить снова».',
    ],
    linuxCandidates: [
      '/usr/bin/yandex-browser',
      '/usr/bin/yandex-browser-stable',
      '/usr/bin/yandex-browser-beta',
      '/opt/yandex/browser/yandex-browser',
    ],
    linuxDesktopEntries: [
      '/usr/share/applications/yandex-browser.desktop',
      '/usr/share/applications/ru.yandex.desktop.browser.desktop',
    ],
    winCandidates: [
      { envKey: 'LOCALAPPDATA', subpath: ['Yandex', 'YandexBrowser', 'Application', 'browser.exe'] },
      { envKey: 'PROGRAMFILES', subpath: ['Yandex', 'YandexBrowser', 'Application', 'browser.exe'] },
      { envKey: 'PROGRAMFILES(X86)', subpath: ['Yandex', 'YandexBrowser', 'Application', 'browser.exe'] },
    ],
    darwinCandidates: [
      '/Applications/Yandex.app/Contents/MacOS/Yandex',
      '/Applications/Yandex Browser.app/Contents/MacOS/Yandex Browser',
    ],
  },
  brave: {
    id: 'brave',
    name: 'Brave',
    label: 'Brave',
    extensionsUrl: 'brave://extensions/',
    extensionsUrlDisplay: 'brave://extensions',
    openExtensionsBtnText: '🌐 Открыть расширения Brave',
    openBrowserBtnText: '🌐 Открыть Brave',
    supportsDragDropInstall: true,
    devModeHint: 'Переключатель находится в правом верхнем углу страницы расширений.',
    guideTitle: 'Установите расширение',
    guideSubtitle: 'Три простых шага — займёт меньше минуты.',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений',
        desc: 'В Brave откроется вкладка со списком установленных расширений.',
        ctaText: '🌐 Открыть расширения Brave',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'Переключатель находится в правом верхнем углу страницы расширений.',
      },
      {
        num: '③',
        title: 'Перетащите папку extension',
        desc: 'Откройте папку расширения и перетащите именно папку extension в окно страницы расширений браузера.',
        ctaText: '📁 Открыть папку extension',
        dndHint: 'Зажмите папку extension мышью и перетащите её на страницу расширений.',
      },
    ],
    recoveryCardTitle: 'Расширение не подключилось?',
    recoverySteps: [
      'Убедитесь, что переключатель расширения включён на странице <code id="ob-recovery-url" class="ob-code-pill">brave://extensions</code>.',
      'Обновите страницу со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Нажмите «Проверить снова».',
    ],
    linuxCandidates: [
      '/usr/bin/brave-browser',
      '/usr/bin/brave',
    ],
    linuxDesktopEntries: [
      '/usr/share/applications/brave-browser.desktop',
    ],
    winCandidates: [
      { envKey: 'LOCALAPPDATA', subpath: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'] },
      { envKey: 'PROGRAMFILES', subpath: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'] },
      { envKey: 'PROGRAMFILES(X86)', subpath: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'] },
    ],
    darwinCandidates: [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
  },
  chrome: {
    id: 'chrome',
    name: 'Chrome',
    label: 'Google Chrome',
    extensionsUrl: 'chrome://extensions/',
    extensionsUrlDisplay: 'chrome://extensions',
    openExtensionsBtnText: '🌐 Открыть расширения Chrome',
    openBrowserBtnText: '🌐 Открыть Chrome',
    supportsDragDropInstall: true,
    devModeHint: 'Переключатель находится в правом верхнем углу страницы расширений.',
    guideTitle: 'Установите расширение',
    guideSubtitle: 'Три простых шага — займёт меньше минуты.',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений',
        desc: 'В Chrome откроется вкладка со списком установленных расширений.',
        ctaText: '🌐 Открыть расширения Chrome',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'Переключатель находится в правом верхнем углу страницы расширений.',
      },
      {
        num: '③',
        title: 'Перетащите папку extension',
        desc: 'Откройте папку расширения и перетащите именно папку extension в окно страницы расширений браузера.',
        ctaText: '📁 Открыть папку extension',
        dndHint: 'Зажмите папку extension мышью и перетащите её на страницу расширений.',
      },
    ],
    recoveryCardTitle: 'Расширение не подключилось?',
    recoverySteps: [
      'Убедитесь, что переключатель расширения включён на странице <code id="ob-recovery-url" class="ob-code-pill">chrome://extensions</code>.',
      'Обновите страницу со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Нажмите «Проверить снова».',
    ],
    linuxCandidates: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
    ],
    linuxDesktopEntries: [
      '/usr/share/applications/google-chrome.desktop',
    ],
    winCandidates: [
      { envKey: 'LOCALAPPDATA', subpath: ['Google', 'Chrome', 'Application', 'chrome.exe'] },
      { envKey: 'PROGRAMFILES', subpath: ['Google', 'Chrome', 'Application', 'chrome.exe'] },
      { envKey: 'PROGRAMFILES(X86)', subpath: ['Google', 'Chrome', 'Application', 'chrome.exe'] },
    ],
    darwinCandidates: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ],
  },
  edge: {
    id: 'edge',
    name: 'Edge',
    label: 'Microsoft Edge',
    extensionsUrl: 'edge://extensions/',
    extensionsUrlDisplay: 'edge://extensions',
    openExtensionsBtnText: '🌐 Открыть расширения Edge',
    openBrowserBtnText: '🌐 Открыть Edge',
    supportsDragDropInstall: true,
    devModeHint: 'Переключатель находится в левой боковой панели страницы расширений.',
    guideTitle: 'Установите расширение',
    guideSubtitle: 'Три простых шага — займёт меньше минуты.',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений',
        desc: 'В Edge откроется вкладка со списком установленных расширений.',
        ctaText: '🌐 Открыть расширения Edge',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'Переключатель находится в левой боковой панели страницы расширений.',
      },
      {
        num: '③',
        title: 'Перетащите папку extension',
        desc: 'Откройте папку расширения и перетащите именно папку extension в окно страницы расширений браузера.',
        ctaText: '📁 Открыть папку extension',
        dndHint: 'Зажмите папку extension мышью и перетащите её на страницу расширений.',
      },
    ],
    recoveryCardTitle: 'Расширение не подключилось?',
    recoverySteps: [
      'Убедитесь, что переключатель расширения включён на странице <code id="ob-recovery-url" class="ob-code-pill">edge://extensions</code>.',
      'Обновите страницу со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Нажмите «Проверить снова».',
    ],
    linuxCandidates: [
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
    ],
    linuxDesktopEntries: [
      '/usr/share/applications/microsoft-edge.desktop',
    ],
    winCandidates: [
      { envKey: 'PROGRAMFILES', subpath: ['Microsoft', 'Edge', 'Application', 'msedge.exe'] },
      { envKey: 'PROGRAMFILES(X86)', subpath: ['Microsoft', 'Edge', 'Application', 'msedge.exe'] },
    ],
    darwinCandidates: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
  },
  chromium: {
    id: 'chromium',
    name: 'Chromium',
    label: 'Chromium',
    extensionsUrl: 'chrome://extensions/',
    extensionsUrlDisplay: 'chrome://extensions',
    openExtensionsBtnText: '🌐 Открыть расширения Chromium',
    openBrowserBtnText: '🌐 Открыть Chromium',
    supportsDragDropInstall: true,
    devModeHint: 'Переключатель находится в правом верхнем углу страницы расширений.',
    guideTitle: 'Установите расширение',
    guideSubtitle: 'Три простых шага — займёт меньше минуты.',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений',
        desc: 'В Chromium откроется вкладка со списком установленных расширений.',
        ctaText: '🌐 Открыть расширения Chromium',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'Переключатель находится в правом верхнем углу страницы расширений.',
      },
      {
        num: '③',
        title: 'Перетащите папку extension',
        desc: 'Откройте папку расширения и перетащите именно папку extension в окно страницы расширений браузера.',
        ctaText: '📁 Открыть папку extension',
        dndHint: 'Зажмите папку extension мышью и перетащите её на страницу расширений.',
      },
    ],
    recoveryCardTitle: 'Расширение не подключилось?',
    recoverySteps: [
      'Убедитесь, что переключатель расширения включён на странице <code id="ob-recovery-url" class="ob-code-pill">chrome://extensions</code>.',
      'Обновите страницу со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Нажмите «Проверить снова».',
    ],
    linuxCandidates: [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ],
    linuxDesktopEntries: [
      '/usr/share/applications/chromium.desktop',
      '/usr/share/applications/chromium-browser.desktop',
    ],
    winCandidates: [],
    darwinCandidates: [
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
  },
};

function getBrowserMetadata(browserId) {
  return SUPPORTED_BROWSERS[browserId] || SUPPORTED_BROWSERS.chrome;
}

function getExtensionsUrlForBrowser(browserId) {
  const meta = SUPPORTED_BROWSERS[browserId];
  return meta?.extensionsUrl || 'chrome://extensions/';
}

function getSupportedBrowserList() {
  return Object.values(SUPPORTED_BROWSERS);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SUPPORTED_BROWSERS,
    getBrowserMetadata,
    getExtensionsUrlForBrowser,
    getSupportedBrowserList,
  };
} else {
  globalThis.BoostyBrowserMetadata = {
    SUPPORTED_BROWSERS,
    getBrowserMetadata,
    getExtensionsUrlForBrowser,
    getSupportedBrowserList,
  };
}
