'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');

const {
  TECHNICAL_ISSUE_TYPES,
  SEVERITY_LABELS,
  SEVERITY_LABELS_UPPER,
  ROLE_LABELS,
  CONNECTION_STATUS_LABELS,
  UPDATE_STATUS_LABELS,
  OBS_ERROR_MESSAGES,
  pluralize,
  formatPlural,
  getTechnicalIssueLabel,
  getSeverityLabel,
  getRoleLabel,
  getConnectionStatusLabel,
  getUpdateStatusLabel,
  getObsErrorMessage,
} = require('../core/i18n/ru.js');

const {
  createChatMonitorApp,
  createChatCard,
  formatMessageTime,
} = require('../desktop/chat-monitor/app.js');

const FORBIDDEN_RAW_SLUGS = [
  'audio_missing',
  'audio_low',
  'audio_high',
  'audio_sync',
  'video_missing',
  'stream_freeze',
  'stream_lag',
  'quality',
];

test('i18n: technical issue categories are fully mapped to canonical Russian names', () => {
  const expectedMapping = {
    audio_missing: 'Нет звука',
    audio_low: 'Слишком тихо',
    audio_high: 'Слишком громко',
    audio_sync: 'Рассинхрон',
    video_missing: 'Нет изображения',
    stream_freeze: 'Стрим завис',
    stream_lag: 'Лагает',
    quality: 'Проблемы с качеством',
  };

  for (const [key, label] of Object.entries(expectedMapping)) {
    assert.equal(TECHNICAL_ISSUE_TYPES[key], label, `Slug ${key} must map to ${label}`);
    assert.equal(getTechnicalIssueLabel(key), label, `getTechnicalIssueLabel("${key}") must return ${label}`);
  }
});

test('i18n: unknown or missing tech issue slug returns user-friendly Russian fallback', () => {
  assert.equal(getTechnicalIssueLabel('unknown_hardware_bug'), 'Техническая проблема');
  assert.equal(getTechnicalIssueLabel(null), 'Техническая проблема');
  assert.equal(getTechnicalIssueLabel(''), 'Техническая проблема');
  assert.equal(getTechnicalIssueLabel(undefined), 'Техническая проблема');
  // Custom fallback
  assert.equal(getTechnicalIssueLabel('unknown', 'Кастомная ошибка'), 'Кастомная ошибка');
});

test('i18n: Russian pluralization operates correctly for 1, 2, 5, 21, 25', () => {
  const forms = ['сообщение', 'сообщения', 'сообщений'];
  assert.equal(pluralize(1, forms), 'сообщение');
  assert.equal(pluralize(2, forms), 'сообщения');
  assert.equal(pluralize(3, forms), 'сообщения');
  assert.equal(pluralize(4, forms), 'сообщения');
  assert.equal(pluralize(5, forms), 'сообщений');
  assert.equal(pluralize(11, forms), 'сообщений');
  assert.equal(pluralize(14, forms), 'сообщений');
  assert.equal(pluralize(20, forms), 'сообщений');
  assert.equal(pluralize(21, forms), 'сообщение');
  assert.equal(pluralize(22, forms), 'сообщения');
  assert.equal(pluralize(25, forms), 'сообщений');

  assert.equal(formatPlural(1, forms), '1 сообщение');
  assert.equal(formatPlural(2, forms), '2 сообщения');
  assert.equal(formatPlural(5, forms), '5 сообщений');
  assert.equal(formatPlural(21, forms), '21 сообщение');
  assert.equal(formatPlural(25, forms), '25 сообщений');

  const viewerForms = ['зритель', 'зрителя', 'зрителей'];
  assert.equal(formatPlural(1, viewerForms), '1 зритель');
  assert.equal(formatPlural(2, viewerForms), '2 зрителя');
  assert.equal(formatPlural(5, viewerForms), '5 зрителей');
  assert.equal(formatPlural(21, viewerForms), '21 зритель');
});

