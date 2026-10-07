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
  getMessageAuthorKey,
  getMessageAuthorInfo,
  isSafeEmojiUrl,
  isMessageMention,
  isMessageReply,
  isMessageImportant,
  getMessageTechIssue,
  isMessageTechIssue,
  messageMatchesFilter,
  messageMatchesSearch,
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

test('Attention classification helpers: isMessageMention, isMessageReply, isMessageImportant', () => {
  // Plain message
  assert.equal(isMessageMention({ text: 'Привет всем' }), false);
  assert.equal(isMessageReply({ text: 'Привет всем' }), false);
  assert.equal(isMessageImportant({ text: 'Привет всем' }), false);

  // Mention via segments
  assert.equal(isMessageMention({ segments: [{ type: 'mention', displayName: 'Streamer' }] }), true);
  assert.equal(isMessageImportant({ segments: [{ type: 'mention', displayName: 'Streamer' }] }), true);

  // Mention via regex fallback in text
  assert.equal(isMessageMention({ text: 'Эй @Streamer привет!' }), true);
  assert.equal(isMessageMention({ text: '@username' }), true);
  assert.equal(isMessageMention({ text: 'my email is test@example.com' }), false);

  // Reply
  assert.equal(isMessageReply({ reply: { author: 'Alice', text: 'question' } }), true);
  assert.equal(isMessageReply({ reply: { author: '', text: '' } }), false);
  assert.equal(isMessageReply({ reply: null }), false);
  assert.equal(isMessageImportant({ reply: { author: 'Bob', text: 'hello' } }), true);

  // Both
  assert.equal(isMessageImportant({
    text: 'Привет @User',
    reply: { author: 'User', text: 'Вопрос' },
  }), true);
});

test('Filters and Search matching helpers', () => {
  const msgPlain = { author: { name: 'Alice' }, text: 'Обычный текст' };
  const msgMention = { author: { name: 'Bob' }, text: 'Привет @Streamer' };
  const msgReply = { author: { name: 'Charlie' }, text: 'Ответ', reply: { author: 'Alice', text: 'Текст' } };

  // messageMatchesFilter
  assert.equal(messageMatchesFilter(msgPlain, 'all'), true);
  assert.equal(messageMatchesFilter(msgPlain, 'important'), false);
  assert.equal(messageMatchesFilter(msgMention, 'important'), true);
  assert.equal(messageMatchesFilter(msgMention, 'mentions'), true);
  assert.equal(messageMatchesFilter(msgMention, 'replies'), false);
  assert.equal(messageMatchesFilter(msgReply, 'important'), true);
  assert.equal(messageMatchesFilter(msgReply, 'mentions'), false);
  assert.equal(messageMatchesFilter(msgReply, 'replies'), true);

  // messageMatchesSearch
  assert.equal(messageMatchesSearch(msgPlain, ''), true);
  assert.equal(messageMatchesSearch(msgPlain, 'alice'), true);
  assert.equal(messageMatchesSearch(msgPlain, 'ОБЫЧНЫЙ'), true);
  assert.equal(messageMatchesSearch(msgPlain, 'notfound'), false);
});

test('createChatCard: applies highlight-mention, highlight-reply, and highlight-both classes', () => {
  const { document } = createDomHarness();
  global.document = document;

  // Mention only
  const cardMention = createChatCard({
    id: 'm1',
    author: 'User1',
    text: 'Привет @Streamer!',
  });
  assert.ok(cardMention.classList.contains('highlight-important'));
  assert.ok(cardMention.classList.contains('highlight-mention'));
  assert.equal(cardMention.classList.contains('highlight-reply'), false);

  // Reply only
  const cardReply = createChatCard({
    id: 'm2',
    author: 'User2',
    text: 'Ответ на сообщение',
    reply: { author: 'Streamer', text: 'Привет' },
  });
  assert.ok(cardReply.classList.contains('highlight-important'));
  assert.ok(cardReply.classList.contains('highlight-reply'));
  assert.equal(cardReply.classList.contains('highlight-mention'), false);

  // Both
  const cardBoth = createChatCard({
    id: 'm3',
    author: 'User3',
    text: 'Ответ @Streamer на вопрос',
    reply: { author: 'Streamer', text: 'Привет' },
  });
  assert.ok(cardBoth.classList.contains('highlight-important'));
  assert.ok(cardBoth.classList.contains('highlight-both'));
});

