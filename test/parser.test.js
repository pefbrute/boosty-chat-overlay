const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseHTML } = require("linkedom");
const {
  parseBoostyMessage,
  normalizeAuthorName,
  extractAuthor,
  extractAuthorRole,
  extractSegments,
  extractText,
  extractAvatarUrl,
  extractMessageId,
  extractReplyInfo,
  queryRootElements,
} = require("../extension/parser.js");

function loadFixture(relPath) {
  const file = path.join(__dirname, "fixtures", relPath);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, "utf8");
  const { document } = parseHTML(html);
  const root = queryRootElements(document)[0] || document.querySelector('[data-test-id="CHATMESSAGE:root"]');
  return { root, document };
}

// ==========================================
// 1. Synthetic Fixtures
// ==========================================
test("Boosty Parser: text message fixture", () => {
  const { root } = loadFixture("text-message.html");
  assert.ok(root, "Root element should be found");

  const author = extractAuthor(root);
  const text = extractText(root);
  const avatar = extractAvatarUrl(root);
  const id = extractMessageId(root);
  const parsed = parseBoostyMessage(root);

  assert.strictEqual(author, "Алексей Смирнов");
  assert.strictEqual(text, "Всем привет, отличный стрим!");
  assert.strictEqual(avatar, "");
  assert.strictEqual(id, "msg-101");

  assert.deepStrictEqual(parsed, {
    id: "msg-101",
    author: "Алексей Смирнов",
    role: null,
    text: "Всем привет, отличный стрим!",
    segments: [
      { type: "text", text: "Всем привет, отличный стрим!" },
    ],
    avatar: "",
    publishTime: "14:20",
    reply: null,
  });
});

test("Boosty Parser: message with <img> avatar fixture", () => {
  const { root } = loadFixture("with-avatar.html");
  assert.ok(root, "Root element should be found");

  const parsed = parseBoostyMessage(root);
  assert.strictEqual(parsed.author, "Дмитрий Игроман");
  assert.strictEqual(parsed.text, "Удачи в катке, тащи!");
  assert.strictEqual(parsed.avatar, "https://images.boosty.to/user/42/avatar.jpg?change_time=123");
  assert.strictEqual(parsed.id, "msg-102");
});

test("Boosty Parser: message without avatar fixture", () => {
  const { root } = loadFixture("without-avatar.html");
  assert.ok(root, "Root element should be found");

  const parsed = parseBoostyMessage(root);
  assert.strictEqual(parsed.author, "Анонимный Зритель");
  assert.strictEqual(parsed.text, "Сообщение без аватарки и картинок.");
  assert.strictEqual(parsed.avatar, "");
  assert.strictEqual(parsed.id, "msg-103");
});

test("Boosty Parser: message with emoji & background avatar fixture", () => {
  const { root } = loadFixture("with-emoji.html");
  assert.ok(root, "Root element should be found");

  const parsed = parseBoostyMessage(root);
  assert.strictEqual(parsed.author, "Катя Смайл");
  assert.strictEqual(parsed.text, "Привет стример! 🔥🚀🎉 Спасибо за крутой контент ❤️");
  assert.deepStrictEqual(parsed.segments, [
    { type: "text", text: "Привет стример! 🔥🚀🎉 Спасибо за крутой контент ❤️" },
  ]);
  assert.strictEqual(parsed.avatar, "https://images.boosty.to/user/99/avatar.png");
  assert.strictEqual(parsed.id, "msg-104");
});

test("Boosty Parser: long message fixture", () => {
  const { root } = loadFixture("long-message.html");
  assert.ok(root, "Root element should be found");

  const parsed = parseBoostyMessage(root);
  assert.strictEqual(parsed.author, "Максим Аналитик");
  assert.ok(parsed.text.startsWith("Привет! Хотел подробно разобрать вчерашний стрим."));
  assert.ok(parsed.text.length > 200, "Text should be long");
  assert.strictEqual(parsed.avatar, "https://images.boosty.to/user/77/avatar.webp");
  assert.strictEqual(parsed.id, "msg-105");
});

