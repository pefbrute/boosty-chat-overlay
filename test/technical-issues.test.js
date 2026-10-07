'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONFIDENCE,
  SEVERITY,
  SEVERITY_LABELS,
  normalizeIssueText,
  classifyTechnicalIssue,
  computeSeverity,
  formatAlertSummary,
  createTechnicalIssueAggregator,
} = require('../desktop/chat-monitor/technical-issues.js');

// =========================================================================
// 1. Normalization Tests (Section 4 & 22)
// =========================================================================

test('normalizeIssueText: lowercases, trims, collapses spaces, strips punctuation, converts ё -> е without mutating input', () => {
  assert.equal(normalizeIssueText('  НЕТ ЗВУКА!!! '), 'нет звука');
  assert.equal(normalizeIssueText('ЧЁРНЫЙ   ЭКРАН...?!'), 'черный экран');
  assert.equal(normalizeIssueText('Звук   отстаёт,   ребята!'), 'звук отстает ребята');
  assert.equal(normalizeIssueText('ОРЁТ!!!'), 'орет');
  assert.equal(normalizeIssueText(''), '');
  assert.equal(normalizeIssueText(null), '');
});

// =========================================================================
// 2. Positive Classification across all 8 Categories (Section 3 & 22)
// =========================================================================

test('classifyTechnicalIssue: detects audio_missing (HIGH and MEDIUM)', () => {
  const c1 = classifyTechnicalIssue('нет звука');
  assert.equal(c1.isTechnicalIssue, true);
  assert.equal(c1.type, 'audio_missing');
  assert.equal(c1.confidence, CONFIDENCE.HIGH);
  assert.equal(c1.shouldHighlight, true);

  const c2 = classifyTechnicalIssue('не слышно');
  assert.equal(c2.isTechnicalIssue, true);
  assert.equal(c2.type, 'audio_missing');
  assert.equal(c2.confidence, CONFIDENCE.HIGH);

  const c3 = classifyTechnicalIssue('звук пропал');
  assert.equal(c3.isTechnicalIssue, true);
  assert.equal(c3.type, 'audio_missing');
  assert.equal(c3.confidence, CONFIDENCE.HIGH);

  const c4 = classifyTechnicalIssue('без звука сидим');
  assert.equal(c4.isTechnicalIssue, true);
  assert.equal(c4.type, 'audio_missing');
  assert.equal(c4.confidence, CONFIDENCE.HIGH);
});

test('classifyTechnicalIssue: detects audio_low (HIGH, MEDIUM, LOW)', () => {
  const med = classifyTechnicalIssue('звук очень тихий');
  assert.equal(med.isTechnicalIssue, true);
  assert.equal(med.type, 'audio_low');
  assert.equal(med.confidence, CONFIDENCE.MEDIUM);
  assert.equal(med.shouldHighlight, true);

  const high = classifyTechnicalIssue('прибавь звук пожалуйста');
  assert.equal(high.isTechnicalIssue, true);
  assert.equal(high.type, 'audio_low');
  assert.equal(high.confidence, CONFIDENCE.HIGH);

  const low = classifyTechnicalIssue('тихо');
  assert.equal(low.isTechnicalIssue, true);
  assert.equal(low.type, 'audio_low');
  assert.equal(low.confidence, CONFIDENCE.LOW);
  assert.equal(low.shouldHighlight, false, 'LOW confidence single word should not highlight standalone');
});

test('classifyTechnicalIssue: detects audio_high', () => {
  const c1 = classifyTechnicalIssue('слишком громко');
  assert.equal(c1.isTechnicalIssue, true);
  assert.equal(c1.type, 'audio_high');
  assert.equal(c1.confidence, CONFIDENCE.HIGH);

  const c2 = classifyTechnicalIssue('звук очень громкий');
  assert.equal(c2.isTechnicalIssue, true);
  assert.equal(c2.type, 'audio_high');
  assert.equal(c2.confidence, CONFIDENCE.HIGH);

  const c3 = classifyTechnicalIssue('орёт');
  assert.equal(c3.isTechnicalIssue, true);
  assert.equal(c3.type, 'audio_high');
  assert.equal(c3.confidence, CONFIDENCE.LOW);
});