test('ChatMonitorApp: Attention filters (all, important, mentions, replies) filter messages in DOM', async () => {
  const { document } = createDomHarness();

  const app = createChatMonitorApp({
    document,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  const list = document.querySelector('#messages-list');
  const emptyState = document.querySelector('#empty-state');
  const noResultsState = document.querySelector('#no-results-state');

  // Push 3 distinct messages
  app.handleIncomingMessage({ id: 'msg-norm', author: 'User1', text: 'Просто чат' });
  app.handleIncomingMessage({ id: 'msg-mention', author: 'User2', text: 'Привет @Streamer' });
  app.handleIncomingMessage({ id: 'msg-reply', author: 'User3', text: 'Ответ', reply: { author: 'User1', text: 'Просто чат' } });

  assert.equal(list.children.length, 3);
  assert.equal(app.getActiveFilter(), 'all');

  // Filter: Important (should show mention + reply = 2)
  app.setFilter('important');
  assert.equal(app.getActiveFilter(), 'important');
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].dataset.messageId, 'msg-mention');
  assert.equal(list.children[1].dataset.messageId, 'msg-reply');

  // Filter: Mentions (should show 1)
  app.setFilter('mentions');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].dataset.messageId, 'msg-mention');

  // Filter: Replies (should show 1)
  app.setFilter('replies');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].dataset.messageId, 'msg-reply');

  // Clear or no matching filter shows noResultsState
  const tabAll = document.querySelector('.filter-tab[data-filter="all"]');
  tabAll.click();
  assert.equal(app.getActiveFilter(), 'all');
  assert.equal(list.children.length, 3);
});

test('ChatMonitorApp: Local search filters messages and toggles match count and no-results state', async () => {
  const { document } = createDomHarness();

  const app = createChatMonitorApp({
    document,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  const list = document.querySelector('#messages-list');
  const noResultsState = document.querySelector('#no-results-state');
  const matchCountEl = document.querySelector('#search-match-count');

  app.handleIncomingMessage({ id: 'msg-1', author: 'Alex_Stream', text: 'Привет всем на стриме!' });
  app.handleIncomingMessage({ id: 'msg-2', author: 'Viewer_Bob', text: 'Когда стрим по CS2?' });
  app.handleIncomingMessage({ id: 'msg-3', author: 'Mod_Anna', text: 'Модератор в чате' });

  // Open search and search by author
  app.openSearchPanel();
  assert.equal(app.isSearchOpen(), true);

  app.setSearchQuery('alex');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].dataset.messageId, 'msg-1');
  assert.equal(matchCountEl.textContent, '1');
  assert.equal(noResultsState.style.display, 'none');

  // Search by text
  app.setSearchQuery('стрим');
  assert.equal(list.children.length, 2); // 'Alex_Stream' (author) and 'Когда стрим по CS2?' (text)
  assert.equal(matchCountEl.textContent, '2');

  // Search no results
  app.setSearchQuery('несуществующий текст 12345');
  assert.equal(list.children.length, 0);
  assert.equal(matchCountEl.textContent, '0');
  assert.equal(noResultsState.style.display, 'flex');

  // Close search resets
  app.closeSearchPanel();
  assert.equal(app.isSearchOpen(), false);
  assert.equal(list.children.length, 3);
  assert.equal(noResultsState.style.display, 'none');
});

test('ChatMonitorApp: Unread tracking increments when unfocused/scrolled up and resets at bottom with focus', async () => {
  const { document, window: win } = createDomHarness();
  const chatContainer = document.querySelector('#chat-container');

  // Simulate window unfocused
  document.hasFocus = () => false;

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  // New mention arrives while unfocused
  app.handleIncomingMessage({
    id: 'unf-1',
    author: 'Viewer',
    text: 'Привет @Streamer!',
  });

  const counters = app.getUnreadCounters();
  assert.equal(counters.total, 1);
  assert.equal(counters.important, 1);
  assert.equal(counters.mentions, 1);
  assert.equal(counters.replies, 0);

  const badgeImportant = document.querySelector('#badge-important');
  const badgeMentions = document.querySelector('#badge-mentions');
  assert.equal(badgeImportant.textContent, '1');
  assert.equal(badgeImportant.style.display, 'inline-flex');
  assert.equal(badgeMentions.textContent, '1');
  assert.equal(badgeMentions.style.display, 'inline-flex');

  // Reply arrives
  app.handleIncomingMessage({
    id: 'unf-2',
    author: 'Viewer2',
    text: 'Ответ',
    reply: { author: 'Streamer', text: 'Привет' },
  });
  const counters2 = app.getUnreadCounters();
  assert.equal(counters2.total, 2);
  assert.equal(counters2.important, 2);
  assert.equal(counters2.mentions, 1);
  assert.equal(counters2.replies, 1);

  // Now simulate window gained focus AND user is at bottom -> resets
  document.hasFocus = () => true;
  win.dispatchEvent(new win.Event('focus'));

  const countersReset = app.getUnreadCounters();
  assert.equal(countersReset.total, 0);
  assert.equal(countersReset.important, 0);
  assert.equal(countersReset.mentions, 0);
  assert.equal(countersReset.replies, 0);
  assert.equal(badgeImportant.style.display, 'none');
  assert.equal(badgeMentions.style.display, 'none');
});

