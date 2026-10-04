const messages = document.querySelector('#messages');
const removalTimers = new Map();
const seenMessageIds = new Set();
const MAX_SEEN_IDS = 300;

// Chronological message state (oldest -> newest) and card element mapping
const activeMessages = [];
const cardsByEventId = new Map();

// Expose on window for test assertions and audit inspection
if (typeof window !== 'undefined') {
  window.activeMessages = activeMessages;
  window.cardsByEventId = cardsByEventId;
}

let config = {
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
  horizontalAnchor: 'left',
  verticalAnchor: 'bottom',
  newMessagePosition: 'bottom',
  offsetX: 20,
  offsetY: 20,
  textAlign: 'left',
  maxStackHeight: 800,
  animationType: 'fade',
  animationDurationMs: 280,
};

let sseOpenBatchUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 120;

function nowPerf() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function getActiveCards() {
  return Array.from(messages.children).filter(el => !el.classList.contains('disappearing'));
}

function reorderDomCards(position) {
  const ordered = position === 'top' ? [...activeMessages].reverse() : activeMessages;
  for (const message of ordered) {
    const card = cardsByEventId.get(String(message.eventId));
    if (card && messages.contains(card)) {
      messages.appendChild(card);
    }
  }
}

function removeMessage(card, options = {}) {
  if (
    !card ||
    card.classList.contains('disappearing') ||
    card.dataset.lifecycle === 'exiting' ||
    card.dataset.lifecycle === 'removed'
  ) {
    return;
  }
  const eventId = card.dataset.eventId;
  if (eventId) {
    cardsByEventId.delete(String(eventId));
    const idx = activeMessages.findIndex(m => String(m.eventId) === String(eventId));
    if (idx !== -1) activeMessages.splice(idx, 1);
  }

  const timer = removalTimers.get(card);
  if (timer) {
    clearTimeout(timer);
    removalTimers.delete(card);
  }

  const activeConfig = (options && options.config) ? { ...config, ...options.config } : config;
  if (window.BoostyRenderer && typeof window.BoostyRenderer.exitMessageCard === 'function') {
    window.BoostyRenderer.exitMessageCard(
      card,
      activeConfig,
      () => {
        removalTimers.delete(card);
      },
      options
    );
  } else {
    card.classList.add('disappearing');
    setTimeout(() => {
      card.remove();
      removalTimers.delete(card);
    }, 280);
  }
}

function scheduleRemoval(card, seconds) {
  if (seconds <= 0 || !Number.isFinite(seconds)) return;
  const existing = removalTimers.get(card);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => removeMessage(card), seconds * 1_000);
  removalTimers.set(card, timer);
}

function applyConfig(next) {
  const previousDuration = config.durationSeconds;
  const previousOrder = config.newMessagePosition;
  config = { ...config, ...next };

  if (window.BoostyRenderer) {
    window.BoostyRenderer.applyAppearanceConfig(document.documentElement, config);
  } else {
    document.documentElement.style.setProperty('--accent', config.accentColor);
    document.documentElement.style.setProperty('--message-font-size', `${config.fontSize}px`);
    document.body.classList.toggle('hide-avatars', !config.showAvatars);
  }

  // Dynamic reorder if newMessagePosition changed without recreating cards or resetting TTL
  if (next.newMessagePosition && next.newMessagePosition !== previousOrder) {
    reorderDomCards(next.newMessagePosition);
  }

  // If maxMessages decreased, remove excess oldest cards using chronological state
  while (activeMessages.length > config.maxMessages) {
    const oldest = activeMessages[0];
    const card = cardsByEventId.get(String(oldest.eventId));
    if (card) {
      removeMessage(card);
    } else {
      activeMessages.shift();
    }
  }

  // Handle durationSeconds transitions
  if (config.durationSeconds === 0) {
    // 20 -> 0: cancel all pending removal timers
    for (const [, timer] of removalTimers) {
      clearTimeout(timer);
    }
    removalTimers.clear();
  } else if (previousDuration === 0 && config.durationSeconds > 0) {
    // 0 -> >0: schedule fresh TTL for all currently visible active cards
    for (const card of getActiveCards()) {
      scheduleRemoval(card, config.durationSeconds);
    }
  }
}

function handleConfig(event) {
  try {
    applyConfig(JSON.parse(event.data));
  } catch {}
}

function isHistoricalOrReplayMessage(message, event, options) {
  if (options && typeof options.animate === 'boolean') {
    return !options.animate;
  }
  if (options && options.isReplay === true) {
    return true;
  }
  if (message?._isReplay === true || event?.isReplay === true) {
    return true;
  }
  if (typeof message?.receivedAt === 'number' && message.receivedAt > 1_000_000_000_000) {
    const ageMs = Date.now() - message.receivedAt;
    if (ageMs > 450) {
      return true;
    }
    if (nowPerf() <= sseOpenBatchUntil && ageMs > 80) {
      return true;
    }
  }
  return false;
}

