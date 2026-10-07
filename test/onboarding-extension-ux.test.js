'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');

const indexHtmlPath = path.resolve(__dirname, '../desktop/index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

test('Onboarding Extension Setup UX — Static DOM structure contains all required sections', () => {
  const { document } = parseHTML(indexHtml);

  // 1. Clear Header & Subtitle
  const heroTitle = document.querySelector('#step-1 .card-hero h2');
  assert.ok(heroTitle, 'Hero title must exist');
  assert.equal(heroTitle.textContent.trim(), 'Установите расширение');

  const heroSubtitle = document.querySelector('#step-1 .card-hero p');
  assert.ok(heroSubtitle, 'Hero subtitle must exist');
  assert.equal(heroSubtitle.textContent.trim(), 'Три простых шага — займёт меньше минуты.');

  // 2. Browser choice container
  const browserPrompt = document.querySelector('#ob-browser-prompt');
  assert.ok(browserPrompt, 'Browser prompt must exist');
  assert.match(browserPrompt.textContent, /В каком браузере вы открываете Boosty\?/);

  const browserOptions = document.querySelector('#ob-browser-options');
  assert.ok(browserOptions, 'Browser options container must exist');

  // 3. Mini-Lesson Video Tutorial Card
  const tutorialCard = document.querySelector('#ob-tutorial-card');
  assert.ok(tutorialCard, 'Tutorial mini-lesson card must exist');

  const tutorialVideo = document.querySelector('#ob-tutorial-video');
  assert.ok(tutorialVideo, 'Tutorial video element must exist');
  assert.equal(tutorialVideo.getAttribute('data-src'), 'assets/tutorials/yandex-extension-install.webm');
  assert.equal(tutorialVideo.getAttribute('poster'), 'assets/tutorials/yandex-extension-install-poster.png');

  const toggleBtn = document.querySelector('#ob-tutorial-toggle-btn');
  assert.ok(toggleBtn, 'Tutorial play/pause toggle button must exist');

  const schemeBtn = document.querySelector('#ob-tutorial-scheme-btn');
  assert.ok(schemeBtn, 'Tutorial scheme toggle button must exist');

  const staticFallback = document.querySelector('#ob-tutorial-static-fallback');
  assert.ok(staticFallback, 'Tutorial static fallback container must exist');

  const diagramImg = document.querySelector('.ob-tutorial-diagram-img');
  assert.ok(diagramImg, 'Tutorial diagram SVG img must exist');
  assert.equal(diagramImg.getAttribute('src'), 'assets/tutorials/yandex-extension-install-diagram.svg');

  const rmOverlay = document.querySelector('#ob-tutorial-rm-overlay');
  assert.ok(rmOverlay, 'Reduced motion overlay must exist');

  // 4. 3-step cards container
  const stepCards = document.querySelectorAll('#ob-three-steps-container .ob-step-card');
  assert.equal(stepCards.length, 3, 'Must have exactly 3 installation step cards');

  // Step 1: Open extensions page CTA & URL pill
  const openExtPageBtn = document.querySelector('#ob-open-ext-page-btn');
  assert.ok(openExtPageBtn, 'Open extensions page button must exist');

  const extUrlCode = document.querySelector('#ob-ext-url-code');
  assert.ok(extUrlCode, 'Extension URL code element must exist');

  // Step 2: Dev mode description
  const step2Desc = document.querySelector('#ob-step2-desc');
  assert.ok(step2Desc, 'Step 2 description must exist');

  // Step 3: Open folder CTA & Drag & Drop hint
  const openFolderBtn = document.querySelector('#ob-open-ext-folder-btn');
  assert.ok(openFolderBtn, 'Open folder button must exist');

  const dragDropHint = document.querySelector('#ob-drag-drop-hint');
  assert.ok(dragDropHint, 'Drag and drop hint must exist');

  const folderOpenedHint = document.querySelector('#ob-folder-opened-hint');
  assert.ok(folderOpenedHint, 'Folder opened hint must exist');

  // 4. Collapsible manual fallback accordion
  const manualFallback = document.querySelector('#ob-manual-fallback');
  assert.ok(manualFallback, 'Manual fallback accordion must exist');

  const folderPath = document.querySelector('#ob-ext-folder-path');
  assert.ok(folderPath, 'Extension folder path element must exist');

  const copyPathBtn = document.querySelector('#ob-copy-ext-path-btn');
  assert.ok(copyPathBtn, 'Copy path button must exist');

  const manualOpenFolderBtn = document.querySelector('#ob-manual-open-folder-btn');
  assert.ok(manualOpenFolderBtn, 'Manual open folder button must exist');

  // 5. Status Card
  const statusBadge = document.querySelector('#ob-ext-status-badge');
  assert.ok(statusBadge, 'Status badge must exist');

  const statusText = document.querySelector('#ob-ext-status-text');
  assert.ok(statusText, 'Status text must exist');

  const successMsg = document.querySelector('#ob-ext-success-msg');
  assert.ok(successMsg, 'Success message box must exist');

  // Already connected banner
  const alreadyConnectedBanner = document.querySelector('#ob-ext-already-connected-banner');
  assert.ok(alreadyConnectedBanner, 'Already connected banner must exist');

  const showInstructionsBtn = document.querySelector('#ob-show-instructions-btn');
  assert.ok(showInstructionsBtn, 'Show instructions button must exist');

  // 6. Recovery help card (hidden by default)
  const recoveryBox = document.querySelector('#ob-recovery-box');
  assert.ok(recoveryBox, 'Recovery box must exist');

  const recoveryTitle = document.querySelector('#ob-recovery-title-text');
  assert.ok(recoveryTitle, 'Recovery card title element must exist');

  const recoveryRecheckBtn = document.querySelector('#ob-recovery-recheck-btn');
  assert.ok(recoveryRecheckBtn, 'Recovery recheck button must exist');

  // 7. Wizard Navigation Bottom Actions
  const nextBtn = document.querySelector('#ob-step1-next-btn');
  assert.ok(nextBtn, 'Step 1 Next button must exist');
  assert.equal(nextBtn.disabled, true, 'Next button must be disabled by default');

  const reasonHint = document.querySelector('#ob-step1-reason');
  assert.ok(reasonHint, 'Step 1 blocking reason hint must exist');
  assert.match(reasonHint.textContent, /Сначала подключите расширение/);
});

test('Onboarding Extension Setup UX — Browser URL mapping logic', () => {
  const { getExtensionsUrlForBrowser } = require('../desktop/browser/metadata.js');

  assert.equal(getExtensionsUrlForBrowser('brave'), 'brave://extensions/');
  assert.equal(getExtensionsUrlForBrowser('chrome'), 'chrome://extensions/');
  assert.equal(getExtensionsUrlForBrowser('edge'), 'edge://extensions/');
  assert.equal(getExtensionsUrlForBrowser('yandex'), 'browser://extensions/');
  assert.equal(getExtensionsUrlForBrowser('unknown'), 'chrome://extensions/');
});

test('Yandex Browser First-Class Support — Metadata & Copy Invariants', () => {
  const { SUPPORTED_BROWSERS, getBrowserMetadata } = require('../desktop/browser/metadata.js');

  const yandex = SUPPORTED_BROWSERS.yandex;
  assert.ok(yandex, 'yandex must be registered in SUPPORTED_BROWSERS');
  assert.equal(yandex.id, 'yandex');
  assert.equal(yandex.name, 'Яндекс Браузер');
  assert.equal(yandex.label, 'Яндекс Браузер');
  assert.equal(yandex.extensionsUrl, 'browser://extensions/');
  assert.equal(yandex.openExtensionsBtnText, '🌐 Открыть расширения Яндекс Браузера');
  assert.equal(yandex.guideTitle, 'Установите расширение');
  assert.equal(yandex.guideSubtitle, 'Три простых шага — займёт меньше минуты.');

  // Verify exactly 3 steps for Yandex onboarding
  assert.equal(yandex.guideSteps.length, 3, 'Yandex onboarding must have 3 clear steps');
  assert.match(yandex.guideSteps[0].title, /Откройте страницу расширений/);
  assert.match(yandex.guideSteps[0].desc, /расширений/i);
  assert.match(yandex.guideSteps[1].title, /Режим разработчика/);
  assert.match(yandex.guideSteps[2].title, /Перетащите папку extension/);
  assert.match(yandex.guideSteps[2].desc, /папку extension/i);

  // Assert NO text leakage of Chrome/Brave/Edge in Yandex steps
  for (const step of yandex.guideSteps) {
    const combined = `${step.title} ${step.desc}`.toLowerCase();
    assert.ok(!combined.includes('chrome'), `Yandex step must not mention Chrome: ${combined}`);
    assert.ok(!combined.includes('brave'), `Yandex step must not mention Brave: ${combined}`);
    assert.ok(!combined.includes('edge'), `Yandex step must not mention Edge: ${combined}`);
  }

  // Recovery steps (3 steps)
  assert.ok(Array.isArray(yandex.recoverySteps));
  assert.equal(yandex.recoverySteps.length, 3);
  const recoveryJoined = yandex.recoverySteps.join(' ').toLowerCase();
  assert.match(recoveryJoined, /browser:\/\/extensions/);
  assert.ok(!recoveryJoined.includes('chrome'), 'Yandex recovery must not mention Chrome');
  assert.ok(!recoveryJoined.includes('brave'), 'Yandex recovery must not mention Brave');
  assert.ok(!recoveryJoined.includes('edge'), 'Yandex recovery must not mention Edge');

  // Fallback behavior
  const fallback = getBrowserMetadata('unknown_browser');
  assert.ok(fallback, 'Fallback metadata must exist');
  assert.equal(fallback.id, 'chrome');
});

test('Yandex Browser First-Class Support — Detection & Launch Actions in BrowserManager', () => {
  const { createBrowserManager } = require('../desktop/browser/manager.js');

  const fakeFs = {
    existsSync(p) {
      return p === '/usr/bin/yandex-browser';
    },
    readFileSync(p) {
      return '';
    },
  };

  let clipboardText = '';
  const fakeClipboard = {
    writeText(text) {
      clipboardText = text;
    },
  };

  let spawned = null;
  const fakeSpawn = (cmd, args, opts) => {
    spawned = { cmd, args, opts };
    return { unref() {} };
  };

  const mgr = createBrowserManager({
    platform: 'linux',
    fsModule: fakeFs,
    clipboardModule: fakeClipboard,
    spawnFn: fakeSpawn,
    extensionDir: '/tmp/extension',
  });

  const installed = mgr.installedBrowsers();
  assert.equal(installed.length, 1);
  assert.equal(installed[0].id, 'yandex');
  assert.equal(installed[0].name, 'Яндекс Браузер');
  assert.equal(installed[0].command, '/usr/bin/yandex-browser');
  assert.equal(installed[0].extensionsUrl, 'browser://extensions/');

  const list = mgr.listBrowsers();
  assert.deepEqual(list, [
    { id: 'yandex', name: 'Яндекс Браузер' },
  ]);

  // Open extensions page action
  const openRes = mgr.openBrowserExtensionsPage('yandex');
  assert.equal(openRes.ok, true);
  assert.equal(openRes.browser, 'Яндекс Браузер');
  assert.equal(openRes.managerUrl, 'browser://extensions/');
  assert.equal(clipboardText, 'browser://extensions/');
  assert.equal(spawned.cmd, '/usr/bin/yandex-browser');
  assert.deepEqual(spawned.args, ['--new-window', 'browser://extensions/']);

  // Copy extensions URL
  const copyRes = mgr.copyExtensionsUrl('yandex');
  assert.equal(copyRes.ok, true);
  assert.equal(copyRes.url, 'browser://extensions/');
});

test('Yandex Browser First-Class Support — Dynamic DOM Rendering & No Text Leakage', () => {
  const { parseHTML } = require('linkedom');
  const { SUPPORTED_BROWSERS } = require('../desktop/browser/metadata.js');

  const { document } = parseHTML(indexHtml);

  // Simulate updateBrowserActionButtons logic when Yandex is selected
  const meta = SUPPORTED_BROWSERS.yandex;
  const name = meta.name;
  const extUrl = meta.extensionsUrl;

  const obOpenExtPage = document.querySelector('#ob-open-ext-page-btn');
  if (obOpenExtPage) obOpenExtPage.textContent = meta.openExtensionsBtnText;

  const obHeroTitle = document.querySelector('#ob-hero-title');
  if (obHeroTitle && meta.guideTitle) obHeroTitle.textContent = meta.guideTitle;

  const obHeroSubtitle = document.querySelector('#ob-hero-subtitle');
  if (obHeroSubtitle && meta.guideSubtitle) obHeroSubtitle.textContent = meta.guideSubtitle;

  const obStep1Desc = document.querySelector('#ob-step1-desc');
  if (obStep1Desc && meta.guideSteps?.[0]?.desc) obStep1Desc.textContent = meta.guideSteps[0].desc;

  const obStep2Desc = document.querySelector('#ob-step2-desc');
  if (obStep2Desc) obStep2Desc.textContent = meta.devModeHint || meta.guideSteps?.[1]?.desc;

  const obStep3Desc = document.querySelector('#ob-step3-desc');
  if (obStep3Desc && meta.guideSteps?.[2]?.desc) obStep3Desc.textContent = meta.guideSteps[2].desc;

  const obExtUrlCode = document.querySelector('#ob-ext-url-code');
  if (obExtUrlCode) obExtUrlCode.textContent = meta.extensionsUrlDisplay || extUrl;

  const obRecoveryUrl = document.querySelector('#ob-recovery-url');
  if (obRecoveryUrl) obRecoveryUrl.textContent = meta.extensionsUrlDisplay || extUrl;

  const obRecoveryList = document.querySelector('#ob-recovery-list');
  if (obRecoveryList) {
    obRecoveryList.innerHTML = '';
    for (const stepText of meta.recoverySteps) {
      const li = document.createElement('li');
      li.innerHTML = stepText;
      obRecoveryList.appendChild(li);
    }
  }

  // Assertions
  assert.equal(obOpenExtPage.textContent, '🌐 Открыть расширения Яндекс Браузера');
  assert.equal(obHeroTitle.textContent, 'Установите расширение');

  const renderedCards = document.querySelectorAll('#ob-three-steps-container .ob-step-card');
  assert.equal(renderedCards.length, 3);

  const renderedRecovery = document.querySelectorAll('#ob-recovery-list li');
  assert.equal(renderedRecovery.length, 3);

  const step1Html = document.querySelector('#step-1').innerHTML.toLowerCase();
  assert.ok(!step1Html.includes('chrome://extensions'), 'Rendered step 1 must not contain chrome://extensions');
  assert.ok(!step1Html.includes('brave://extensions'), 'Rendered step 1 must not contain brave://extensions');
  assert.ok(step1Html.includes('browser://extensions'), 'Rendered step 1 must contain browser://extensions');
});

test('Onboarding OBS Step 3 Refresh CTA — Waiting, Checking, Detected & Duplicate Prevention', async () => {
  const vm = require('node:vm');
  const { window, document } = parseHTML(indexHtml);

  let listObsScenesCalls = 0;
  let addObsSceneCalls = 0;
  let currentObsState = {
    ok: true,
    connected: false,
    authFailed: false,
    scenes: [],
  };
  let resolvePendingList = null;

  const boostyOverlayMock = {
    listBrowsers: async () => [{ id: 'yandex', name: 'Яндекс Браузер' }],
    getObsConnectionConfig: async () => ({ host: '127.0.0.1', port: 4455, password: '' }),
    saveObsConnectionConfig: async () => ({ ok: true }),
    hasObsExecutable: async () => true,
    getHealth: async () => ({ ok: true, extensionConnected: true, boostyConnected: true }),
    getConfig: async () => ({}),
    getServerInfo: async () => ({ overlayUrl: 'http://127.0.0.1:31999/overlay', extensionDir: '/app/extension' }),
    listObsScenes: async () => {
      listObsScenesCalls += 1;
      if (resolvePendingList) {
        await new Promise(r => { resolvePendingList = r; });
      }
      return currentObsState;
    },
    addObsScene: async (_pwd, sceneId) => {
      addObsSceneCalls += 1;
      return { ok: true, addedScene: sceneId };
    },
    onHealthUpdate: () => {},
    onUpdateAvailable: () => {},
  };

  window.boostyOverlay = boostyOverlayMock;
  window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.BoostyStatusHub = require('../desktop/ui/status-hub.js');

  const storageMap = new Map();
  const localStorageMock = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
  };
  window.localStorage = localStorageMock;

  const appJsCode = fs.readFileSync(path.resolve(__dirname, '../desktop/app.js'), 'utf8');
  const sandbox = {
    window,
    document,
    localStorage: localStorageMock,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    URLSearchParams,
    BoostyStatusHub: window.BoostyStatusHub,
  };
  vm.createContext(sandbox);
  vm.runInContext(appJsCode, sandbox);

  // Wait for init() to settle
  await new Promise(r => setTimeout(r, 30));

  const refreshBtn = document.querySelector('#ob-refresh-obs-btn');
  const refreshLabel = document.querySelector('#ob-refresh-obs-label');
  const refreshIcon = document.querySelector('#ob-refresh-obs-icon');
  const statusBadge = document.querySelector('#ob-obs-status-badge');
  const statusText = document.querySelector('#ob-obs-status-text');
  const waitingHint = document.querySelector('#ob-obs-waiting-hint');
  const waitingLead = document.querySelector('#ob-obs-waiting-lead');
  const waitingSub = document.querySelector('#ob-obs-waiting-sub');
  const addBtn = document.querySelector('#ob-add-obs-btn');

  // 1 & 2. Waiting-state shows 'Проверить снова' and has primary style / class, calm badge
  assert.ok(refreshBtn, '#ob-refresh-obs-btn must exist');
  assert.equal(refreshIcon.textContent.trim(), '↻');
  assert.equal(refreshLabel.textContent.trim(), 'Проверить снова');
  assert.ok(refreshBtn.className.includes('primary'), 'Waiting state refresh button must have primary class');
  assert.ok(statusBadge.className.includes('pending'), 'Waiting state status badge must be pending (calm, not error)');
  assert.equal(statusText.textContent.trim(), 'OBS пока не обнаружен');
  assert.notEqual(waitingHint.style.display, 'none', 'Waiting hint must be visible in waiting state');
  assert.match(waitingLead.textContent, /OBS уже запущен\? Нажмите «Проверить снова»\./);
  assert.match(waitingSub.textContent, /Если OBS уже запущен или источник добавлен — нажмите «Проверить снова»\./);
  assert.equal(addBtn.disabled, true, 'Add button must be disabled when OBS is not connected');

  // 3 & 4. Clicking refresh button calls refresh logic & disables button with 'Проверяем…' during check
  const callsBeforeClick = listObsScenesCalls;
  resolvePendingList = true;
  refreshBtn.click();

  await new Promise(r => setTimeout(r, 15));
  assert.equal(refreshBtn.disabled, true, 'Refresh button must be disabled while checking');
  assert.equal(refreshLabel.textContent.trim(), 'Проверяем…', 'Refresh button must show Проверяем… while checking');
  assert.ok(refreshIcon.className.includes('obs-refresh-spinning'), 'Refresh icon must spin while checking');

  // Transition to OBS connected, waiting for source
  currentObsState = {
    ok: true,
    connected: true,
    authFailed: false,
    currentProgramSceneName: 'Стрим',
    scenes: [{ sceneId: 'scene-1', sceneName: 'Стрим', isCurrentProgram: true, hasChat: false }],
  };
  const resumeList = resolvePendingList;
  resolvePendingList = null;
  if (typeof resumeList === 'function') resumeList();
  await new Promise(r => setTimeout(r, 25));

  assert.ok(listObsScenesCalls > callsBeforeClick, 'Clicking refresh button must trigger listObsScenes');
  assert.equal(refreshBtn.disabled, false, 'Refresh button must re-enable after check completes');
  assert.equal(statusText.textContent.trim(), '✓ OBS обнаружен');
  assert.ok(refreshBtn.className.includes('primary'), 'Refresh button remains primary while source is still missing');
  assert.match(waitingLead.textContent, /Источник уже добавлен\? Нажмите «Проверить снова»\./);

  // 5, 6 & 7. Transition to source already existing -> CTA lowered to secondary, no duplicate creation, add button disabled
  currentObsState = {
    ok: true,
    connected: true,
    authFailed: false,
    currentProgramSceneName: 'Стрим',
    scenes: [{ sceneId: 'scene-1', sceneName: 'Стрим', isCurrentProgram: true, hasChat: true }],
  };
  refreshBtn.click();
  await new Promise(r => setTimeout(r, 25));

  assert.equal(statusText.textContent.trim(), '✓ OBS обнаружен · ✓ Источник найден');
  assert.ok(refreshBtn.className.includes('secondary'), 'After source is detected, refresh button must lower priority to secondary');
  assert.ok(!refreshBtn.className.includes('primary'), 'After source is detected, refresh button must not be primary');
  assert.equal(waitingHint.style.display, 'none', 'Waiting hint must be hidden once source is detected');

  // Verify no duplicate source creation on repeated refresh clicks
  refreshBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(addObsSceneCalls, 0, 'Refresh button must never create duplicate Browser Sources');

  // Verify user is not offered to add a second source when scene already hasChat
  assert.equal(addBtn.disabled, true, 'Add source button must be disabled when source already exists in scene');
  assert.ok(addBtn.className.includes('secondary'), 'Add source button must be secondary when source already exists');
  assert.equal(addBtn.textContent.trim(), '✓ Источник уже добавлен');

  // Even programmatic click on addBtn must not call addObsScene when hasChat is true
  addBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(addObsSceneCalls, 0, 'Add button must not create duplicate source if scene already hasChat');
});