test('ChatMonitorApp: Autoscroll follows incoming messages even when window is unfocused (hasFocus === false)', async () => {
  const { document, window: win } = createDomHarness();
  const chatContainer = document.querySelector('#chat-container');
  const btnScrollBottom = document.querySelector('#btn-scroll-bottom');

  // Unfocused companion window (streamer in game / OBS / browser)
  document.hasFocus = () => false;

  let currentScrollHeight = 400;
  let currentScrollTop = 0;
  Object.defineProperty(chatContainer, 'clientHeight', { get: () => 400, configurable: true });
  Object.defineProperty(chatContainer, 'scrollHeight', { get: () => currentScrollHeight, configurable: true });
  Object.defineProperty(chatContainer, 'scrollTop', {
    get: () => currentScrollTop,
    set: (val) => { currentScrollTop = val; },
    configurable: true,
  });

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  assert.equal(app.isFollowLatest(), true);
  assert.equal(app.isScrolledUp(), false);

  for (let i = 1; i <= 10; i++) {
    currentScrollHeight += 60;
    app.handleIncomingMessage({
      id: `burst-${i}`,
      author: `Viewer_${i}`,
      text: `Message #${i}`,
    });
    // Autoscroll must update scrollTop to match scrollHeight regardless of focus
    assert.equal(chatContainer.scrollTop, currentScrollHeight);
    assert.equal(app.isFollowLatest(), true);
    assert.equal(app.isScrolledUp(), false);
  }

  // Unread counter still increments because window is unfocused
  assert.equal(app.getUnreadCount(), 10);
  // Floating scroll-to-bottom button stays hidden because viewport is at bottom
  assert.equal(btnScrollBottom.style.display, 'none');
});

test('ChatMonitorApp: Manual scroll-up disables autoscroll, preserves position, shows button, and restores on click', async () => {
  const { document, window: win } = createDomHarness();
  const chatContainer = document.querySelector('#chat-container');
  const btnScrollBottom = document.querySelector('#btn-scroll-bottom');
  const unreadCountBadge = document.querySelector('#unread-count-badge');

  document.hasFocus = () => true;

  let currentScrollHeight = 800;
  let currentScrollTop = 400;
  Object.defineProperty(chatContainer, 'clientHeight', { get: () => 400, configurable: true });
  Object.defineProperty(chatContainer, 'scrollHeight', { get: () => currentScrollHeight, configurable: true });
  Object.defineProperty(chatContainer, 'scrollTop', {
    get: () => currentScrollTop,
    set: (val) => { currentScrollTop = val; },
    configurable: true,
  });

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  // User manually scrolls up to scrollTop = 120 (distance = 800 - 400 - 120 = 280 > 60)
  currentScrollTop = 120;
  chatContainer.dispatchEvent(new win.Event('scroll'));

  assert.equal(app.isFollowLatest(), false);
  assert.equal(app.isScrolledUp(), true);

  // Incoming messages arrive while scrolled up
  currentScrollHeight = 860;
  app.handleIncomingMessage({ id: 'up-1', author: 'UserA', text: 'First new msg' });
  assert.equal(chatContainer.scrollTop, 120, 'Scroll position must not jump when user is scrolled up');
  assert.equal(btnScrollBottom.style.display, 'flex');
  assert.equal(unreadCountBadge.textContent, '1');
  assert.equal(unreadCountBadge.style.display, 'inline-block');

  currentScrollHeight = 920;
  app.handleIncomingMessage({ id: 'up-2', author: 'UserB', text: 'Second new msg' });
  assert.equal(chatContainer.scrollTop, 120);
  assert.equal(unreadCountBadge.textContent, '2');

  // Clicking "Новые сообщения ↓" restores bottom and autoscroll
  btnScrollBottom.click();
  assert.equal(app.isFollowLatest(), true);
  assert.equal(app.isScrolledUp(), false);
  assert.equal(chatContainer.scrollTop, 920);
  assert.equal(btnScrollBottom.style.display, 'none');
  assert.equal(app.getUnreadCount(), 0);

  // Subsequent incoming message automatically scrolls again
  currentScrollHeight = 980;
  app.handleIncomingMessage({ id: 'up-3', author: 'UserC', text: 'Third msg after restore' });
  assert.equal(chatContainer.scrollTop, 980);
  assert.equal(app.isFollowLatest(), true);
});

