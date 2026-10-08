'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const { createChatMonitorApp } = require('../desktop/chat-monitor/app.js');

const htmlContent = fs.readFileSync(
  path.join(__dirname, '..', 'desktop', 'chat-monitor', 'index.html'),
  'utf8'
);

function createDomHarness() {
  const { document, window: win } = parseHTML(htmlContent);
  global.document = document;
  global.window = win;
  return { document, window: win };
}

test('Chat Monitor History: initial load requests up to 1000 messages from /history', async () => {
  const { document, window: win } = createDomHarness();
  let requestedUrl = null;

  const mockMessages = [];
  for (let i = 1; i <= 20; i++) {
    mockMessages.push({
      id: `hist-${i}`,
      author: { name: `User ${i}` },
      text: `History message ${i}`,
      receivedAt: Date.now() + i,
    });
  }

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async (url) => {
      requestedUrl = url;
      if (url.includes('/history')) {
        return { ok: true, json: async () => mockMessages };
      }
      return { ok: true, json: async () => [] };
    },
  });

  await app.init();

  assert.ok(requestedUrl && requestedUrl.includes('limit=1000'), 'Initial history fetch must request limit=1000');
  const chatCards = document.querySelectorAll('.chat-item');
  assert.strictEqual(chatCards.length, 20, 'All 20 history messages must be rendered in DOM');
});

test('Chat Monitor History: DOM cap of 500 limits rendered cards while protecting performance', async () => {
  const { document, window: win } = createDomHarness();

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async () => ({ ok: true, json: async () => [] }),
  });

  await app.init();

  // Feed 520 messages
  for (let i = 1; i <= 520; i++) {
    app.handleIncomingMessage({
      id: `live-dom-${i}`,
      author: { name: `Author ${i}` },
      text: `Live text ${i}`,
      receivedAt: Date.now() + i,
    });
  }

  const cards = document.querySelectorAll('.chat-item');
  assert.strictEqual(cards.length, 500, 'DOM cards strictly capped at 500');
  assert.strictEqual(cards[0].getAttribute('data-message-id'), 'live-dom-21', 'First 20 cards evicted FIFO');
  assert.strictEqual(cards[499].getAttribute('data-message-id'), 'live-dom-520', 'Latest card is live-dom-520');
});

test('Chat Monitor History: Clear Screen (clearView) empties DOM only; Delete History (deleteHistory) deletes from server', async () => {
  const { document, window: win } = createDomHarness();
  let deleteCalled = false;

  const initialBatch = [
    { id: 'm-1', author: 'A', text: 'Text 1' },
    { id: 'm-2', author: 'B', text: 'Text 2' },
  ];

  const app = createChatMonitorApp({
    document,
    window: win,
    fetch: async (url, opts = {}) => {
      if (url.includes('/history') && opts.method === 'DELETE') {
        deleteCalled = true;
        return { ok: true, json: async () => ({ ok: true, deleted: 2 }) };
      }
      if (url.includes('/history')) {
        return { ok: true, json: async () => initialBatch };
      }
      return { ok: true, json: async () => [] };
    },
  });

  await app.init();
  assert.strictEqual(document.querySelectorAll('.chat-item').length, 2);

  // 1. Clear Screen only
  app.clearView();
  assert.strictEqual(document.querySelectorAll('.chat-item').length, 0, 'DOM cards emptied');
  assert.strictEqual(deleteCalled, false, 'DELETE /history must NOT be called on clear screen');

  // Re-append a message to verify monitor still works
  app.handleIncomingMessage({ id: 'm-3', author: 'C', text: 'Text 3' });
  assert.strictEqual(document.querySelectorAll('.chat-item').length, 1);

  // 2. Delete History
  await app.deleteHistory(true); // force without confirm dialog
  assert.strictEqual(deleteCalled, true, 'DELETE /history must be called on delete history');
  assert.strictEqual(document.querySelectorAll('.chat-item').length, 0, 'DOM cards emptied after history delete');
});
