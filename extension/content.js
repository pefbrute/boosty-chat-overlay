const endpoint = 'http://127.0.0.1:17369/message';
const connectorEndpoint = 'http://127.0.0.1:17369/connector';
const processed = new WeakSet();

// Query helpers with flexible fallbacks for Boosty Chat DOM
function queryRootElements(scope = document) {
  return scope.querySelectorAll(
    '[data-test-id="CHATMESSAGE:root"], [data-test-id*="CHATMESSAGE"], [class*="ChatMessage_root"], [class*="ChatMessage"]'
  );
}

function extractAuthor(root) {
  const el = root.querySelector(
    '[data-test-id="CHATMESSAGE:author"], [class*="Author"], [class*="author"], [class*="name"]'
  );
  return el?.textContent?.trim() || '';
}

function extractText(root) {
  const el = root.querySelector(
    '[data-test-id="CHATMESSAGE:message"], [class*="Message_text"], [class*="Message"], [class*="message"], [class*="Text"], [class*="text"]'
  );
  return el?.textContent?.trim() || '';
}

function avatarUrl(root) {
  const image = root.querySelector('img');
  if (image?.src) return image.src;

  const avatar = root.querySelector('[class*="Avatar"], [class*="avatar"]');
  if (!avatar) return '';
  const background = getComputedStyle(avatar).backgroundImage;
  const match = background.match(/^url\(["']?(.*?)["']?\)$/);
  return match?.[1] || '';
}

// Mark existing messages on initial page load as already processed
queryRootElements(document).forEach(root => {
  processed.add(root);
});

// Dual transport: try background service worker first (bypasses CSP/PNA), then fallback to direct fetch
async function transportSend(type, payload, fallbackUrl) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      const res = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, payload }, response => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(response);
        });
      });
      if (res?.ok) return true;
    } catch {
      // Fallback to direct fetch
    }
  }

  try {
    const response = await fetch(fallbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (err) {
    console.warn('[Boosty Chat Connector] transport failed:', err.message);
    return false;
  }
}

async function forward(root) {
  if (processed.has(root)) return;

  const author = extractAuthor(root);
  const text = extractText(root);
  if (!author || !text) return;

  processed.add(root);

  const extensionVersion = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '0.4.0';
  const publishTime = root.querySelector('[class*="publishTime"], [class*="time"]')?.textContent?.trim() || '';
  const messageId = `${location.pathname}|${author}|${text}|${publishTime || Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const message = {
    id: messageId,
    author,
    text,
    avatar: avatarUrl(root),
    extensionVersion,
    version: extensionVersion,
  };

  const sent = await transportSend('POST_MESSAGE', message, endpoint);
  if (sent) {
    console.info('[Boosty Chat Connector] sent message:', author, '->', text);
  } else {
    processed.delete(root);
    console.error('[Boosty Chat Connector] local server unavailable');
  }
}

let currentChatContainer = null;
let chatObserver = null;
let discoveryObserver = null;

function findChatContainer() {
  const sample = document.querySelector('[data-test-id="CHATMESSAGE:root"], [data-test-id*="CHATMESSAGE"]');
  if (sample) return sample.parentElement;
  return document.querySelector('[data-test-id="CHAT:messages"], [class*="Chat_messages"], [class*="chat-messages"], [class*="Chat_scroll"]');
}

function processMessageNode(node) {
  if (!(node instanceof Element)) return;
  if (node.matches('[data-test-id="CHATMESSAGE:root"], [data-test-id*="CHATMESSAGE"], [class*="ChatMessage"]')) {
    forward(node);
    return;
  }
  const roots = queryRootElements(node);
  for (const root of roots) {
    forward(root);
  }
}

function attachChatObserver(container) {
  if (!container || currentChatContainer === container) return;
  if (chatObserver) chatObserver.disconnect();
  currentChatContainer = container;

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
        if (node.matches('[data-test-id="CHATMESSAGE:root"], [data-test-id*="CHATMESSAGE"], [class*="ChatMessage"]') || queryRootElements(node).length > 0) {
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
  const extensionVersion = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '0.4.0';
  const payload = {
    source: 'content_tab',
    extensionVersion,
    version: extensionVersion,
    url: location.href,
    timestamp: Date.now(),
  };
  await transportSend('HEARTBEAT', payload, connectorEndpoint);
}

heartbeat();
setInterval(heartbeat, 5_000);