test('ChatMonitorApp: Pause, Resume, Filter, and Clear preserve autoscroll invariants', async () => {
  const { document, window: win } = createDomHarness();
  const chatContainer = document.querySelector('#chat-container');
  const btnScrollBottom = document.querySelector('#btn-scroll-bottom');

  document.hasFocus = () => true;

  let currentScrollHeight = 600;
  let currentScrollTop = 200;
  Object.defineProperty(chatContainer, 'clientHeight', { get: () => 400, configurable: true });
  Object.defineProperty(chatContainer, 'scrollHeight', { get: () => currentScrollHeight, configurable: true });
  Object.defineProperty(chatContainer, 'scrollTop', {
    get: () => currentScrollTop,
    set: (val) => { currentScrollTop = val; },
    configurable: true,
  });

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  // 1. Pause while scrolled up -> resume keeps scroll position
  currentScrollTop = 50;
  chatContainer.dispatchEvent(new win.Event('scroll'));
  assert.equal(app.isFollowLatest(), false);

  app.pause();
  currentScrollHeight = 700;
  app.handleIncomingMessage({ id: 'p-1', author: 'U1', text: 'Paused msg 1' });
  assert.equal(app.getPausedCount(), 1);
  assert.equal(chatContainer.scrollTop, 50);

  app.resume();
  assert.equal(app.getPausedCount(), 0);
  assert.equal(chatContainer.scrollTop, 50, 'Resume while scrolled up must not jump to bottom');
  assert.equal(btnScrollBottom.style.display, 'flex');

  // 2. Clear view resets followLatest and hides scroll button
  app.clearView();
  assert.equal(app.isFollowLatest(), true);
  assert.equal(app.isScrolledUp(), false);
  assert.equal(btnScrollBottom.style.display, 'none');

  // 3. Filter: non-matching message does not trigger scroll
  app.setFilter('mentions');
  currentScrollTop = 100;
  currentScrollHeight = 500;
  app.handleIncomingMessage({ id: 'f-1', author: 'NormalUser', text: 'Just normal text' });
  assert.equal(chatContainer.scrollTop, 100, 'Filtered-out message should not scroll container');

  // Matching mention message DOES scroll when followLatest is true
  currentScrollHeight = 560;
  app.handleIncomingMessage({ id: 'f-2', author: 'Fan', text: 'Hello @Streamer!' });
  assert.equal(chatContainer.scrollTop, 560, 'Matching message scrolls to bottom when followLatest is true');
});

test('createChatCard: renders Техпроблема badge and highlight-tech-issue for HIGH/MEDIUM tech issues, and suppresses false positives', () => {
  const { document } = createDomHarness();
  global.document = document;

  // 1. High confidence tech issue
  const msgTech = {
    id: 'tech-1',
    author: { name: 'Viewer1' },
    text: 'Ребята, вообще нет звука!',
  };
  assert.equal(isMessageTechIssue(msgTech), true);
  assert.equal(getMessageTechIssue(msgTech).type, 'audio_missing');

  const cardTech = createChatCard(msgTech);
  assert.ok(cardTech.classList.contains('highlight-tech-issue'));
  assert.equal(cardTech.dataset.techIssueType, 'audio_missing');
  const techBadge = cardTech.querySelector('.chat-badge.badge-tech-issue');
  assert.ok(techBadge, 'Should render .badge-tech-issue');
  assert.equal(techBadge.querySelector('.badge-label').textContent, 'Нет звука');

  // 2. Mention + Tech issue: keeps mention highlight + adds tech badge (attention-compatible)
  const msgMentionTech = {
    id: 'tech-2',
    author: { name: 'Viewer2' },
    text: '@Alex_Stream звук пропал полностью!',
  };
  const cardMentionTech = createChatCard(msgMentionTech);
  assert.ok(cardMentionTech.classList.contains('highlight-mention'));
  assert.ok(cardMentionTech.classList.contains('highlight-tech-issue'));
  assert.ok(cardMentionTech.querySelector('.chat-badge.badge-tech-issue'));

  // 3. False positive: no badge, no highlight
  const msgFalsePositive = {
    id: 'tech-fp-1',
    author: { name: 'Viewer3' },
    text: 'в этом видео нет звука у автора ролика',
  };
  assert.equal(isMessageTechIssue(msgFalsePositive), false);
  const cardFp = createChatCard(msgFalsePositive);
  assert.equal(cardFp.classList.contains('highlight-tech-issue'), false);
  assert.equal(cardFp.querySelector('.chat-badge.badge-tech-issue'), null);
});

