'use strict';

/**
 * First-Class Browser Metadata & Instruction Catalog.
 * Centralized registry for browser identification, detection rules, extension URLs,
 * and localized onboarding/recovery flows across platforms (Linux, Windows, macOS).
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
    guideTitle: 'Откройте страницу расширений Яндекс Браузера',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений Яндекс Браузера',
        desc: 'Перейдите по адресу: <code id="ob-ext-url-code" class="ob-code-pill">browser://extensions</code>',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'В правом верхнем углу страницы расширений включите тумблер режима разработчика.',
      },
      {
        num: '③',
        title: 'Нажмите «Загрузить распакованное расширение»',
        desc: 'Кнопка появится в верхней панели инструментов после включения режима разработчика.',
      },
      {
        num: '④',
        title: 'Выберите папку Boosty Chat Overlay',
        desc: 'Укажите распакованную папку расширения из блока ниже.',
      },
      {
        num: '⑤',
        title: 'Убедитесь, что расширение включено',
        desc: 'Тумблер на карточке Boosty Chat Overlay должен быть активен.',
      },
      {
        num: '⑥',
        title: 'Вернитесь в приложение и нажмите «Проверить подключение»',
        desc: 'Приложение автоматически установит связь с расширением.',
      },
    ],
    recoveryCardTitle: '❓ Расширение установлено, но приложение пока его не видит?',
    recoverySteps: [
      'Откройте страницу <code id="ob-recovery-url" class="ob-code-pill">browser://extensions</code> в Яндекс Браузере.',
      'Убедитесь, что переключатель Boosty Chat Overlay включён.',
      'Нажмите значок обновления расширения (🔄) на карточке.',
      'Обновите вкладку со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Затем вернитесь сюда и нажмите «Проверить снова».',
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
    openExtensionsBtnText: '🌐 Открыть страницу расширений (Brave)',
    openBrowserBtnText: '🌐 Открыть Brave',
    guideTitle: 'Откройте страницу расширений в Brave',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений в Brave',
        desc: 'Перейдите по адресу: <code id="ob-ext-url-code" class="ob-code-pill">brave://extensions</code>',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'Переключатель находится в правом верхнем углу страницы расширений.',
      },
      {
        num: '③',
        title: 'Нажмите «Загрузить распакованное расширение»',
        desc: 'Кнопка «Load unpacked» появится в верхней панели инструментов.',
      },
      {
        num: '④',
        title: 'Выберите папку расширения',
        desc: 'Укажите распакованную папку расширения из блока ниже.',
      },
      {
        num: '⑤',
        title: 'Убедитесь, что расширение включено',
        desc: 'Тумблер на карточке Boosty Chat Overlay должен быть активен.',
      },
      {
        num: '⑥',
        title: 'Вернитесь в приложение и нажмите «Проверить подключение»',
        desc: 'Приложение автоматически установит связь с расширением.',
      },
    ],
    recoveryCardTitle: '❓ Расширение установлено, но приложение пока его не видит?',
    recoverySteps: [
      'Обновите страницу со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Убедитесь, что переключатель расширения включён на странице <code id="ob-recovery-url" class="ob-code-pill">brave://extensions</code>.',
      'Нажмите значок перезагрузки (🔄) на карточке расширения в браузере.',
      'Затем вернитесь сюда и нажмите «Проверить снова».',
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
    openExtensionsBtnText: '🌐 Открыть страницу расширений (Chrome)',
    openBrowserBtnText: '🌐 Открыть Chrome',
    guideTitle: 'Откройте страницу расширений в Chrome',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений в Chrome',
        desc: 'Перейдите по адресу: <code id="ob-ext-url-code" class="ob-code-pill">chrome://extensions</code>',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'Переключатель находится в правом верхнем углу страницы расширений.',
      },
      {
        num: '③',
        title: 'Нажмите «Загрузить распакованное расширение»',
        desc: 'Кнопка «Load unpacked» появится в верхней панели инструментов.',
      },
      {
        num: '④',
        title: 'Выберите папку расширения',
        desc: 'Укажите распакованную папку расширения из блока ниже.',
      },
      {
        num: '⑤',
        title: 'Убедитесь, что расширение включено',
        desc: 'Тумблер на карточке Boosty Chat Overlay должен быть активен.',
      },
      {
        num: '⑥',
        title: 'Вернитесь в приложение и нажмите «Проверить подключение»',
        desc: 'Приложение автоматически установит связь с расширением.',
      },
    ],
    recoveryCardTitle: '❓ Расширение установлено, но приложение пока его не видит?',
    recoverySteps: [
      'Обновите страницу со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Убедитесь, что переключатель расширения включён на странице <code id="ob-recovery-url" class="ob-code-pill">chrome://extensions</code>.',
      'Нажмите значок перезагрузки (🔄) на карточке расширения в браузере.',
      'Затем вернитесь сюда и нажмите «Проверить снова».',
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
    openExtensionsBtnText: '🌐 Открыть страницу расширений (Edge)',
    openBrowserBtnText: '🌐 Открыть Edge',
    guideTitle: 'Откройте страницу расширений в Edge',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений в Edge',
        desc: 'Перейдите по адресу: <code id="ob-ext-url-code" class="ob-code-pill">edge://extensions</code>',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'Переключатель находится в левой боковой панели страницы расширений.',
      },
      {
        num: '③',
        title: 'Нажмите «Загрузить распакованное расширение»',
        desc: 'Кнопка появится в верхней панели инструментов.',
      },
      {
        num: '④',
        title: 'Выберите папку расширения',
        desc: 'Укажите распакованную папку расширения из блока ниже.',
      },
      {
        num: '⑤',
        title: 'Убедитесь, что расширение включено',
        desc: 'Тумблер на карточке Boosty Chat Overlay должен быть активен.',
      },
      {
        num: '⑥',
        title: 'Вернитесь в приложение и нажмите «Проверить подключение»',
        desc: 'Приложение автоматически установит связь с расширением.',
      },
    ],
    recoveryCardTitle: '❓ Расширение установлено, но приложение пока его не видит?',
    recoverySteps: [
      'Обновите страницу со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Убедитесь, что переключатель расширения включён на странице <code id="ob-recovery-url" class="ob-code-pill">edge://extensions</code>.',
      'Нажмите значок перезагрузки (🔄) на карточке расширения в браузере.',
      'Затем вернитесь сюда и нажмите «Проверить снова».',
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
    extensionsUrl: 'chrome://extensions',
    extensionsUrlDisplay: 'chrome://extensions',
    openExtensionsBtnText: '🌐 Открыть страницу расширений (Chromium)',
    openBrowserBtnText: '🌐 Открыть Chromium',
    guideTitle: 'Откройте страницу расширений в Chromium',
    guideSteps: [
      {
        num: '①',
        title: 'Откройте страницу расширений в Chromium',
        desc: 'Перейдите по адресу: <code id="ob-ext-url-code" class="ob-code-pill">chrome://extensions</code>',
      },
      {
        num: '②',
        title: 'Включите «Режим разработчика»',
        desc: 'Переключатель находится в правом верхнем углу страницы расширений.',
      },
      {
        num: '③',
        title: 'Нажмите «Загрузить распакованное расширение»',
        desc: 'Кнопка появится в верхней панели инструментов.',
      },
      {
        num: '④',
        title: 'Выберите папку расширения',
        desc: 'Укажите распакованную папку расширения из блока ниже.',
      },
    ],
    recoveryCardTitle: '❓ Расширение установлено, но приложение пока его не видит?',
    recoverySteps: [
      'Обновите страницу со стримом Boosty (<kbd>Ctrl</kbd> + <kbd>R</kbd> или <kbd>F5</kbd>).',
      'Убедитесь, что переключатель расширения включён на странице <code id="ob-recovery-url" class="ob-code-pill">chrome://extensions</code>.',
      'Нажмите значок перезагрузки (🔄) на карточке расширения в браузере.',
      'Затем вернитесь сюда и нажмите «Проверить снова».',
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
  return meta?.extensionsUrl || 'chrome://extensions';
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
