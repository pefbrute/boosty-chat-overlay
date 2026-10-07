'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');

const htmlContent = fs.readFileSync(
  path.join(__dirname, '..', 'desktop', 'chat-monitor', 'index.html'),
  'utf8'
);

const {
  createChatMonitorApp,
  createChatCard,
  formatMessageTime,
  normalizeAuthorRole,
  isSafeEmojiUrl,
} = require('../desktop/chat-monitor/app.js');

function createDomHarness() {
  const { document, window } = parseHTML(htmlContent);
  return { document, window };
}

test('formatMessageTime: extracts publishedAt or formats receivedAt timestamp', () => {
  assert.equal(formatMessageTime({ publishedAt: '15:30:45' }), '15:30:45');
  assert.equal(formatMessageTime({ publishedAt: '  12:00  ' }), '12:00');
  const d = new Date(1700000000000);
  const expected = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  assert.equal(formatMessageTime({ receivedAt: 1700000000000 }), expected);
});

test('normalizeAuthorRole: strictly allows streamer and moderator only', () => {
  assert.equal(normalizeAuthorRole('streamer'), 'streamer');
  assert.equal(normalizeAuthorRole('Streamer '), 'streamer');
  assert.equal(normalizeAuthorRole('moderator'), 'moderator');
  assert.equal(normalizeAuthorRole('MODERATOR'), 'moderator');
  assert.equal(normalizeAuthorRole('admin'), null);
  assert.equal(normalizeAuthorRole(''), null);
  assert.equal(normalizeAuthorRole(null), null);
});

test('isSafeEmojiUrl: validates http, https, and data:image schemes', () => {
  assert.equal(isSafeEmojiUrl('https://boosty.to/emoji/smile.png'), true);
  assert.equal(isSafeEmojiUrl('http://cdn.boosty.to/emoji.webp'), true);
  assert.equal(isSafeEmojiUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isSafeEmojiUrl('javascript:alert(1)'), false);
  assert.equal(isSafeEmojiUrl('file:///etc/passwd'), false);
});

test('createChatCard: renders author, role badge, timestamp, mentions, emoji, and reply quote', () => {
  const { document } = createDomHarness();
  global.document = document;

  const msg = {
    id: 'msg-full-1',
    eventId: '1',
    author: {
      name: 'StreamerPro',
      role: 'streamer',
    },
    publishedAt: '20:15',
    text: 'Привет @User! :boosty_heart: Отличный стрим!',
    reply: {
      author: 'User',
      text: 'Когда следующий стрим?',
    },
    segments: [
      { type: 'text', text: 'Привет ' },
      { type: 'mention', displayName: 'User' },
      { type: 'text', text: '! ' },
      { type: 'emoji', id: ':boosty_heart:', url: 'https://cdn.boosty.to/emojis/heart.png', alt: ':heart:' },
      { type: 'text', text: ' Отличный стрим! 🔥' },
    ],
  };

  const card = createChatCard(msg);
  assert.ok(card);
  assert.equal(card.dataset.messageId, 'msg-full-1');
  assert.ok(card.classList.contains('role-streamer'));

  // Reply block check
  const replyEl = card.querySelector('.chat-reply');
  assert.ok(replyEl);
  assert.equal(replyEl.querySelector('.reply-author').textContent, '@User:');
  assert.equal(replyEl.querySelector('.reply-text').textContent, 'Когда следующий стрим?');

  // Timestamp
  const timeEl = card.querySelector('.chat-time');
  assert.equal(timeEl.textContent, '20:15');

  // Badge
  const badgeEl = card.querySelector('.chat-badge.badge-streamer');
  assert.ok(badgeEl);

  // Author
  const authorEl = card.querySelector('.chat-author');
  assert.equal(authorEl.textContent, 'StreamerPro');

  // Mention segment
  const mentionEl = card.querySelector('.chat-mention');
  assert.ok(mentionEl);
  assert.equal(mentionEl.textContent, '@User');

  // Emoji segment
  const emojiImg = card.querySelector('.chat-emoji');
  assert.ok(emojiImg);
  assert.equal(emojiImg.getAttribute('src'), 'https://cdn.boosty.to/emojis/heart.png');
  assert.equal(emojiImg.getAttribute('alt'), ':heart:');

  // Unicode emoji & text preserved
  assert.ok(card.querySelector('.chat-content').textContent.includes('Отличный стрим! 🔥'));
});