test('ChatMonitorApp: Filter "tech" (Техпроблемы), unread counter #badge-tech, and sticky alert banner with Показать / Скрыть', async () => {
  const { document, window: win } = createDomHarness();
  document.hasFocus = () => false;

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  const list = document.querySelector('#messages-list');
  const badgeTech = document.querySelector('#badge-tech');
  const techBanner = document.querySelector('#tech-issue-banner');
  const techBannerSummary = document.querySelector('#tech-banner-summary');
  const techBannerSeverity = document.querySelector('#tech-banner-severity');
  const btnTechShow = document.querySelector('#btn-tech-show');
  const btnTechDismiss = document.querySelector('#btn-tech-dismiss');

  const now = Date.now();
  // Normal message
  app.handleIncomingMessage({ id: 'n-1', author: 'Viewer0', text: 'Всем привет в чате!', receivedAt: now });
  assert.equal(app.getUnreadCounters().tech, 0);
  assert.equal(techBanner.style.display, 'none');

  // 1st tech message -> unreadTech = 1, banner still hidden (only 1 user = possible)
  app.handleIncomingMessage({ id: 't-1', author: 'ViewerA', text: 'Ребята, нет звука!', receivedAt: now + 1000 });
  assert.equal(app.getUnreadCounters().tech, 1);
  assert.equal(badgeTech.textContent, '1');
  assert.equal(badgeTech.style.display, 'inline-flex');
  assert.equal(techBanner.style.display, 'none');

  // 2nd tech message from different user -> probable alert banner appears!
  app.handleIncomingMessage({ id: 't-2', author: 'ViewerB', text: 'Да, звук пропал вообще', receivedAt: now + 2000 });
  assert.equal(app.getUnreadCounters().tech, 2);
  assert.equal(techBanner.style.display, 'flex');
  assert.ok(techBanner.classList.contains('severity-probable'));
  assert.equal(techBannerSeverity.textContent, 'ВЕРОЯТНАЯ ПРОБЛЕМА · Нет звука');
  assert.ok(techBannerSummary.textContent.includes('Нет звука'));
  assert.ok(techBannerSummary.textContent.includes('2 сообщения от 2 зрителей'));

  // 3rd tech message from 3rd user -> escalates to critical!
  app.handleIncomingMessage({ id: 't-3', author: 'ViewerC', text: 'Не слышно стримера!', receivedAt: now + 3000 });
  assert.equal(techBanner.style.display, 'flex');
  assert.ok(techBanner.classList.contains('severity-critical'));
  assert.equal(techBannerSeverity.textContent, 'КРИТИЧНО · Нет звука');
  assert.ok(techBannerSummary.textContent.includes('3 сообщения от 3 зрителей'));

  // Click "Показать" on banner -> activates 'tech' filter and shows only the 3 tech messages
  btnTechShow.click();
  assert.equal(app.getActiveFilter(), 'tech');
  assert.equal(list.children.length, 3);
  assert.equal(list.children[0].dataset.messageId, 't-1');
  assert.equal(list.children[1].dataset.messageId, 't-2');
  assert.equal(list.children[2].dataset.messageId, 't-3');

  // Click "Скрыть" on banner -> dismisses banner
  btnTechDismiss.click();
  assert.equal(techBanner.style.display, 'none');

  app.destroy();
});

test('ChatMonitorApp: Pause compatibility and Autoscroll preservation when Tech Issue Banner toggles', async () => {
  const { document, window: win } = createDomHarness();
  const chatContainer = document.querySelector('#chat-container');
  const techBanner = document.querySelector('#tech-issue-banner');

  let currentScrollHeight = 800;
  let currentScrollTop = 400;
  Object.defineProperty(chatContainer, 'clientHeight', { get: () => 400, configurable: true });
  Object.defineProperty(chatContainer, 'scrollHeight', { get: () => currentScrollHeight, configurable: true });
  Object.defineProperty(chatContainer, 'scrollTop', {
    get: () => currentScrollTop,
    set: (val) => { currentScrollTop = val; },
    configurable: true,
  });

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  const now = Date.now();

  // 1. While paused, incoming tech messages still update active tech alert banner so streamer sees urgent failure,
  // while DOM message list remains frozen until resume.
  app.pause();
  app.handleIncomingMessage({ id: 'pt-1', author: 'User1', text: 'чёрный экран', receivedAt: now });
  app.handleIncomingMessage({ id: 'pt-2', author: 'User2', text: 'нет картинки на стриме', receivedAt: now + 1000 });
  assert.equal(document.querySelector('#messages-list').children.length, 0, 'DOM list stays frozen during pause');
  assert.equal(techBanner.style.display, 'flex', 'Urgent tech banner still alerts streamer during pause');
  assert.equal(app.getPausedCount(), 2);

  app.resume();
  assert.equal(document.querySelector('#messages-list').children.length, 2, 'Paused tech messages flush on resume');

  // 2. When user is scrolled up (followLatest = false), banner updates must NOT jump scrollTop to bottom
  app.clearView();
  currentScrollTop = 110;
  chatContainer.dispatchEvent(new win.Event('scroll'));
  assert.equal(app.isFollowLatest(), false);

  currentScrollHeight = 860;
  app.handleIncomingMessage({ id: 'sc-1', author: 'UserA', text: 'стрим завис', receivedAt: now + 5000 });
  currentScrollHeight = 920;
  app.handleIncomingMessage({ id: 'sc-2', author: 'UserB', text: 'зависло всё', receivedAt: now + 6000 });

  assert.equal(techBanner.style.display, 'flex');
  assert.equal(chatContainer.scrollTop, 110, 'Banner appearance while scrolled up must NOT jump scrollTop');

  app.destroy();
});

