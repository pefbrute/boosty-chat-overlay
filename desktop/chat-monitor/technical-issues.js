'use strict';

/**
 * Boosty Chat Monitor — Technical Issue Detection & Multi-User Aggregation v1
 * Fast, deterministic, dictionary + token-pattern classifier with false-positive
 * exclusions, confidence scoring, rolling time-window aggregation, cooldown, and decay.
 * Compatible with both Node.js and Browser environments.
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.BoostyTechnicalIssues = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  'use strict';

  const I18n = (typeof root !== 'undefined' && root.BoostyI18nRu)
    || (typeof globalThis !== 'undefined' && globalThis.BoostyI18nRu)
    || (typeof require === 'function' ? (() => {
        try { return require('../../core/i18n/ru.js'); } catch {
          try { return require('../core/i18n/ru.js'); } catch {
            try { return require('./core/i18n/ru.js'); } catch { return null; }
          }
        }
      })() : null);

  const CONFIDENCE = {
    HIGH: 'HIGH',
    MEDIUM: 'MEDIUM',
    LOW: 'LOW',
  };

  const SEVERITY = {
    NONE: 'none',
    POSSIBLE: 'possible',
    PROBABLE: 'probable',
    CRITICAL: 'critical',
  };

  const SEVERITY_RANK = {
    none: 0,
    possible: 1,
    probable: 2,
    critical: 3,
  };

  const SEVERITY_LABELS = {
    none: '',
    possible: 'Возможная проблема',
    probable: 'Вероятная проблема',
    critical: 'Критично',
  };

  const DEFAULT_WINDOW_MS = 30000;   // 30s rolling window for grouping reports
  const DEFAULT_DECAY_MS = 75000;    // 75s (within 60-90s spec) decay when no new reports arrive
  const DEFAULT_COOLDOWN_MS = 60000; // 60s cooldown after manual dismiss unless severity grows

  /**
   * False-positive exclusion phrases (already normalized: lowercase, ё->е, no punctuation).
   * Matches phrases where the viewer is describing their own device/connection or
   * content inside the game/video being watched rather than the stream itself.
   */
  const FALSE_POSITIVE_EXCLUSIONS = [
    'у меня',
    'на телефоне',
    'с телефона',
    'на мобиле',
    'на планшете',
    'мой интернет',
    'моем интернете',
    'интернет тормозит',
    'интернет лагает',
    'в этом видео',
    'в видео',
    'на видео',
    'в ролике',
    'в клипе',
    'в фильме',
    'в игре',
    'по сюжету',
    'у героя',
    'у персонажа',
    'персонаж',
    'у него',
    'у нее',
    'у них',
    'у тиммейта',
    'у босса',
    'на прошлом стриме',
    'вчера на стриме',
  ];

  /**
   * Category definitions with HIGH (exact phrases), MEDIUM (token combinations),
   * and LOW (single ambiguous keywords).
   * All patterns must use normalized text (lowercase, ё -> е, single spaces).
   */
  const TECH_ISSUE_CATEGORIES = {
    audio_missing: {
      id: 'audio_missing',
      title: 'Нет звука',
      label: 'Нет звука',
      possibleTitle: 'Возможно, нет звука',
      badgeLabel: 'Нет звука',
      exactHigh: [
        'нет звука',
        'звука нет',
        'звук пропал',
        'пропал звук',
        'не слышно',
        'без звука',
        'я тоже не слышу',
        'тоже не слышу',
        'не слышу',
        'вас не слышно',
        'тебя не слышно',
        'стрим без звука',
        'звук отрубился',
        'звук исчез',
        'микро выключен',
        'микрофон выключен',
        'микрофон не работает',
      ],
      tokenMedium: [
        ['звук', 'нет'],
        ['звука', 'нет'],
        ['звук', 'пропал'],
        ['звук', 'исчез'],
        ['звук', 'отрубился'],
        ['звук', 'выключился'],
        ['не', 'слышно'],
        ['не', 'слышу'],
        ['микрофон', 'молчит'],
        ['микро', 'молчит'],
      ],
      singleLow: [
        'глухо',
        'замучен',
      ],
    },

    audio_low: {
      id: 'audio_low',
      title: 'Слишком тихо',
      label: 'Слишком тихо',
      possibleTitle: 'Возможно, слишком тихо',
      badgeLabel: 'Тихо',
      exactHigh: [
        'слишком тихо',
        'очень тихо',
        'прибавь звук',
        'сделай погромче',
        'сделайте погромче',
        'плохо слышно',
        'еле слышно',
      ],
      tokenMedium: [
        ['звук', 'тихий'],
        ['звук', 'тихо'],
        ['голос', 'тихий'],
        ['голос', 'тихо'],
        ['микрофон', 'тихий'],
        ['микро', 'тихий'],
        ['микро', 'тихо'],
        ['прибавь', 'громкость'],
        ['добавь', 'звук'],
        ['сделай', 'громче'],
      ],
      singleLow: [
        'тихо',
        'погромче',
      ],
    },

    audio_high: {
      id: 'audio_high',
      title: 'Слишком громко',
      label: 'Слишком громко',
      possibleTitle: 'Возможно, слишком громко',
      badgeLabel: 'Громко',
      exactHigh: [
        'слишком громко',
        'очень громко',
        'звук очень громкий',
        'убавь звук',
        'сделай потише',
        'перегруз по звуку',
        'микрофон фонит',
        'микрофон хрипит',
      ],
      tokenMedium: [
        ['звук', 'громкий'],
        ['звук', 'громко'],
        ['звук', 'орет'],
        ['микрофон', 'громкий'],
        ['микро', 'орет'],
        ['убавь', 'громкость'],
        ['сделай', 'тише'],
      ],
      singleLow: [
        'орет',
        'громко',
        'потише',
      ],
    },

    audio_sync: {
      id: 'audio_sync',
      title: 'Рассинхрон',
      label: 'Рассинхрон',
      possibleTitle: 'Возможный рассинхрон',
      badgeLabel: 'Рассинхрон',
      exactHigh: [
        'звук отстает',
        'отстает звук',
        'рассинхрон',
        'звук раньше видео',
        'звук позже видео',
        'звук спешит',
        'звук запаздывает',
      ],
      tokenMedium: [
        ['звук', 'отстает'],
        ['звук', 'спешит'],
        ['звук', 'задержка'],
        ['аудио', 'отстает'],
        ['голос', 'отстает'],
        ['голос', 'спешит'],
      ],
      singleLow: [
        'рассинхронизация',
        'десинхрон',
      ],
    },

    video_missing: {
      id: 'video_missing',
      title: 'Нет изображения',
      label: 'Нет изображения',
      possibleTitle: 'Возможно, нет изображения',
      badgeLabel: 'Нет видео',
      exactHigh: [
        'черный экран',
        'экран черный',
        'нет картинки',
        'картинки нет',
        'видео пропало',
        'пропало видео',
        'пропала картинка',
        'нет видео',
      ],
      tokenMedium: [
        ['черный', 'экран'],
        ['нет', 'картинки'],
        ['видео', 'пропало'],
        ['картинка', 'пропала'],
        ['экран', 'погас'],
        ['стрим', 'черный'],
      ],
      singleLow: [
        'малевич',
      ],
    },

    stream_freeze: {
      id: 'stream_freeze',
      title: 'Стрим завис',
      label: 'Стрим завис',
      possibleTitle: 'Возможно, стрим завис',
      badgeLabel: 'Завис',
      exactHigh: [
        'стрим завис',
        'завис стрим',
        'стрим встал',
        'трансляция зависла',
        'картинка зависла',
        'эфир завис',
        'стрим упал',
      ],
      tokenMedium: [
        ['стрим', 'завис'],
        ['стрим', 'зависает'],
        ['стрим', 'фризит'],
        ['картинка', 'зависла'],
        ['картинка', 'стоит'],
        ['видео', 'зависло'],
      ],
      singleLow: [
        'зависло',
        'фризит',
        'зависает',
        'завис',
        'фризы',
      ],
    },

    stream_lag: {
      id: 'stream_lag',
      title: 'Лагает',
      label: 'Лагает',
      possibleTitle: 'Возможные лаги',
      badgeLabel: 'Лаги',
      exactHigh: [
        'дико лагает',
        'жестко лагает',
        'сильно лагает',
        'стрим заикается',
        'кадры дропаются',
        'слайдшоу на стриме',
      ],
      tokenMedium: [
        ['стрим', 'лагает'],
        ['стрим', 'тормозит'],
        ['стрим', 'дропает'],
        ['очень', 'лагает'],
        ['сильно', 'тормозит'],
        ['картинка', 'лагает'],
        ['видео', 'лагает'],
        ['видео', 'тормозит'],
      ],
      singleLow: [
        'лагает',
        'тормозит',
        'дропает',
        'заикается',
        'лаги',
        'слайдшоу',
      ],
    },

    quality: {
      id: 'quality',
      title: 'Проблемы с качеством',
      label: 'Проблемы с качеством',
      possibleTitle: 'Возможны проблемы с качеством',
      badgeLabel: 'Качество',
      exactHigh: [
        'качество упало',
        'упало качество',
        'картинка рассыпается',
        'рассыпается картинка',
        'битрейт упал',
        'все в пикселях',
      ],
      tokenMedium: [
        ['качество', 'упало'],
        ['качество', 'плохое'],
        ['качество', 'мыло'],
        ['картинка', 'мыльная'],
        ['картинка', 'пиксели'],
        ['битрейт', 'низкий'],
      ],
      singleLow: [
        'мыло',
        'пиксели',
        'шакалит',
        'битрейт',
      ],
    },
  };

  const CATEGORY_ORDER = [
    'audio_missing',
    'video_missing',
    'stream_freeze',
    'audio_sync',
    'audio_low',
    'audio_high',
    'stream_lag',
    'quality',
  ];

  /**
   * Normalizes message text for pattern matching without mutating the original message:
   * - lowercase
   * - ё -> е
   * - strip punctuation to spaces
   * - collapse multiple spaces and trim
   *
   * @param {string} rawText
   * @returns {string}
   */
  function normalizeIssueText(rawText) {
    if (typeof rawText !== 'string') return '';
    return rawText
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Checks if normalized text contains a phrase on word boundaries.
   */
  function containsPhrase(paddedNorm, phrase) {
    if (!phrase) return false;
    return paddedNorm.includes(` ${phrase} `);
  }

  /**
   * Extracts plain text from a message object or string.
   */
  function extractMessageText(messageOrText) {
    if (typeof messageOrText === 'string') return messageOrText;
    if (!messageOrText || typeof messageOrText !== 'object') return '';
    if (typeof messageOrText.text === 'string' && messageOrText.text.trim()) {
      return messageOrText.text;
    }
    if (Array.isArray(messageOrText.segments)) {
      return messageOrText.segments
        .map(seg => (seg && typeof seg.text === 'string' ? seg.text : ''))
        .join(' ');
    }
    return '';
  }

  /**
   * Extracts author name from a message object.
   */
  function extractAuthorName(message) {
    if (!message || typeof message !== 'object') return 'Аноним';
    if (typeof message.author === 'string' && message.author.trim()) {
      return message.author.trim();
    }
    if (message.author && typeof message.author === 'object' && typeof message.author.name === 'string' && message.author.name.trim()) {
      return message.author.name.trim();
    }
    return 'Аноним';
  }

  /**
   * Classifies a chat message or string for potential stream technical issues.
   *
   * @param {object|string} messageOrText
   * @returns {{
   *   isTechnicalIssue: boolean,
   *   shouldHighlight: boolean,
   *   type: string | null,
   *   confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null,
   *   matchedPattern: string | null,
   *   excludedBy: string | null,
   *   normalizedText: string
   * }}
   */
  function classifyTechnicalIssue(messageOrText) {
    const rawText = extractMessageText(messageOrText);
    const normalizedText = normalizeIssueText(rawText);

    if (!normalizedText) {
      return {
        isTechnicalIssue: false,
        shouldHighlight: false,
        type: null,
        confidence: null,
        matchedPattern: null,
        excludedBy: null,
        normalizedText: '',
      };
    }

    const padded = ` ${normalizedText} `;

    // 1. False-positive check
    for (const exclusion of FALSE_POSITIVE_EXCLUSIONS) {
      if (containsPhrase(padded, exclusion)) {
        return {
          isTechnicalIssue: false,
          shouldHighlight: false,
          type: null,
          confidence: null,
          matchedPattern: null,
          excludedBy: exclusion,
          normalizedText,
        };
      }
    }

    const tokens = normalizedText.split(' ').filter(Boolean);
    const tokenSet = new Set(tokens);

    // 2. Pass 1: HIGH confidence exact phrases across all categories
    for (const catId of CATEGORY_ORDER) {
      const cat = TECH_ISSUE_CATEGORIES[catId];
      for (const phrase of cat.exactHigh) {
        if (containsPhrase(padded, phrase)) {
          return {
            isTechnicalIssue: true,
            shouldHighlight: true,
            type: cat.id,
            confidence: CONFIDENCE.HIGH,
            matchedPattern: phrase,
            excludedBy: null,
            normalizedText,
          };
        }
      }
    }

    // 3. Pass 2: MEDIUM confidence token combinations across all categories
    for (const catId of CATEGORY_ORDER) {
      const cat = TECH_ISSUE_CATEGORIES[catId];
      for (const combo of cat.tokenMedium) {
        if (Array.isArray(combo) && combo.length > 0 && combo.every(t => tokenSet.has(t))) {
          return {
            isTechnicalIssue: true,
            shouldHighlight: true,
            type: cat.id,
            confidence: CONFIDENCE.MEDIUM,
            matchedPattern: combo.join(' + '),
            excludedBy: null,
            normalizedText,
          };
        }
      }
    }

    // 4. Pass 3: LOW confidence single ambiguous words across all categories
    for (const catId of CATEGORY_ORDER) {
      const cat = TECH_ISSUE_CATEGORIES[catId];
      for (const word of cat.singleLow) {
        if (containsPhrase(padded, word)) {
          return {
            isTechnicalIssue: true,
            shouldHighlight: false,
            type: cat.id,
            confidence: CONFIDENCE.LOW,
            matchedPattern: word,
            excludedBy: null,
            normalizedText,
          };
        }
      }
    }

    return {
      isTechnicalIssue: false,
      shouldHighlight: false,
      type: null,
      confidence: null,
      matchedPattern: null,
      excludedBy: null,
      normalizedText,
    };
  }

  /**
   * Russian pluralization helper: (1, 'зритель', 'зрителя', 'зрителей')
   */
  function pluralizeRu(count, one, few, many) {
    const n = Math.abs(Number(count) || 0);
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 19) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  /**
   * Computes severity string and rank from unique user count.
   * 1 user -> possible ('Возможная проблема')
   * 2 users -> probable ('Вероятная проблема')
   * 3+ users -> critical ('Критично')
   */
  function computeSeverity(uniqueUsers) {
    if (uniqueUsers >= 3) return SEVERITY.CRITICAL;
    if (uniqueUsers === 2) return SEVERITY.PROBABLE;
    if (uniqueUsers === 1) return SEVERITY.POSSIBLE;
    return SEVERITY.NONE;
  }

  /**
   * Formats human-readable alert summary text for the sticky banner.
   */
  function formatAlertSummary(group) {
    if (!group) return '';
    const cat = TECH_ISSUE_CATEGORIES[group.type];
    const title = (I18n && typeof I18n.getTechnicalIssueLabel === 'function')
      ? I18n.getTechnicalIssueLabel(group.type)
      : (cat ? (cat.label || cat.title) : 'Техническая проблема');
    const pluralFn = (I18n && typeof I18n.pluralize === 'function')
      ? I18n.pluralize
      : pluralizeRu;
    const msgWord = pluralFn(group.count, ['сообщение', 'сообщения', 'сообщений']);
    const viewerWord = pluralFn(group.uniqueUsers, ['зрителя', 'зрителей', 'зрителей']);
    return `${title} — ${group.count} ${msgWord} от ${group.uniqueUsers} ${viewerWord}`;
  }

  /**
   * Creates a multi-user technical issue aggregator with rolling window,
   * unique author tracking, severity escalation, dismiss cooldown, and decay.
   *
   * @param {object} [options]
   * @param {number} [options.windowMs=30000] Rolling time window for grouping complaints
   * @param {number} [options.decayMs=75000] Time after last message before active issue decays
   * @param {number} [options.cooldownMs=60000] Cooldown after user dismisses an alert
   * @param {number} [options.minUsersForAlert=2] Minimum unique users to trigger sticky banner
   * @param {function(): number} [options.nowFn] Clock function for deterministic testing
   */
  function createTechnicalIssueAggregator(options = {}) {
    const windowMs = typeof options.windowMs === 'number' && options.windowMs > 0
      ? options.windowMs
      : DEFAULT_WINDOW_MS;
    const decayMs = typeof options.decayMs === 'number' && options.decayMs > 0
      ? options.decayMs
      : DEFAULT_DECAY_MS;
    const cooldownMs = typeof options.cooldownMs === 'number' && options.cooldownMs >= 0
      ? options.cooldownMs
      : DEFAULT_COOLDOWN_MS;
    const minUsersForAlert = typeof options.minUsersForAlert === 'number' && options.minUsersForAlert >= 1
      ? options.minUsersForAlert
      : 2;
    const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();

    const groups = new Map();

    function pruneAndEvaluate(now = nowFn()) {
      for (const [type, group] of groups.entries()) {
        const idleTime = now - group.lastSeen;
        // Single-user un-escalated group expires after windowMs;
        // Multi-user escalated group decays after decayMs (or windowMs if configured smaller)
        const effectiveExpireMs = group.uniqueUsers >= minUsersForAlert
          ? Math.max(windowMs, decayMs)
          : windowMs;

        if (idleTime > effectiveExpireMs) {
          groups.delete(type);
          continue;
        }

        // If cooldown expired, clear dismissed state
        if (group.dismissedAt !== null && (now - group.dismissedAt) >= cooldownMs) {
          group.dismissedAt = null;
          group.dismissedSeverityRank = 0;
        }
      }
    }

    function recalculateGroupMetrics(group, now) {
      // If the group had NOT reached alert threshold yet, slide the window strictly by windowMs
      // so old isolated complaints don't merge with new ones after windowMs.
      if (group.uniqueUsers < minUsersForAlert) {
        group.events = group.events.filter(evt => (now - evt.timestamp) <= windowMs);
      }

      const uniqueAuthors = new Set();
      let firstSeen = Infinity;
      let lastSeen = 0;

      for (const evt of group.events) {
        uniqueAuthors.add(evt.authorKey);
        if (evt.timestamp < firstSeen) firstSeen = evt.timestamp;
        if (evt.timestamp > lastSeen) lastSeen = evt.timestamp;
      }

      group.count = group.events.length;
      group.uniqueUsers = uniqueAuthors.size;
      group.firstSeen = group.count > 0 ? firstSeen : now;
      group.lastSeen = group.count > 0 ? lastSeen : now;
      group.severity = computeSeverity(group.uniqueUsers);
      group.severityRank = SEVERITY_RANK[group.severity] || 0;
      group.severityLabel = (I18n && typeof I18n.getSeverityLabel === 'function')
        ? I18n.getSeverityLabel(group.severity)
        : (SEVERITY_LABELS[group.severity] || '');
      group.severityUpper = (I18n && typeof I18n.getSeverityLabel === 'function')
        ? I18n.getSeverityLabel(group.severity, { uppercase: true })
        : (group.severity === 'critical' ? 'КРИТИЧНО' : (group.severity === 'probable' ? 'ВЕРОЯТНАЯ ПРОБЛЕМА' : (group.severity === 'possible' ? 'ВОЗМОЖНАЯ ПРОБЛЕМА' : '')));
      group.summary = formatAlertSummary(group);
    }

    /**
     * Ingests a message (and optional pre-computed classification).
     *
     * @param {object} message
     * @param {object} [preClassification]
     * @param {number} [explicitNow]
     */
    function ingest(message, preClassification = null, explicitNow = undefined) {
      const now = typeof explicitNow === 'number' ? explicitNow : nowFn();
      pruneAndEvaluate(now);

      const classification = preClassification || classifyTechnicalIssue(message);
      if (!classification || !classification.isTechnicalIssue || !classification.type) {
        return {
          classification,
          group: null,
          activeAlert: getActiveAlert(now),
        };
      }

      const type = classification.type;
      const cat = TECH_ISSUE_CATEGORIES[type];
      const authorDisplay = extractAuthorName(message);
      const authorKey = authorDisplay.toLowerCase();
      const msgId = message && message.id !== undefined ? String(message.id) : `msg-${now}`;

      let group = groups.get(type);
      if (group) {
        // Check if previous group should decay before adding new event
        const gap = now - group.lastSeen;
        const maxGap = group.uniqueUsers >= minUsersForAlert ? Math.max(windowMs, decayMs) : windowMs;
        if (gap > maxGap) {
          groups.delete(type);
          group = null;
        }
      }

      if (!group) {
        group = {
          type,
          title: cat ? cat.title : type,
          possibleTitle: cat ? cat.possibleTitle : type,
          badgeLabel: cat ? cat.badgeLabel : 'Техпроблема',
          count: 0,
          uniqueUsers: 0,
          firstSeen: now,
          lastSeen: now,
          severity: SEVERITY.NONE,
          severityRank: 0,
          severityLabel: '',
          summary: '',
          events: [],
          dismissedAt: null,
          dismissedSeverityRank: 0,
        };
        groups.set(type, group);
      }

      // Dedup by message ID within the group
      if (!group.events.some(e => e.id === msgId)) {
        group.events.push({
          id: msgId,
          author: authorDisplay,
          authorKey,
          timestamp: now,
          type,
          confidence: classification.confidence,
          matchedPattern: classification.matchedPattern,
          text: extractMessageText(message),
        });
      }

      recalculateGroupMetrics(group, now);

      // Cooldown escalation check: if severity grew higher than when dismissed, break cooldown!
      if (group.dismissedAt !== null) {
        if ((now - group.dismissedAt) >= cooldownMs) {
          group.dismissedAt = null;
          group.dismissedSeverityRank = 0;
        } else if (group.severityRank > group.dismissedSeverityRank) {
          group.dismissedAt = null;
          group.dismissedSeverityRank = 0;
        }
      }

      return {
        classification,
        group: cloneGroupSnapshot(group, now),
        activeAlert: getActiveAlert(now),
      };
    }

    function isGroupSuppressedByCooldown(group, now) {
      if (!group || group.dismissedAt === null) return false;
      if ((now - group.dismissedAt) >= cooldownMs) return false;
      return group.severityRank <= group.dismissedSeverityRank;
    }

    function cloneGroupSnapshot(group, now = nowFn()) {
      if (!group) return null;
      const suppressed = isGroupSuppressedByCooldown(group, now);
      const meetsThreshold = group.uniqueUsers >= minUsersForAlert;
      const typeLabel = (I18n && typeof I18n.getTechnicalIssueLabel === 'function')
        ? I18n.getTechnicalIssueLabel(group.type)
        : (TECH_ISSUE_CATEGORIES[group.type]?.label || group.title || 'Техническая проблема');
      return {
        type: group.type,
        typeLabel,
        title: group.title,
        possibleTitle: group.possibleTitle,
        badgeLabel: group.badgeLabel,
        count: group.count,
        uniqueUsers: group.uniqueUsers,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
        severity: group.severity,
        severityRank: group.severityRank,
        severityLabel: group.severityLabel,
        severityUpper: group.severityUpper || (SEVERITY_LABELS[group.severity] ? String(SEVERITY_LABELS[group.severity]).toUpperCase() : ''),
        summary: group.summary,
        isSuppressedByCooldown: suppressed,
        shouldShowAlert: meetsThreshold && !suppressed,
        events: group.events.map(e => ({ ...e })),
      };
    }

    function getGroup(type, explicitNow = undefined) {
      const now = typeof explicitNow === 'number' ? explicitNow : nowFn();
      pruneAndEvaluate(now);
      const group = groups.get(type);
      return group ? cloneGroupSnapshot(group, now) : null;
    }

    function getAllGroups(explicitNow = undefined) {
      const now = typeof explicitNow === 'number' ? explicitNow : nowFn();
      pruneAndEvaluate(now);
      const result = [];
      for (const group of groups.values()) {
        result.push(cloneGroupSnapshot(group, now));
      }
      result.sort((a, b) => {
        if (b.severityRank !== a.severityRank) return b.severityRank - a.severityRank;
        if (b.uniqueUsers !== a.uniqueUsers) return b.uniqueUsers - a.uniqueUsers;
        return b.lastSeen - a.lastSeen;
      });
      return result;
    }

    function getActiveAlert(explicitNow = undefined) {
      const now = typeof explicitNow === 'number' ? explicitNow : nowFn();
      const all = getAllGroups(now);
      return all.find(g => g.shouldShowAlert) || null;
    }

    function dismiss(type = null, explicitNow = undefined) {
      const now = typeof explicitNow === 'number' ? explicitNow : nowFn();
      pruneAndEvaluate(now);

      let targetType = type;
      if (!targetType) {
        const current = getActiveAlert(now);
        if (current) targetType = current.type;
      }
      if (!targetType) return false;

      const group = groups.get(targetType);
      if (!group) return false;

      group.dismissedAt = now;
      group.dismissedSeverityRank = group.severityRank;
      return true;
    }

    function clear() {
      groups.clear();
    }

    return {
      ingest,
      getGroup,
      getAllGroups,
      getActiveAlert,
      dismiss,
      clear,
      prune: pruneAndEvaluate,
    };
  }

  return {
    CONFIDENCE,
    SEVERITY,
    SEVERITY_RANK,
    SEVERITY_LABELS,
    DEFAULT_WINDOW_MS,
    DEFAULT_DECAY_MS,
    DEFAULT_COOLDOWN_MS,
    FALSE_POSITIVE_EXCLUSIONS,
    TECH_ISSUE_CATEGORIES,
    CATEGORIES: TECH_ISSUE_CATEGORIES,
    CATEGORY_ORDER,
    normalizeIssueText,
    classifyTechnicalIssue,
    computeSeverity,
    formatAlertSummary,
    pluralizeRu,
    createTechnicalIssueAggregator,
  };
});
