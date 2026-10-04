const endpoint = 'http://127.0.0.1:17369/message';
const connectorEndpoint = 'http://127.0.0.1:17369/connector';
const processed = new WeakSet();

const parser = typeof BoostyParser !== 'undefined' ? BoostyParser : null;

// Query helpers with flexible fallbacks for Boosty Chat DOM
function queryRootElements(scope = document) {
  if (parser) return parser.queryRootElements(scope);
  const roots = scope.querySelectorAll(
    '[data-test-id="CHATMESSAGE:root"], [class*="ChatMessage-scss--module_root"], [class*="ChatMessage_root"], [class*="ChatMessageRoot"], [class*="chat-message-root"]'
  );
  if (roots.length > 0) return roots;

  const candidates = scope.querySelectorAll('[data-test-id*="CHATMESSAGE"], [class*="ChatMessage"]');
  return Array.from(candidates).filter(el => {
    const cls = String(el.className || "");
    return !cls.includes("button") && !cls.includes("Icon") && !cls.includes("avatar") && !cls.includes("badge") && !cls.includes("tooltip");
  });
}

function extractAuthor(root) {
  if (parser) return parser.extractAuthor(root);
  const el = root.querySelector(
    '[data-test-id="CHATMESSAGE:author"], [class*="Author"], [class*="author"], [class*="name"]'
  );
  return (el?.textContent || '').trim().replace(/:$/, '').trim();
}

function extractText(root) {
  if (parser) return parser.extractText(root);
  const el = root.querySelector(
    '[data-test-id="CHATMESSAGE:message"], [class*="Message_text"], [class*="Message"], [class*="message"], [class*="Text"], [class*="text"]'
  );
  return el?.textContent?.trim() || '';
}

function avatarUrl(root) {
  if (parser) return parser.extractAvatarUrl(root);
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

// Port to background service worker for reliable event-driven messaging
let bgPort = null;

function getBackgroundPort() {
  if (bgPort) return bgPort;
  if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
    try {
      bgPort = chrome.runtime.connect({ name: 'boosty_tab' });
      bgPort.onDisconnect.addListener(() => {
        bgPort = null;
        setTimeout(getBackgroundPort, 1500);
      });
    } catch {
      bgPort = null;
    }
  }
  return bgPort;
}

// Ensure initial Port connection
getBackgroundPort();

// Dual transport: try background port/service worker first, then fallback to direct fetch
async function transportSend(type, payload, fallbackUrl) {
  const port = getBackgroundPort();
  if (port) {
    try {
      port.postMessage({ type, payload });
      return true;
    } catch {
      bgPort = null;
    }
  }

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

  const parsed = parser ? parser.parseBoostyMessage(root, { pathname: location.pathname }) : null;
  const author = parsed ? parsed.author : extractAuthor(root);
  const text = parsed ? parsed.text : extractText(root);
  if (!author || !text) return;

  processed.add(root);

  const extensionVersion = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '0.4.0';
  const messageId = parsed?.id || `${location.pathname}|${author}|${text}|${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const message = {
    id: messageId,
    platform: 'boosty',
    author,
    role: parsed?.role || null,
    text,
    segments: Array.isArray(parsed?.segments) ? parsed.segments : null,
    avatar: parsed ? parsed.avatar : avatarUrl(root),
    publishTime: parsed?.publishTime || '',
    reply: parsed?.reply || null,
    extensionVersion,
    version: extensionVersion,
    timestamp: Date.now(),
  };

  const sent = await transportSend('MESSAGE', message, endpoint);
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
  const sample = document.querySelector(
    '[data-test-id="CHATMESSAGE:root"], [class*="ChatMessage-scss--module_root"], [class*="ChatMessage_root"], [data-test-id*="CHATMESSAGE"]'
  );
  if (sample) {
    // Look upwards for virtual list or scroll container
    const scrollContainer = sample.closest(
      '[class*="ChatBoxBase"][class*="list"], [class*="Chat_scroll"], [class*="scroll"], [class*="Chat_messages"], [class*="messages"]'
    );
    if (scrollContainer) return scrollContainer;

    // Fallback: if parent is an individual message row wrapper, go up to list container if possible
    if (sample.parentElement && sample.parentElement.parentElement) {
      return sample.parentElement.parentElement;
    }
    return sample.parentElement;
  }

  return document.querySelector(
    '[class*="ChatBoxBase"][class*="list"], [data-test-id="CHAT:messages"], [class*="Chat_messages"], [class*="chat-messages"], [class*="Chat_scroll"]'
  );
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

  // Immediately announce chat container detection to desktop server & background
  immediateAnnounce();
}

function detachChatObserver() {
  if (chatObserver) {
    chatObserver.disconnect();
    chatObserver = null;
  }
  currentChatContainer = null;
  immediateAnnounce();
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

// --- Adaptive Heartbeat & Immediate State Announce ---
const tabSessionId = 'tab_' + Math.random().toString(36).slice(2, 9);
let isConnected = false;
let retryAttempt = 0;
let heartbeatTimer = null;

function buildPayload() {
  const extensionVersion = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '0.4.0';
  const hasChat = Boolean(currentChatContainer && currentChatContainer.isConnected);
  const isStream = location.pathname.includes('/streams/') ||
                   location.pathname.includes('/stream') ||
                   Boolean(document.querySelector('[data-test-id*="STREAM"], [class*="Stream"]'));
  return {
    source: 'content_tab',
    tabSessionId,
    extensionVersion,
    version: extensionVersion,
    url: location.href,
    title: document.title,
    hasChat,
    isStream,
    timestamp: Date.now(),
  };
}

async function heartbeat() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }

  const payload = buildPayload();
  const ok = await transportSend('TAB_STATE', payload, connectorEndpoint);

  if (ok) {
    isConnected = true;
    retryAttempt = 0;
    // Gentle periodic sync: 20s (transport is WebSocket-driven)
    heartbeatTimer = setTimeout(heartbeat, 20_000);
  } else {
    isConnected = false;
    retryAttempt++;
    // Reconnect backoff: 1s, 2s, 3s, 5s...
    const backoffDelays = [1000, 2000, 3000, 5000];
    const delay = backoffDelays[Math.min(retryAttempt - 1, backoffDelays.length - 1)];
    heartbeatTimer = setTimeout(heartbeat, delay);
  }
}

function immediateAnnounce() {
  heartbeat();
}

// Initial announce
heartbeat();

// Announce on user focus or visibility change
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) immediateAnnounce();
});
window.addEventListener('focus', immediateAnnounce);

// Announce on SPA client navigation
['pushState', 'replaceState'].forEach(method => {
  const orig = history[method];
  if (typeof orig === 'function') {
    history[method] = function(...args) {
      const result = orig.apply(this, args);
      immediateAnnounce();
      return result;
    };
  }
});
window.addEventListener('popstate', immediateAnnounce);
window.addEventListener('hashchange', immediateAnnounce);