test("Boosty Parser: reply message fixture", () => {
  const { root } = loadFixture("reply-message.html");
  assert.ok(root, "Root element should be found");

  const parsed = parseBoostyMessage(root);
  assert.strictEqual(parsed.author, "Стример Борис");
  assert.strictEqual(parsed.text, "Завтра в 19:00 по Москве, будем проходить финал!");
  assert.strictEqual(parsed.avatar, "https://images.boosty.to/user/55/avatar.png");
  assert.strictEqual(parsed.id, "msg-106");

  assert.ok(parsed.reply, "Reply information should be extracted");
  assert.strictEqual(parsed.reply.author, "Иван Про");
  assert.strictEqual(parsed.reply.text, "Когда следующий стрим?");
});

test("Boosty Parser: realistic custom emoji + mention fixture", () => {
  const { root } = loadFixture("custom-emoji-mention.html");
  assert.ok(root, "Root element should be found");

  const parsed = parseBoostyMessage(root, { pathname: "/streamer" });
  assert.ok(parsed, "Message should be parsed");
  assert.strictEqual(parsed.author, "Стример_Тест");
  assert.strictEqual(parsed.publishTime, "18:15");
  assert.strictEqual(parsed.avatar, "https://images.boosty.to/user/12345/avatar.png");
  assert.strictEqual(parsed.text, "Привет :heart: @Иван!");
  assert.ok(parsed.id.startsWith("fallback-"), "Should generate deterministic fallback ID without colliding on emoji data-id");
  assert.deepStrictEqual(parsed.segments, [
    { type: "text", text: "Привет " },
    {
      type: "emoji",
      id: ":heart:",
      alt: ":heart:",
      url: "https://static.boosty.to/assets/images/small.heart123.png",
    },
    { type: "text", text: " " },
    {
      type: "mention",
      userId: "12345",
      displayName: "Иван",
    },
    { type: "text", text: "!" },
  ]);
});

// ==========================================
// 2. Real DOM Fixtures Group
// ==========================================
test("Boosty Parser: real DOM fixtures", (t) => {
  const realDir = path.join(__dirname, "fixtures", "real");
  const files = fs.existsSync(realDir)
    ? fs.readdirSync(realDir).filter(f => f.endsWith(".html"))
    : [];

  if (files.length === 0) {
    console.warn("\n============================================================");
    console.warn("⚠ Real Boosty fixtures: NOT CAPTURED / SKIPPED");
    console.warn("Причина: отсутствие активного стрима для автоматического захвата.");
    console.warn("Для захвата используйте DevTools-сниппет scripts/capture-boosty-dom.js");
    console.warn("============================================================\n");
    t.skip("Real Boosty fixtures: NOT CAPTURED / SKIPPED");
    return;
  }

  for (const file of files) {
    const fixture = loadFixture(path.join("real", file));
    assert.ok(fixture?.root, `Root element must be found in real fixture: ${file}`);
    const parsed = parseBoostyMessage(fixture.root);
    assert.ok(parsed, `parseBoostyMessage must succeed on real fixture: ${file}`);
    assert.ok(parsed.author, `Author must be extracted from ${file}`);
    assert.ok(parsed.text, `Text must be extracted from ${file}`);
    assert.ok(parsed.id, `ID must be extracted from ${file}`);
  }
});

