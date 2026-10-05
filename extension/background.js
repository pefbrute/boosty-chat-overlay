// extension/background.js
// Manifest V3 Persistent Connection-Oriented Transport v2
const WS_URL = 'ws://127.0.0.1:17369/connector';
const HTTP_ENDPOINT = 'http://127.0.0.1:17369/connector';

// Track known active Boosty tabs: tabId -> { tabId, url, hasChat, isStream, title, lastSeenAt }
const activeBoostyTabs = new Map();

let ws = null;
let isConnected = false;
let clientGeneration = 0;
let reconnectTimer = null;
let pingTimer = null;
let retryAttempt = 0;

function getExtensionVersion() {
  return (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '0.4.0';
}

function getExtensionId() {
  return (typeof chrome !== 'undefined' && chrome.runtime?.id) || 'bcoadgccgjomlcadhmeognidaoocohdp';
}

function getActiveTabsPayload() {
  const tabs = [];
  for (const tab of activeBoostyTabs.values()) {
    tabs.push({
      tabId: tab.tabId,
      url: tab.url,
      hasChat: Boolean(tab.hasChat),
      isStream: Boolean(tab.isStream),
      title: tab.title,
      lastSeenAt: tab.lastSeenAt,
    });
  }
  return tabs;
}

function saveTabsToSession() {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    const tabList = getActiveTabsPayload();
    chrome.storage.session.set({ activeBoostyTabs: tabList }).catch(() => {});
  }
}

function loadTabsFromSession() {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    chrome.storage.session.get('activeBoostyTabs', (items) => {
      if (Array.isArray(items?.activeBoostyTabs)) {
        for (const t of items.activeBoostyTabs) {
          if (t && t.tabId && !activeBoostyTabs.has(t.tabId)) {
            activeBoostyTabs.set(t.tabId, t);
          }
        }
      }
    });
  }
}

// Initial session load
loadTabsFromSession();

// --- WebSocket Connection Management ---

function sendWs(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch (err) {
      console.warn('[Boosty Background] WS send error:', err.message);
    }
  }
  return false;
}

function connectWs() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  clientGeneration++;
  const currentGen = clientGeneration;

  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    if (currentGen !== clientGeneration) return;
    isConnected = true;
    retryAttempt = 0;
    console.info(`[Boosty Background] WebSocket connected (generation ${currentGen})`);

    // Immediate Handshake with server
    const handshake = {
      type: 'HANDSHAKE',
      client: 'boosty-chat-connector',
      version: getExtensionVersion(),
      extensionVersion: getExtensionVersion(),
      extensionId: getExtensionId(),
      tabs: getActiveTabsPayload(),
      generation: currentGen,
    };
    try {
      ws.send(JSON.stringify(handshake));
    } catch {}

    // Start 20s keepalive ping to maintain MV3 service worker active
    startPing(currentGen);
  };

  ws.onmessage = (event) => {
    if (currentGen !== clientGeneration) return;
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'PONG') {
        // Keepalive acknowledged
      }
    } catch {}
  };

  ws.onclose = (event) => {
    if (currentGen !== clientGeneration) return;
    cleanupSocket(currentGen);
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    if (currentGen !== clientGeneration) return;
    cleanupSocket(currentGen);
    scheduleReconnect();
  };
}

function cleanupSocket(gen) {
  if (gen === clientGeneration) {
    isConnected = false;
    stopPing();
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
  }
}

function startPing(gen) {
  stopPing();
  pingTimer = setInterval(() => {
    if (gen === clientGeneration && ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
      } catch {
        cleanupSocket(gen);
        scheduleReconnect();
      }
    } else {
      stopPing();
    }
  }, 20_000);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return; // Single-flight coordinator

  retryAttempt++;
  // Jittered backoff: 50ms, 250ms, 500ms, 1000ms, 2000ms, capped at 3000ms + random 0-500ms
  const backoffs = [50, 250, 500, 1000, 2000, 3000];
  const baseDelay = backoffs[Math.min(retryAttempt - 1, backoffs.length - 1)];
  const jitter = Math.floor(Math.random() * 500);
  const delay = baseDelay + jitter;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
}

