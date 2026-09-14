const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseHTML } = require("linkedom");
const {
  parseBoostyMessage,
  extractAuthor,
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
    text: "Всем привет, отличный стрим!",
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
// 4. Edge Cases & Fallbacks
// ==========================================
test("Boosty Parser: edge cases (null root, empty text, fallback IDs)", () => {
  assert.strictEqual(parseBoostyMessage(null), null);
  assert.strictEqual(extractAuthor(null), "");
  assert.strictEqual(extractText(null), "");
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