test('User Context: getMessageAuthorKey and getMessageAuthorInfo canonical resolution', () => {
  // ID based
  assert.equal(getMessageAuthorKey({ author: { id: 42, name: 'Alice' } }), 'id:42');
  assert.equal(getMessageAuthorKey({ authorId: 'user-99', author: 'Bob' }), 'id:user-99');

  // Name based fallback
  assert.equal(getMessageAuthorKey({ author: '  ViewerAlice  ' }), 'name:vieweralice');
  assert.equal(getMessageAuthorKey({ author: { name: '  ViewerBob  ' } }), 'name:viewerbob');
  assert.equal(getMessageAuthorKey({}), 'name:anonymous');

  // Author info structure
  const info1 = getMessageAuthorInfo({
    author: { name: 'StreamerPro', role: 'streamer', avatar: 'https://cdn.boosty.to/av.png' },
  });
  assert.equal(info1.name, 'StreamerPro');
  assert.equal(info1.role, 'streamer');
  assert.equal(info1.avatar, 'https://cdn.boosty.to/av.png');
  assert.equal(info1.key, 'name:streamerpro');

  const info2 = getMessageAuthorInfo({
    author: 'ViewerBob',
    avatar: 'https://cdn.boosty.to/bob.png',
  });
  assert.equal(info2.name, 'ViewerBob');
  assert.equal(info2.role, null);
  assert.equal(info2.avatar, 'https://cdn.boosty.to/bob.png');
  assert.equal(info2.key, 'name:viewerbob');
});

test('User Context: createChatCard binds click/enter on author and avatar when onOpenUserContext provided', () => {
  const { document, window: win } = createDomHarness();
  global.document = document;

  let clickedMessage = null;
  const card = createChatCard(
    {
      id: 'm-ctx-1',
      author: { name: 'ViewerAlice' },
      text: 'Привет всем!',
    },
    {
      onOpenUserContext: (msg) => {
        clickedMessage = msg;
      },
    }
  );

  const authorEl = card.querySelector('.chat-author');
  const avatarEl = card.querySelector('.chat-avatar-wrap');

  assert.ok(authorEl.classList.contains('chat-author-clickable'), 'Author should have clickable class');
  assert.ok(avatarEl.classList.contains('chat-avatar-clickable'), 'Avatar should have clickable class');
  assert.equal(authorEl.getAttribute('role'), 'button');
  assert.equal(avatarEl.getAttribute('role'), 'button');

  // Click author
  authorEl.dispatchEvent(new win.Event('click'));
  assert.equal(clickedMessage?.id, 'm-ctx-1');

  // Keydown Enter on avatar
  clickedMessage = null;
  const enterEvent = new win.Event('keydown');
  enterEvent.key = 'Enter';
  avatarEl.dispatchEvent(enterEvent);
  assert.equal(clickedMessage?.id, 'm-ctx-1');
});

