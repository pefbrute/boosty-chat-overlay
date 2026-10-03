const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageHistory } = require('../core/messages/history.js');

test('createMessageHistory assigns eventId and limits capacity', () => {
  const history = createMessageHistory({ maxHistory: 3 });

  const m1 = history.add({ id: 'msg-1', text: 'Hello 1' });
  assert.equal(m1.eventId, '1');
  assert.equal(typeof m1.receivedAt, 'number');
  assert.equal(history.size(), 1);

  const m2 = history.add({ id: 'msg-2', text: 'Hello 2' });
  const m3 = history.add({ id: 'msg-3', text: 'Hello 3' });
  assert.equal(m2.eventId, '2');
  assert.equal(m3.eventId, '3');
  assert.equal(history.size(), 3);

  // Exceed capacity
  const m4 = history.add({ id: 'msg-4', text: 'Hello 4' });
  assert.equal(history.size(), 3);
  const all = history.getAll();
  assert.deepEqual(all.map(m => m.id), ['msg-2', 'msg-3', 'msg-4']);
});

test('createMessageHistory getAfterEventId replay logic', () => {
  const history = createMessageHistory({ maxHistory: 10 });
  history.add({ id: 'msg-1', text: '1' });
  history.add({ id: 'msg-2', text: '2' });
  history.add({ id: 'msg-3', text: '3' });
  history.add({ id: 'msg-4', text: '4' });

  // No last-event-id -> all
  assert.equal(history.getAfterEventId(null).length, 4);
  assert.equal(history.getAfterEventId('').length, 4);

  // Numeric last-event-id
  const after2 = history.getAfterEventId('2');
  assert.deepEqual(after2.map(m => m.id), ['msg-3', 'msg-4']);

  const after4 = history.getAfterEventId('4');
  assert.equal(after4.length, 0);

  // Custom string last-event-id
  const customHistory = createMessageHistory();
  customHistory.add({ id: 'c1', eventId: 'alpha' });
  customHistory.add({ id: 'c2', eventId: 'beta' });
  customHistory.add({ id: 'c3', eventId: 'gamma' });

  const afterBeta = customHistory.getAfterEventId('beta');
  assert.deepEqual(afterBeta.map(m => m.id), ['c3']);
});
