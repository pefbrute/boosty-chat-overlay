'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStreamStopGuardrails } = require('../scripts/live-e2e/stream.js');

test('Stream Cleanup Guardrails: QA title + matching runId allows stream stop', () => {
  const runId = 'live-20261004-abc123';
  const stream = {
    runId,
    title: `[QA] Boosty Chat Overlay ${runId}`,
    createdByRunner: true,
    url: 'https://boosty.to/beautiful_foot/streams/video_stream',
  };

  const result = validateStreamStopGuardrails(stream, runId);
  assert.strictEqual(result.ok, true, 'Guardrail should allow stopping matching QA stream');
  assert.strictEqual(result.reason, undefined);
});

test('Stream Cleanup Guardrails: non-QA title is refused', () => {
  const runId = 'live-20261004-abc123';
  const stream = {
    runId,
    title: `My Real Public Stream ${runId}`,
    createdByRunner: true,
    url: 'https://boosty.to/beautiful_foot/streams/video_stream',
  };

  const result = validateStreamStopGuardrails(stream, runId);
  assert.strictEqual(result.ok, false, 'Non-QA stream must be refused');
  assert.ok(result.reason.includes('does not start with [QA]'));
});

test('Stream Cleanup Guardrails: wrong runId is refused', () => {
  const currentRunId = 'live-current-run-111';
  const stream = {
    runId: 'live-old-run-222',
    title: '[QA] Boosty Chat Overlay live-old-run-222',
    createdByRunner: true,
    url: 'https://boosty.to/beautiful_foot/streams/video_stream',
  };

  const result = validateStreamStopGuardrails(stream, currentRunId);
  assert.strictEqual(result.ok, false, 'Stream with mismatched runId must be refused');
  assert.ok(result.reason.includes('does not match currentRunId'));
});

test('Stream Cleanup Guardrails: createdByRunner=false is refused', () => {
  const runId = 'live-20261004-abc123';
  const stream = {
    runId,
    title: `[QA] Boosty Chat Overlay ${runId}`,
    createdByRunner: false,
    url: 'https://boosty.to/beautiful_foot/streams/video_stream',
  };

  const result = validateStreamStopGuardrails(stream, runId);
  assert.strictEqual(result.ok, false, 'Stream not created by runner must be refused');
  assert.ok(result.reason.includes('createdByRunner !== true'));
});

test('Stream Cleanup Guardrails: title missing runId is refused', () => {
  const runId = 'live-20261004-abc123';
  const stream = {
    runId,
    title: '[QA] Generic Boosty Stream',
    createdByRunner: true,
    url: 'https://boosty.to/beautiful_foot/streams/video_stream',
  };

  const result = validateStreamStopGuardrails(stream, runId);
  assert.strictEqual(result.ok, false, 'Stream title without matching runId must be refused');
  assert.ok(result.reason.includes('does not contain runId'));
});
