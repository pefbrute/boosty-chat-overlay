const endpoint = 'http://127.0.0.1:17369/connector';

async function sendHeartbeat() {
  const version = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '0.4.0';
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'background', version, timestamp: Date.now() }),
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
