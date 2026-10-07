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

const { validateNormalizedMessage, normalizeIncomingMessage } = require('../core/messages/model.js');
const {
  PRESETS,
  QUICK_PERSONAS,
  MACRO_SCENARIOS,
  buildSyntheticMessage,
  generateBatchMessages,
  createMessageLab,
  resetDeterministicCounter,
} = require('../desktop/chat-monitor/lab.js');
const { createChatMonitorApp, createChatCard } = require('../desktop/chat-monitor/app.js');

function createDomHarness() {
  const { document, window } = parseHTML(htmlContent);
  return { document, window };
}

test('buildSyntheticMessage: constructs valid viewer message', () => {
  const msg = buildSyntheticMessage({
    author: 'ViewerAlice',
    role: null,
    text: 'Привет всем!',
  });

  assert.equal(typeof msg.id, 'string');
  assert.ok(msg.id.startsWith('qa-'), `ID ${msg.id} should start with qa-`);
  assert.equal(msg.author.name, 'ViewerAlice');
  assert.equal(msg.author.role, null);
  assert.equal(msg.text, 'Привет всем!');
  assert.equal(msg.source, 'message_lab');
  assert.equal(msg.qaSynthetic, true);
  assert.equal(typeof msg.receivedAt, 'number');
  assert.equal(typeof msg.publishedAt, 'string');

  const validation = validateNormalizedMessage(msg);
  assert.equal(validation.ok, true, `Validation failed: ${validation.error}`);
});

test('buildSyntheticMessage: constructs moderator and streamer roles', () => {
  const modMsg = buildSyntheticMessage({
    author: 'ModMike',
    role: 'moderator',
    text: 'Сообщение модератора',
  });
  assert.equal(modMsg.author.role, 'moderator');
  assert.equal(validateNormalizedMessage(modMsg).ok, true);

  const streamerMsg = buildSyntheticMessage({
    author: 'Alex_Stream',
    role: 'streamer',
    text: 'Сообщение стримера',
  });
  assert.equal(streamerMsg.author.role, 'streamer');
  assert.equal(validateNormalizedMessage(streamerMsg).ok, true);
});

test('buildSyntheticMessage: creates mention segments and text correctly', () => {
  const msg = buildSyntheticMessage({
    author: 'ViewerBob',
    text: 'Привет @Alex_Stream! Как дела?',
    mention: 'Alex_Stream',
  });

  assert.ok(Array.isArray(msg.segments));
  const mentionSeg = msg.segments.find(s => s.type === 'mention');
  assert.ok(mentionSeg, 'Mention segment should exist');
  assert.equal(mentionSeg.displayName, 'Alex_Stream');
  assert.equal(validateNormalizedMessage(msg).ok, true);
});

test('buildSyntheticMessage: creates reply quote structure', () => {
  const msg = buildSyntheticMessage({
    author: 'ViewerCharlie',
    text: 'Согласен с предыдущим сообщением',
    reply: {
      author: 'ViewerAlice',
      text: 'Отличный стрим!',
    },
  });

  assert.ok(msg.reply);
  assert.equal(msg.reply.author, 'ViewerAlice');
  assert.equal(msg.reply.text, 'Отличный стрим!');
  assert.equal(validateNormalizedMessage(msg).ok, true);
});

test('buildSyntheticMessage: creates custom emoji segments', () => {
  const msg = buildSyntheticMessage({
    author: 'ViewerDave',
    text: 'Смотрите какой стикер',
    customEmoji: {
      url: 'https://boosty.to/emoji/pepe.png',
      alt: ':pepe:',
    },
  });

  assert.ok(Array.isArray(msg.segments));
  const emojiSeg = msg.segments.find(s => s.type === 'emoji');
  assert.ok(emojiSeg);
  assert.equal(emojiSeg.url, 'https://boosty.to/emoji/pepe.png');
  assert.equal(emojiSeg.alt, ':pepe:');
  assert.equal(validateNormalizedMessage(msg).ok, true);
});

