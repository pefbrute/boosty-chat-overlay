const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageDedup } = require('../core/messages/dedup.js');

test('createMessageDedup filters immediate duplicates', () => {
  const dedup = createMessageDedup({ ttlMs: 5000 });
  const t0 = 10000;

  assert.equal(dedup.remember('msg-1', t0), true);
  assert.equal(dedup.remember('msg-1', t0 + 100), false);
  assert.equal(dedup.remember('msg-2', t0 + 200), true);
  assert.equal(dedup.size(), 2);
});

test('createMessageDedup expires items past TTL', () => {
  const dedup = createMessageDedup({ ttlMs: 5000 });
  const t0 = 10000;

  dedup.remember('msg-1', t0);
  dedup.remember('msg-2', t0 + 1000);

  // At t0 + 5001, msg-1 is expired, msg-2 is still valid
  assert.equal(dedup.remember('msg-2', t0 + 5001), false);
  assert.equal(dedup.remember('msg-1', t0 + 5001), true); // re-accepted!

  // At t0 + 10000, all prior expired
  assert.equal(dedup.remember('msg-3', t0 + 10000), true);
  assert.equal(dedup.has('msg-2'), false);
});
