const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanAuthorName,
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
      role: null,
    },
    text: 'Привет чату, начинаем трансляцию!',
    segments: null,
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
    role: null,
  });
  assert.strictEqual(normalized.text, 'Старый формат от extension v0.4');
  assert.strictEqual(normalized.segments, null);
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
    segments: null,
    reply: null,
    publishedAt: null,
    receivedAt: Date.now(),
  }).ok, false);

  assert.strictEqual(validateNormalizedMessage({
    id: '1',
    platform: '',
    author: { name: 'A', avatar: null },
    text: 'T',
    segments: null,
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

test('Message Model: segments normalization, unknown segment filtering, and URL safety', () => {
  // 1. Valid mixed segments preserved in exact order
  const rawMixed = {
    id: 'seg-1',
    author: 'Иван:',
    text: 'Привет :heart: @Борис!',
    segments: [
      { type: 'text', text: 'Привет ' },
      { type: 'emoji', id: ':heart:', alt: ':heart:', url: 'https://static.boosty.to/assets/images/small.heart.png' },
      { type: 'text', text: ' ' },
      { type: 'mention', userId: '42', displayName: 'Борис' },
      { type: 'text', text: '!' },
    ],
  };

  const normMixed = normalizeIncomingMessage(rawMixed, { receivedAt: 1760000020000 });
  assert.strictEqual(validateNormalizedMessage(normMixed).ok, true);
  assert.strictEqual(normMixed.author.name, 'Иван', 'Trailing presentation colon must be stripped');
  assert.strictEqual(normMixed.text, 'Привет :heart: @Борис!');
  assert.deepStrictEqual(normMixed.segments, [
    { type: 'text', text: 'Привет ' },
    { type: 'emoji', id: ':heart:', alt: ':heart:', url: 'https://static.boosty.to/assets/images/small.heart.png' },
    { type: 'text', text: ' ' },
    { type: 'mention', userId: '42', displayName: 'Борис' },
    { type: 'text', text: '!' },
  ]);

  // Verify JSON serialization over SSE preserves exact order
  const overWire = JSON.parse(JSON.stringify(normMixed));
  assert.deepStrictEqual(overWire.segments, normMixed.segments);

  // 2. Unknown segment types and malformed emoji URLs are safely dropped without breaking message
  const rawWithUnknownAndUnsafe = {
    id: 'seg-2',
    author: 'Тестер',
    text: 'Безопасный текст :evil:',
    segments: [
      { type: 'text', text: 'Безопасный текст ' },
      { type: 'unknown_rich_widget', foo: 'bar' },
      { type: 'emoji', id: ':evil:', alt: ':evil:', url: 'javascript:alert(1)' },
      { type: 'emoji', id: ':html:', alt: ':html:', url: 'data:text/html,<script>alert(1)</script>' },
      { type: 'mention', userId: '99', displayName: 'Анна' },
    ],
  };

  const normFiltered = normalizeIncomingMessage(rawWithUnknownAndUnsafe);
  assert.strictEqual(validateNormalizedMessage(normFiltered).ok, true);
  assert.strictEqual(normFiltered.text, 'Безопасный текст :evil:');
  assert.deepStrictEqual(normFiltered.segments, [
    { type: 'text', text: 'Безопасный текст ' },
    { type: 'mention', userId: '99', displayName: 'Анна' },
  ]);
});

test('Overlay Renderer: segments DOM rendering (order, .message-emoji, .message-mention) and XSS safety', () => {
  const { parseHTML } = require('linkedom');
  const BoostyRenderer = require('../overlay/renderer.js');
  const { document: overlayDoc } = parseHTML('<!DOCTYPE html><html><body><div id="messages"></div></body></html>');
  const prevDoc = globalThis.document;
  globalThis.document = overlayDoc;

  try {
    // 1. Ordered DOM rendering of text + mention + emoji + text
    const card = BoostyRenderer.createMessageCard({
      author: 'Стример',
      text: 'Привет @Иван :heart: за донат!',
      segments: [
        { type: 'text', text: 'Привет ' },
        { type: 'mention', userId: '123', displayName: 'Иван' },
        { type: 'text', text: ' ' },
        { type: 'emoji', id: ':heart:', alt: ':heart:', url: 'https://static.boosty.to/assets/images/small.heart.png' },
        { type: 'text', text: ' за донат!' },
      ],
    });

    const textEl = card.querySelector('.text');
    assert.ok(textEl, '.text container must exist');
    const childNodes = Array.from(textEl.childNodes);
    assert.strictEqual(childNodes.length, 5, 'Should render 5 child nodes matching segments order');

    assert.strictEqual(childNodes[0].nodeType, 3, '1st node must be TextNode');
    assert.strictEqual(childNodes[0].textContent, 'Привет ');

    assert.strictEqual(childNodes[1].nodeType, 1, '2nd node must be Element');
    assert.ok(childNodes[1].classList.contains('message-mention'), '2nd node must have .message-mention');
    assert.strictEqual(childNodes[1].textContent, '@Иван');

    assert.strictEqual(childNodes[2].nodeType, 3, '3rd node must be TextNode');
    assert.strictEqual(childNodes[2].textContent, ' ');

    assert.strictEqual(childNodes[3].nodeType, 1, '4th node must be Element');
    assert.strictEqual(String(childNodes[3].tagName).toUpperCase(), 'IMG', '4th node must be IMG');
    assert.ok(childNodes[3].classList.contains('message-emoji'), '4th node must have .message-emoji');
    assert.strictEqual(childNodes[3].src, 'https://static.boosty.to/assets/images/small.heart.png');
    assert.strictEqual(childNodes[3].alt, ':heart:');

    assert.strictEqual(childNodes[4].nodeType, 3, '5th node must be TextNode');
    assert.strictEqual(childNodes[4].textContent, ' за донат!');

    // 2. XSS safety in segments (mention displayName, text segment, and javascript: emoji URL)
    const xssSegmentCard = BoostyRenderer.createMessageCard({
      author: 'Хакер',
      text: 'XSS test',
      segments: [
        { type: 'text', text: '<script>alert(1)</script>' },
        { type: 'mention', userId: '1', displayName: '<img src=x onerror=alert(1)>' },
        { type: 'emoji', id: ':xss:', alt: ':xss:', url: 'javascript:alert(1)' },
      ],
    });

    const xssTextEl = xssSegmentCard.querySelector('.text');
    assert.strictEqual(xssTextEl.querySelectorAll('script').length, 0, 'No script element may be created');
    assert.strictEqual(xssTextEl.querySelectorAll('img').length, 0, 'javascript: emoji URL must not create an img element');
    const mentionSpan = xssTextEl.querySelector('.message-mention');
    assert.ok(mentionSpan, 'Mention span must exist');
    assert.strictEqual(mentionSpan.querySelectorAll('img').length, 0, 'Mention displayName must not inject HTML');
    assert.strictEqual(mentionSpan.textContent, '@<img src=x onerror=alert(1)>');
    assert.strictEqual(xssTextEl.textContent, '<script>alert(1)</script>@<img src=x onerror=alert(1)>:xss:');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('Message Model: author.role whitelist normalization and validation (streamer, moderator, null, invalid, legacy)', () => {
  // 1. author.role = streamer (structured & flat)
  const normStreamerObj = normalizeIncomingMessage({
    id: 'role-1',
    author: { name: 'Фёдор', avatar: null, role: 'streamer' },
    text: 'Привет',
  });
  assert.strictEqual(normStreamerObj.author.role, 'streamer');
  assert.strictEqual(validateNormalizedMessage(normStreamerObj).ok, true);

  const normStreamerFlat = normalizeIncomingMessage({
    id: 'role-2',
    author: 'Фёдор:',
    role: 'STREAMER',
    text: 'Привет',
  });
  assert.strictEqual(normStreamerFlat.author.name, 'Фёдор');
  assert.strictEqual(normStreamerFlat.author.role, 'streamer');
  assert.strictEqual(validateNormalizedMessage(normStreamerFlat).ok, true);

  // 2. author.role = moderator
  const normMod = normalizeIncomingMessage({
    id: 'role-3',
    author: { name: 'Иван', avatar: null, role: 'moderator' },
    text: 'Правила чата',
  });
  assert.strictEqual(normMod.author.role, 'moderator');
  assert.strictEqual(validateNormalizedMessage(normMod).ok, true);

  // 3. author.role = null / undefined / legacy author
  const normNull = normalizeIncomingMessage({
    id: 'role-4',
    author: { name: 'Зритель', avatar: null, role: null },
    text: 'Обычное сообщение',
  });
  assert.strictEqual(normNull.author.role, null);
  assert.strictEqual(validateNormalizedMessage(normNull).ok, true);

  const normLegacy = normalizeIncomingMessage({
    id: 'role-5',
    author: { name: 'СтарыйФормат', avatar: null },
    text: 'Без поля role',
  });
  assert.strictEqual(normLegacy.author.role, null);
  assert.strictEqual(validateNormalizedMessage(normLegacy).ok, true);

  // 4. Invalid / unverified roles normalize to null
  const invalidRoles = ['admin', 'subscriber', 'premium', 'tier1', 'vip', '<script>alert(1)</script>', 123, {}, []];
  for (const badRole of invalidRoles) {
    const normBad = normalizeIncomingMessage({
      id: 'role-bad',
      author: { name: 'Тест', avatar: null, role: badRole },
      text: 'Текст',
    });
    assert.strictEqual(normBad.author.role, null, `Invalid role ${JSON.stringify(badRole)} must normalize to null`);
    assert.strictEqual(validateNormalizedMessage(normBad).ok, true);

    // Direct validation of un-normalized object with invalid role must fail
    const corrupted = {
      ...normBad,
      author: { ...normBad.author, role: badRole },
    };
    assert.strictEqual(validateNormalizedMessage(corrupted).ok, false, `validateNormalizedMessage must reject role=${JSON.stringify(badRole)}`);
  }
});

test('Overlay Renderer: role badges DOM (.author-role--streamer, .author-role--moderator, normal absence, XSS safety)', () => {
  const { parseHTML } = require('linkedom');
  const BoostyRenderer = require('../overlay/renderer.js');
  const { document: overlayDoc } = parseHTML('<!DOCTYPE html><html><body><div id="messages"></div></body></html>');
  const prevDoc = globalThis.document;
  globalThis.document = overlayDoc;

  try {
    // 1. Streamer role badge
    const streamerCard = BoostyRenderer.createMessageCard({
      author: { name: 'Фёдор', avatar: null, role: 'streamer' },
      text: 'Всем привет!',
      reply: { author: 'Зритель', text: 'Когда стрим?' },
    });
    const streamerBadge = streamerCard.querySelector('.author-role.author-role--streamer');
    assert.ok(streamerBadge, '.author-role--streamer must exist for streamer');
    assert.strictEqual(streamerBadge.getAttribute('aria-label'), 'Стример');
    assert.ok(streamerBadge.querySelector('svg.author-role-icon path'), 'Streamer badge must contain SVG icon path');
    assert.strictEqual(streamerCard.querySelector('.author').textContent, 'Фёдор', 'Badge must not add extra visible text to .author');
    assert.strictEqual(streamerCard.querySelector('.message-reply .author-role'), null, 'Reply block must not contain role badge');

    // 2. Moderator role badge
    const modCard = BoostyRenderer.createMessageCard({
      author: { name: 'Иван', avatar: null, role: 'moderator' },
      text: 'Соблюдаем правила',
    });
    const modBadge = modCard.querySelector('.author-role.author-role--moderator');
    assert.ok(modBadge, '.author-role--moderator must exist for moderator');
    assert.strictEqual(modBadge.getAttribute('aria-label'), 'Модератор');
    assert.ok(modBadge.querySelector('svg.author-role-icon path'), 'Moderator badge must contain SVG icon path');
    assert.strictEqual(modCard.querySelector('.author').textContent, 'Иван');

    // 3. Normal user (role = null / absent)
    const normalCard = BoostyRenderer.createMessageCard({
      author: { name: 'ОбычныйЗритель', avatar: null, role: null },
      text: 'Привет',
    });
    assert.strictEqual(normalCard.querySelector('.author-role'), null, 'Role DOM must be absent for normal user');
    assert.strictEqual(normalCard.querySelector('.author').textContent, 'ОбычныйЗритель');

    // 4. XSS / arbitrary role string rejected
    const xssRoleCard = BoostyRenderer.createMessageCard({
      author: { name: 'Хакер', avatar: null, role: '<img src=x onerror=alert(1)>' },
      text: 'Тест',
    });
    assert.strictEqual(xssRoleCard.querySelector('.author-role'), null, 'Arbitrary role string must not render role DOM');
    assert.strictEqual(xssRoleCard.querySelectorAll('img').length, 1, 'Only avatar img may exist');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('Message Model: author colon normalization preserves colons inside names and strips trailing colon only', () => {
  const cases = [
    { input: 'Иван:', expected: 'Иван' },
    { input: 'Иван :', expected: 'Иван' },
    { input: 'Иван', expected: 'Иван' },
    { input: 'Foo:Bar', expected: 'Foo:Bar' },
    { input: 'Foo:Bar:', expected: 'Foo:Bar' },
    { input: '  Стример:  ', expected: 'Стример' },
    { input: '  Стример :  ', expected: 'Стример' },
  ];

  for (const c of cases) {
    if (typeof cleanAuthorName === 'function') {
      const clean = cleanAuthorName(c.input);
      assert.strictEqual(clean, c.expected, `cleanAuthorName failed for "${c.input}"`);
    }

    // String author format
    const msgStr = normalizeIncomingMessage({ id: 'msg-str', author: c.input, text: 'Hello' });
    assert.strictEqual(msgStr.author.name, c.expected, `normalizeIncomingMessage (string author) failed for "${c.input}"`);
    assert.strictEqual(msgStr.author.name.endsWith(':'), false, `author.name must not end with colon for "${c.input}"`);

    // Object author format
    const msgObj = normalizeIncomingMessage({ id: 'msg-obj', author: { name: c.input }, text: 'Hello' });
    assert.strictEqual(msgObj.author.name, c.expected, `normalizeIncomingMessage (object author) failed for "${c.input}"`);
    assert.strictEqual(msgObj.author.name.endsWith(':'), false, `author.name must not end with colon for "${c.input}"`);
  }
});
