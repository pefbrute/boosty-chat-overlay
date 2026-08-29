const v8 = require('node:v8');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT_DIR = path.join(__dirname, '..', '..');

// Test 1: server.js recentMessageIds Map leak test
function testServerMessageMapRetention() {
  console.log('--- TEST 1: Server recentMessageIds Map Retention & Scaling ---');
  const recentMessageIds = new Map();
  function rememberMessage(id, now) {
    for (const [knownId, seenAt] of recentMessageIds) {
      if (now - seenAt > 10 * 60_000) recentMessageIds.delete(knownId);
    }
    if (recentMessageIds.has(id)) return false;
    recentMessageIds.set(id, now);
    return true;
  }

  if (global.gc) global.gc();
  const initialHeap = process.memoryUsage().heapUsed;

  // Insert 2,000 messages spaced across 5 minutes (within 10m window)
  let t = 1000000;
  for (let i = 0; i < 2000; i++) {
    t += 150; // 150ms between msgs
    rememberMessage(`msg-${i}-${Math.random()}`, t);
  }
  const sizeAt5Min = recentMessageIds.size;

  // Advance time by 11 minutes (t + 11*60*1000) and send 1 message -> triggers purge
  t += 11 * 60 * 1000;
  const purgeStart = performance.now();
  rememberMessage(`msg-after-11m`, t);
  const purgeDurationMs = performance.now() - purgeStart;
  const sizeAfterPurge = recentMessageIds.size;

  if (global.gc) global.gc();
  const finalHeap = process.memoryUsage().heapUsed;

  return {
    test: 'recentMessageIds Map Retention',
    messagesSimulated: 2000,
    sizeAt5Min,
    sizeAfter11MinPurge: sizeAfterPurge,
    purgeExecutionTimeMs: purgeDurationMs.toFixed(3),
    heapGrowthBytes: finalHeap - initialHeap,
    finding: sizeAfterPurge === 1 
      ? 'Map correctly evicts expired items on subsequent message, but eviction is O(N) iteration on each message. If no message arrives, items remain indefinitely.'
      : 'Map failed to evict'
  };
}

// Test 2: Overlay Removal Timers & DOM Reference Retention
function testOverlayRemovalTimerMap() {
  console.log('--- TEST 2: Overlay removalTimers Map Key Retention ---');
  // Replicate removalTimers logic
  const removalTimers = new Map();
  let clearedCount = 0;

  function mockCard(id) {
    return { id, classList: { contains: () => false, add: () => {} }, remove: () => {} };
  }

  function scheduleRemoval(card, seconds) {
    if (seconds <= 0) return;
    const existing = removalTimers.get(card);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      removalTimers.delete(card);
      clearedCount++;
    }, 10);
    removalTimers.set(card, timer);
  }

  for (let i = 0; i < 500; i++) {
    const card = mockCard(i);
    scheduleRemoval(card, 0.01);
  }

  const mapSizeBefore = removalTimers.size;
  return new Promise((resolve) => {
    setTimeout(() => {
      const mapSizeAfter = removalTimers.size;
      resolve({
        test: 'Overlay removalTimers Map',
        cardsScheduled: 500,
        mapSizeBefore,
        mapSizeAfter,
        clearedCount,
        finding: mapSizeAfter === 0 
          ? 'Timers correctly deleted from Map after removal callback.'
          : 'Warning: Leaked timer entries remain in Map!'
      });
    }, 50);
  });
}

// Test 3: userMutationQueue Promise Chain Retention
function testPromiseQueueRetention() {
  console.log('--- TEST 3: Desktop main.js userMutationQueue Chaining ---');
  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;

  let userMutationQueue = Promise.resolve();
  function enqueueUserMutation(task) {
    const next = userMutationQueue.catch(() => {}).then(() => task());
    userMutationQueue = next.catch(() => {});
    return next;
  }

  // Enqueue 1,000 tasks
  const tasks = [];
  for (let i = 0; i < 1000; i++) {
    tasks.push(enqueueUserMutation(async () => {
      return { ok: true, i };
    }));
  }

  return Promise.all(tasks).then(() => {
    if (global.gc) global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const diffMb = ((heapAfter - heapBefore) / 1024 / 1024).toFixed(3);
    return {
      test: 'userMutationQueue Promise Chaining (1000 operations)',
      heapBeforeMb: (heapBefore / 1024 / 1024).toFixed(2),
      heapAfterMb: (heapAfter / 1024 / 1024).toFixed(2),
      netHeapGrowthMb: diffMb,
      finding: Math.abs(Number(diffMb)) < 0.5 
        ? 'Promise queue does not retain resolved closures in V8.'
        : 'Potential promise closure retention observed.'
    };
  });
}

async function run() {
  console.log('=== MEMORY LEAK & RETENTION ANALYSIS ===\n');

  const res1 = testServerMessageMapRetention();
  console.log(JSON.stringify(res1, null, 2));
  console.log();

  const res2 = await testOverlayRemovalTimerMap();
  console.log(JSON.stringify(res2, null, 2));
  console.log();

  const res3 = await testPromiseQueueRetention();
  console.log(JSON.stringify(res3, null, 2));
}

run().catch(console.error);