test('buildSyntheticMessage: supports broken 404 avatar URLs for fallback testing', () => {
  const msg = buildSyntheticMessage({
    author: 'BrokenAvatarUser',
    text: 'Тест битой аватарки',
    avatar: 'https://invalid.example/broken-404.png',
  });

  assert.equal(msg.author.avatar, 'https://invalid.example/broken-404.png');
  assert.equal(validateNormalizedMessage(msg).ok, true);
});

test('buildSyntheticMessage: deterministic IDs for automated tests', () => {
  resetDeterministicCounter();
  const msg1 = buildSyntheticMessage({ author: 'A', text: '1', deterministic: true });
  const msg2 = buildSyntheticMessage({ author: 'B', text: '2', deterministic: true });

  assert.equal(msg1.id, 'qa-deterministic-1');
  assert.equal(msg2.id, 'qa-deterministic-2');

  resetDeterministicCounter();
  const msg1Again = buildSyntheticMessage({ author: 'A', text: '1', deterministic: true });
  assert.equal(msg1Again.id, 'qa-deterministic-1');
});

test('generateBatchMessages: generates specified count with mixed profiles and valid contracts', () => {
  const batch10 = generateBatchMessages(10);
  assert.equal(batch10.length, 10);

  const ids = new Set();
  for (const msg of batch10) {
    assert.ok(msg.id);
    assert.ok(!ids.has(msg.id), `ID ${msg.id} must be unique`);
    ids.add(msg.id);
    assert.equal(msg.source, 'message_lab');
    assert.equal(msg.qaSynthetic, true);
    const validation = validateNormalizedMessage(msg);
    assert.equal(validation.ok, true, `Invalid message in batch: ${validation.error}`);
  }
});

test('normalizeIncomingMessage: preserves source and qaSynthetic fields', () => {
  const rawLabMsg = {
    id: 'lab-custom-99',
    author: { name: 'LabBot' },
    text: 'Тестовое через POST /message',
    source: 'message_lab',
    qaSynthetic: true,
  };

  const normalized = normalizeIncomingMessage(rawLabMsg);
  assert.equal(normalized.source, 'message_lab');
  assert.equal(normalized.qaSynthetic, true);
});

test('Production Isolation: Message Lab is hidden by default when env flag is unset', async () => {
  const { document, window } = createDomHarness();

  const app = createChatMonitorApp({
    document,
    window,
    isMessageLabEnabled: false,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });

  await app.init();

  const labBtn = document.querySelector('#btn-message-lab');
  assert.ok(labBtn, '#btn-message-lab element exists in DOM');
  assert.equal(labBtn.style.display, 'none');

  const labDrawer = document.querySelector('#message-lab-drawer');
  assert.ok(labDrawer);
  assert.equal(labDrawer.style.display, 'none');

  assert.equal(app.isMessageLabEnabled(), false);
  assert.equal(app.getMessageLab(), null);
});

test('QA Mode: Message Lab is initialized, button is visible, and drawer can be opened', async () => {
  const { document, window } = createDomHarness();

  const app = createChatMonitorApp({
    document,
    window,
    isMessageLabEnabled: true,
    BoostyMessageLab: {
      createMessageLab,
    },
    fetch: async () => ({ ok: true, json: async () => [] }),
  });

  await app.init();

  const labBtn = document.querySelector('#btn-message-lab');
  assert.equal(labBtn.style.display, 'inline-flex');

  const labInstance = app.getMessageLab();
  assert.ok(labInstance, 'Message Lab instance must be created in QA mode');
  assert.equal(labInstance.isOpen(), false);

  labInstance.open();
  assert.equal(labInstance.isOpen(), true);
  assert.ok(document.querySelector('#message-lab-drawer').classList.contains('open'));

  labInstance.close();
  assert.equal(labInstance.isOpen(), false);
  assert.ok(!document.querySelector('#message-lab-drawer').classList.contains('open'));
});