// ==========================================
// 3. Deterministic Fallback ID & Stability
// ==========================================
test("Boosty Parser: deterministic fallback ID without explicit message ID", () => {
  const { document } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <div class="ChatMessage_header">
        <span data-test-id="CHATMESSAGE:author">Иван_Стример</span>
        <span class="ChatMessage_time">16:45</span>
      </div>
      <div data-test-id="CHATMESSAGE:message">Привет мир</div>
    </div>
  `);
  const root = document.querySelector('[data-test-id="CHATMESSAGE:root"]');

  // Idempotency: multiple parse calls on the exact same element return identical ID
  const msg1 = parseBoostyMessage(root, { pathname: "/live/stream1" });
  const msg2 = parseBoostyMessage(root, { pathname: "/live/stream1" });
  const msg3 = parseBoostyMessage(root, { pathname: "/live/stream1" });

  assert.ok(msg1.id.startsWith("fallback-"), "ID should use deterministic fallback- prefix");
  // Verify exact FNV-1a hash stability for "/live/stream1|Иван_Стример|Привет мир|16:45"
  assert.strictEqual(msg1.id, "fallback-eb5996f8", "Fallback ID hash for plain message must remain unchanged");
  assert.strictEqual(msg1.id, msg2.id, "ID must be strictly equal across calls");
  assert.strictEqual(msg2.id, msg3.id, "ID must be strictly equal across calls");
  assert.doesNotMatch(msg1.id, /[0-9]{13}/, "ID must not contain Date.now() timestamp");

  // Same author + text + time in different pathname MUST produce different ID
  const idPath1 = extractMessageId(root, { pathname: "/channel/alpha" });
  const idPath2 = extractMessageId(root, { pathname: "/channel/beta" });
  assert.notStrictEqual(idPath1, idPath2, "Different pathname must produce different fallback ID");

  // Different text produces different ID
  const { document: docDiffText } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <span data-test-id="CHATMESSAGE:author">Иван_Стример</span>
      <span class="ChatMessage_time">16:45</span>
      <div data-test-id="CHATMESSAGE:message">Другой текст сообщения</div>
    </div>
  `);
  const rootDiffText = docDiffText.querySelector('[data-test-id="CHATMESSAGE:root"]');
  const idDiffText = extractMessageId(rootDiffText, { pathname: "/live/stream1" });
  assert.notStrictEqual(msg1.id, idDiffText, "Different text must produce different fallback ID");

  // Different time produces different ID
  const { document: docDiffTime } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <span data-test-id="CHATMESSAGE:author">Иван_Стример</span>
      <span class="ChatMessage_time">16:46</span>
      <div data-test-id="CHATMESSAGE:message">Привет мир</div>
    </div>
  `);
  const rootDiffTime = docDiffTime.querySelector('[data-test-id="CHATMESSAGE:root"]');
  const idDiffTime = extractMessageId(rootDiffTime, { pathname: "/live/stream1" });
  assert.notStrictEqual(msg1.id, idDiffTime, "Different time must produce different fallback ID");
});

// ==========================================
// 3.1 Structured Segments, Tooltip Regression & Author Colon Normalization
// ==========================================
test("Boosty Parser: Unicode emoji stays a single text segment", () => {
  const { document } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <span data-test-id="CHATMESSAGE:author">Зритель</span>
      <div data-test-id="CHATMESSAGE:message">Привет 👋</div>
    </div>
  `);
  const root = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
  const parsed = parseBoostyMessage(root);
  assert.strictEqual(parsed.text, "Привет 👋");
  assert.deepStrictEqual(parsed.segments, [
    { type: "text", text: "Привет 👋" },
  ]);
});

