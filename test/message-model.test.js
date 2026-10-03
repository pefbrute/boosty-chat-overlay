const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeIncomingMessage,
  validateNormalizedMessage,
} = require('../core/messages/model.js');

test('Message Model: standard normalized message with full fields', () => {
  const raw = {
    id: 'msg-42',
    platform: 'boosty',
    author: {
      name: 'Фёдор Стример',
      avatar: 'https://images.boosty.to/user/42/avatar.jpg',
    },
    text: 'Привет чату, начинаем трансляцию!',
    reply: {
      author: 'Модератор',
      text: 'Правила закреплены',
    },
    publishedAt: '19:45',
  };

  const receivedAt = 1760000000000;
  const eventId = '105';

  const normalized = normalizeIncomingMessage(raw, { receivedAt, eventId });
  const validation = validateNormalizedMessage(normalized);

  assert.strictEqual(validation.ok, true, 'Validation must succeed');
  assert.deepStrictEqual(normalized, {
    id: 'msg-42',
    platform: 'boosty',
    author: {
      name: 'Фёдор Стример',
      avatar: 'https://images.boosty.to/user/42/avatar.jpg',
    },
    text: 'Привет чату, начинаем трансляцию!',
    reply: {
      author: 'Модератор',
      text: 'Правила закреплены',
    },
    publishedAt: '19:45',
    receivedAt: 1760000000000,
    eventId: '105',
  });
});

test('Message Model: legacy compatibility - flat author string and avatar URL', () => {
  const legacyRaw = {
    id: 'legacy-msg-1',
    author: 'Иван Зритель',
    avatar: 'https://images.boosty.to/avatar.png',
    text: 'Старый формат от extension v0.4',
    publishTime: '15:30', // legacy field name
  };

  const normalized = normalizeIncomingMessage(legacyRaw, { receivedAt: 1760000005000 });
  const validation = validateNormalizedMessage(normalized);

  assert.strictEqual(validation.ok, true);
  assert.strictEqual(normalized.id, 'legacy-msg-1');
  assert.strictEqual(normalized.platform, 'boosty');
  assert.deepStrictEqual(normalized.author, {
    name: 'Иван Зритель',
    avatar: 'https://images.boosty.to/avatar.png',
  });
  assert.strictEqual(normalized.text, 'Старый формат от extension v0.4');
  assert.strictEqual(normalized.publishedAt, '15:30');
  assert.strictEqual(normalized.reply, null);
  assert.strictEqual(normalized.receivedAt, 1760000005000);
});

test('Message Model: missing avatar normalizes cleanly to null without breaking', () => {
  const rawNoAvatar = {
    id: 'no-avatar-1',
    author: 'Аноним',
    avatar: '',
    text: 'Текст без аватарки',
  };

  const normalized = normalizeIncomingMessage(rawNoAvatar);
  assert.strictEqual(normalized.author.avatar, null);

  const validation = validateNormalizedMessage(normalized);
  assert.strictEqual(validation.ok, true);
});

test('Message Model: reply preservation with valid author and text', () => {
  const rawWithReply = {
    id: 'reply-test-1',
    author: 'Пользователь2',
    text: 'Согласен с предыдущим оратором',
    reply: {
      author: 'Пользователь1',
      text: 'Предыдущее сообщение',
    },
  };

  const normalized = normalizeIncomingMessage(rawWithReply);
  assert.deepStrictEqual(normalized.reply, {
    author: 'Пользователь1',
    text: 'Предыдущее сообщение',
  });
  assert.strictEqual(validateNormalizedMessage(normalized).ok, true);
});

test('Message Model: malformed reply object normalizes safely to null', () => {
  const rawBadReply = {
    id: 'bad-reply-1',
    author: 'User',
    text: 'Message',
    reply: { author: '', text: '' },
  };

  const normalized = normalizeIncomingMessage(rawBadReply);
  assert.strictEqual(normalized.reply, null);
  assert.strictEqual(validateNormalizedMessage(normalized).ok, true);
});

test('Message Model: publishedAt handles both string and timestamp numbers', () => {
  const rawNumericTime = {
    id: 'num-time-1',
    author: 'User',
    text: 'Message',
    publishedAt: 1760000000000,
  };

  const normalized = normalizeIncomingMessage(rawNumericTime);
  assert.strictEqual(typeof normalized.publishedAt, 'string');
  assert.ok(normalized.publishedAt.includes('T'), 'Should format to ISO string');
});

