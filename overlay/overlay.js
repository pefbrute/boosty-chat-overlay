const messages = document.querySelector('#messages');
const events = new EventSource('/events');
let config = {
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
};

function applyConfig(next) {
  config = { ...config, ...next };
  document.documentElement.style.setProperty('--accent', config.accentColor);
  document.documentElement.style.setProperty('--background-opacity', `${config.backgroundOpacity}%`);
  document.documentElement.style.setProperty('--message-font-size', `${config.fontSize}px`);
  document.body.classList.toggle('hide-avatars', !config.showAvatars);
  while (messages.children.length > config.maxMessages) messages.firstElementChild.remove();
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
  while (messages.children.length > config.maxMessages) messages.firstElementChild.remove();
  setTimeout(() => card.remove(), config.durationSeconds * 1_000);
};
