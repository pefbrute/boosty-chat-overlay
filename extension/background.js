const endpoint = 'http://127.0.0.1:17369/connector';

async function sendHeartbeat() {
  const extensionVersion = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '0.4.0';
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'background', extensionVersion, version: extensionVersion, timestamp: Date.now() }),
    });
  } catch {
    // Desktop application is not running.
  }
}

// Initial heartbeat upon load / install
sendHeartbeat();

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    sendHeartbeat();
  });
}

// Use chrome.alarms for persistent wakeup in Manifest V3
if (typeof chrome !== 'undefined' && chrome.alarms) {
  chrome.alarms.create('connector_heartbeat', {
    periodInMinutes: 0.5,
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'connector_heartbeat') {
      sendHeartbeat();
    }
  });
}

// Message & Heartbeat forwarding from Content Script (bypasses CSP / PNA)
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type === 'POST_MESSAGE') {
      fetch('http://127.0.0.1:17369/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.payload),
      })
        .then(res => res.json())
        .then(data => sendResponse({ ok: true, data }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true; // Keep message channel open for async response
    }
    if (request?.type === 'HEARTBEAT') {
      fetch('http://127.0.0.1:17369/connector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.payload),
      })
        .then(res => res.json())
        .then(data => sendResponse({ ok: true, data }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });
}