// Initial connect
connectWs();

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    connectWs();
  });
}

// Watchdog alarm for Manifest V3 recovery
if (typeof chrome !== 'undefined' && chrome.alarms) {
  chrome.alarms.create('connector_watchdog', {
    periodInMinutes: 1,
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'connector_watchdog') {
      if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
        connectWs();
      }
    }
  });
}

// Track tab closure for immediate removal & announce
if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener(tabId => {
    if (activeBoostyTabs.has(tabId)) {
      activeBoostyTabs.delete(tabId);
      saveTabsToSession();
      sendWs('TAB_CLOSED', { tabId });
    }
  });
}

// --- Content Script Port-based Event-Driven Communication ---

if (typeof chrome !== 'undefined' && chrome.runtime?.onConnect) {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'boosty_tab') {
      const tabId = port.sender?.tab?.id ?? 'tab_' + Math.random().toString(36).slice(2, 9);

      port.onMessage.addListener(msg => {
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'TAB_STATE') {
          const payload = msg.payload || {};
          const tabEntry = {
            tabId,
            url: payload.url || port.sender?.tab?.url || '',
            hasChat: Boolean(payload.hasChat),
            isStream: Boolean(payload.isStream),
            title: payload.title || port.sender?.tab?.title || '',
            lastSeenAt: Date.now(),
          };
          activeBoostyTabs.set(tabId, tabEntry);
          saveTabsToSession();

          // Send over WebSocket; if not open, fallback to HTTP
          if (!sendWs('TAB_STATE', tabEntry)) {
            fetch(HTTP_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(tabEntry),
            }).catch(() => {});
          }
        } else if (msg.type === 'MESSAGE' || msg.type === 'POST_MESSAGE') {
          const payload = msg.payload || msg;
          if (!sendWs('MESSAGE', payload)) {
            fetch('http://127.0.0.1:17369/message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }).catch(() => {});
          }
        }
      });

      port.onDisconnect.addListener(() => {
        if (activeBoostyTabs.has(tabId)) {
          activeBoostyTabs.delete(tabId);
          saveTabsToSession();
          sendWs('TAB_CLOSED', { tabId });
        }
      });
    }
  });
}

// Backward-compatible chrome.runtime.onMessage handler
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const tabId = sender?.tab?.id ?? sender?.url ?? 'default';

    if (request?.type === 'POST_MESSAGE') {
      const sent = sendWs('MESSAGE', request.payload);
      if (sent) {
        sendResponse({ ok: true, transport: 'websocket' });
      } else {
        fetch('http://127.0.0.1:17369/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.payload),
        })
          .then(res => res.json())
          .then(data => sendResponse({ ok: true, data, transport: 'http' }))
          .catch(err => sendResponse({ ok: false, error: err.message }));
      }
      return true;
    }

    if (request?.type === 'HEARTBEAT' || request?.type === 'TAB_STATE') {
      const payload = request.payload || {};
      const tabEntry = {
        tabId: sender?.tab?.id,
        url: payload.url || sender?.tab?.url || '',
        hasChat: Boolean(payload.hasChat),
        isStream: Boolean(payload.isStream),
        title: payload.title || sender?.tab?.title || '',
        lastSeenAt: Date.now(),
      };
      activeBoostyTabs.set(tabId, tabEntry);
      saveTabsToSession();

      const sent = sendWs('TAB_STATE', tabEntry);
      if (sent) {
        sendResponse({ ok: true, transport: 'websocket' });
      } else {
        fetch(HTTP_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then(res => res.json())
          .then(data => sendResponse({ ok: true, data, transport: 'http' }))
          .catch(err => sendResponse({ ok: false, error: err.message }));
      }
      return true;
    }
  });
}