test("Boosty Parser: Boosty custom emoji produces [text, emoji, text] segments", () => {
  const { document } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <span data-test-id="CHATMESSAGE:author">Зритель</span>
      <div data-test-id="CHATMESSAGE:message">
        Привет
        <img data-type="smile" data-id=":heart:" alt=":heart:" src="https://static.boosty.to/assets/images/small.heart.png">
        мир
      </div>
    </div>
  `);
  const root = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
  const parsed = parseBoostyMessage(root);
  assert.deepStrictEqual(parsed.segments, [
    { type: "text", text: "Привет" },
    {
      type: "emoji",
      id: ":heart:",
      alt: ":heart:",
      url: "https://static.boosty.to/assets/images/small.heart.png",
    },
    { type: "text", text: "мир" },
  ]);
  assert.strictEqual(parsed.text, "Привет:heart:мир");
});

test("Boosty Parser: multiple custom emoji in a row (2-3 smile images)", () => {
  const { document } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <span data-test-id="CHATMESSAGE:author">Зритель:</span>
      <div data-test-id="CHATMESSAGE:message">
        <img data-type="smile" data-id=":heart:" alt=":heart:" src="https://static.boosty.to/assets/images/small.heart.png">
        <img data-type="smile" data-id=":fire:" alt=":fire:" src="https://static.boosty.to/assets/images/small.fire.png">
        <img data-type="smile" data-id=":rocket:" alt=":rocket:" src="https://static.boosty.to/assets/images/small.rocket.png">
      </div>
    </div>
  `);
  const root = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
  const parsed = parseBoostyMessage(root);
  assert.strictEqual(parsed.author, "Зритель");
  assert.strictEqual(parsed.text, ":heart::fire::rocket:");
  assert.deepStrictEqual(parsed.segments, [
    {
      type: "emoji",
      id: ":heart:",
      alt: ":heart:",
      url: "https://static.boosty.to/assets/images/small.heart.png",
    },
    {
      type: "emoji",
      id: ":fire:",
      alt: ":fire:",
      url: "https://static.boosty.to/assets/images/small.fire.png",
    },
    {
      type: "emoji",
      id: ":rocket:",
      alt: ":rocket:",
      url: "https://static.boosty.to/assets/images/small.rocket.png",
    },
  ]);
});

test("Boosty Parser: mention element produces mention segment and @name in text", () => {
  const { document } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <span data-test-id="CHATMESSAGE:author">Алексей:</span>
      <div data-test-id="CHATMESSAGE:message">
        <span class="mention" data-mention-id="123" data-display-name="Иван">Иван</span>
      </div>
    </div>
  `);
  const root = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
  const parsed = parseBoostyMessage(root);
  assert.strictEqual(parsed.author, "Алексей");
  assert.strictEqual(parsed.text, "@Иван");
  assert.deepStrictEqual(parsed.segments, [
    {
      type: "mention",
      userId: "123",
      displayName: "Иван",
    },
  ]);
});

test("Boosty Parser: mixed text + mention + emoji + text preserves DOM order", () => {
  const { document } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <span data-test-id="CHATMESSAGE:author">Мария:</span>
      <div data-test-id="CHATMESSAGE:message">Привет <span class="mention" data-mention-id="777" data-display-name="Иван">Иван</span> лови <img data-type="smile" data-id=":heart:" alt=":heart:" src="https://static.boosty.to/assets/images/small.heart.png"> за стрим!</div>
    </div>
  `);
  const root = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
  const parsed = parseBoostyMessage(root);
  assert.strictEqual(parsed.author, "Мария");
  assert.strictEqual(parsed.text, "Привет @Иван лови :heart: за стрим!");
  assert.deepStrictEqual(parsed.segments, [
    { type: "text", text: "Привет " },
    { type: "mention", userId: "777", displayName: "Иван" },
    { type: "text", text: " лови " },
    {
      type: "emoji",
      id: ":heart:",
      alt: ":heart:",
      url: "https://static.boosty.to/assets/images/small.heart.png",
    },
    { type: "text", text: " за стрим!" },
  ]);
});

