const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..', '..');

// 1. Overlay DOM Mutation Analysis
function benchmarkOverlayDom(messagesCount = 50) {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'overlay', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://127.0.0.1:17369/overlay/',
  });

  const { window } = dom;
  const { document } = window;

  let addedNodes = 0;
  let removedNodes = 0;
  let attributeMutations = 0;
  let totalMutationRecords = 0;

  const observer = new window.MutationObserver(records => {
    totalMutationRecords += records.length;
    for (const rec of records) {
      if (rec.type === 'childList') {
        addedNodes += rec.addedNodes.length;
        removedNodes += rec.removedNodes.length;
      } else if (rec.type === 'attributes') {
        attributeMutations++;
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
  });

  // Mock EventSource and fetch in window
  let messageHandler = null;
  let configHandler = null;
  window.EventSource = class {
    constructor() {}
    addEventListener(type, handler) {
      if (type === 'config') configHandler = handler;
    }
    set onmessage(handler) {
      messageHandler = handler;
    }
  };
  window.fetch = async (url) => {
    return {
      json: async () => ({
        durationSeconds: 20,
        maxMessages: 6,
        fontSize: 21,
        accentColor: '#f15f2c',
        backgroundOpacity: 88,
        showAvatars: true,
      })
    };
  };

  // Load overlay.js in JSDOM context
  const scriptContent = fs.readFileSync(path.join(ROOT_DIR, 'overlay', 'overlay.js'), 'utf8');
  window.eval(scriptContent);

  // Send 50 messages
  const t0 = performance.now();
  for (let i = 0; i < messagesCount; i++) {
    if (messageHandler) {
      messageHandler({
        data: JSON.stringify({
          id: `msg-${i}`,
          author: `User ${i}`,
          text: `Sample message content ${i}`,
          avatar: '',
          timestamp: Date.now(),
        })
      });
    }
  }
  const durationMs = performance.now() - t0;

  const activeDomCards = document.querySelector('#messages').children.length;
  const allNodesInMessages = document.querySelector('#messages').querySelectorAll('*').length;

  return {
    messagesSent: messagesCount,
    executionTimeMs: durationMs.toFixed(2),
    totalMutationRecords,
    addedNodes,
    removedNodes,
    attributeMutations,
    finalActiveCards: activeDomCards,
    totalDomNodesInContainer: allNodesInMessages + 1, // container + children
    mutationsPerMessage: (totalMutationRecords / messagesCount).toFixed(2),
    addedNodesPerMessage: (addedNodes / messagesCount).toFixed(2),
  };
}

// 2. Desktop Dashboard UI DOM Mutations in Idle (1 minute simulation)
function benchmarkDesktopAppDom(durationSeconds = 60) {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'desktop', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'file://' + path.join(ROOT_DIR, 'desktop', 'index.html'),
  });

  const { window } = dom;
  const { document } = window;

  let addedNodes = 0;
  let removedNodes = 0;
  let attributeMutations = 0;
  let characterDataMutations = 0;
  let totalRecords = 0;

  const observer = new window.MutationObserver(records => {
    totalRecords += records.length;
    for (const rec of records) {
      if (rec.type === 'childList') {
        addedNodes += rec.addedNodes.length;
        removedNodes += rec.removedNodes.length;
      } else if (rec.type === 'attributes') {
        attributeMutations++;
      } else if (rec.type === 'characterData') {
        characterDataMutations++;
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  // Replicate renderObsUi behavior from desktop/app.js
  const mockScenes = [
    { sceneUuid: 'uuid-1', sceneName: 'Gaming', hasChat: true },
    { sceneUuid: 'uuid-2', sceneName: 'Just Chatting', hasChat: false },
    { sceneUuid: 'uuid-3', sceneName: 'BRB', hasChat: false },
  ];

  function simulateRenderObsUi() {
    const obSelect = document.querySelector('#ob-obs-scene-select');
    const dashSelect = document.querySelector('#dash-obs-scene');
    const obBadge = document.querySelector('#ob-obs-status-badge');
    const obBadgeText = document.querySelector('#ob-obs-status-text');
    const dashBadge = document.querySelector('#dash-obs-badge');
    const dashTargetsHint = document.querySelector('#dash-obs-targets-hint');
    const dashObsPill = document.querySelector('#dash-obs-pill');
    const dashObsText = document.querySelector('#dash-obs-text');

    if (obBadge) { obBadge.className = 'badge connected'; obBadgeText.textContent = 'OBS подключён'; }
    if (dashBadge) { dashBadge.className = 'badge connected'; dashBadge.textContent = 'OBS подключён'; }
    if (dashObsPill) { dashObsPill.className = 'status-pill connected'; dashObsText.textContent = 'Подключён (Gaming)'; }
    if (dashTargetsHint) { dashTargetsHint.textContent = 'Чат подключён в сценах: Gaming.'; }

    // Dropdown rebuilding on every cycle:
    [obSelect, dashSelect].forEach(select => {
      if (!select) return;
      select.innerHTML = '<option value="">Выберите сцену OBS…</option>';
      for (const scene of mockScenes) {
        const opt = document.createElement('option');
        opt.value = scene.sceneUuid;
        opt.textContent = scene.hasChat ? `${scene.sceneName} ✓` : scene.sceneName;
        select.append(opt);
      }
    });
  }

  function simulateRefreshStatus() {
    const dashConnectorPill = document.querySelector('#dash-connector-pill');
    const dashConnectorText = document.querySelector('#dash-connector-text');
    const dashExtensionPill = document.querySelector('#dash-extension-pill');
    const dashExtensionText = document.querySelector('#dash-extension-text');
    const dashCounter = document.querySelector('#dash-received-count');

    if (dashConnectorPill) dashConnectorPill.className = 'status-pill connected';
    if (dashConnectorText) dashConnectorText.textContent = 'Активен (вкладка открыта)';
    if (dashExtensionPill) dashExtensionPill.className = 'status-pill connected';
    if (dashExtensionText) dashExtensionText.textContent = 'Установлено (0.4.0)';
    if (dashCounter) dashCounter.textContent = '12';
  }

  // Simulate 60 seconds of idle polling:
  // refreshStatus runs every 1.5s -> 40 times in 60s
  // obsStateChanged / loadObsScenes runs every 2.5s -> 24 times in 60s
  const refreshStatusCalls = Math.floor(durationSeconds / 1.5);
  const obsRenderCalls = Math.floor(durationSeconds / 2.5);

  for (let i = 0; i < refreshStatusCalls; i++) {
    simulateRefreshStatus();
  }
  for (let i = 0; i < obsRenderCalls; i++) {
    simulateRenderObsUi();
  }

  return {
    simulatedDurationSec: durationSeconds,
    refreshStatusCycles: refreshStatusCalls,
    obsRenderCycles: obsRenderCalls,
    totalMutationRecords: totalRecords,
    addedNodes,
    removedNodes,
    attributeMutations,
    characterDataMutations,
    domMutationsPerMinute: totalRecords,
    domMutationsPerHour: totalRecords * 60,
  };
}

async function run() {
  console.log('=== BENCHMARK & AUDIT: DOM MUTATIONS ===\n');

  console.log('1. Overlay DOM Mutations for 50 messages...');
  const overlayDomStats = benchmarkOverlayDom(50);
  console.log(JSON.stringify(overlayDomStats, null, 2));
  console.log();

  console.log('2. Desktop UI DOM Mutations in Idle over 60 seconds (Dropdown recreation & Status polling)...');
  const desktopDomStats = benchmarkDesktopAppDom(60);
  console.log(JSON.stringify(desktopDomStats, null, 2));
}

run().catch(console.error);