test('i18n: severities, roles, and connection statuses are fully localized in Russian', () => {
  assert.equal(getSeverityLabel('none'), '');
  assert.equal(getSeverityLabel('possible'), 'Возможная проблема');
  assert.equal(getSeverityLabel('probable'), 'Вероятная проблема');
  assert.equal(getSeverityLabel('critical'), 'Критично');

  assert.equal(SEVERITY_LABELS_UPPER.possible, 'ВОЗМОЖНАЯ ПРОБЛЕМА');
  assert.equal(SEVERITY_LABELS_UPPER.probable, 'ВЕРОЯТНАЯ ПРОБЛЕМА');
  assert.equal(SEVERITY_LABELS_UPPER.critical, 'КРИТИЧНО');

  assert.equal(getRoleLabel('streamer'), 'Стример');
  assert.equal(getRoleLabel('moderator'), 'Модератор');
  assert.equal(getRoleLabel('user'), 'Зритель');
  assert.equal(getRoleLabel('viewer'), 'Зритель');
  assert.equal(getRoleLabel('unknown_role'), 'Зритель');

  assert.equal(getConnectionStatusLabel('connected'), 'Подключено');
  assert.equal(getConnectionStatusLabel('connecting'), 'Подключение…');
  assert.equal(getConnectionStatusLabel('disconnected'), 'Отключено');
  assert.equal(getConnectionStatusLabel('error'), 'Ошибка');
});

test('i18n: OBS errors map to clear Russian explanations', () => {
  assert.equal(getObsErrorMessage('CONNECTION_REFUSED'), 'OBS недоступен. Убедитесь, что OBS Studio запущен');
  assert.equal(getObsErrorMessage('AUTHENTICATION_FAILED'), 'Не удалось авторизоваться в OBS');
  assert.equal(getObsErrorMessage('NOT_CONNECTED'), 'Нет подключения к OBS Studio');
  assert.equal(getObsErrorMessage('SCENE_NOT_FOUND'), 'Сцена не найдена в OBS');
  // Unknown falls back to generic message
  assert.equal(getObsErrorMessage('UNKNOWN_CODE'), 'Не удалось подключиться к OBS');
});

test('DOM audit: rendered chat cards never leak raw tech issue slugs to textContent', () => {
  const htmlContent = fs.readFileSync(
    path.join(__dirname, '..', 'desktop', 'chat-monitor', 'index.html'),
    'utf8'
  );
  const { document, window } = parseHTML(htmlContent);
  global.document = document;
  global.window = window;

  for (const slug of FORBIDDEN_RAW_SLUGS) {
    const msg = {
      id: `msg-${slug}`,
      author: { name: 'User1', role: 'user' },
      text: 'жалоба на стрим',
      technicalIssue: true,
      technicalIssueType: slug,
      technicalIssueConfidence: 'HIGH',
      receivedAt: Date.now(),
    };

    const card = createChatCard(msg);
    const visibleText = card.textContent;

    for (const forbidden of FORBIDDEN_RAW_SLUGS) {
      assert.equal(
        visibleText.includes(forbidden),
        false,
        `Rendered chat card for ${slug} must not contain raw slug "${forbidden}" in textContent. Found in: "${visibleText}"`
      );
    }

    const badge = card.querySelector('.badge-tech-issue');
    assert.ok(badge, `Card for ${slug} should render a badge-tech-issue`);
    const badgeLabel = badge.querySelector('.badge-label').textContent;
    assert.equal(badgeLabel, TECHNICAL_ISSUE_TYPES[slug]);
  }
});

test('DOM audit: chat-monitor index.html and desktop index.html do not leak raw slugs in static markup', () => {
  const chatMonitorHtml = fs.readFileSync(
    path.join(__dirname, '..', 'desktop', 'chat-monitor', 'index.html'),
    'utf8'
  );
  const desktopHtml = fs.readFileSync(
    path.join(__dirname, '..', 'desktop', 'index.html'),
    'utf8'
  );

  // In HTML templates, raw slugs shouldn't appear as visible button/option text
  assert.equal(chatMonitorHtml.includes('>Mod<'), false, 'Should not have >Mod< button text');
  assert.equal(chatMonitorHtml.includes('Обычный (User)'), false, 'Should not have User English slug in select');
  assert.equal(desktopHtml.includes('Stream Overlay</span>'), false, 'Desktop index subtitle should be localized');
});
