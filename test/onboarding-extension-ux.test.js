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
  assert.equal(heroTitle.textContent.trim(), 'Подключите расширение Boosty Chat Overlay');

  const heroSubtitle = document.querySelector('#step-1 .card-hero p');
  assert.ok(heroSubtitle, 'Hero subtitle must exist');
  assert.equal(heroSubtitle.textContent.trim(), 'Расширение передаёт сообщения из Boosty в приложение.');

  // 2. Browser choice container
  const browserPrompt = document.querySelector('#ob-browser-prompt');
  assert.ok(browserPrompt, 'Browser prompt must exist');
  assert.match(browserPrompt.textContent, /В каком браузере вы открываете Boosty\?/);

  const browserOptions = document.querySelector('#ob-browser-options');
  assert.ok(browserOptions, 'Browser options container must exist');

  // 3. Step-by-step instructions
  const guideSteps = document.querySelectorAll('.ob-guide-step');
  assert.equal(guideSteps.length, 4, 'Must have exactly 4 installation steps');

  const extUrlCode = document.querySelector('#ob-ext-url-code');
  assert.ok(extUrlCode, 'Extension URL code element must exist');

  // 4. Folder block with actions
  const folderPath = document.querySelector('#ob-ext-folder-path');
  assert.ok(folderPath, 'Extension folder path element must exist');

  const openFolderBtn = document.querySelector('#ob-open-ext-folder-btn');
  assert.ok(openFolderBtn, 'Open folder button must exist');

  const copyPathBtn = document.querySelector('#ob-copy-ext-path-btn');
  assert.ok(copyPathBtn, 'Copy path button must exist');

  // 5. Primary CTAs
  const openExtPageBtn = document.querySelector('#ob-open-ext-page-btn');
  assert.ok(openExtPageBtn, 'Open extensions page button must exist');

  const recheckBtn = document.querySelector('#ob-recheck-btn');
  assert.ok(recheckBtn, 'Recheck button must exist');

  // 6. Status Card
  const statusBadge = document.querySelector('#ob-ext-status-badge');
  assert.ok(statusBadge, 'Status badge must exist');

  const statusText = document.querySelector('#ob-ext-status-text');
  assert.ok(statusText, 'Status text must exist');

  const successMsg = document.querySelector('#ob-ext-success-msg');
  assert.ok(successMsg, 'Success message box must exist');

  // 7. Recovery help card
  const recoveryBox = document.querySelector('#ob-recovery-box');
  assert.ok(recoveryBox, 'Recovery box must exist');

  const recoveryUrl = document.querySelector('#ob-recovery-url');
  assert.ok(recoveryUrl, 'Recovery URL element must exist');

  const recoveryRecheckBtn = document.querySelector('#ob-recovery-recheck-btn');
  assert.ok(recoveryRecheckBtn, 'Recovery recheck button must exist');

  // 8. Wizard Navigation Bottom Actions
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
  assert.equal(getExtensionsUrlForBrowser('unknown'), 'chrome://extensions');
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
  assert.equal(yandex.guideTitle, 'Откройте страницу расширений Яндекс Браузера');

  // Verify exactly 6 steps for Yandex onboarding
  assert.equal(yandex.guideSteps.length, 6, 'Yandex onboarding must have 6 clear steps');
  assert.match(yandex.guideSteps[0].desc, /browser:\/\/extensions/);
  assert.match(yandex.guideSteps[1].title, /Режим разработчика/);
  assert.match(yandex.guideSteps[2].title, /Загрузить распакованное расширение/);
  assert.match(yandex.guideSteps[3].title, /Boosty Chat Overlay/);
  assert.match(yandex.guideSteps[4].title, /Убедитесь, что расширение включено/);
  assert.match(yandex.guideSteps[5].title, /Проверить подключение/);

  // Assert NO text leakage of Chrome/Brave/Edge in Yandex steps
  for (const step of yandex.guideSteps) {
    const combined = `${step.title} ${step.desc}`.toLowerCase();
    assert.ok(!combined.includes('chrome'), `Yandex step must not mention Chrome: ${combined}`);
    assert.ok(!combined.includes('brave'), `Yandex step must not mention Brave: ${combined}`);
    assert.ok(!combined.includes('edge'), `Yandex step must not mention Edge: ${combined}`);
  }

  // Recovery steps
  assert.ok(Array.isArray(yandex.recoverySteps));
  assert.ok(yandex.recoverySteps.length >= 4);
  const recoveryJoined = yandex.recoverySteps.join(' ').toLowerCase();
  assert.match(recoveryJoined, /browser:\/\/extensions/);
  assert.match(recoveryJoined, /boosty chat overlay/);
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

  const obGuideTitle = document.querySelector('#ob-guide-title');
  if (obGuideTitle) obGuideTitle.textContent = meta.guideTitle;

  const obGuideSteps = document.querySelector('#ob-guide-steps');
  if (obGuideSteps) {
    obGuideSteps.innerHTML = '';
    for (const step of meta.guideSteps) {
      const stepEl = document.createElement('div');
      stepEl.className = 'ob-guide-step';
      stepEl.innerHTML = `
        <span class="ob-step-num">${step.num}</span>
        <div class="ob-step-body">
          <div class="ob-step-title">${step.title}</div>
          <div class="ob-step-desc">${step.desc}</div>
        </div>
      `;
      obGuideSteps.appendChild(stepEl);
    }
  }

  const obExtUrlCode = document.querySelector('#ob-ext-url-code');
  if (obExtUrlCode) obExtUrlCode.textContent = extUrl;

  const obRecoveryUrl = document.querySelector('#ob-recovery-url');
  if (obRecoveryUrl) obRecoveryUrl.textContent = extUrl;

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
  assert.equal(obGuideTitle.textContent, 'Откройте страницу расширений Яндекс Браузера');

  const renderedSteps = document.querySelectorAll('#ob-guide-steps .ob-guide-step');
  assert.equal(renderedSteps.length, 6);

  const renderedRecovery = document.querySelectorAll('#ob-recovery-list li');
  assert.equal(renderedRecovery.length, 5);

  const step1Html = document.querySelector('#step-1').innerHTML.toLowerCase();
  assert.ok(!step1Html.includes('chrome://extensions'), 'Rendered step 1 must not contain chrome://extensions');
  assert.ok(!step1Html.includes('brave://extensions'), 'Rendered step 1 must not contain brave://extensions');
});
