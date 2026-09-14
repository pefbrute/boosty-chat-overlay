'use strict';

const FIXTURE_MESSAGES = {
  standard: [
    {
      id: 'audit-msg-1',
      author: 'Алексей',
      text: 'Привет! Проверка обычного сообщения',
      avatar: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42"><rect width="42" height="42" fill="%234A90E2"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold" font-size="20">А</text></svg>',
      timestamp: Date.now() - 15000,
      receivedAt: Date.now() - 15000,
    },
    {
      id: 'audit-msg-2',
      author: 'Streamer_123',
      text: '🔥 Отличный стрим! 🚀🎉',
      avatar: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42"><rect width="42" height="42" fill="%23F5A623"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold" font-size="20">S</text></svg>',
      timestamp: Date.now() - 10000,
      receivedAt: Date.now() - 10000,
    },
    {
      id: 'audit-msg-3',
      author: 'Михаил_Без_Аватара',
      text: 'Сообщение без аватара для проверки верстки',
      avatar: '',
      timestamp: Date.now() - 5000,
      receivedAt: Date.now() - 5000,
    },
  ],

  stress: [
    {
      id: 'audit-stress-1',
      author: 'ОченьДлинноеИмяПользователя123456789',
      text: 'Проверка очень длинного имени пользователя и поведения контейнера автора',
      avatar: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42"><rect width="42" height="42" fill="%239013FE"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold" font-size="20">Д</text></svg>',
      timestamp: Date.now() - 25000,
      receivedAt: Date.now() - 25000,
    },
    {
      id: 'audit-stress-2',
      author: 'Мария',
      text: 'Длинное сообщение для проверки переноса текста и поведения карточки при большом объеме текста в несколько строк. Текст должен аккуратно оборачиваться без переполнения и артефактов!',
      avatar: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42"><rect width="42" height="42" fill="%23E02020"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold" font-size="20">М</text></svg>',
      timestamp: Date.now() - 20000,
      receivedAt: Date.now() - 20000,
    },
    {
      id: 'audit-stress-3',
      author: 'CodeMaster',
      text: 'English test with symbols & numbers: #12345, testing max-messages card stack overflow resistance!',
      avatar: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42"><rect width="42" height="42" fill="%2350E3C2"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold" font-size="20">C</text></svg>',
      timestamp: Date.now() - 15000,
      receivedAt: Date.now() - 15000,
    },
    {
      id: 'audit-stress-4',
      author: 'Anon',
      text: '🚀🔥🎉✨🏆',
      avatar: '',
      timestamp: Date.now() - 10000,
      receivedAt: Date.now() - 10000,
    },
    {
      id: 'audit-stress-5',
      author: 'Владимир',
      text: 'Финальное сообщение в пачке сообщений стресс-теста.',
      avatar: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42"><rect width="42" height="42" fill="%23F8E71C"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="black" font-family="sans-serif" font-weight="bold" font-size="20">В</text></svg>',
      timestamp: Date.now() - 5000,
      receivedAt: Date.now() - 5000,
    },
  ],
};

const FIXTURE_BROWSERS = [
  { id: 'brave', name: 'Brave' },
  { id: 'chrome', name: 'Google Chrome' },
  { id: 'yandex', name: 'Yandex Browser' },
];

const FIXTURE_OBS_SCENES = {
  connected: [
    { sceneUuid: 'scene-1', sceneName: 'Основная сцена', hasChat: true, sceneItemEnabled: true },
    { sceneUuid: 'scene-2', sceneName: 'Общение с чатом', hasChat: false, sceneItemEnabled: true },
    { sceneUuid: 'scene-3', sceneName: 'Игра', hasChat: true, sceneItemEnabled: true },
  ],
  unconfigured: [
    { sceneUuid: 'scene-1', sceneName: 'Основная сцена', hasChat: false, sceneItemEnabled: true },
    { sceneUuid: 'scene-2', sceneName: 'Только стрим', hasChat: false, sceneItemEnabled: true },
  ],
};

module.exports = {
  FIXTURE_MESSAGES,
  FIXTURE_BROWSERS,
  FIXTURE_OBS_SCENES,
};