test('classifyTechnicalIssue: detects audio_sync', () => {
  const c1 = classifyTechnicalIssue('звук отстаёт');
  assert.equal(c1.isTechnicalIssue, true);
  assert.equal(c1.type, 'audio_sync');
  assert.equal(c1.confidence, CONFIDENCE.HIGH);

  const c2 = classifyTechnicalIssue('рассинхрон');
  assert.equal(c2.isTechnicalIssue, true);
  assert.equal(c2.type, 'audio_sync');
  assert.equal(c2.confidence, CONFIDENCE.HIGH);

  const c3 = classifyTechnicalIssue('звук раньше видео');
  assert.equal(c3.isTechnicalIssue, true);
  assert.equal(c3.type, 'audio_sync');
  assert.equal(c3.confidence, CONFIDENCE.HIGH);

  const c4 = classifyTechnicalIssue('звук позже видео');
  assert.equal(c4.isTechnicalIssue, true);
  assert.equal(c4.type, 'audio_sync');
  assert.equal(c4.confidence, CONFIDENCE.HIGH);
});

test('classifyTechnicalIssue: detects video_missing', () => {
  const c1 = classifyTechnicalIssue('чёрный экран');
  assert.equal(c1.isTechnicalIssue, true);
  assert.equal(c1.type, 'video_missing');
  assert.equal(c1.confidence, CONFIDENCE.HIGH);

  const c2 = classifyTechnicalIssue('нет картинки');
  assert.equal(c2.isTechnicalIssue, true);
  assert.equal(c2.type, 'video_missing');
  assert.equal(c2.confidence, CONFIDENCE.HIGH);

  const c3 = classifyTechnicalIssue('видео пропало');
  assert.equal(c3.isTechnicalIssue, true);
  assert.equal(c3.type, 'video_missing');
  assert.equal(c3.confidence, CONFIDENCE.HIGH);
});

test('classifyTechnicalIssue: detects stream_freeze', () => {
  const c1 = classifyTechnicalIssue('стрим завис');
  assert.equal(c1.isTechnicalIssue, true);
  assert.equal(c1.type, 'stream_freeze');
  assert.equal(c1.confidence, CONFIDENCE.HIGH);

  const c2 = classifyTechnicalIssue('зависло');
  assert.equal(c2.isTechnicalIssue, true);
  assert.equal(c2.type, 'stream_freeze');
  assert.equal(c2.confidence, CONFIDENCE.LOW);
  assert.equal(c2.shouldHighlight, false);

  const c3 = classifyTechnicalIssue('фризит');
  assert.equal(c3.isTechnicalIssue, true);
  assert.equal(c3.type, 'stream_freeze');
  assert.equal(c3.confidence, CONFIDENCE.LOW);
  assert.equal(c3.shouldHighlight, false);

  const c4 = classifyTechnicalIssue('стрим фризит жестко');
  assert.equal(c4.isTechnicalIssue, true);
  assert.equal(c4.type, 'stream_freeze');
  assert.equal(c4.confidence, CONFIDENCE.MEDIUM);
  assert.equal(c4.shouldHighlight, true);
});

test('classifyTechnicalIssue: detects stream_lag', () => {
  const c1 = classifyTechnicalIssue('стрим лагает');
  assert.equal(c1.isTechnicalIssue, true);
  assert.equal(c1.type, 'stream_lag');
  assert.equal(c1.confidence, CONFIDENCE.MEDIUM);
  assert.equal(c1.shouldHighlight, true);

  const c2 = classifyTechnicalIssue('лагает');
  assert.equal(c2.isTechnicalIssue, true);
  assert.equal(c2.type, 'stream_lag');
  assert.equal(c2.confidence, CONFIDENCE.LOW);
  assert.equal(c2.shouldHighlight, false);

  const c3 = classifyTechnicalIssue('тормозит');
  assert.equal(c3.isTechnicalIssue, true);
  assert.equal(c3.type, 'stream_lag');
  assert.equal(c3.confidence, CONFIDENCE.LOW);
});

test('classifyTechnicalIssue: detects quality', () => {
  const c1 = classifyTechnicalIssue('качество упало');
  assert.equal(c1.isTechnicalIssue, true);
  assert.equal(c1.type, 'quality');
  assert.equal(c1.confidence, CONFIDENCE.HIGH);

  const c2 = classifyTechnicalIssue('картинка рассыпается');
  assert.equal(c2.isTechnicalIssue, true);
  assert.equal(c2.type, 'quality');
  assert.equal(c2.confidence, CONFIDENCE.HIGH);

  const c3 = classifyTechnicalIssue('качество мыло на экране');
  assert.equal(c3.isTechnicalIssue, true);
  assert.equal(c3.type, 'quality');
  assert.equal(c3.confidence, CONFIDENCE.MEDIUM);

  const c4 = classifyTechnicalIssue('пиксели');
  assert.equal(c4.isTechnicalIssue, true);
  assert.equal(c4.type, 'quality');
  assert.equal(c4.confidence, CONFIDENCE.LOW);
});

// =========================================================================
// 3. False Positive Exclusions (Section 6 & 22)
// =========================================================================