test('createChatCard: renders QA badge when isMessageLabEnabled is true', () => {
  const { document } = createDomHarness();
  global.document = document;

  const syntheticMsg = buildSyntheticMessage({
    author: 'TestSynth',
    text: 'Синтетическое сообщение для проверки бейджа',
  });

  // 1. With isMessageLabEnabled = true
  const cardWithBadge = createChatCard(syntheticMsg, { isMessageLabEnabled: true });
  assert.ok(cardWithBadge.classList.contains('chat-item-qa'));
  const badgeEl = cardWithBadge.querySelector('.badge-qa');
  assert.ok(badgeEl, 'Should render .badge-qa in QA mode');
  assert.equal(badgeEl.textContent, 'QA');

  // 2. With isMessageLabEnabled = false (production mode)
  const cardProd = createChatCard(syntheticMsg, { isMessageLabEnabled: false });
  assert.ok(cardProd.classList.contains('chat-item-qa'));
  const badgeElProd = cardProd.querySelector('.badge-qa');
  assert.equal(badgeElProd, null, 'Should not render .badge-qa in production mode');
});

test('createMessageLab: applyPreset populates composer fields', () => {
  const { document } = createDomHarness();

  const lab = createMessageLab({
    document,
    drawer: document.querySelector('#message-lab-drawer'),
    btnToggle: document.querySelector('#btn-message-lab'),
  });

  const preset = PRESETS.find(p => p.id === 'streamer');
  assert.ok(preset);
  lab.applyPreset(preset);

  assert.equal(document.querySelector('#lab-author').value, 'Alex_Stream');
  assert.equal(document.querySelector('#lab-role').value, 'streamer');
  assert.ok(document.querySelector('#lab-text').value.includes('Alex_Stream') || document.querySelector('#lab-text').value.includes('стрим'));
});

test('createMessageLab: sendSyntheticPayload sends POST /message with correct payload', async () => {
  const { document } = createDomHarness();
  let requestedUrl = null;
  let postedBody = null;

  const mockFetch = async (url, opts) => {
    requestedUrl = url;
    postedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: postedBody }),
    };
  };

  const lab = createMessageLab({
    document,
    drawer: document.querySelector('#message-lab-drawer'),
    btnToggle: document.querySelector('#btn-message-lab'),
    apiOrigin: 'http://127.0.0.1:17369',
    fetch: mockFetch,
  });

  const testPayload = buildSyntheticMessage({
    author: 'FetchTester',
    text: 'Тест через mock fetch',
  });

  const result = await lab.sendSyntheticPayload(testPayload);
  assert.equal(result.ok, true);
  assert.equal(requestedUrl, 'http://127.0.0.1:17369/message');
  assert.equal(postedBody.author.name, 'FetchTester');
  assert.equal(postedBody.source, 'message_lab');
  assert.equal(postedBody.qaSynthetic, true);
});

test('MACRO_SCENARIOS: includes autoscrollDemo scenario and renders button in Message Lab', () => {
  assert.ok(MACRO_SCENARIOS.autoscrollDemo, 'autoscrollDemo macro must exist');
  assert.equal(MACRO_SCENARIOS.autoscrollDemo.name, 'Autoscroll demo');
  assert.equal(typeof MACRO_SCENARIOS.autoscrollDemo.run, 'function');

  const { document } = createDomHarness();
  createMessageLab({
    document,
    drawer: document.querySelector('#message-lab-drawer'),
    btnToggle: document.querySelector('#btn-message-lab'),
  });

  const macroBtns = Array.from(document.querySelectorAll('#lab-scenarios-grid .macro-card-btn'));
  const hasAutoscrollBtn = macroBtns.some(btn => btn.textContent.includes('Автоскролл (демо)') || btn.textContent.includes('Autoscroll demo'));
  assert.equal(hasAutoscrollBtn, true, 'Message Lab scenarios grid must include Autoscroll demo button');
});