test('Message Model: invalid inputs safely rejected by validateNormalizedMessage', () => {
  // 1. Null / undefined / non-object
  assert.strictEqual(validateNormalizedMessage(null).ok, false);
  assert.strictEqual(validateNormalizedMessage('string').ok, false);

  // 2. Empty text
  const emptyText = normalizeIncomingMessage({ id: '1', author: 'A', text: '   ' });
  const vEmpty = validateNormalizedMessage(emptyText);
  assert.strictEqual(vEmpty.ok, false);
  assert.ok(vEmpty.error.includes('text'));

  // 3. Missing author name
  const emptyAuthor = normalizeIncomingMessage({ id: '1', author: '   ', text: 'Valid text' });
  // normalizeIncomingMessage falls back to 'Boosty' for empty author to prevent crashes
  assert.strictEqual(emptyAuthor.author.name, 'Boosty');
  assert.strictEqual(validateNormalizedMessage(emptyAuthor).ok, true);

  // 4. Manually corrupted object
  assert.strictEqual(validateNormalizedMessage({
    id: '',
    platform: 'boosty',
    author: { name: 'A', avatar: null },
    text: 'T',
    reply: null,
    publishedAt: null,
    receivedAt: Date.now(),
  }).ok, false);

  assert.strictEqual(validateNormalizedMessage({
    id: '1',
    platform: '',
    author: { name: 'A', avatar: null },
    text: 'T',
    reply: null,
    publishedAt: null,
    receivedAt: Date.now(),
  }).ok, false);
});

test('Message Model: source data cannot spoof server-controlled receivedAt and eventId', () => {
  const clientAttempt = {
    id: 'client-msg-1',
    author: 'Attacker',
    text: 'Trying to forge server time',
    receivedAt: 1000, // client tries to inject old timestamp
    eventId: '999999', // client tries to fake event sequence
  };

  const serverReceivedAt = 2000000;
  const serverEventId = '42';

  const normalized = normalizeIncomingMessage(clientAttempt, {
    receivedAt: serverReceivedAt,
    eventId: serverEventId,
  });

  assert.strictEqual(normalized.receivedAt, serverReceivedAt, 'Server option must override client receivedAt');
  assert.strictEqual(normalized.eventId, serverEventId, 'Server option must override client eventId');
});