test('classifyTechnicalIssue: filters out false positives and non-stream contexts', () => {
  const falsePositives = [
    'в этом видео нет звука',
    'у героя тихо голос',
    'там по сюжету экран чёрный',
    'персонаж лагает',
    'в игре всё тормозит',
    'у меня на телефоне звук пропал',
    'у меня интернет тормозит',
    'привет всем на стриме!',
    'отличный момент, вообще топ',
  ];

  for (const sample of falsePositives) {
    const res = classifyTechnicalIssue(sample);
    assert.equal(
      res.isTechnicalIssue,
      false,
      `Expected "${sample}" NOT to be classified as technicalIssue, got type=${res.type}`
    );
    assert.equal(res.shouldHighlight, false);
  }
});

test('classifyTechnicalIssue: does not mutate original message object', () => {
  const msg = {
    id: 'immutable-1',
    author: { name: 'Viewer' },
    text: '  НЕТ ЗВУКА!!! ',
  };
  const res = classifyTechnicalIssue(msg);
  assert.equal(res.isTechnicalIssue, true);
  assert.equal(msg.text, '  НЕТ ЗВУКА!!! ', 'Original message.text must not be mutated');
});

// =========================================================================
// 4. Aggregation & Multi-User Escalation Tests (Section 8–12 & 23)
// =========================================================================

test('Aggregation Case A: 1 user -> possible (no sticky banner)', () => {
  const agg = createTechnicalIssueAggregator({ windowMs: 30000 });
  const t0 = 1000000;

  const state = agg.ingest(
    { id: 'm1', author: { name: 'UserA' }, text: 'нет звука' },
    null,
    t0
  );

  assert.ok(state.group);
  assert.equal(state.group.count, 1);
  assert.equal(state.group.uniqueUsers, 1);
  assert.equal(state.group.severity, SEVERITY.POSSIBLE);
  assert.equal(state.activeAlert, null, 'Single user should not trigger sticky alert banner');
});

test('Aggregation Case B: 2 different users within 30s -> probable (sticky banner shown)', () => {
  const agg = createTechnicalIssueAggregator({ windowMs: 30000 });
  const t0 = 1000000;

  agg.ingest({ id: 'm1', author: { name: 'UserA' }, text: 'нет звука' }, null, t0);
  const state = agg.ingest({ id: 'm2', author: { name: 'UserB' }, text: 'звук пропал' }, null, t0 + 5000);

  assert.ok(state.activeAlert, '2 unique users within 30s must trigger sticky alert');
  assert.equal(state.activeAlert.type, 'audio_missing');
  assert.equal(state.activeAlert.severity, SEVERITY.PROBABLE);
  assert.equal(state.activeAlert.severityLabel, SEVERITY_LABELS[SEVERITY.PROBABLE]);
  assert.equal(state.activeAlert.uniqueUsers, 2);
  assert.equal(state.activeAlert.count, 2);
  assert.ok(state.activeAlert.summary.includes('Нет звука'));
  assert.ok(state.activeAlert.summary.includes('2 сообщения от 2 зрителей'));
});

test('Aggregation Case C: 3 different users within 30s -> critical', () => {
  const agg = createTechnicalIssueAggregator({ windowMs: 30000 });
  const t0 = 1000000;

  agg.ingest({ id: 'm1', author: { name: 'UserA' }, text: 'нет звука' }, null, t0);
  agg.ingest({ id: 'm2', author: { name: 'UserB' }, text: 'звук пропал' }, null, t0 + 4000);
  const state = agg.ingest({ id: 'm3', author: { name: 'UserC' }, text: 'не слышно' }, null, t0 + 9000);

  assert.ok(state.activeAlert);
  assert.equal(state.activeAlert.type, 'audio_missing');
  assert.equal(state.activeAlert.severity, SEVERITY.CRITICAL);
  assert.equal(state.activeAlert.severityLabel, SEVERITY_LABELS[SEVERITY.CRITICAL]);
  assert.equal(state.activeAlert.uniqueUsers, 3);
  assert.equal(state.activeAlert.count, 3);
});

test('Aggregation Case D: 3 messages from the SAME user -> NOT critical (stays 1 unique user)', () => {
  const agg = createTechnicalIssueAggregator({ windowMs: 30000 });
  const t0 = 1000000;

  agg.ingest({ id: 'm1', author: { name: 'Spammer' }, text: 'нет звука' }, null, t0);
  agg.ingest({ id: 'm2', author: { name: 'Spammer' }, text: 'звук пропал' }, null, t0 + 2000);
  const state = agg.ingest({ id: 'm3', author: { name: 'Spammer' }, text: 'не слышно вообще' }, null, t0 + 4000);

  assert.ok(state.group);
  assert.equal(state.group.count, 3);
  assert.equal(state.group.uniqueUsers, 1);
  assert.equal(state.group.severity, SEVERITY.POSSIBLE);
  assert.equal(state.activeAlert, null, '1 unique user spamming 3 times must NOT trigger critical/probable alert');
});