test('PRESETS and MACRO_SCENARIOS: include all 8 technical issue presets and 2 tech demo macros', () => {
  const expectedTechPresetIds = [
    'tech_audio_missing',
    'tech_audio_low',
    'tech_audio_high',
    'tech_audio_sync',
    'tech_video_missing',
    'tech_stream_freeze',
    'tech_stream_lag',
    'tech_quality',
  ];

  for (const presetId of expectedTechPresetIds) {
    const found = PRESETS.find((p) => p.id === presetId);
    assert.ok(found, `Preset ${presetId} must exist in PRESETS`);
  }

  assert.ok(MACRO_SCENARIOS.techIssueDemo, 'techIssueDemo macro must exist');
  assert.equal(MACRO_SCENARIOS.techIssueDemo.name, 'Tech issue demo');
  assert.equal(typeof MACRO_SCENARIOS.techIssueDemo.run, 'function');

  assert.ok(MACRO_SCENARIOS.techFalsePositiveDemo, 'techFalsePositiveDemo macro must exist');
  assert.equal(MACRO_SCENARIOS.techFalsePositiveDemo.name, 'Tech false-positive demo');
  assert.equal(typeof MACRO_SCENARIOS.techFalsePositiveDemo.run, 'function');
});

test('MACRO_SCENARIOS: includes userContextDemo and userContextLongHistory macros and drawer mutex', async () => {
  assert.ok(MACRO_SCENARIOS.userContextDemo, 'userContextDemo macro must exist');
  assert.equal(MACRO_SCENARIOS.userContextDemo.name, 'User context demo');
  assert.equal(typeof MACRO_SCENARIOS.userContextDemo.run, 'function');

  assert.ok(MACRO_SCENARIOS.userContextLongHistory, 'userContextLongHistory macro must exist');
  assert.equal(MACRO_SCENARIOS.userContextLongHistory.name, 'User context long history');
  assert.equal(typeof MACRO_SCENARIOS.userContextLongHistory.run, 'function');

  // Verify userContextDemo sequence
  const sentDemo = [];
  await MACRO_SCENARIOS.userContextDemo.run(async (msg) => {
    sentDemo.push(msg);
  });
  assert.ok(sentDemo.length >= 7, `Expected at least 7 messages in userContextDemo, got ${sentDemo.length}`);
  const aliceMsgs = sentDemo.filter(m => m.author.name === 'ViewerAlice');
  assert.ok(aliceMsgs.length >= 4, 'ViewerAlice must have multiple messages');
  assert.ok(aliceMsgs.some(m => m.segments?.some(s => s.type === 'mention')), 'Must have a mention message');
  assert.ok(aliceMsgs.some(m => m.reply), 'Must have a reply message');
  assert.ok(aliceMsgs.some(m => m.text.includes('звук пропал')), 'Must have a tech issue message');

  // Verify userContextLongHistory
  const sentLong = [];
  await MACRO_SCENARIOS.userContextLongHistory.run(async (msg) => {
    sentLong.push(msg);
  });
  assert.equal(sentLong.length, 20, 'Expected 20 messages in userContextLongHistory');
  assert.ok(sentLong.every(m => m.author.name === 'ViewerAlice'));

  // Verify drawer mutex: opening lab drawer calls monitorApp.closeUserContext
  const { document } = createDomHarness();
  let userContextClosed = false;
  const lab = createMessageLab({
    document,
    drawer: document.querySelector('#message-lab-drawer'),
    btnToggle: document.querySelector('#btn-message-lab'),
    monitorApp: {
      closeUserContext: () => {
        userContextClosed = true;
      },
    },
  });

  lab.open();
  assert.equal(userContextClosed, true, 'Opening lab drawer must call monitorApp.closeUserContext');
  lab.close();
});