test("Boosty Parser: tooltip regression test (tooltip inside message container must not leak into text or segments)", () => {
  const { document } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <span data-test-id="CHATMESSAGE:author">Зритель</span>
      <div data-test-id="CHATMESSAGE:message">
        Привет
        <img data-type="smile" alt=":heart:" data-id=":heart:" src="https://static.boosty.to/assets/images/small.heart.png">
        <div class="ChatMessage-scss--module_tooltip_Fu2uP">:heart:</div>
      </div>
    </div>
  `);
  const root = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
  const parsed = parseBoostyMessage(root);

  assert.strictEqual(parsed.text, "Привет:heart:");
  assert.notStrictEqual(parsed.text, "Привет:heart::heart:");
  assert.deepStrictEqual(parsed.segments, [
    { type: "text", text: "Привет" },
    {
      type: "emoji",
      id: ":heart:",
      alt: ":heart:",
      url: "https://static.boosty.to/assets/images/small.heart.png",
    },
  ]);
});

test("Boosty Parser: author colon normalization (strips trailing presentation colon only)", () => {
  const cases = [
    { raw: "Иван:", expected: "Иван" },
    { raw: "Иван :", expected: "Иван" },
    { raw: "Иван", expected: "Иван" },
    { raw: "Foo:Bar", expected: "Foo:Bar" },
    { raw: "Foo:Bar:", expected: "Foo:Bar" },
    { raw: "  Никнейм:  ", expected: "Никнейм" },
    { raw: "  Никнейм :  ", expected: "Никнейм" },
  ];

  for (const c of cases) {
    if (typeof normalizeAuthorName === "function") {
      assert.strictEqual(normalizeAuthorName(c.raw), c.expected, `normalizeAuthorName failed for "${c.raw}"`);
    }
    const { document } = parseHTML(`
      <div data-test-id="CHATMESSAGE:root">
        <span data-test-id="CHATMESSAGE:author">${c.raw}</span>
        <div data-test-id="CHATMESSAGE:message">Текст</div>
      </div>
    `);
    const root = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
    assert.strictEqual(extractAuthor(root), c.expected, `Failed for raw author "${c.raw}"`);
  }
});

// ==========================================
// 3.2 Author Role Badges (streamer / moderator / null)
// ==========================================
test("Boosty Parser: streamer-message.html, moderator-message.html, normal-user-message.html, and real-text-message.html fixtures", () => {
  // 1. Streamer fixture (#icon-star-*)
  const streamerFix = loadFixture("streamer-message.html");
  assert.ok(streamerFix?.root, "streamer-message.html root must exist");
  const parsedStreamer = parseBoostyMessage(streamerFix.root, { pathname: "/streamer" });
  assert.strictEqual(parsedStreamer.author, "Фёдор_Стример");
  assert.strictEqual(parsedStreamer.role, "streamer");
  assert.strictEqual(parsedStreamer.avatar, "https://images.boosty.to/user/10/avatar.png");
  assert.strictEqual(parsedStreamer.text, "Всем привет, начинаем эфир!");
  assert.deepStrictEqual(parsedStreamer.segments, [
    { type: "text", text: "Всем привет, начинаем эфир!" },
  ]);

  // 2. Moderator fixture (#icon-sword-*)
  const modFix = loadFixture("moderator-message.html");
  assert.ok(modFix?.root, "moderator-message.html root must exist");
  const parsedMod = parseBoostyMessage(modFix.root, { pathname: "/streamer" });
  assert.strictEqual(parsedMod.author, "Модератор_Иван");
  assert.strictEqual(parsedMod.role, "moderator");
  assert.strictEqual(parsedMod.avatar, "https://images.boosty.to/user/20/avatar.png");
  assert.strictEqual(parsedMod.text, "Соблюдаем правила чата и уважаем друг друга.");
  assert.deepStrictEqual(parsedMod.segments, [
    { type: "text", text: "Соблюдаем правила чата и уважаем друг друга." },
  ]);

  // 3. Normal user fixture (no role icon)
  const normalFix = loadFixture("normal-user-message.html");
  assert.ok(normalFix?.root, "normal-user-message.html root must exist");
  const parsedNormal = parseBoostyMessage(normalFix.root, { pathname: "/streamer" });
  assert.strictEqual(parsedNormal.author, "Обычный_Зритель");
  assert.strictEqual(parsedNormal.role, null);
  assert.strictEqual(parsedNormal.avatar, "https://images.boosty.to/user/30/avatar.png");
  assert.strictEqual(parsedNormal.text, "Звук и картинка супер!");

  // 4. Real captured DOM fixture (real/real-text-message.html contains #icon-star-4f3444cf)
  const realFix = loadFixture(path.join("real", "real-text-message.html"));
  if (realFix?.root) {
    const parsedReal = parseBoostyMessage(realFix.root, { pathname: "/streamer" });
    assert.strictEqual(parsedReal.author, "Зритель_Тест");
    assert.strictEqual(parsedReal.role, "streamer");
    assert.strictEqual(parsedReal.text, "Тестовое сообщение из реального DOM Boosty");
  }
});

test("Boosty Parser: role detection supports both href and xlink:href, ignores unknown icons, and preserves fallback ID", () => {
  // 1. Standard href attribute on <use>
  const { document: docHrefStar } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <div class="ChatMessage-scss--module_author_3jNAZ">
        <svg><use href="#icon-star-9999abcd"></use></svg>
        <span data-test-id="CHATMESSAGE:author">Иван_Стример:</span>
      </div>
      <span class="ChatMessage_time">16:45</span>
      <div data-test-id="CHATMESSAGE:message">Привет мир</div>
    </div>
  `);
  const rootHrefStar = docHrefStar.querySelector('[data-test-id="CHATMESSAGE:root"]');
  const parsedHrefStar = parseBoostyMessage(rootHrefStar, { pathname: "/live/stream1" });
  assert.strictEqual(parsedHrefStar.role, "streamer");
  assert.strictEqual(parsedHrefStar.author, "Иван_Стример");
  assert.strictEqual(parsedHrefStar.text, "Привет мир");
  // Fallback ID must be identical to the message without role badge!
  assert.strictEqual(parsedHrefStar.id, "fallback-eb5996f8");

  // 2. Standard href attribute for moderator (#icon-sword)
  const { document: docHrefSword } = parseHTML(`
    <div data-test-id="CHATMESSAGE:root">
      <div class="ChatMessage-scss--module_author_3jNAZ">
        <svg><use href="#icon-sword"></use></svg>
        <span data-test-id="CHATMESSAGE:author">Модер:</span>
      </div>
      <div data-test-id="CHATMESSAGE:message">Тишина в чате</div>
    </div>
  `);
  const rootHrefSword = docHrefSword.querySelector('[data-test-id="CHATMESSAGE:root"]');
  assert.strictEqual(extractAuthorRole(rootHrefSword), "moderator");

  // 3. Unknown SVG icons near author must return role = null without breaking message parsing
  const unknownIcons = [
    "#icon-crown-12345",
    "#icon-verified-abcd",
    "#icon-subscriber-tier1",
    "#icon-starting-soon",
    "#icon-trash-rounded-bold-7f6beacc",
  ];
  for (const iconHref of unknownIcons) {
    const { document: docUnknown } = parseHTML(`
      <div data-test-id="CHATMESSAGE:root">
        <div class="ChatMessage-scss--module_author_3jNAZ">
          <svg><use xlink:href="${iconHref}"></use></svg>
          <span data-test-id="CHATMESSAGE:author">Зритель:</span>
        </div>
        <div data-test-id="CHATMESSAGE:message">Обычный текст</div>
      </div>
    `);
    const rootUnknown = docUnknown.querySelector('[data-test-id="CHATMESSAGE:root"]');
    const parsedUnknown = parseBoostyMessage(rootUnknown);
    assert.ok(parsedUnknown, `Message with unknown icon ${iconHref} must still be parsed`);
    assert.strictEqual(parsedUnknown.role, null, `Unknown icon ${iconHref} must produce role = null`);
    assert.strictEqual(parsedUnknown.author, "Зритель");
    assert.strictEqual(parsedUnknown.text, "Обычный текст");
  }
});