function handleMessage(event, options = {}) {
  try {
    const message = typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data;
    const hasSegments = Array.isArray(message?.segments) && message.segments.length > 0;
    if (!message || (!message.text && !hasSegments)) return;

    // Deduplication check
    const dedupeKey = message.id || (message.eventId ? `evt-${message.eventId}` : null);
    if (dedupeKey) {
      if (seenMessageIds.has(dedupeKey)) {
        return; // Do not show duplicates
      }
      seenMessageIds.add(dedupeKey);
      if (seenMessageIds.size > MAX_SEEN_IDS) {
        const oldestKey = seenMessageIds.values().next().value;
        seenMessageIds.delete(oldestKey);
      }
    }

    // Assign / ensure stable eventId
    const eventId = String(message.eventId || message.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    message.eventId = eventId;

    // TTL check based on server receivedAt
    let effectiveDuration = config.durationSeconds;
    if (config.durationSeconds > 0) {
      const refTime = typeof message.receivedAt === 'number' ? message.receivedAt : message.timestamp;
      if (typeof refTime === 'number' && refTime > 0) {
        const elapsedSec = (Date.now() - refTime) / 1000;
        if (elapsedSec >= config.durationSeconds) {
          return; // Message already expired, ignore
        }
        effectiveDuration = Math.max(1, config.durationSeconds - elapsedSec);
      }
    }

    const card = window.BoostyRenderer
      ? window.BoostyRenderer.createMessageCard(message)
      : (() => {
          const c = document.createElement('article');
          c.className = 'message';
          const authorName = typeof message.author === 'string'
            ? message.author
            : (message.author && typeof message.author === 'object' && typeof message.author.name === 'string' ? message.author.name : 'Пользователь');
          const avatarUrl = (message.author && typeof message.author === 'object' && typeof message.author.avatar === 'string' && message.author.avatar)
            ? message.author.avatar
            : (typeof message.avatar === 'string' ? message.avatar : '');
          const avatar = document.createElement('img');
          avatar.className = 'avatar';
          avatar.alt = '';
          avatar.src = avatarUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
          const author = document.createElement('div');
          author.className = 'author';
          author.textContent = authorName || 'Пользователь';
          const text = document.createElement('div');
          text.className = 'text';
          text.textContent = message.text;

          // Reply / Quote block handling
          let replyContainer = null;
          if (message.reply && typeof message.reply === 'object') {
            const replyAuthor = typeof message.reply.author === 'string' ? message.reply.author.trim() : '';
            const replyText = typeof message.reply.text === 'string' ? message.reply.text.trim() : '';
            if (replyAuthor || replyText) {
              replyContainer = document.createElement('div');
              replyContainer.className = 'message-reply reply';
              if (replyAuthor) {
                const replyAuthorEl = document.createElement('div');
                replyAuthorEl.className = 'message-reply-author';
                replyAuthorEl.textContent = replyAuthor;
                replyContainer.appendChild(replyAuthorEl);
              }
              if (replyText) {
                const replyTextEl = document.createElement('div');
                replyTextEl.className = 'message-reply-text';
                replyTextEl.textContent = replyText;
                replyContainer.appendChild(replyTextEl);
              }
            }
          }

          if (replyContainer) {
            c.classList.add('has-reply');
            c.append(replyContainer, avatar, author, text);
          } else {
            c.append(avatar, author, text);
          }
          return c;
        })();

    card.dataset.eventId = eventId;
    cardsByEventId.set(eventId, card);
    activeMessages.push(message);

    // Presentation order: top prepends, bottom appends
    if (config.newMessagePosition === 'top') {
      messages.prepend(card);
    } else {
      messages.append(card);
    }

    const isReplay = isHistoricalOrReplayMessage(message, event, options);
    if (window.BoostyRenderer && typeof window.BoostyRenderer.enterMessageCard === 'function') {
      window.BoostyRenderer.enterMessageCard(card, config, {
        ...options,
        animate: !isReplay,
      });
    }

    // Chronological eviction: oldest is always activeMessages[0]
    while (activeMessages.length > config.maxMessages) {
      const oldest = activeMessages[0];
      const oldestCard = cardsByEventId.get(String(oldest.eventId));
      if (oldestCard) {
        removeMessage(oldestCard);
      } else {
        activeMessages.shift();
      }
    }

    if (config.durationSeconds > 0) {
      scheduleRemoval(card, effectiveDuration);
    }
  } catch (err) {
    console.error('Failed to parse incoming overlay message:', err);
  }
}

function renderHistoryBatch(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    handleMessage({ data: JSON.stringify(item), isReplay: true }, { animate: false, isReplay: true });
  }
}

if (typeof window !== 'undefined') {
  window.renderHistoryBatch = renderHistoryBatch;
}

if (window.BoostyRenderer) {
  window.BoostyRenderer.applyAppearanceConfig(document.documentElement, config);
}

fetch('/config').then(response => response.json()).then(applyConfig).catch(() => {});

// Native EventSource auto-reconnects and sends Last-Event-ID
const events = new EventSource('/events');
events.onopen = () => {
  sseOpenBatchUntil = nowPerf() + 120;
};
events.onmessage = handleMessage;
events.addEventListener('config', handleConfig);
events.onerror = err => {
  console.warn('[Overlay] EventSource connection state:', events.readyState, err);
};