test('Aggregation Case E: messages outside 30s window do not inflate uniqueUsers', () => {
  const agg = createTechnicalIssueAggregator({ windowMs: 30000, decayMs: 75000 });
  const t0 = 1000000;

  agg.ingest({ id: 'm1', author: { name: 'UserA' }, text: 'нет звука' }, null, t0);
  // 35 seconds later (> 30s window)
  const state = agg.ingest({ id: 'm2', author: { name: 'UserB' }, text: 'звук пропал' }, null, t0 + 35000);

  assert.ok(state.group);
  assert.equal(state.group.uniqueUsers, 1, 'UserA is outside the 30s rolling window');
  assert.equal(state.group.severity, SEVERITY.POSSIBLE);
  assert.equal(state.activeAlert, null);
});

test('Aggregation Case F: dismiss cooldown suppresses same severity for 60s, but escalates if severity increases', () => {
  const agg = createTechnicalIssueAggregator({ windowMs: 30000, cooldownMs: 60000 });
  const t0 = 1000000;

  agg.ingest({ id: 'm1', author: { name: 'UserA' }, text: 'нет звука' }, null, t0);
  agg.ingest({ id: 'm2', author: { name: 'UserB' }, text: 'звук пропал' }, null, t0 + 2000);
  assert.equal(agg.getActiveAlert(t0 + 2000).severity, SEVERITY.PROBABLE);

  // Streamer clicks "Скрыть" (dismiss) at t0 + 3000
  agg.dismiss('audio_missing', t0 + 3000);
  assert.equal(agg.getActiveAlert(t0 + 3000), null);

  // Another message from UserB (still 2 unique users = PROBABLE) at t0 + 10000 -> stays suppressed
  const afterSameSeverity = agg.ingest(
    { id: 'm3', author: { name: 'UserB' }, text: 'звук пропал совсем' },
    null,
    t0 + 10000
  );
  assert.equal(afterSameSeverity.activeAlert, null, 'Same severity within 60s cooldown must stay dismissed');

  // 3rd unique user (UserC) arrives at t0 + 12000 -> severity escalates to CRITICAL -> breaks cooldown!
  const afterEscalation = agg.ingest(
    { id: 'm4', author: { name: 'UserC' }, text: 'не слышно' },
    null,
    t0 + 12000
  );
  assert.ok(afterEscalation.activeAlert, 'Severity escalation from PROBABLE to CRITICAL must re-show alert');
  assert.equal(afterEscalation.activeAlert.severity, SEVERITY.CRITICAL);
  assert.equal(afterEscalation.activeAlert.uniqueUsers, 3);
  assert.equal(afterEscalation.activeAlert.count, 4);
});

test('Aggregation Case G: decay removes active alert after 75s of silence', () => {
  const agg = createTechnicalIssueAggregator({ windowMs: 30000, decayMs: 75000 });
  const t0 = 1000000;

  agg.ingest({ id: 'm1', author: { name: 'UserA' }, text: 'стрим завис' }, null, t0);
  agg.ingest({ id: 'm2', author: { name: 'UserB' }, text: 'фризит' }, null, t0 + 3000);
  agg.ingest({ id: 'm3', author: { name: 'UserC' }, text: 'зависло' }, null, t0 + 5000);

  assert.equal(agg.getActiveAlert(t0 + 5000).severity, SEVERITY.CRITICAL);

  // After 76s of silence from lastSeen (t0 + 5000 + 76000)
  assert.equal(agg.getActiveAlert(t0 + 81000), null, 'Alert must decay after 75s without new reports');
  assert.equal(agg.getAllGroups(t0 + 81000).length, 0);
});

test('formatAlertSummary: formats Russian pluralization accurately', () => {
  assert.equal(formatAlertSummary({ type: 'audio_missing', count: 4, uniqueUsers: 3 }), 'Нет звука — 4 сообщения от 3 зрителей');
  assert.equal(formatAlertSummary({ type: 'audio_sync', count: 2, uniqueUsers: 2 }), 'Рассинхрон — 2 сообщения от 2 зрителей');
  assert.equal(formatAlertSummary({ type: 'video_missing', count: 5, uniqueUsers: 5 }), 'Нет изображения — 5 сообщений от 5 зрителей');
  assert.equal(computeSeverity(0), SEVERITY.NONE);
  assert.equal(computeSeverity(1), SEVERITY.POSSIBLE);
  assert.equal(computeSeverity(2), SEVERITY.PROBABLE);
  assert.equal(computeSeverity(3), SEVERITY.CRITICAL);
});