// ==========================================
// 4. Edge Cases & Fallbacks
// ==========================================
test("Boosty Parser: edge cases (null root, empty text, fallback IDs)", () => {
  assert.strictEqual(parseBoostyMessage(null), null);
  assert.strictEqual(extractAuthor(null), "");
  assert.strictEqual(extractAuthorRole(null), null);
  assert.strictEqual(extractText(null), "");
  assert.deepStrictEqual(extractSegments(null), []);
  assert.strictEqual(extractAvatarUrl(null), "");
  assert.strictEqual(extractMessageId(null), "");

  const { document } = parseHTML('<div class="invalid"><span>No author</span></div>');
  const invalidRoot = document.querySelector(".invalid");
  assert.strictEqual(parseBoostyMessage(invalidRoot), null);
});

// ==========================================
// 5. Capture Snippet Anonymization & Emoji Preservation
// ==========================================
test("Capture Snippet: anonymization and emoji preservation", () => {
  const sampleHtml = `
    <div data-test-id="CHATMESSAGE:root" class="ChatMessage_root" data-user-id="secret-user-12345">
      <div class="ChatMessage_avatar" style="background-image: url('https://images.boosty.to/private/avatar.jpg')">
        <img src="https://images.boosty.to/private/avatar.jpg" data-src="https://images.boosty.to/private/avatar.jpg" srcset="https://images.boosty.to/private/avatar.jpg 1x" />
      </div>
      <a href="https://boosty.to/real-user-profile" class="ChatMessage_author">СекретныйСтример</a>
      <div data-test-id="CHATMESSAGE:message" class="ChatMessage_text">
        Привет, стрим отличный! <img alt="🔥" class="emoji" src="https://boosty.to/emojis/fire.png"> Ура!
      </div>
      <div data-test-id="CHATMESSAGE:reply" class="ChatMessage_reply">
        <span class="ChatMessage_author">ДругойЧеловек</span>
        <span class="ChatMessage_text">Оригинальный вопрос?</span>
      </div>
    </div>
  `;

  const { document, window } = parseHTML(sampleHtml);
  const targetNode = document.querySelector('[data-test-id="CHATMESSAGE:root"]');

  // Load and execute capture snippet logic with targetNode
  window.__BOOSTY_CAPTURE_TEST_NODE__ = targetNode;
  const snippetCode = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'capture-boosty-dom.js'), 'utf8');

  // Execute in VM with provided window and document
  const vm = require('node:vm');
  const context = vm.createContext({
    document,
    window,
    console: { log() {}, info() {}, warn() {}, error() {} },
  });
  const result = vm.runInContext(snippetCode, context);

  assert.ok(result?.html, "Snippet should return anonymized html");
  const anonHtml = result.html;

  // 1. Author anonymized
  assert.ok(!anonHtml.includes("СекретныйСтример"), "Author name must be anonymized");
  assert.ok(anonHtml.includes("Зритель_Тест"), "Anonymized author placeholder must be present");

  // 2. Personal URLs and sensitive user-id anonymized
  assert.ok(!anonHtml.includes("https://images.boosty.to/private/avatar.jpg"), "Avatar URL must not leak");
  assert.ok(!anonHtml.includes("https://boosty.to/real-user-profile"), "Profile link must not leak");
  assert.ok(!anonHtml.includes("secret-user-12345"), "data-user-id must be neutralized");
  assert.ok(anonHtml.includes("https://example.invalid/avatar.png"), "Safe avatar placeholder must be used");
  assert.ok(anonHtml.includes("https://example.invalid/link"), "Safe href placeholder must be used");

  // 3. Emoji preserved with alt attribute intact
  assert.ok(anonHtml.includes('alt="🔥"'), 'Emoji alt attribute must be preserved');
  assert.ok(!anonHtml.includes("https://boosty.to/emojis/fire.png"), "Original emoji URL should be replaced with neutral URL");
  assert.ok(anonHtml.includes("https://example.invalid/emoji.png"), "Neutral emoji URL placeholder must be used");

  // 4. Reply anonymized
  assert.ok(!anonHtml.includes("ДругойЧеловек"), "Reply author must be anonymized");
  assert.ok(!anonHtml.includes("Оригинальный вопрос?"), "Reply text must be anonymized");

  // 5. Structure & classes preserved
  assert.ok(anonHtml.includes('class="ChatMessage_root"'), "Original classes must be preserved");
  assert.ok(anonHtml.includes('data-test-id="CHATMESSAGE:root"'), "data-test-id must be preserved");
});

