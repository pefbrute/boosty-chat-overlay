'use strict';

/**
 * Boosty Chat Monitor — Message Lab / QA Composer
 * Local synthetic scenario generator for manual QA and testing.
 * Compatible with Node.js and Browser environments.
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.BoostyMessageLab = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  'use strict';

  let syntheticCounter = 1;
  let deterministicSequence = 1;

  const QUICK_PERSONAS = [
    { name: 'ViewerAlice', role: null, avatar: null },
    { name: 'ViewerBob', role: null, avatar: null },
    { name: 'ModMike', role: 'moderator', avatar: null },
    { name: 'Alex_Stream', role: 'streamer', avatar: null },
  ];

  const PRESETS = [
    {
      id: 'normal_viewer',
      label: 'Обычный зритель',
      desc: 'Приветствие без спец-статусов',
      author: 'ViewerAlice',
      role: null,
      text: 'Всем отличного стрима и хорошего настроения! 🎮',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'moderator',
      label: 'Модератор',
      desc: 'Сообщение с бейджем щита',
      author: 'ModMike',
      role: 'moderator',
      text: 'Напоминаю правила чата: без спама и ненормативной лексики.',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'streamer',
      label: 'Стример',
      desc: 'Сообщение с золотым бейджем',
      author: 'Alex_Stream',
      role: 'streamer',
      text: 'Всем привет! Спасибо, что заглянули, сегодня плотный стрим.',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'mention',
      label: 'Упоминание',
      desc: 'Сообщение с @Alex_Stream',
      author: 'ViewerBob',
      role: null,
      text: 'Привет @Alex_Stream! Как настройка нового оверлея?',
      avatar: null,
      mention: 'Alex_Stream',
      reply: null,
    },
    {
      id: 'reply',
      label: 'Ответ (цитата)',
      desc: 'Цитата предыдущего сообщения',
      author: 'ViewerCharlie',
      role: null,
      text: 'Да, полностью согласен с этим мнением!',
      avatar: null,
      mention: '',
      reply: {
        author: 'ViewerAlice',
        text: 'Всем отличного стрима и хорошего настроения!',
      },
    },
    {
      id: 'mention_reply',
      label: 'Упоминание + Ответ',
      desc: 'Комбинированный хайлайт',
      author: 'ProMod',
      role: 'moderator',
      text: 'Ответ @Alex_Stream: чат модерируется, дропов нет.',
      avatar: null,
      mention: 'Alex_Stream',
      reply: {
        author: 'Alex_Stream',
        text: 'Модераторы на месте? Как битрейт?',
      },
    },
    {
      id: 'long_username',
      label: 'Длинный ник',
      desc: 'Сверхдлинное имя без пробелов',
      author: 'SuperMegaUltraLongNicknameWithoutAnySpacesToTestWordBreakConstraint123456789',
      role: null,
      text: 'Проверка переноса длинного ника без горизонтального скролла.',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'long_message',
      label: 'Длинный текст',
      desc: 'Многострочное подробное сообщение',
      author: 'StoryTeller',
      role: null,
      text: 'Это очень длинное и подробное сообщение для проверки автоматического переноса строк в карточке чата. Оно должно красиво разбиваться по словам, не вылезать за пределы контейнера, сохранять комфортный межстрочный интервал и не ломать верстку стримерского окна.',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'custom_emoji',
      label: 'Кастомный эмодзи',
      desc: 'Эмодзи через безопасный URL',
      author: 'EmojiFan',
      role: null,
      text: 'Стрим просто огонь ',
      customEmoji: {
        url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text y="20" font-size="20">🔥</text></svg>',
        alt: ':boosty_fire:',
        id: ':boosty_fire:',
      },
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'broken_avatar',
      label: 'Битый аватар',
      desc: 'Проверка фоллбека инициала при 404',
      author: 'BrokenAvatarUser',
      role: null,
      text: 'У этого сообщения аватар возвращает ошибку 404, проверяем fallback.',
      avatar: 'https://invalid.example/broken-avatar-404.png',
      mention: '',
      reply: null,
    },
    {
      id: 'emoji_heavy',
      label: 'Много эмодзи',
      desc: 'Набор юникод-символов',
      author: 'HypeTrain',
      role: null,
      text: '🔥🔥🔥 GG WP 🎮🎮🎮 Легендарный момент! 🚀❤️👍',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'multiline',
      label: 'Многострочное',
      desc: 'Текст с переносами строк \\n',
      author: 'NotesUser',
      role: null,
      text: 'План трансляции:\n1. Разминка и новости\n2. Сюжетное прохождение\n3. Кооператив со зрителями\n4. Итоги и розыгрыш',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'tech_audio_missing',
      label: 'Нет звука',
      desc: 'Техпроблема: пропал звук',
      author: 'ViewerAlice',
      role: null,
      text: 'Нет звука',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'tech_audio_low',
      label: 'Тихо',
      desc: 'Техпроблема: тихий звук',
      author: 'ViewerBob',
      role: null,
      text: 'Звук очень тихий',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'tech_audio_high',
      label: 'Слишком громко',
      desc: 'Техпроблема: громкий звук',
      author: 'ViewerCharlie',
      role: null,
      text: 'Слишком громко',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'tech_audio_sync',
      label: 'Рассинхрон',
      desc: 'Техпроблема: звук отстаёт',
      author: 'ViewerDave',
      role: null,
      text: 'Рассинхрон, звук отстаёт',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'tech_video_missing',
      label: 'Чёрный экран',
      desc: 'Техпроблема: нет изображения',
      author: 'ViewerEve',
      role: null,
      text: 'Чёрный экран',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'tech_stream_freeze',
      label: 'Стрим завис',
      desc: 'Техпроблема: стрим встал',
      author: 'ViewerFrank',
      role: null,
      text: 'Стрим завис',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'tech_stream_lag',
      label: 'Лагает',
      desc: 'Техпроблема: стрим лагает',
      author: 'ViewerGrace',
      role: null,
      text: 'Стрим лагает',
      avatar: null,
      mention: '',
      reply: null,
    },
    {
      id: 'tech_quality',
      label: 'Качество упало',
      desc: 'Техпроблема: проблемы с качеством',
      author: 'ViewerHenry',
      role: null,
      text: 'Качество упало',
      avatar: null,
      mention: '',
      reply: null,
    },
  ];

  /**
   * Resets deterministic sequence counter for test suites.
   */
  function resetDeterministicCounter(start = 1) {
    deterministicSequence = start;
  }

  /**
   * Validates options and builds a canonical Synthetic Message payload.
   *
   * @param {object} options
   * @returns {object} Canonical message payload ready for POST /message
   */
  function buildSyntheticMessage(options = {}) {
    const isDeterministic = Boolean(options.deterministic);
    const id = options.id || (isDeterministic
      ? `qa-deterministic-${deterministicSequence++}`
      : `qa-lab-${Date.now()}-${syntheticCounter++}`);

    const authorName = typeof options.author === 'string'
      ? options.author.trim()
      : (options.author && typeof options.author.name === 'string'
        ? options.author.name.trim()
        : 'TestUser');

    if (!authorName) {
      throw new Error('Имя автора не может быть пустым');
    }

    const rawRole = options.role || (options.author && options.author.role);
    const validRole = (rawRole === 'streamer' || rawRole === 'moderator') ? rawRole : null;

    const rawAvatar = typeof options.avatar === 'string' ? options.avatar.trim() : null;

    let text = typeof options.text === 'string' ? options.text.trim() : '';

    // Build structured segments if mention or custom emoji are present
    let segments = null;
    const hasMention = typeof options.mention === 'string' && options.mention.trim().length > 0;
    const hasCustomEmoji = options.customEmoji && typeof options.customEmoji.url === 'string';

    if (hasMention || hasCustomEmoji) {
      segments = [];
      const mentionName = hasMention ? options.mention.trim().replace(/^@+/, '') : '';

      if (hasMention) {
        const mentionPattern = `@${mentionName}`;
        if (text.includes(mentionPattern)) {
          const parts = text.split(mentionPattern);
          for (let i = 0; i < parts.length; i++) {
            if (parts[i]) {
              segments.push({ type: 'text', text: parts[i] });
            }
            if (i < parts.length - 1) {
              segments.push({ type: 'mention', displayName: mentionName, userId: null });
            }
          }
        } else {
          if (text) segments.push({ type: 'text', text: `${text} ` });
          segments.push({ type: 'mention', displayName: mentionName, userId: null });
        }
      } else if (text) {
        segments.push({ type: 'text', text });
      }

      if (hasCustomEmoji) {
        const alt = options.customEmoji.alt || options.customEmoji.id || ':emoji:';
        segments.push({
          type: 'emoji',
          url: options.customEmoji.url.trim(),
          alt,
          id: options.customEmoji.id || alt,
        });
      }
    }

    if (!text && (!segments || segments.length === 0)) {
      throw new Error('Текст сообщения не может быть пустым');
    }

    // Build Reply
    let reply = null;
    if (options.reply && typeof options.reply === 'object') {
      const replyAuthor = typeof options.reply.author === 'string' ? options.reply.author.trim() : '';
      const replyText = typeof options.reply.text === 'string' ? options.reply.text.trim() : '';
      if (replyAuthor || replyText) {
        reply = { author: replyAuthor, text: replyText };
      }
    }

    // Published timestamp calculation
    let publishedAt = null;
    const now = Date.now();
    if (options.timestampMode === '+1m') {
      const d = new Date(now + 60000);
      publishedAt = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    } else if (options.timestampMode === '-5m') {
      const d = new Date(now - 300000);
      publishedAt = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    } else if (options.timestampMode === 'manual' && typeof options.customTimestamp === 'string' && options.customTimestamp.trim()) {
      publishedAt = options.customTimestamp.trim();
    } else if (isDeterministic) {
      publishedAt = '19:00:00';
    } else {
      const d = new Date(now);
      publishedAt = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }

    return {
      id,
      platform: 'boosty',
      author: {
        name: authorName,
        role: validRole,
        avatar: rawAvatar || null,
      },
      text,
      segments: segments && segments.length > 0 ? segments : null,
      reply,
      publishedAt,
      receivedAt: typeof options.receivedAt === 'number' && options.receivedAt > 0 ? options.receivedAt : now,
      source: 'message_lab',
      qaSynthetic: true,
    };
  }

  /**
   * Generates a batch of diverse synthetic messages for stress and volume testing.
   *
   * @param {number} count Number of messages to generate (clamped to 100)
   * @param {object} [options]
   * @returns {Array<object>}
   */
  function generateBatchMessages(count = 10, options = {}) {
    const total = Math.min(Math.max(1, count), 100);
    const messages = [];
    const isDeterministic = Boolean(options.deterministic);
    const pool = PRESETS.filter(p => !p.id.startsWith('tech_'));

    for (let i = 0; i < total; i++) {
      const presetIndex = i % pool.length;
      const preset = pool[presetIndex];
      const seqNum = i + 1;

      const msg = buildSyntheticMessage({
        deterministic: isDeterministic,
        id: isDeterministic ? `qa-batch-${deterministicSequence++}` : undefined,
        author: `${preset.author}_${seqNum}`,
        role: preset.role,
        text: `${preset.text} [#${seqNum}]`,
        avatar: preset.avatar,
        mention: preset.mention,
        reply: preset.reply ? {
          author: preset.reply.author,
          text: `${preset.reply.text} [#${seqNum}]`,
        } : null,
        customEmoji: preset.customEmoji,
      });

      messages.push(msg);
    }

    return messages;
  }

  /**
   * Macro scenario runner definitions.
   */
  const MACRO_SCENARIOS = {
    attentionDemo: {
      name: 'Attention demo',
      title: 'Демо внимания',
      desc: 'Цепочка: обычное → mention → reply → mention+reply → mod → streamer',
      run: async (sendFn) => {
        const sequence = [
          PRESETS.find(p => p.id === 'normal_viewer'),
          PRESETS.find(p => p.id === 'mention'),
          PRESETS.find(p => p.id === 'reply'),
          PRESETS.find(p => p.id === 'mention_reply'),
          PRESETS.find(p => p.id === 'moderator'),
          PRESETS.find(p => p.id === 'streamer'),
        ];
        for (const preset of sequence) {
          if (!preset) continue;
          await sendFn(buildSyntheticMessage(preset));
          await new Promise(r => setTimeout(r, 120));
        }
      },
    },

    techIssueDemo: {
      name: 'Tech issue demo',
      title: 'Демо техпроблем',
      desc: 'Агрегация: 3 жалобы на звук + 2 на рассинхрон',
      run: async (sendFn) => {
        const sequence = [
          { author: 'ViewerGamer', text: 'Всем отличного стрима и хорошего настроения! 🎮' },
          { author: 'ViewerAlice', text: 'нет звука' },
          { author: 'ViewerBob', text: 'я тоже не слышу' },
          { author: 'ViewerCharlie', text: 'звук пропал' },
          { author: 'ViewerMax', text: 'О, интересный момент на экране!' },
          { author: 'ViewerDave', text: 'рассинхрон' },
          { author: 'ViewerEve', text: 'тоже звук отстаёт' },
        ];
        for (const item of sequence) {
          await sendFn(buildSyntheticMessage(item));
          await new Promise(r => setTimeout(r, 120));
        }
      },
    },

    techFalsePositiveDemo: {
      name: 'Tech false-positive demo',
      title: 'Ложные срабатывания (демо)',
      desc: 'Контекст игры/видео/телефона без ложного critical alert',
      run: async (sendFn) => {
        const sequence = [
          { author: 'ViewerAlice', text: 'у меня на телефоне нет звука' },
          { author: 'ViewerBob', text: 'в этом видео звук тихий' },
          { author: 'ViewerCharlie', text: 'персонаж лагает' },
          { author: 'ViewerDave', text: 'там по сюжету чёрный экран' },
          { author: 'ViewerEve', text: 'у меня интернет тормозит' },
        ];
        for (const item of sequence) {
          await sendFn(buildSyntheticMessage(item));
          await new Promise(r => setTimeout(r, 120));
        }
      },
    },

    stressDemo: {
      name: 'Stress demo (25)',
      title: 'Стресс-тест (25)',
      desc: 'Пакет из 25 разнородных сообщений с интервалом 60мс',
      run: async (sendFn) => {
        const batch = generateBatchMessages(25);
        for (const msg of batch) {
          await sendFn(msg);
          await new Promise(r => setTimeout(r, 60));
        }
      },
    },

    burstPaused: {
      name: 'Burst while paused',
      title: 'Пачка на паузе',
      desc: 'Пауза → 10 сообщений в очередь → возобновление',
      run: async (sendFn, context = {}) => {
        if (context.monitorApp && typeof context.monitorApp.pause === 'function') {
          context.monitorApp.pause();
        }
        const batch = generateBatchMessages(10);
        for (const msg of batch) {
          await sendFn(msg);
          await new Promise(r => setTimeout(r, 40));
        }
        await new Promise(r => setTimeout(r, 400));
        if (context.monitorApp && typeof context.monitorApp.resume === 'function') {
          context.monitorApp.resume();
        }
      },
    },

    unreadDemo: {
      name: 'Unread demo',
      title: 'Непрочитанные (демо)',
      desc: '5 сообщений с паузой 350мс для проверки бейджей непрочитанных',
      run: async (sendFn) => {
        const items = [
          PRESETS.find(p => p.id === 'mention'),
          PRESETS.find(p => p.id === 'reply'),
          PRESETS.find(p => p.id === 'mention_reply'),
          PRESETS.find(p => p.id === 'normal_viewer'),
          PRESETS.find(p => p.id === 'moderator'),
        ];
        for (const item of items) {
          if (!item) continue;
          await sendFn(buildSyntheticMessage(item));
          await new Promise(r => setTimeout(r, 350));
        }
      },
    },

    autoscrollDemo: {
      name: 'Autoscroll demo',
      title: 'Автоскролл (демо)',
      desc: '15 сообщений с интервалом 250мс для наблюдения за автопрокруткой',
      run: async (sendFn) => {
        const batch = generateBatchMessages(15);
        for (const msg of batch) {
          await sendFn(msg);
          await new Promise(r => setTimeout(r, 250));
        }
      },
    },

    userContextDemo: {
      name: 'User context demo',
      title: 'Контекст пользователя (демо)',
      desc: 'Диалог ViewerAlice (обычные, mention, reply, tech issue) + ViewerBob + ModMike',
      run: async (sendFn) => {
        const sequence = [
          { author: 'ViewerAlice', text: 'Всем привет! Как дела на стриме?' },
          { author: 'ViewerBob', text: 'Привет Алиса! Всё отлично.' },
          { author: 'ViewerAlice', text: '@Alex_Stream какую игру планируешь дальше проходить?', mention: 'Alex_Stream' },
          { author: 'ModMike', role: 'moderator', text: 'В расписании указано в описании стрима.' },
          { author: 'ViewerAlice', text: 'Спасибо за подсказку!', reply: { author: 'ModMike', text: 'В расписании указано в описании стрима.' } },
          { author: 'ViewerBob', text: 'Графика сегодня на высоте!' },
          { author: 'ViewerAlice', text: 'Ой, звук пропал' },
          { author: 'ViewerAlice', text: 'А нет, показалось, это в игре тишина была)' },
        ];
        for (const item of sequence) {
          await sendFn(buildSyntheticMessage(item));
          await new Promise(r => setTimeout(r, 120));
        }
      },
    },

    userContextLongHistory: {
      name: 'User context long history',
      title: 'Контекст: много сообщений',
      desc: '20 сообщений от ViewerAlice для проверки пагинации (+10) и скролла',
      run: async (sendFn) => {
        for (let i = 1; i <= 20; i++) {
          const item = {
            author: 'ViewerAlice',
            text: `Сообщение #${i} от Алисы для проверки истории контекста`,
          };
          if (i === 5) {
            item.mention = 'Alex_Stream';
            item.text = `@Alex_Stream сообщение #${i} с упоминанием`;
          } else if (i === 10) {
            item.reply = { author: 'ModMike', text: 'Предыдущее сообщение' };
            item.text = `Ответ на вопрос #${i}`;
          } else if (i === 15) {
            item.text = `нет звука сообщение #${i}`;
          }
          await sendFn(buildSyntheticMessage(item));
          await new Promise(r => setTimeout(r, 40));
        }
      },
    },
  };

  /**
   * Initializes the interactive Message Lab UI drawer inside the given DOM.
   *
   * @param {object} options
   */
  function createMessageLab(options = {}) {
    const documentObj = options.document || (typeof document !== 'undefined' ? document : null);
    if (!documentObj) return null;

    const apiOrigin = options.apiOrigin || (typeof root !== 'undefined' && root?.boostyMonitor?.apiOrigin ? root.boostyMonitor.apiOrigin : 'http://127.0.0.1:17369');
    const fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    const monitorApp = options.monitorApp || null;

    // Elements
    const drawer = options.drawer || documentObj.querySelector('#message-lab-drawer');
    const btnToggle = options.btnToggle || documentObj.querySelector('#btn-message-lab');
    const btnClose = options.btnClose || documentObj.querySelector('#btn-lab-close');
    const statusText = options.statusText || documentObj.querySelector('#lab-status-text');

    // Tabs
    const tabBtns = options.tabBtns || documentObj.querySelectorAll('.lab-nav-btn');
    const tabPanels = options.tabPanels || documentObj.querySelectorAll('.lab-tab-panel');

    // Form inputs
    const inputAuthor = options.inputAuthor || documentObj.querySelector('#lab-author');
    const selectRole = options.selectRole || documentObj.querySelector('#lab-role');
    const textareaText = options.textareaText || documentObj.querySelector('#lab-text');
    const inputMention = options.inputMention || documentObj.querySelector('#lab-mention');
    const selectReplyMode = options.selectReplyMode || documentObj.querySelector('#lab-reply-mode');
    const selectReplyHistory = options.selectReplyHistory || documentObj.querySelector('#lab-reply-history');
    const inputReplyAuthor = options.inputReplyAuthor || documentObj.querySelector('#lab-reply-author');
    const inputReplyText = options.inputReplyText || documentObj.querySelector('#lab-reply-text');
    const inputEmojiUrl = options.inputEmojiUrl || documentObj.querySelector('#lab-emoji-url');
    const inputEmojiAlt = options.inputEmojiAlt || documentObj.querySelector('#lab-emoji-alt');
    const inputAvatar = options.inputAvatar || documentObj.querySelector('#lab-avatar');
    const selectTimestamp = options.selectTimestamp || documentObj.querySelector('#lab-timestamp-mode');
    const inputCustomTimestamp = options.inputCustomTimestamp || documentObj.querySelector('#lab-custom-timestamp');
    const btnSend = options.btnSend || documentObj.querySelector('#btn-lab-send');
    const inlineError = options.inlineError || documentObj.querySelector('#lab-inline-error');

    let isOpen = false;

    function setStatus(text, isError = false) {
      if (!statusText) return;
      statusText.textContent = text;
      statusText.className = isError ? 'lab-status-text status-error' : 'lab-status-text status-ok';
      setTimeout(() => {
        if (statusText) statusText.textContent = '';
      }, 4000);
    }

    function setError(msg) {
      if (inlineError) {
        inlineError.textContent = msg || '';
        inlineError.style.display = msg ? 'block' : 'none';
      }
    }

    function openDrawer() {
      if (monitorApp && typeof monitorApp.closeUserContext === 'function') {
        monitorApp.closeUserContext();
      }
      isOpen = true;
      if (drawer) {
        drawer.style.display = 'flex';
        void drawer.offsetHeight;
        drawer.classList.add('open');
      }
      if (btnToggle) {
        btnToggle.classList.add('active');
        btnToggle.setAttribute('aria-expanded', 'true');
      }
      refreshHistoryPicker();
      if (textareaText) textareaText.focus();
    }

    function closeDrawer() {
      isOpen = false;
      if (drawer) {
        drawer.classList.remove('open');
        drawer.style.display = 'none';
      }
      if (btnToggle) {
        btnToggle.classList.remove('active');
        btnToggle.setAttribute('aria-expanded', 'false');
      }
      setError('');
    }

    function toggleDrawer() {
      if (isOpen) closeDrawer();
      else openDrawer();
    }

    function switchTab(targetTabId) {
      if (tabBtns) {
        tabBtns.forEach(btn => {
          const isActive = btn.dataset.tab === targetTabId;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', String(isActive));
        });
      }
      if (tabPanels) {
        tabPanels.forEach(panel => {
          const isTarget = panel.id === `lab-panel-${targetTabId}`;
          panel.classList.toggle('active', isTarget);
          panel.style.display = isTarget ? 'flex' : 'none';
        });
      }
    }

    function setSelectValue(selectEl, val) {
      if (!selectEl) return;
      try {
        selectEl.value = val;
      } catch {}
      if (selectEl.options) {
        for (let i = 0; i < selectEl.options.length; i++) {
          const opt = selectEl.options[i];
          opt.selected = (opt.value === String(val));
        }
      }
    }

    function applyPreset(preset) {
      if (!preset) return;
      if (inputAuthor) inputAuthor.value = preset.author || '';
      setSelectValue(selectRole, preset.role || 'user');
      if (textareaText) textareaText.value = preset.text || '';
      if (inputMention) inputMention.value = preset.mention || '';
      if (inputAvatar) inputAvatar.value = preset.avatar || '';

      if (preset.customEmoji) {
        if (inputEmojiUrl) inputEmojiUrl.value = preset.customEmoji.url || '';
        if (inputEmojiAlt) inputEmojiAlt.value = preset.customEmoji.alt || '';
      } else {
        if (inputEmojiUrl) inputEmojiUrl.value = '';
        if (inputEmojiAlt) inputEmojiAlt.value = '';
      }

      if (preset.reply) {
        setSelectValue(selectReplyMode, 'manual');
        if (inputReplyAuthor) inputReplyAuthor.value = preset.reply.author || '';
        if (inputReplyText) inputReplyText.value = preset.reply.text || '';
        updateReplyVisibility();
      } else {
        setSelectValue(selectReplyMode, 'none');
        if (inputReplyAuthor) inputReplyAuthor.value = '';
        if (inputReplyText) inputReplyText.value = '';
        updateReplyVisibility();
      }

      setError('');
      switchTab('composer');
    }

    function updateReplyVisibility() {
      const mode = selectReplyMode ? selectReplyMode.value : 'none';
      const historyWrap = documentObj.querySelector('#lab-reply-history-wrap');
      const manualWrap = documentObj.querySelector('#lab-reply-manual-wrap');

      if (historyWrap) historyWrap.style.display = mode === 'history' ? 'block' : 'none';
      if (manualWrap) manualWrap.style.display = mode === 'manual' ? 'block' : 'none';
    }

    async function refreshHistoryPicker() {
      if (!selectReplyHistory) return;
      selectReplyHistory.innerHTML = '<option value="">-- Выберите сообщение --</option>';

      try {
        if (fetchFn) {
          const res = await fetchFn(`${apiOrigin}/history`);
          if (res && res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              const recent = data.slice(-15).reverse();
              for (const msg of recent) {
                const author = typeof msg.author === 'string' ? msg.author : (msg.author?.name || 'User');
                const snippet = (msg.text || '').slice(0, 35);
                const opt = documentObj.createElement('option');
                opt.value = JSON.stringify({ author, text: msg.text || '' });
                opt.textContent = `${author}: "${snippet}"`;
                selectReplyHistory.appendChild(opt);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Message Lab: Failed to fetch history for reply picker:', err);
      }
    }

    async function sendSyntheticPayload(payload) {
      if (!fetchFn) {
        throw new Error('fetch is unavailable in this environment');
      }
      const res = await fetchFn(`${apiOrigin}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      });

      if (!res || !res.ok) {
        const errText = res ? await res.text() : 'Network error';
        throw new Error(`Ошибка отправки: ${errText}`);
      }

      return await res.json();
    }

    async function handleFormSubmit() {
      setError('');
      try {
        const author = inputAuthor ? inputAuthor.value.trim() : 'TestUser';
        const role = selectRole ? (selectRole.value === 'user' ? null : selectRole.value) : null;
        const text = textareaText ? textareaText.value.trim() : '';
        const mention = inputMention ? inputMention.value.trim() : '';
        const avatar = inputAvatar ? inputAvatar.value.trim() : '';
        const emojiUrl = inputEmojiUrl ? inputEmojiUrl.value.trim() : '';
        const emojiAlt = inputEmojiAlt ? inputEmojiAlt.value.trim() : '';
        const replyMode = selectReplyMode ? selectReplyMode.value : 'none';
        const timestampMode = selectTimestamp ? selectTimestamp.value : 'now';
        const customTimestamp = inputCustomTimestamp ? inputCustomTimestamp.value.trim() : '';

        let reply = null;
        if (replyMode === 'history' && selectReplyHistory && selectReplyHistory.value) {
          try {
            reply = JSON.parse(selectReplyHistory.value);
          } catch {}
        } else if (replyMode === 'manual') {
          reply = {
            author: inputReplyAuthor ? inputReplyAuthor.value.trim() : '',
            text: inputReplyText ? inputReplyText.value.trim() : '',
          };
        }

        const customEmoji = emojiUrl ? { url: emojiUrl, alt: emojiAlt || ':emoji:' } : null;

        const payload = buildSyntheticMessage({
          author,
          role,
          text,
          mention,
          avatar: avatar || null,
          customEmoji,
          reply,
          timestampMode,
          customTimestamp,
        });

        const result = await sendSyntheticPayload(payload);
        setStatus(`✓ Отправлено (id: ${payload.id})`);
        return result;
      } catch (err) {
        setError(err.message);
        setStatus(err.message, true);
        throw err;
      }
    }

    // Wire Event Listeners
    if (btnToggle) {
      btnToggle.addEventListener('click', toggleDrawer);
    }
    if (btnClose) {
      btnClose.addEventListener('click', closeDrawer);
    }

    if (tabBtns) {
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          if (tab) switchTab(tab);
        });
      });
    }

    if (selectReplyMode) {
      selectReplyMode.addEventListener('change', updateReplyVisibility);
    }

    if (selectReplyHistory) {
      selectReplyHistory.addEventListener('change', () => {
        if (!selectReplyHistory.value) return;
        try {
          const data = JSON.parse(selectReplyHistory.value);
          if (inputReplyAuthor) inputReplyAuthor.value = data.author || '';
          if (inputReplyText) inputReplyText.value = data.text || '';
        } catch {}
      });
    }

    if (selectTimestamp && inputCustomTimestamp) {
      selectTimestamp.addEventListener('change', () => {
        inputCustomTimestamp.style.display = selectTimestamp.value === 'manual' ? 'inline-block' : 'none';
      });
    }

    if (btnSend) {
      btnSend.addEventListener('click', () => {
        handleFormSubmit().catch(() => {});
      });
    }

    // Quick persona pills
    const personaBtns = documentObj.querySelectorAll('.persona-pill-btn');
    if (personaBtns) {
      personaBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.persona;
          const persona = QUICK_PERSONAS.find(p => p.name === name);
          if (persona) {
            if (inputAuthor) inputAuthor.value = persona.name;
            setSelectValue(selectRole, persona.role || 'user');
          }
        });
      });
    }

    // Quick avatar buttons
    const avatarSampleBtn = documentObj.querySelector('#btn-avatar-sample');
    if (avatarSampleBtn) {
      avatarSampleBtn.addEventListener('click', () => {
        if (inputAvatar) {
          inputAvatar.value = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23f15f2c"/><text x="50%" y="55%" font-size="18" text-anchor="middle" fill="white" dy=".3em">QA</text></svg>';
        }
      });
    }
    const avatarBrokenBtn = documentObj.querySelector('#btn-avatar-broken');
    if (avatarBrokenBtn) {
      avatarBrokenBtn.addEventListener('click', () => {
        if (inputAvatar) {
          inputAvatar.value = 'https://invalid.example/broken-avatar-404.png';
        }
      });
    }
    const avatarClearBtn = documentObj.querySelector('#btn-avatar-clear');
    if (avatarClearBtn) {
      avatarClearBtn.addEventListener('click', () => {
        if (inputAvatar) inputAvatar.value = '';
      });
    }

    // Quick preset buttons
    const presetGrid = documentObj.querySelector('#lab-presets-grid');
    if (presetGrid) {
      presetGrid.innerHTML = '';
      for (const preset of PRESETS) {
        const item = documentObj.createElement('button');
        item.className = 'preset-card-btn';
        item.type = 'button';
        item.title = `preset: ${preset.id}`;
        item.innerHTML = `<span class="preset-title">${preset.label}</span><span class="preset-desc">${preset.desc}</span>`;
        item.addEventListener('click', () => applyPreset(preset));
        presetGrid.appendChild(item);
      }
    }

    // Macro scenario buttons
    const macroGrid = documentObj.querySelector('#lab-scenarios-grid');
    if (macroGrid) {
      macroGrid.innerHTML = '';
      for (const [key, macro] of Object.entries(MACRO_SCENARIOS)) {
        const item = documentObj.createElement('button');
        item.className = 'macro-card-btn';
        item.type = 'button';
        item.title = `scenario: ${key}`;
        const titleText = macro.title || macro.name;
        item.innerHTML = `<span class="macro-title">${titleText}</span><span class="macro-desc">${macro.desc}</span>`;
        item.addEventListener('click', async () => {
          setStatus(`Запуск сценария: ${titleText}...`);
          try {
            await macro.run(sendSyntheticPayload, { monitorApp });
            setStatus(`✓ Сценарий "${titleText}" выполнен!`);
          } catch (err) {
            setStatus(`Ошибка: ${err.message}`, true);
          }
        });
        macroGrid.appendChild(item);
      }
    }

    // Batch send button
    const btnBatchSend = documentObj.querySelector('#btn-lab-batch-send');
    const inputBatchCount = documentObj.querySelector('#lab-batch-count');
    const selectBatchInterval = documentObj.querySelector('#lab-batch-interval');

    if (btnBatchSend) {
      btnBatchSend.addEventListener('click', async () => {
        const count = inputBatchCount ? parseInt(inputBatchCount.value, 10) || 10 : 10;
        const interval = selectBatchInterval ? parseInt(selectBatchInterval.value, 10) || 0 : 0;

        setStatus(`Отправка пачки (${count} шт)...`);
        try {
          const batch = generateBatchMessages(count);
          for (let i = 0; i < batch.length; i++) {
            await sendSyntheticPayload(batch[i]);
            if (interval > 0 && i < batch.length - 1) {
              await new Promise(r => setTimeout(r, interval));
            }
          }
          setStatus(`✓ Успешно отправлено ${count} сообщений!`);
        } catch (err) {
          setStatus(`Ошибка отправки пачки: ${err.message}`, true);
        }
      });
    }

    // Hotkeys: Ctrl+Enter (send), Ctrl+Shift+L (toggle)
    if (documentObj) {
      documentObj.addEventListener('keydown', (e) => {
        const isCmdOrCtrl = e.ctrlKey || e.metaKey;

        if (isCmdOrCtrl && e.shiftKey && (e.key === 'l' || e.key === 'L' || e.key === 'д' || e.key === 'Д')) {
          e.preventDefault();
          toggleDrawer();
          return;
        }

        if (isOpen && isCmdOrCtrl && e.key === 'Enter') {
          e.preventDefault();
          handleFormSubmit().catch(() => {});
          return;
        }
      });
    }

    return {
      open: openDrawer,
      close: closeDrawer,
      toggle: toggleDrawer,
      isOpen: () => isOpen,
      applyPreset,
      sendSyntheticPayload,
      submit: handleFormSubmit,
      refreshHistoryPicker,
      switchTab,
    };
  }

  return {
    PRESETS,
    QUICK_PERSONAS,
    MACRO_SCENARIOS,
    buildSyntheticMessage,
    generateBatchMessages,
    createMessageLab,
    resetDeterministicCounter,
  };
});