test('ChatMonitorApp: initial history loads and dedup suppresses identical SSE message', async () => {
  const { document } = createDomHarness();

  const historyMessages = [
    { id: 'hist-1', text: 'Первое сообщение истории', author: { name: 'Alice' }, publishedAt: '12:00' },
    { id: 'hist-2', text: 'Второе сообщение истории', author: { name: 'Bob' }, publishedAt: '12:01' },
  ];

  const app = createChatMonitorApp({
    document,
    fetch: async (url) => {
      if (url.endsWith('/history')) {
        return { ok: true, json: async () => historyMessages };
      }
      return { ok: false };
    },
  });

  await app.init();

  const list = document.querySelector('#messages-list');
  assert.equal(list.children.length, 2);
  assert.equal(app.getStatus(), 'connected');

  // Live SSE arrives with hist-2 (already in history) -> MUST BE DEDUPLICATED
  app.handleIncomingMessage({
    id: 'hist-2',
    text: 'Второе сообщение истории',
    author: { name: 'Bob' },
  });
  assert.equal(list.children.length, 2, 'Duplicate message from SSE must NOT be appended');

  // New unique message -> appended
  app.handleIncomingMessage({
    id: 'live-3',
    text: 'Третье уникальное сообщение',
    author: { name: 'Charlie' },
    publishedAt: '12:02',
  });
  assert.equal(list.children.length, 3);
  assert.equal(list.children[2].dataset.messageId, 'live-3');
});

test('ChatMonitorApp: Pause/Resume freezes DOM rendering and flushes queue in arrival order', async () => {
  const { document } = createDomHarness();

  const app = createChatMonitorApp({
    document,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  const list = document.querySelector('#messages-list');
  assert.equal(list.children.length, 0);

  // 1. Send normal message
  app.handleIncomingMessage({ id: 'msg-1', text: 'Привет', author: 'User1' });
  assert.equal(list.children.length, 1);

  // 2. Enable pause
  app.pause();
  assert.equal(app.isPaused(), true);
  assert.equal(document.querySelector('#pause-banner').style.display, 'flex');

  // 3. Send 3 messages while paused
  app.handleIncomingMessage({ id: 'msg-2', text: 'Сообщение во время паузы 1', author: 'User2' });
  app.handleIncomingMessage({ id: 'msg-3', text: 'Сообщение во время паузы 2', author: 'User3' });
  app.handleIncomingMessage({ id: 'msg-4', text: 'Сообщение во время паузы 3', author: 'User4' });

  // DOM must NOT be modified while paused!
  assert.equal(list.children.length, 1);
  assert.equal(app.getPausedCount(), 3);
  assert.equal(document.querySelector('#paused-count').textContent, '3');

  // 4. Resume
  app.resume();
  assert.equal(app.isPaused(), false);
  assert.equal(document.querySelector('#pause-banner').style.display, 'none');

  // All 3 messages must now be appended in exact order
  assert.equal(list.children.length, 4);
  assert.equal(list.children[1].dataset.messageId, 'msg-2');
  assert.equal(list.children[2].dataset.messageId, 'msg-3');
  assert.equal(list.children[3].dataset.messageId, 'msg-4');
  assert.equal(app.getPausedCount(), 0);
});

test('ChatMonitorApp: Clear View clears current DOM without breaking future messages', async () => {
  const { document } = createDomHarness();

  const app = createChatMonitorApp({
    document,
    fetch: async () => ({
      ok: true,
      json: async () => [
        { id: 'init-1', text: 'Привет', author: 'User1' },
      ],
    }),
  });
  await app.init();

  const list = document.querySelector('#messages-list');
  assert.equal(list.children.length, 1);

  // Click clear
  app.clearView();
  assert.equal(list.children.length, 0);
  assert.equal(document.querySelector('#empty-state').style.display, 'flex');

  // New message still works
  app.handleIncomingMessage({ id: 'after-clear', text: 'Новое сообщение после очистки', author: 'User2' });
  assert.equal(list.children.length, 1);
  assert.equal(document.querySelector('#empty-state').style.display, 'none');
});

test('ChatMonitorApp: autoscroll freezes when scrolled up and shows unread badge', async () => {
  const { document, window: win } = createDomHarness();
  const chatContainer = document.querySelector('#chat-container');

  // Simulate scroll dimensions: container height 400, content 1000, scrolled up (scrollTop = 100)
  Object.defineProperty(chatContainer, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(chatContainer, 'scrollHeight', { value: 1000, configurable: true, writable: true });
  chatContainer.scrollTop = 100; // Scrolled up (distance to bottom = 1000 - 100 - 400 = 500 > 45)

  const app = createChatMonitorApp({
    document,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  // Trigger container scroll event to update state
  chatContainer.dispatchEvent(new win.Event('scroll'));
  assert.equal(app.isScrolledUp(), true);

  // Incoming message while scrolled up
  app.handleIncomingMessage({ id: 'scrolled-1', text: 'Новое сообщение', author: 'User1' });

  // Scroll position must NOT jump down!
  assert.equal(chatContainer.scrollTop, 100);

  // Scroll to bottom button should be visible with badge
  const btnScrollBottom = document.querySelector('#btn-scroll-bottom');
  assert.equal(btnScrollBottom.style.display, 'flex');
  assert.equal(app.getUnreadCount(), 1);

  // Clicking scroll bottom button scrolls down and resets
  btnScrollBottom.click();
  assert.equal(chatContainer.scrollTop, chatContainer.scrollHeight);
  assert.equal(app.isScrolledUp(), false);
  assert.equal(btnScrollBottom.style.display, 'none');
});