test('User Context: openUserContext renders header, metadata, summary, badges, and chronological messages', async () => {
  const { document, window: win } = createDomHarness();
  global.document = document;

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  const now = Date.now();
  // Feed messages for ViewerAlice (5 messages) and ViewerBob (2 messages)
  app.handleIncomingMessage({
    id: 'a-1',
    author: { name: 'ViewerAlice', role: null },
    text: 'Привет!',
    publishedAt: '12:00',
    receivedAt: now,
  });
  app.handleIncomingMessage({
    id: 'b-1',
    author: { name: 'ViewerBob' },
    text: 'Привет Алиса',
    publishedAt: '12:01',
    receivedAt: now + 1000,
  });
  app.handleIncomingMessage({
    id: 'a-2',
    author: { name: 'ViewerAlice' },
    text: '@Alex_Stream привет',
    segments: [{ type: 'mention', displayName: 'Alex_Stream' }],
    publishedAt: '12:02',
    receivedAt: now + 2000,
  });
  app.handleIncomingMessage({
    id: 'a-3',
    author: { name: 'ViewerAlice' },
    text: 'Спасибо за ответ',
    reply: { author: 'ModMike', text: 'Расписание в описании' },
    publishedAt: '12:03',
    receivedAt: now + 3000,
  });
  app.handleIncomingMessage({
    id: 'a-4',
    author: { name: 'ViewerAlice' },
    text: 'нет звука',
    publishedAt: '12:04',
    receivedAt: now + 4000,
  });
  app.handleIncomingMessage({
    id: 'a-5',
    author: { name: 'ViewerAlice' },
    text: 'Всё наладилось!',
    publishedAt: '12:05',
    receivedAt: now + 5000,
  });

  const panel = document.querySelector('#user-context-panel');
  assert.equal(panel.style.display, 'none', 'Panel hidden initially');

  // Open context for Alice
  app.openUserContext({ author: { name: 'ViewerAlice' } });

  assert.equal(panel.style.display, 'flex');
  assert.equal(panel.getAttribute('aria-hidden'), 'false');
  assert.equal(app.isUserContextOpen(), true);

  // Check header
  assert.equal(document.querySelector('#user-context-username').textContent, 'ViewerAlice');
  assert.equal(document.querySelector('#user-context-meta').textContent, 'Зритель · 5 сообщений');

  // Check summary
  const summaryText = document.querySelector('#user-context-summary').textContent;
  assert.ok(summaryText.includes('5 сообщений'), `Summary should include 5 messages: ${summaryText}`);
  assert.ok(summaryText.includes('1 упом.'), `Summary should include 1 mention: ${summaryText}`);
  assert.ok(summaryText.includes('1 отв.'), `Summary should include 1 reply: ${summaryText}`);
  assert.ok(summaryText.includes('1 техжалоб'), `Summary should include 1 tech complaint: ${summaryText}`);

  // Check rendered message cards in chronological order
  const msgCards = Array.from(document.querySelectorAll('#user-context-messages-list .user-context-msg'));
  assert.equal(msgCards.length, 5);
  assert.equal(msgCards[0].dataset.messageId, 'a-1', 'First rendered should be oldest');
  assert.equal(msgCards[4].dataset.messageId, 'a-5', 'Last rendered should be newest');

  // Check tags on specific messages
  assert.ok(msgCards[1].querySelector('.user-context-tag-mention'), 'Message a-2 should have mention tag');
  assert.ok(msgCards[2].querySelector('.user-context-tag-reply'), 'Message a-3 should have reply tag');
  assert.ok(msgCards[2].querySelector('.user-context-msg-reply'), 'Message a-3 should render reply quote');
  assert.ok(msgCards[3].querySelector('.user-context-tag-tech'), 'Message a-4 should have tech tag');

  // Close context
  document.querySelector('#btn-user-context-close').dispatchEvent(new win.Event('click'));
  assert.equal(panel.style.display, 'none');
  assert.equal(app.isUserContextOpen(), false);

  app.destroy();
});

test('User Context: pagination (+10) shows earlier messages when history > 10', async () => {
  const { document, window: win } = createDomHarness();
  global.document = document;

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  // Feed 25 messages from Alice
  for (let i = 1; i <= 25; i++) {
    app.handleIncomingMessage({
      id: `alice-${i}`,
      author: { name: 'ViewerAlice' },
      text: `Сообщение #${i}`,
    });
  }

  app.openUserContext({ author: { name: 'ViewerAlice' } });

  const showMoreBtn = document.querySelector('#btn-user-context-show-more');
  assert.equal(showMoreBtn.style.display, 'block', 'Show more button must be visible when > 10 messages');

  let list = document.querySelectorAll('#user-context-messages-list .user-context-msg');
  assert.equal(list.length, 10, 'Initially last 10 messages displayed');
  assert.equal(list[0].dataset.messageId, 'alice-16', 'Oldest visible is alice-16');
  assert.equal(list[9].dataset.messageId, 'alice-25', 'Newest visible is alice-25');

  // Click show more (+10)
  showMoreBtn.dispatchEvent(new win.Event('click'));
  list = document.querySelectorAll('#user-context-messages-list .user-context-msg');
  assert.equal(list.length, 20, 'Now 20 messages displayed');
  assert.equal(list[0].dataset.messageId, 'alice-6');
  assert.equal(showMoreBtn.style.display, 'block');

  // Click show more again (+10)
  showMoreBtn.dispatchEvent(new win.Event('click'));
  list = document.querySelectorAll('#user-context-messages-list .user-context-msg');
  assert.equal(list.length, 25, 'All 25 messages displayed');
  assert.equal(list[0].dataset.messageId, 'alice-1');
  assert.equal(showMoreBtn.style.display, 'none', 'Show more button hidden when all displayed');

  app.destroy();
});