test("Capture Snippet: recursive text anonymization with deeply nested tags & reply", () => {
  const nestedHtml = `
    <div data-test-id="CHATMESSAGE:root" class="ChatMessage_root">
      <span data-test-id="CHATMESSAGE:author" class="ChatMessage_author">
        <span class="badge">PRO</span>
        СуперСтример123
      </span>
      <div data-test-id="CHATMESSAGE:message" class="ChatMessage_text">
        Настоящий текст
        <span class="nested">секретный вложенный текст</span>
        <span>
          ещё один
          <strong>глубоко вложенный текст</strong>
        </span>
        <img alt="🔥" class="emoji" src="https://cdn.boosty.to/private-emoji.png">
      </div>
      <div data-test-id="CHATMESSAGE:reply" class="ChatMessage_reply">
        <span class="ChatMessage_author">
          <span class="role">Модер</span>
          АвторЦитаты
        </span>
        <div class="ChatMessage_text">
          Текст цитаты
          <em>с важным приватным уточнением</em>
        </div>
      </div>
    </div>
  `;

  const { document, window } = parseHTML(nestedHtml);
  const targetNode = document.querySelector('[data-test-id="CHATMESSAGE:root"]');

  window.__BOOSTY_CAPTURE_TEST_NODE__ = targetNode;
  const snippetCode = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'capture-boosty-dom.js'), 'utf8');

  const vm = require('node:vm');
  const context = vm.createContext({
    document,
    window,
    console: { log() {}, info() {}, warn() {}, error() {} },
  });
  const result = vm.runInContext(snippetCode, context);

  assert.ok(result?.html, "Snippet should return anonymized html");
  const anonHtml = result.html;

  // 1. All original text fragments must be completely absent
  assert.ok(!anonHtml.includes("Настоящий текст"), "Root text must be removed");
  assert.ok(!anonHtml.includes("секретный вложенный текст"), "Nested span text must be removed");
  assert.ok(!anonHtml.includes("ещё один"), "Intermediate text must be removed");
  assert.ok(!anonHtml.includes("глубоко вложенный текст"), "Deeply nested strong text must be removed");
  assert.ok(!anonHtml.includes("СуперСтример123"), "Author text must be removed");
  assert.ok(!anonHtml.includes("АвторЦитаты"), "Reply author text must be removed");
  assert.ok(!anonHtml.includes("Текст цитаты"), "Reply text must be removed");
  assert.ok(!anonHtml.includes("с важным приватным уточнением"), "Nested em in reply must be removed");
  assert.ok(!anonHtml.includes("https://cdn.boosty.to/private-emoji.png"), "Emoji CDN URL must be removed");

  // 2. All nested tags must be preserved in place
  assert.ok(anonHtml.includes('<span class="nested">'), "Nested span must be preserved");
  assert.ok(anonHtml.includes('<strong>'), "Strong tag must be preserved");
  assert.ok(anonHtml.includes('<em>'), "Em tag must be preserved");
  assert.ok(anonHtml.includes('<span class="badge">'), "Badge span in author must be preserved");
  assert.ok(anonHtml.includes('<span class="role">'), "Role span in reply author must be preserved");

  // 3. Emoji img and alt must be preserved, src safely neutralized
  assert.ok(anonHtml.includes('<img alt="🔥"'), "Img tag and alt attribute must be preserved");
  assert.ok(anonHtml.includes('src="https://example.invalid/emoji.png"'), "Img src must be safe placeholder");
});

