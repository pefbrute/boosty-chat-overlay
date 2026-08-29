const messages = document.querySelector('#messages');
const events = new EventSource('/events');
const removalTimers = new Map();

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

fetch('/config').then(response => response.json()).then(applyConfig).catch(() => {});
events.addEventListener('config', event => applyConfig(JSON.parse(event.data)));

events.onmessage = event => {
  const message = JSON.parse(event.data);
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
    scheduleRemoval(card, config.durationSeconds);
  }
};