test('User Context: search within user messages and clear restores', async () => {
  const { document, window: win } = createDomHarness();
  global.document = document;

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  app.handleIncomingMessage({ id: 's-1', author: 'ViewerAlice', text: 'Всем отличного дня' });
  app.handleIncomingMessage({ id: 's-2', author: 'ViewerAlice', text: 'Какая сейчас видеокарта?' });
  app.handleIncomingMessage({ id: 's-3', author: 'ViewerAlice', text: 'Спасибо за стрим' });

  app.openUserContext({ author: { name: 'ViewerAlice' } });

  const searchInput = document.querySelector('#user-context-search-input');
  const clearBtn = document.querySelector('#btn-user-context-search-clear');
  const emptyState = document.querySelector('#user-context-empty');

  // Search for 'видеокарта'
  searchInput.value = 'видеокарта';
  searchInput.dispatchEvent(new win.Event('input'));

  let list = document.querySelectorAll('#user-context-messages-list .user-context-msg');
  assert.equal(list.length, 1);
  assert.equal(list[0].dataset.messageId, 's-2');
  assert.equal(clearBtn.style.display, 'inline-flex');
  assert.equal(emptyState.style.display, 'none');

  // Search for nonexistent query
  searchInput.value = 'несуществующее';
  searchInput.dispatchEvent(new win.Event('input'));
  list = document.querySelectorAll('#user-context-messages-list .user-context-msg');
  assert.equal(list.length, 0);
  assert.equal(emptyState.style.display, 'block');

  // Clear search
  clearBtn.dispatchEvent(new win.Event('click'));
  list = document.querySelectorAll('#user-context-messages-list .user-context-msg');
  assert.equal(list.length, 3);
  assert.equal(emptyState.style.display, 'none');

  app.destroy();
});

test('User Context: live incoming messages append only for selected user', async () => {
  const { document, window: win } = createDomHarness();
  global.document = document;

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  app.handleIncomingMessage({ id: 'lv-1', author: 'ViewerAlice', text: 'Первое сообщение' });
  app.openUserContext({ author: { name: 'ViewerAlice' } });

  let list = document.querySelectorAll('#user-context-messages-list .user-context-msg');
  assert.equal(list.length, 1);

  // Incoming message from ViewerBob -> should NOT change Alice panel
  app.handleIncomingMessage({ id: 'lv-bob', author: 'ViewerBob', text: 'Сообщение Боба' });
  list = document.querySelectorAll('#user-context-messages-list .user-context-msg');
  assert.equal(list.length, 1);

  // Incoming message from ViewerAlice -> should append
  app.handleIncomingMessage({ id: 'lv-2', author: 'ViewerAlice', text: 'Второе сообщение' });
  list = document.querySelectorAll('#user-context-messages-list .user-context-msg');
  assert.equal(list.length, 2);
  assert.equal(list[1].dataset.messageId, 'lv-2');

  app.destroy();
});

test('User Context: jumpToMessage flashes highlight or shows toast if pruned', async () => {
  const { document, window: win } = createDomHarness();
  global.document = document;

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  app.handleIncomingMessage({ id: 'j-1', author: 'ViewerAlice', text: 'Сообщение для перехода' });
  app.openUserContext({ author: { name: 'ViewerAlice' } });

  const card = document.querySelector('#messages-list [data-message-id="j-1"]');
  assert.ok(card);

  // Jump to existing message
  app.jumpToMessage('j-1');
  assert.ok(card.classList.contains('jump-highlight'), 'Target card should have jump-highlight class');

  // Jump to nonexistent message ID -> should show toast
  const toast = document.querySelector('#user-context-toast');
  assert.equal(toast.style.display, 'none');
  app.jumpToMessage('non-existent-id');
  assert.equal(toast.style.display, 'block');
  assert.equal(toast.textContent, 'Сообщение уже вне текущей ленты');

  app.destroy();
});

test('User Context: Escape key closes search first, then closes panel', async () => {
  const { document, window: win } = createDomHarness();
  global.document = document;

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  await app.init();

  app.handleIncomingMessage({ id: 'esc-1', author: 'ViewerAlice', text: 'Тест эскейпа' });
  app.openUserContext({ author: { name: 'ViewerAlice' } });

  const searchInput = document.querySelector('#user-context-search-input');
  searchInput.value = 'тест';
  searchInput.dispatchEvent(new win.Event('input'));

  // First Escape -> clears search query, panel stays open
  const escEvent1 = new win.Event('keydown');
  escEvent1.key = 'Escape';
  document.dispatchEvent(escEvent1);
  assert.equal(app.isUserContextOpen(), true, 'Panel remains open on search clear');
  assert.equal(searchInput.value, '', 'Search input cleared');

  // Second Escape -> closes panel
  const escEvent2 = new win.Event('keydown');
  escEvent2.key = 'Escape';
  document.dispatchEvent(escEvent2);
  assert.equal(app.isUserContextOpen(), false, 'Panel closed on second escape');

  app.destroy();
});
