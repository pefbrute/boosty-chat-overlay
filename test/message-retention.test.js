'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createMessageHistory } = require('../core/messages/history.js');
const { defaultConfig } = require('../core/config/defaults.js');
const { normalizeConfig } = require('../core/config/schema.js');

test('Message Retention: default config has maxMessages 10 and durationSeconds 0', () => {
  assert.strictEqual(defaultConfig.maxMessages, 10, 'Default messages on screen must be 10');
  assert.strictEqual(defaultConfig.durationSeconds, 0, 'Auto-hide must be OFF (0) by default');

  const normalized = normalizeConfig({});
  assert.strictEqual(normalized.maxMessages, 10, 'Normalized default maxMessages must be 10');
  assert.strictEqual(normalized.durationSeconds, 0, 'Normalized default durationSeconds must be 0');
});

test('Message Retention: overlay queue preserves last 10 messages with FIFO eviction of 11th', () => {
  // Simulates overlay message manager logic
  const maxMessages = 10;
  const activeMessages = [];
  const cardsByEventId = new Map();

  function receiveMessage(msg) {
    activeMessages.push(msg);
    cardsByEventId.set(String(msg.eventId), { id: msg.id, text: msg.text });

    // FIFO eviction when exceeding maxMessages
    while (activeMessages.length > maxMessages) {
      const oldest = activeMessages.shift();
      cardsByEventId.delete(String(oldest.eventId));
    }
  }

  // Push 10 messages
  for (let i = 1; i <= 10; i++) {
    receiveMessage({ id: `msg-${i}`, eventId: String(i), text: `Hello ${i}` });
  }

  assert.strictEqual(activeMessages.length, 10, 'Must have 10 active messages');
  assert.strictEqual(activeMessages[0].id, 'msg-1', 'First active is msg-1');
  assert.strictEqual(activeMessages[9].id, 'msg-10', 'Tenth active is msg-10');
  assert.strictEqual(cardsByEventId.has('1'), true);

  // Push 11th message
  receiveMessage({ id: 'msg-11', eventId: '11', text: 'Hello 11' });

  assert.strictEqual(activeMessages.length, 10, 'Still 10 messages after 11th arrives');
  assert.strictEqual(activeMessages[0].id, 'msg-2', 'Oldest msg-1 evicted, now msg-2 is first');
  assert.strictEqual(activeMessages[9].id, 'msg-11', 'Latest is msg-11');
  assert.strictEqual(cardsByEventId.has('1'), false, 'msg-1 removed from active map');
  assert.strictEqual(cardsByEventId.has('11'), true, 'msg-11 present in active map');
});

test('Message Retention: persistent disk history survives restarts and restores up to 1000 messages', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-hist-'));
  const storageFile = path.join(tmpDir, 'chat-history.json');

  try {
    // 1. Initial history store
    const history1 = createMessageHistory({ maxHistory: 1000, storageFile, debounceMs: 0 });

    for (let i = 1; i <= 25; i++) {
      history1.add({
        id: `m-${i}`,
        author: { name: `Author ${i}` },
        text: `Message content ${i}`,
        receivedAt: Date.now() + i,
      });
    }

    history1.flush();
    assert.strictEqual(history1.size(), 25);
    assert.ok(fs.existsSync(storageFile), 'History file must be written to disk');

    // 2. Restart simulation: create fresh instance pointing to same file
    const history2 = createMessageHistory({ maxHistory: 1000, storageFile, debounceMs: 0 });
    assert.strictEqual(history2.size(), 25, 'Restarted history must restore all 25 messages');

    const allRestored = history2.getAll();
    assert.strictEqual(allRestored[0].id, 'm-1');
    assert.strictEqual(allRestored[allRestored.length - 1].id, 'm-25');

    // Verify next eventId continues monotonically
    const added = history2.add({ id: 'm-26', author: { name: 'Author 26' }, text: 'New message' });
    assert.strictEqual(Number(added.eventId), 26, 'EventId sequence must continue from 25 -> 26');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Message Retention: disk history ring buffer caps at 1000 messages', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-cap-'));
  const storageFile = path.join(tmpDir, 'capped-history.json');

  try {
    const history = createMessageHistory({ maxHistory: 1000, storageFile, debounceMs: 0 });

    // Add 1050 messages
    for (let i = 1; i <= 1050; i++) {
      history.add({
        id: `cap-${i}`,
        author: { name: `Author ${i}` },
        text: `Test text ${i}`,
      });
    }

    history.flush();
    assert.strictEqual(history.size(), 1000, 'Must cap at exactly 1000 messages');

    const all = history.getAll();
    assert.strictEqual(all[0].id, 'cap-51', 'Oldest messages 1-50 evicted');
    assert.strictEqual(all[all.length - 1].id, 'cap-1050', 'Latest message is cap-1050');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
