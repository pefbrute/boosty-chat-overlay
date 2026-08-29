const endpoint = 'http://127.0.0.1:17369/message';
const processed = new WeakSet();
const initialMessages = new WeakSet();

document.querySelectorAll('[data-test-id="CHATMESSAGE:root"]').forEach(root => {
  processed.add(root);
  initialMessages.add(root);
});

function avatarUrl(root) {
  const image = root.querySelector('img');
  if (image?.src) return image.src;

  const avatar = root.querySelector('[class*="Avatar"]');
  if (!avatar) return '';
  const background = getComputedStyle(avatar).backgroundImage;
  const match = background.match(/^url\(["']?(.*?)["']?\)$/);
  return match?.[1] || '';
}

async function forward(root) {
  if (processed.has(root)) return;

  const author = root.querySelector('[data-test-id="CHATMESSAGE:author"]')?.textContent?.trim();
  const text = root.querySelector('[data-test-id="CHATMESSAGE:message"]')?.textContent?.trim();
  if (!author || !text) return;

  processed.add(root);
  const message = {
    author,
    text,
    avatar: avatarUrl(root),
    id: [
      location.pathname,
      root.querySelector('[class*="publishTime"]')?.textContent?.trim() || '',
      author,
      text,
    ].join('|'),
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.info('[Boosty Chat Connector] sent:', message);
  } catch (error) {
    processed.delete(root);
    console.error('[Boosty Chat Connector] local server unavailable:', error);
  }
}

let currentChatContainer = null;
let chatObserver = null;
let discoveryObserver = null;
let initialLoadDone = false;

function findChatContainer() {
  const sample = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
  if (sample) return sample.parentElement;
  return document.querySelector('[data-test-id="CHAT:messages"], [class*="Chat_messages"], [class*="chat-messages"]');
}

function processMessageNode(node) {
  if (!(node instanceof Element)) return;
  if (node.matches('[data-test-id="CHATMESSAGE:root"]')) {
    forward(node);
    return;
  }
  const roots = node.querySelectorAll('[data-test-id="CHATMESSAGE:root"]');
  for (const root of roots) {
    forward(root);
  }
}

function attachChatObserver(container) {
  if (!container || currentChatContainer === container) return;
  if (chatObserver) chatObserver.disconnect();
  currentChatContainer = container;

  if (!initialLoadDone) {
    container.querySelectorAll('[data-test-id="CHATMESSAGE:root"]').forEach(root => {
      processed.add(root);
      initialMessages.add(root);
    });
    initialLoadDone = true;
  }

  chatObserver = new MutationObserver(records => {
    if (!container.isConnected) {
      detachChatObserver();
      startDiscovery();
      return;
    }
    for (const record of records) {
      for (const node of record.addedNodes) {
        processMessageNode(node);
      }
    }
  });

  chatObserver.observe(container, { childList: true, subtree: true });
  console.info('[Boosty Chat Connector] attached to chat container');

  if (discoveryObserver) {
    discoveryObserver.disconnect();
    discoveryObserver = null;
  }
}

function detachChatObserver() {
  if (chatObserver) {
    chatObserver.disconnect();
    chatObserver = null;
  }
  currentChatContainer = null;
}

function startDiscovery() {
  if (currentChatContainer?.isConnected) return;
  if (discoveryObserver) return;

  const container = findChatContainer();
  if (container) {
    attachChatObserver(container);
    return;
  }

  discoveryObserver = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[data-test-id="CHATMESSAGE:root"]') || node.querySelector('[data-test-id="CHATMESSAGE:root"]')) {
          if (!currentChatContainer) {
            const found = findChatContainer();
            if (found) attachChatObserver(found);
          }
          processMessageNode(node);
        }
      }
    }
  });

  discoveryObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  console.info('[Boosty Chat Connector] discovery observer active');
}

startDiscovery();
console.info('[Boosty Chat Connector] active');

async function heartbeat() {
  const version = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '0.4.0';
  try {
    await fetch('http://127.0.0.1:17369/connector', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'content_tab', version, url: location.href, timestamp: Date.now() }),
    });
  } catch {
    // The desktop application is not running yet.
  }
}

heartbeat();
setInterval(heartbeat, 5_000);
