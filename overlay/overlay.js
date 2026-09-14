const messages = document.querySelector('#messages');
const removalTimers = new Map();
const seenMessageIds = new Set();
const MAX_SEEN_IDS = 300;

let config = {
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
};

function getActiveCards() {
  return Array.from(messages.children).filter(el => !el.classList.contains('disappearing'));
}

function removeMessage(card) {
  if (!card || card.classList.contains('disappearing')) return;
  const timer = removalTimers.get(card);
  if (timer) {
    clearTimeout(timer);
    removalTimers.delete(card);
  }
  card.classList.add('disappearing');
  setTimeout(() => {
    card.remove();
    removalTimers.delete(card);
  }, 280);
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
  config = { ...config, ...next };

  document.documentElement.style.setProperty('--accent', config.accentColor);
  document.documentElement.style.setProperty('--background-opacity', `${config.backgroundOpacity}%`);
  document.documentElement.style.setProperty('--message-font-size', `${config.fontSize}px`);
  document.body.classList.toggle('hide-avatars', !config.showAvatars);

  // If maxMessages decreased, remove excess oldest cards
  const activeCards = getActiveCards();
  while (activeCards.length > config.maxMessages) {
    const oldest = activeCards.shift();
    removeMessage(oldest);
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

function handleMessage(event) {
  try {
    const message = JSON.parse(event.data);
    if (!message || !message.text) return;

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

    const card = document.createElement('article');
    card.className = 'message';

    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.alt = '';
    avatar.src = message.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

    const author = document.createElement('div');
    author.className = 'author';
    author.textContent = message.author;

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = message.text;

    card.append(avatar, author, text);
    messages.append(card);

    const activeCards = getActiveCards();
    while (activeCards.length > config.maxMessages) {
      const oldest = activeCards.shift();
      removeMessage(oldest);
    }

    if (config.durationSeconds > 0) {
      scheduleRemoval(card, effectiveDuration);
    }
  } catch (err) {
    console.error('Failed to parse incoming overlay message:', err);
  }
}

fetch('/config').then(response => response.json()).then(applyConfig).catch(() => {});

// Native EventSource auto-reconnects and sends Last-Event-ID
const events = new EventSource('/events');
events.onmessage = handleMessage;
events.addEventListener('config', handleConfig);
events.onerror = err => {
  console.warn('[Overlay] EventSource connection state:', events.readyState, err);
};