test('Message Model: end-to-end chain (parser fixture -> normalize -> SSE serialize -> overlay renderer)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { parseHTML } = require('linkedom');
  const { parseBoostyMessage, queryRootElements } = require('../extension/parser.js');
  const BoostyRenderer = require('../overlay/renderer.js');

  const fixturePath = path.join(__dirname, 'fixtures', 'reply-message.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { document: fixtureDoc } = parseHTML(html);
  const root = queryRootElements(fixtureDoc)[0];
  assert.ok(root, 'Fixture root must exist');

  // 1. Parser extracts from DOM
  const parsed = parseBoostyMessage(root, { pathname: '/streamer' });
  assert.ok(parsed, 'Parser must succeed');
  assert.strictEqual(parsed.author, 'Стример Борис');
  assert.ok(parsed.reply, 'Reply must be found by parser');

  // 2. Normalize message
  const now = 1760000010000;
  const normalized = normalizeIncomingMessage(parsed, {
    receivedAt: now,
    eventId: '55',
  });
  assert.strictEqual(validateNormalizedMessage(normalized).ok, true);
  assert.strictEqual(normalized.author.name, 'Стример Борис');
  assert.deepStrictEqual(normalized.reply, {
    author: 'Иван Про',
    text: 'Когда следующий стрим?',
  });
  assert.strictEqual(normalized.publishedAt, null);

  // 3. Server JSON serialization & SSE delivery simulation
  const ssePayload = JSON.stringify(normalized);
  const receivedOverWire = JSON.parse(ssePayload);

  // 4. Overlay rendering
  const { document: overlayDoc } = parseHTML('<!DOCTYPE html><html><body><div id="messages"></div></body></html>');
  // Mock document on globalThis so DOM methods work in linkedom
  const prevDoc = globalThis.document;
  globalThis.document = overlayDoc;
  try {
    const card = BoostyRenderer.createMessageCard(receivedOverWire);
    assert.ok(card, 'Card must be created');
    assert.strictEqual(card.querySelector('.author').textContent, 'Стример Борис');
    assert.strictEqual(card.querySelector('.text').textContent, 'Завтра в 19:00 по Москве, будем проходить финал!');
    assert.strictEqual(card.querySelector('.avatar').src, 'https://images.boosty.to/user/55/avatar.png');
    assert.ok(card.classList.contains('has-reply'), 'Card must have has-reply class');
    assert.ok(card.querySelector('.message-reply'), 'Card must contain .message-reply element');
    assert.strictEqual(card.querySelector('.message-reply-author').textContent, 'Иван Про');
    assert.strictEqual(card.querySelector('.message-reply-text').textContent, 'Когда следующий стрим?');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('Overlay Renderer: reply DOM scenarios (normal, empty, partial, long, xss-safe)', () => {
  const { parseHTML } = require('linkedom');
  const BoostyRenderer = require('../overlay/renderer.js');
  const { document: overlayDoc } = parseHTML('<!DOCTYPE html><html><body><div id="messages"></div></body></html>');
  const prevDoc = globalThis.document;
  globalThis.document = overlayDoc;

  try {
    // 1. Normal message without reply
    const normalCard = BoostyRenderer.createMessageCard({
      author: 'User1',
      text: 'Simple text',
      reply: null,
    });
    assert.strictEqual(normalCard.classList.contains('has-reply'), false);
    assert.strictEqual(normalCard.querySelector('.message-reply'), null);

    // 2. Empty reply: empty author and empty text
    const emptyReplyCard = BoostyRenderer.createMessageCard({
      author: 'User2',
      text: 'Hello',
      reply: { author: '', text: '' },
    });
    assert.strictEqual(emptyReplyCard.classList.contains('has-reply'), false);
    assert.strictEqual(emptyReplyCard.querySelector('.message-reply'), null);

    // 3. Partial reply: author only
    const authorOnlyCard = BoostyRenderer.createMessageCard({
      author: 'User3',
      text: 'Replying with author only',
      reply: { author: 'Alice', text: '' },
    });
    assert.strictEqual(authorOnlyCard.classList.contains('has-reply'), true);
    assert.ok(authorOnlyCard.querySelector('.message-reply'));
    assert.strictEqual(authorOnlyCard.querySelector('.message-reply-author').textContent, 'Alice');
    assert.strictEqual(authorOnlyCard.querySelector('.message-reply-text'), null);

    // 4. Partial reply: text only
    const textOnlyCard = BoostyRenderer.createMessageCard({
      author: 'User4',
      text: 'Replying with text only',
      reply: { author: '', text: 'Quoted question' },
    });
    assert.strictEqual(textOnlyCard.classList.contains('has-reply'), true);
    assert.ok(textOnlyCard.querySelector('.message-reply'));
    assert.strictEqual(textOnlyCard.querySelector('.message-reply-author'), null);
    assert.strictEqual(textOnlyCard.querySelector('.message-reply-text').textContent, 'Quoted question');

    // 5. Long reply scenario
    const longCard = BoostyRenderer.createMessageCard({
      author: 'User5',
      text: 'Main answer',
      reply: {
        author: 'ОченьДлинныйНикПользователяКоторыйНеДолженСломатьИнтерфейс',
        text: 'Очень длинный текст цитаты '.repeat(10),
      },
    });
    assert.strictEqual(longCard.classList.contains('has-reply'), true);
    assert.ok(longCard.querySelector('.message-reply-author'));
    assert.ok(longCard.querySelector('.message-reply-text'));

    // 6. Security / XSS: <script> or <img onerror> in reply and author
    const xssPayload = '<img src=x onerror=alert(1)><script>alert("hack")</script>';
    const xssCard = BoostyRenderer.createMessageCard({
      author: xssPayload,
      text: xssPayload,
      reply: { author: xssPayload, text: xssPayload },
    });
    // Check that no img/script tags were created from string payloads
    assert.strictEqual(xssCard.querySelectorAll('script').length, 0);
    // avatar is the only img tag
    assert.strictEqual(xssCard.querySelectorAll('img').length, 1);
    assert.strictEqual(xssCard.querySelector('.message-reply-author').textContent, xssPayload);
    assert.strictEqual(xssCard.querySelector('.message-reply-text').textContent, xssPayload);
    assert.strictEqual(xssCard.querySelector('.author').textContent, xssPayload);
    assert.strictEqual(xssCard.querySelector('.text').textContent, xssPayload);
  } finally {
    globalThis.document = prevDoc;
  }
});
