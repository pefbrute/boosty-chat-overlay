'use strict';

/**
 * Boosty Chat Monitor — Renderer Application
 * Lightweight, high-readability stream chat window for streamers.
 */

(function(root) {
  const MAX_DOM_MESSAGES = 500;
  const BOTTOM_THRESHOLD_PX = 60;
  const HISTORY_INITIAL_LIMIT = 100;

  function isSafeEmojiUrl(url) {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (/^data:image\/(png|webp|gif|jpeg|jpg|svg\+xml)[;,]/i.test(trimmed)) {
      return true;
    }
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function formatMessageTime(message) {
    if (message.publishedAt && typeof message.publishedAt === 'string') {
      const trimmed = message.publishedAt.trim();
      if (trimmed.length > 0) return trimmed;
    }
    const ts = typeof message.receivedAt === 'number' && message.receivedAt > 0
      ? message.receivedAt
      : (typeof message.timestamp === 'number' && message.timestamp > 0 ? message.timestamp : null);

    if (ts) {
      const d = new Date(ts);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
    return '';
  }

  function normalizeAuthorRole(rawRole) {
    if (typeof rawRole !== 'string') return null;
    const clean = rawRole.trim().toLowerCase();
    if (clean === 'streamer' || clean === 'moderator') {
      return clean;
    }
    return null;
  }

  function getAuthorInitial(name) {
    if (!name || typeof name !== 'string') return '?';
    const clean = name.trim().replace(/^@+/, '');
    if (!clean) return '?';
    return Array.from(clean)[0].toUpperCase();
  }

  function getMessageAuthorKey(message) {
    if (!message || typeof message !== 'object') return 'name:anonymous';
    const rawId = (message.author && typeof message.author === 'object' && message.author.id !== undefined && message.author.id !== null)
      ? message.author.id
      : (message.authorId !== undefined && message.authorId !== null ? message.authorId : null);

    if (rawId !== null && rawId !== undefined) {
      const strId = String(rawId).trim();
      if (strId.length > 0) return `id:${strId}`;
    }

    if (message.author && typeof message.author === 'object') {
      if (typeof message.author.name === 'string' && message.author.name.trim()) {
        return `name:${message.author.name.trim().toLowerCase()}`;
      }
    }
    if (typeof message.author === 'string' && message.author.trim()) {
      return `name:${message.author.trim().toLowerCase()}`;
    }
    return 'name:anonymous';
  }

  function getMessageAuthorInfo(message) {
    let name = 'Пользователь';
    let avatar = null;
    let role = null;
    let key = '';

    if (message && typeof message === 'object') {
      if (message.author && typeof message.author === 'object') {
        if (typeof message.author.name === 'string' && message.author.name.trim()) {
          name = message.author.name.trim();
        }
        if (typeof message.author.avatar === 'string' && message.author.avatar.trim()) {
          avatar = message.author.avatar.trim();
        }
        role = normalizeAuthorRole(message.author.role);
      } else if (typeof message.author === 'string' && message.author.trim()) {
        name = message.author.trim();
        role = normalizeAuthorRole(message.role);
      }
      if (!avatar && typeof message.avatar === 'string' && message.avatar.trim()) {
        avatar = message.avatar.trim();
      }
      if (!role && message.role) {
        role = normalizeAuthorRole(message.role);
      }
      key = getMessageAuthorKey(message);
    }
    return { name, avatar, role, key };
  }

  function getAvatarColor(name) {
    if (!name || typeof name !== 'string') return '#2b3547';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash |= 0;
    }
    const palette = [
      '#2e3d52',
      '#244238',
      '#443048',
      '#4a3726',
      '#1f3f4d',
      '#4a2936',
      '#2c394b',
      '#383b48',
    ];
    return palette[Math.abs(hash) % palette.length];
  }

  function createFallbackAvatar(name) {
    const el = document.createElement('div');
    el.className = 'chat-avatar chat-avatar-fallback';
    el.setAttribute('aria-hidden', 'true');
    el.style.backgroundColor = getAvatarColor(name);
    el.textContent = getAuthorInitial(name);
    return el;
  }

  function createRoleBadgeElement(role) {
    const validRole = normalizeAuthorRole(role);
    if (!validRole) return null;

    const badge = document.createElement('span');
    badge.className = `chat-badge badge-${validRole}`;
    const roleLabel = validRole === 'streamer' ? 'Стример' : 'Модератор';
    badge.setAttribute('title', roleLabel);
    badge.setAttribute('aria-label', roleLabel);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'badge-icon');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (validRole === 'streamer') {
      path.setAttribute('d', 'M8 1.35l1.98 4.02 4.44.64-3.21 3.13.76 4.42L8 11.47l-3.97 2.09.76-4.42L1.58 6.01l4.44-.64L8 1.35z');
      path.setAttribute('fill', 'currentColor');
    } else {
      path.setAttribute('d', 'M8 1.5l5.5 2.5v4.5c0 3.5-2.5 6.5-5.5 7.5-3-1-5.5-4-5.5-7.5V4L8 1.5z');
      path.setAttribute('fill', 'currentColor');
    }
    svg.appendChild(path);
    badge.appendChild(svg);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'badge-label';
    labelSpan.textContent = roleLabel;
    badge.appendChild(labelSpan);

    return badge;
  }

  const I18n = (typeof root !== 'undefined' && root.BoostyI18nRu)
    || (typeof globalThis !== 'undefined' && globalThis.BoostyI18nRu)
    || (typeof require === 'function' ? (() => {
        try { return require('../../core/i18n/ru.js'); } catch {
          try { return require('../core/i18n/ru.js'); } catch {
            try { return require('./core/i18n/ru.js'); } catch { return null; }
          }
        }
      })() : null);

  const TechIssuesModule = (typeof root !== 'undefined' && root.BoostyTechnicalIssues)
    ? root.BoostyTechnicalIssues
    : (typeof require === 'function' ? (() => { try { return require('./technical-issues.js'); } catch { return null; } })() : null);

  function getTechIssueLabel(type) {
    if (I18n && typeof I18n.getTechnicalIssueLabel === 'function') {
      return I18n.getTechnicalIssueLabel(type);
    }
    const cat = TechIssuesModule?.CATEGORIES && TechIssuesModule.CATEGORIES[type];
    return cat?.label || cat?.title || 'Техническая проблема';
  }

  function getRoleDisplayName(role) {
    if (I18n && typeof I18n.getRoleLabel === 'function') {
      return I18n.getRoleLabel(role);
    }
    if (role === 'streamer') return 'Стример';
    if (role === 'moderator') return 'Модератор';
    return 'Зритель';
  }

  function getSeverityDisplayName(severity, options = {}) {
    if (I18n && typeof I18n.getSeverityLabel === 'function') {
      return I18n.getSeverityLabel(severity, options);
    }
    if (options && options.uppercase) {
      if (severity === 'critical') return 'КРИТИЧНО';
      if (severity === 'probable') return 'ВЕРОЯТНАЯ ПРОБЛЕМА';
      if (severity === 'possible') return 'ВОЗМОЖНАЯ ПРОБЛЕМА';
      return '';
    }
    if (severity === 'critical') return 'Критично';
    if (severity === 'probable') return 'Вероятная проблема';
    if (severity === 'possible') return 'Возможная проблема';
    return '';
  }

  const techClassificationCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function getMessageTechIssue(message) {
    if (!message || typeof message !== 'object') {
      return {
        isTechnicalIssue: false,
        shouldHighlight: false,
        type: null,
        confidence: null,
        matchedPattern: null,
      };
    }

    if (typeof message.technicalIssue === 'boolean') {
      const conf = message.technicalIssueConfidence || (message.technicalIssue ? 'HIGH' : null);
      return {
        isTechnicalIssue: message.technicalIssue,
        shouldHighlight: Boolean(message.technicalIssue && (conf === 'HIGH' || conf === 'MEDIUM')),
        type: message.technicalIssueType || null,
        confidence: conf,
        matchedPattern: message.technicalIssueMatchedPattern || null,
      };
    }

    if (techClassificationCache && techClassificationCache.has(message)) {
      return techClassificationCache.get(message);
    }

    const result = TechIssuesModule && typeof TechIssuesModule.classifyTechnicalIssue === 'function'
      ? TechIssuesModule.classifyTechnicalIssue(message)
      : {
          isTechnicalIssue: false,
          shouldHighlight: false,
          type: null,
          confidence: null,
          matchedPattern: null,
        };

    if (techClassificationCache) {
      techClassificationCache.set(message, result);
    }
    return result;
  }

  function isMessageTechIssue(message) {
    const info = getMessageTechIssue(message);
    return Boolean(info && info.shouldHighlight);
  }

  function isMessageMention(message) {
    if (!message) return false;
    if (Array.isArray(message.segments) && message.segments.length > 0) {
      if (message.segments.some(seg => seg && seg.type === 'mention')) {
        return true;
      }
    }
    if (typeof message.text === 'string' && /(?:^|\s)@[\w\u0400-\u04FF]+/i.test(message.text)) {
      return true;
    }
    return false;
  }

  function isMessageReply(message) {
    if (!message || !message.reply || typeof message.reply !== 'object') return false;
    const author = typeof message.reply.author === 'string' ? message.reply.author.trim() : '';
    const text = typeof message.reply.text === 'string' ? message.reply.text.trim() : '';
    return author.length > 0 || text.length > 0;
  }

  function isMessageImportant(message) {
    return isMessageMention(message) || isMessageReply(message);
  }

  function messageMatchesFilter(message, filter) {
    if (!filter || filter === 'all') return true;
    if (filter === 'important') return isMessageImportant(message);
    if (filter === 'mentions') return isMessageMention(message);
    if (filter === 'replies') return isMessageReply(message);
    if (filter === 'tech') return isMessageTechIssue(message);
    return true;
  }

  function messageMatchesSearch(message, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    if (!q) return true;

    const author = typeof message.author === 'string'
      ? message.author.toLowerCase()
      : (message.author && typeof message.author === 'object' && typeof message.author.name === 'string'
        ? message.author.name.toLowerCase()
        : '');
    const text = typeof message.text === 'string' ? message.text.toLowerCase() : '';

    return author.includes(q) || text.includes(q);
  }

  function renderMessageSegments(container, message, options = {}) {
    const segments = Array.isArray(message.segments) && message.segments.length > 0
      ? message.segments
      : null;

    if (!segments) {
      container.textContent = message.text || '';
      return;
    }

    let renderedCount = 0;
    for (const seg of segments) {
      if (!seg || typeof seg !== 'object') continue;

      if (seg.type === 'text') {
        if (typeof seg.text === 'string' && seg.text.length > 0) {
          container.appendChild(document.createTextNode(seg.text));
          renderedCount++;
        }
      } else if (seg.type === 'emoji') {
        const alt = typeof seg.alt === 'string' && seg.alt
          ? seg.alt
          : (typeof seg.id === 'string' && seg.id ? seg.id : ':emoji:');
        if (isSafeEmojiUrl(seg.url)) {
          const img = document.createElement('img');
          img.className = 'chat-emoji';
          img.src = seg.url.trim();
          img.alt = alt;
          img.draggable = false;
          if (typeof options.onMediaLoad === 'function') {
            img.addEventListener('load', options.onMediaLoad);
          }
          container.appendChild(img);
          renderedCount++;
        } else if (alt) {
          container.appendChild(document.createTextNode(alt));
          renderedCount++;
        }
      } else if (seg.type === 'mention') {
        const rawName = typeof seg.displayName === 'string'
          ? seg.displayName.trim().replace(/^@+/, '').trim()
          : '';
        if (rawName) {
          const mentionEl = document.createElement('span');
          mentionEl.className = 'chat-mention';
          mentionEl.textContent = `@${rawName}`;
          container.appendChild(mentionEl);
          renderedCount++;
        }
      }
    }

    if (renderedCount === 0) {
      container.textContent = message.text || '';
    }
  }

  function createTechIssueBadgeElement(techInfo, options = {}) {
    if (!techInfo || !techInfo.shouldHighlight) return null;

    const badge = document.createElement('span');
    badge.className = 'chat-badge badge-tech-issue';
    const isDebug = Boolean(options.isMessageLabEnabled || options.isLab);
    const issueLabel = getTechIssueLabel(techInfo.type);
    const tooltip = isDebug
      ? `${issueLabel} • type: ${techInfo.type} (${techInfo.confidence})${techInfo.matchedPattern ? ` [${techInfo.matchedPattern}]` : ''}`
      : issueLabel;
    badge.setAttribute('title', tooltip);
    badge.setAttribute('aria-label', `Техпроблема: ${issueLabel}`);
    if (isDebug) {
      badge.dataset.techCategory = String(techInfo.type || '');
      badge.dataset.techConfidence = String(techInfo.confidence || '');
      badge.dataset.techMatched = String(techInfo.matchedPattern || '');
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = 'badge-tech-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = '▲';
    badge.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'badge-label';
    labelSpan.textContent = issueLabel;
    badge.appendChild(labelSpan);

    return badge;
  }

  function createChatCard(message, options = {}) {
    const card = document.createElement('article');
    card.className = 'chat-item';
    card.dataset.messageId = String(message.id || '');
    if (message.eventId !== undefined) {
      card.dataset.eventId = String(message.eventId);
    }

    const isSynthetic = Boolean(message.qaSynthetic || message.source === 'message_lab');
    if (isSynthetic) {
      card.classList.add('chat-item-qa');
    }

    const hasMention = isMessageMention(message);
    const hasReply = isMessageReply(message);
    if (hasMention || hasReply) {
      card.classList.add('highlight-important');
      if (hasMention && hasReply) {
        card.classList.add('highlight-both');
      } else if (hasMention) {
        card.classList.add('highlight-mention');
      } else if (hasReply) {
        card.classList.add('highlight-reply');
      }
    }

    const techInfo = getMessageTechIssue(message);
    if (techInfo && techInfo.isTechnicalIssue) {
      card.dataset.techIssue = String(Boolean(techInfo.shouldHighlight));
      card.dataset.techIssueType = String(techInfo.type || '');
      card.dataset.techIssueConfidence = String(techInfo.confidence || '');
      if (techInfo.shouldHighlight) {
        card.classList.add('highlight-tech-issue');
      }
    }

    const authorName = typeof message.author === 'string'
      ? message.author
      : (message.author && typeof message.author === 'object' && typeof message.author.name === 'string'
        ? message.author.name
        : 'Пользователь');

    const authorRole = normalizeAuthorRole(
      message.author && typeof message.author === 'object' && message.author.role !== undefined
        ? message.author.role
        : message.role
    );
    if (authorRole) {
      card.classList.add(`role-${authorRole}`);
    }

    // 1. Avatar column
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'chat-avatar-wrap';

    const rawAvatar = (message.author && typeof message.author === 'object' && typeof message.author.avatar === 'string' && message.author.avatar.trim())
      ? message.author.avatar.trim()
      : (typeof message.avatar === 'string' && message.avatar.trim() ? message.avatar.trim() : null);

    if (rawAvatar && isSafeEmojiUrl(rawAvatar)) {
      const img = document.createElement('img');
      img.className = 'chat-avatar';
      img.src = rawAvatar;
      img.alt = '';
      img.loading = 'lazy';
      img.draggable = false;
      if (typeof options.onMediaLoad === 'function') {
        img.addEventListener('load', options.onMediaLoad);
      }
      img.onerror = () => {
        img.replaceWith(createFallbackAvatar(authorName));
        if (typeof options.onMediaLoad === 'function') {
          options.onMediaLoad();
        }
      };
      avatarWrap.appendChild(img);
    } else {
      avatarWrap.appendChild(createFallbackAvatar(authorName));
    }

    if (typeof options.onOpenUserContext === 'function') {
      avatarWrap.classList.add('chat-avatar-clickable');
      avatarWrap.setAttribute('role', 'button');
      avatarWrap.setAttribute('tabindex', '0');
      avatarWrap.setAttribute('title', `Контекст пользователя ${authorName}`);
      avatarWrap.setAttribute('aria-label', `Контекст пользователя ${authorName}`);
      avatarWrap.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onOpenUserContext(message);
      });
      avatarWrap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          options.onOpenUserContext(message);
        }
      });
    }

    card.appendChild(avatarWrap);

    // 2. Chat body
    const body = document.createElement('div');
    body.className = 'chat-body';

    // Header line: Author, Role Badge, Tech Issue Badge, Timestamp
    const headerLine = document.createElement('div');
    headerLine.className = 'chat-header-line chat-main-line';

    const authorSpan = document.createElement('span');
    authorSpan.className = 'chat-author';
    if (authorRole) authorSpan.classList.add(`author-${authorRole}`);
    authorSpan.textContent = authorName;
    authorSpan.title = authorName;

    if (typeof options.onOpenUserContext === 'function') {
      authorSpan.classList.add('chat-author-clickable');
      authorSpan.setAttribute('role', 'button');
      authorSpan.setAttribute('tabindex', '0');
      authorSpan.setAttribute('title', `Контекст пользователя ${authorName}`);
      authorSpan.setAttribute('aria-label', `Контекст пользователя ${authorName}`);
      authorSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onOpenUserContext(message);
      });
      authorSpan.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          options.onOpenUserContext(message);
        }
      });
    }

    headerLine.appendChild(authorSpan);

    if (authorRole) {
      const roleBadge = createRoleBadgeElement(authorRole);
      if (roleBadge) headerLine.appendChild(roleBadge);
    }

    if (techInfo && techInfo.shouldHighlight) {
      const techBadge = createTechIssueBadgeElement(techInfo, options);
      if (techBadge) headerLine.appendChild(techBadge);
    }

    if (isSynthetic && options.isMessageLabEnabled) {
      const qaBadge = document.createElement('span');
      qaBadge.className = 'chat-badge badge-qa';
      qaBadge.textContent = 'QA';
      qaBadge.title = 'Synthetic QA message (Message Lab)';
      headerLine.appendChild(qaBadge);
    }

    const timeStr = formatMessageTime(message);
    if (timeStr) {
      const timeSpan = document.createElement('span');
      timeSpan.className = 'chat-time';
      timeSpan.textContent = timeStr;
      headerLine.appendChild(timeSpan);
    }
    body.appendChild(headerLine);

    // Reply Quote Snippet (Compact)
    if (message.reply && typeof message.reply === 'object') {
      const replyAuthor = typeof message.reply.author === 'string' ? message.reply.author.trim() : '';
      const replyText = typeof message.reply.text === 'string' ? message.reply.text.trim() : '';
      if (replyAuthor || replyText) {
        const replyBlock = document.createElement('div');
        replyBlock.className = 'chat-reply';

        const arrow = document.createElement('span');
        arrow.className = 'reply-arrow';
        arrow.textContent = '↳';

        const replyAuthorSpan = document.createElement('span');
        replyAuthorSpan.className = 'reply-author';
        replyAuthorSpan.textContent = replyAuthor ? `@${replyAuthor}:` : '';

        const replyTextSpan = document.createElement('span');
        replyTextSpan.className = 'reply-text';
        replyTextSpan.textContent = replyText;

        replyBlock.append(arrow, replyAuthorSpan, replyTextSpan);
        body.appendChild(replyBlock);
      }
    }

    // Message Content Line
    const contentSpan = document.createElement('div');
    contentSpan.className = 'chat-content';
    renderMessageSegments(contentSpan, message, options);
    body.appendChild(contentSpan);

    card.appendChild(body);
    return card;
  }

  /**
   * Initializes the Chat Monitor App logic on a given DOM container.
   */
  function createChatMonitorApp(options = {}) {
    const documentObj = options.document || (typeof document !== 'undefined' ? document : null);
    if (!documentObj) return null;
    const windowObj = options.window || (typeof window !== 'undefined' ? window : null);

    const apiOrigin = options.apiOrigin || (root.boostyMonitor?.apiOrigin || 'http://127.0.0.1:17369');
    const monitorIpc = options.monitorIpc || root.boostyMonitor || null;
    const isMessageLabEnabled = options.isMessageLabEnabled !== undefined
      ? Boolean(options.isMessageLabEnabled)
      : Boolean(monitorIpc?.isMessageLabEnabled);

    // DOM Elements
    const chatContainer = options.chatContainer || documentObj.querySelector('#chat-container');
    const messagesList = options.messagesList || documentObj.querySelector('#messages-list');
    const emptyState = options.emptyState || documentObj.querySelector('#empty-state');
    const noResultsState = options.noResultsState || documentObj.querySelector('#no-results-state');
    const statusBadge = options.statusBadge || documentObj.querySelector('#monitor-status');
    const statusText = options.statusText || documentObj.querySelector('#monitor-status-text');
    const monitorLayout = options.monitorLayout || documentObj.querySelector('.monitor-layout');
    const btnDensity = options.btnDensity || documentObj.querySelector('#btn-density');
    const btnAot = options.btnAot || documentObj.querySelector('#btn-always-on-top');
    const btnPause = options.btnPause || documentObj.querySelector('#btn-pause');
    const btnPauseLabel = options.btnPauseLabel || documentObj.querySelector('#btn-pause-label');
    const pauseBanner = options.pauseBanner || documentObj.querySelector('#pause-banner');
    const pausedCountEl = options.pausedCountEl || documentObj.querySelector('#paused-count');
    const btnResumeBanner = options.btnResumeBanner || documentObj.querySelector('#btn-resume-banner');
    const btnClear = options.btnClear || documentObj.querySelector('#btn-clear');
    const btnScrollBottom = options.btnScrollBottom || documentObj.querySelector('#btn-scroll-bottom');
    const unreadCountBadge = options.unreadCountBadge || documentObj.querySelector('#unread-count-badge');
    const appVariant = options.appVariant || monitorIpc?.appVariant || null;
    const isLab = Boolean(appVariant?.isLab);
    const monitorBaseTitle = appVariant?.monitorWindowTitle || (isLab ? 'Boosty Chat Monitor — Lab' : 'Boosty Chat Monitor');
    const badgeLab = options.badgeLab || documentObj.querySelector('#monitor-lab-badge');
    const btnMessageLab = options.btnMessageLab || documentObj.querySelector('#btn-message-lab');
    const messageLabDrawer = options.messageLabDrawer || documentObj.querySelector('#message-lab-drawer');
    let messageLabInstance = null;

    // Attention Toolbar Elements
    const filterTabs = options.filterTabs || documentObj.querySelectorAll('.filter-tab');
    const badgeImportant = options.badgeImportant || documentObj.querySelector('#badge-important');
    const badgeMentions = options.badgeMentions || documentObj.querySelector('#badge-mentions');
    const badgeReplies = options.badgeReplies || documentObj.querySelector('#badge-replies');
    const badgeTech = options.badgeTech || documentObj.querySelector('#badge-tech');
    const btnSearchToggle = options.btnSearchToggle || documentObj.querySelector('#btn-search-toggle');
    const searchPanel = options.searchPanel || documentObj.querySelector('#search-panel');
    const searchInput = options.searchInput || documentObj.querySelector('#search-input');
    const btnSearchClear = options.btnSearchClear || documentObj.querySelector('#btn-search-clear');
    const searchMatchCount = options.searchMatchCount || documentObj.querySelector('#search-match-count');

    // Technical Issue Sticky Banner Elements
    const techIssueBanner = options.techIssueBanner || documentObj.querySelector('#tech-issue-banner');
    const techBannerSeverity = options.techBannerSeverity || documentObj.querySelector('#tech-banner-severity');
    const techBannerSummary = options.techBannerSummary || documentObj.querySelector('#tech-banner-summary');
    const btnTechShow = options.btnTechShow || documentObj.querySelector('#btn-tech-show');
    const btnTechDismiss = options.btnTechDismiss || documentObj.querySelector('#btn-tech-dismiss');

    const techAggregator = TechIssuesModule && typeof TechIssuesModule.createTechnicalIssueAggregator === 'function'
      ? TechIssuesModule.createTechnicalIssueAggregator(options.techAggregatorOptions || {})
      : null;

    // User Context Panel Elements
    const userContextPanel = options.userContextPanel || documentObj.querySelector('#user-context-panel');
    const userContextAvatar = options.userContextAvatar || documentObj.querySelector('#user-context-avatar');
    const userContextUsername = options.userContextUsername || documentObj.querySelector('#user-context-username');
    const userContextRoleBadge = options.userContextRoleBadge || documentObj.querySelector('#user-context-role-badge');
    const userContextMeta = options.userContextMeta || documentObj.querySelector('#user-context-meta');
    const btnUserContextCopy = options.btnUserContextCopy || documentObj.querySelector('#btn-user-context-copy');
    const btnUserContextClose = options.btnUserContextClose || documentObj.querySelector('#btn-user-context-close');
    const userContextSummary = options.userContextSummary || documentObj.querySelector('#user-context-summary');
    const userContextSearchInput = options.userContextSearchInput || documentObj.querySelector('#user-context-search-input');
    const btnUserContextSearchClear = options.btnUserContextSearchClear || documentObj.querySelector('#btn-user-context-search-clear');
    const userContextBody = options.userContextBody || documentObj.querySelector('#user-context-body');
    const btnUserContextShowMore = options.btnUserContextShowMore || documentObj.querySelector('#btn-user-context-show-more');
    const userContextEmpty = options.userContextEmpty || documentObj.querySelector('#user-context-empty');
    const userContextMessagesList = options.userContextMessagesList || documentObj.querySelector('#user-context-messages-list');
    const userContextToast = options.userContextToast || documentObj.querySelector('#user-context-toast');

    // State
    const allMessages = [];
    const seenMessageIds = new Set();
    const pausedQueue = [];
    const pausedTechCountedIds = new Set();
    let activeFilter = 'all'; // 'all' | 'important' | 'mentions' | 'replies' | 'tech'
    let searchQuery = '';
    let isSearchOpen = false;
    let isPaused = false;
    let followLatest = true;
    let isScrolledUp = false;
    let unreadTotal = 0;
    let unreadImportant = 0;
    let unreadMentions = 0;
    let unreadReplies = 0;
    let unreadTech = 0;
    let eventSource = null;
    let decayInterval = null;
    let currentStatus = 'waiting';
    let alwaysOnTop = false;
    let isCompact = false;

    // User Context State
    let activeUserKey = null;
    let activeUserInfo = null;
    let userContextLimit = 10;
    let userContextSearchQuery = '';
    let userContextToastTimer = null;
    let isUserContextOpenState = false;

    function setCompactMode(enabled) {
      isCompact = Boolean(enabled);
      if (monitorLayout) {
        monitorLayout.classList.toggle('density-compact', isCompact);
      }
      if (btnDensity) {
        btnDensity.classList.toggle('active', isCompact);
        btnDensity.setAttribute('aria-pressed', String(isCompact));
      }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('boosty_monitor_compact', isCompact ? '1' : '0');
        }
      } catch {}
    }

    function toggleCompactMode() {
      setCompactMode(!isCompact);
    }

    function setStatus(statusKey, text) {
      currentStatus = statusKey;
      if (statusBadge) {
        statusBadge.className = `status-badge status-${statusKey}`;
      }
      if (statusText) {
        statusText.textContent = text;
      }
    }

    function updateBadges() {
      if (badgeImportant) {
        if (unreadImportant > 0) {
          badgeImportant.textContent = unreadImportant > 99 ? '99+' : String(unreadImportant);
          badgeImportant.style.display = 'inline-flex';
        } else {
          badgeImportant.style.display = 'none';
        }
      }
      if (badgeMentions) {
        if (unreadMentions > 0) {
          badgeMentions.textContent = unreadMentions > 99 ? '99+' : String(unreadMentions);
          badgeMentions.style.display = 'inline-flex';
        } else {
          badgeMentions.style.display = 'none';
        }
      }
      if (badgeReplies) {
        if (unreadReplies > 0) {
          badgeReplies.textContent = unreadReplies > 99 ? '99+' : String(unreadReplies);
          badgeReplies.style.display = 'inline-flex';
        } else {
          badgeReplies.style.display = 'none';
        }
      }
      if (badgeTech) {
        if (unreadTech > 0) {
          badgeTech.textContent = unreadTech > 99 ? '99+' : String(unreadTech);
          badgeTech.style.display = 'inline-flex';
        } else {
          badgeTech.style.display = 'none';
        }
      }
      if (unreadCountBadge) {
        if (unreadTotal > 0 && isScrolledUp) {
          unreadCountBadge.textContent = unreadTotal > 99 ? '99+' : String(unreadTotal);
          unreadCountBadge.style.display = 'inline-block';
        } else {
          unreadCountBadge.style.display = 'none';
        }
      }
      if (documentObj) {
        documentObj.title = unreadTotal > 0 ? `Boosty Chat (${unreadTotal > 99 ? '99+' : unreadTotal})` : monitorBaseTitle;
      }
    }

    function checkResetUnread(resetTechOnFocus = false) {
      const hasFocus = typeof documentObj.hasFocus === 'function' ? documentObj.hasFocus() : true;
      if (hasFocus && isUserNearBottom() && !isPaused) {
        unreadTotal = 0;
        unreadImportant = 0;
        unreadMentions = 0;
        unreadReplies = 0;
        if (activeFilter === 'tech' || resetTechOnFocus) {
          unreadTech = 0;
        }
        updateBadges();
      }
    }

    function updateTechBannerUi(preserveFollowState = followLatest) {
      if (!techIssueBanner || !techAggregator) return;
      const activeAlert = techAggregator.getActiveAlert();
      const wasVisible = techIssueBanner.style.display !== 'none';

      if (!activeAlert) {
        techIssueBanner.style.display = 'none';
        techIssueBanner.className = 'tech-issue-banner';
        delete techIssueBanner.dataset.issueType;
        delete techIssueBanner.dataset.severity;
        if (wasVisible && preserveFollowState && chatContainer) {
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        return;
      }

      techIssueBanner.style.display = 'flex';
      techIssueBanner.className = `tech-issue-banner severity-${activeAlert.severity}`;
      techIssueBanner.dataset.issueType = activeAlert.type;
      techIssueBanner.dataset.severity = activeAlert.severity;

      if (techBannerSeverity) {
        const sevUpper = activeAlert.severityUpper || getSeverityDisplayName(activeAlert.severity, { uppercase: true });
        const issueTitle = activeAlert.typeLabel || getTechIssueLabel(activeAlert.type);
        techBannerSeverity.textContent = sevUpper ? `${sevUpper} · ${issueTitle}` : issueTitle;
      }
      if (techBannerSummary) {
        techBannerSummary.textContent = activeAlert.summary;
      }

      if (!wasVisible && preserveFollowState && chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    }

    function dismissTechAlert(type = null) {
      if (!techAggregator) return false;
      const dismissed = techAggregator.dismiss(type);
      updateTechBannerUi(followLatest);
      return dismissed;
    }

    function updateEmptyOrNoResultsState(visibleCount) {
      if (allMessages.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        if (noResultsState) noResultsState.style.display = 'none';
      } else if (visibleCount === 0) {
        if (emptyState) emptyState.style.display = 'none';
        if (noResultsState) noResultsState.style.display = 'flex';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        if (noResultsState) noResultsState.style.display = 'none';
      }
    }

    function isUserNearBottom() {
      if (!chatContainer) return true;
      const scrollHeight = chatContainer.scrollHeight || 0;
      const scrollTop = chatContainer.scrollTop || 0;
      const clientHeight = chatContainer.clientHeight || 0;
      return (scrollHeight - scrollTop - clientHeight) <= BOTTOM_THRESHOLD_PX;
    }

    function scrollToBottom(explicitUserAction = false) {
      if (!chatContainer) return;
      followLatest = true;
      isScrolledUp = false;

      chatContainer.scrollTop = chatContainer.scrollHeight;
      if (btnScrollBottom) btnScrollBottom.style.display = 'none';
      checkResetUnread(Boolean(explicitUserAction));

      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          if (followLatest && chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
        });
      }
    }

    function updatePausedUi() {
      if (btnPause) {
        btnPause.classList.toggle('active', isPaused);
        btnPause.setAttribute('aria-pressed', String(isPaused));
        btnPause.title = isPaused ? 'Возобновить визуальное обновление чата' : 'Приостановить визуальное обновление чата';
        btnPause.setAttribute('aria-label', isPaused ? 'Возобновить' : 'Пауза');
        const iconPause = btnPause.querySelector('.icon-pause');
        const iconPlay = btnPause.querySelector('.icon-play');
        if (iconPause) iconPause.style.display = isPaused ? 'none' : 'block';
        if (iconPlay) iconPlay.style.display = isPaused ? 'block' : 'none';
      }
      if (btnPauseLabel) {
        btnPauseLabel.textContent = isPaused ? 'Возобновить' : 'Пауза';
      }
      if (pauseBanner) {
        pauseBanner.style.display = isPaused ? 'flex' : 'none';
      }
      if (pausedCountEl) {
        pausedCountEl.textContent = String(pausedQueue.length);
      }
    }

    function pruneDom() {
      if (!messagesList) return;
      while (messagesList.children.length > MAX_DOM_MESSAGES) {
        const first = messagesList.firstElementChild;
        if (first) first.remove();
        else break;
      }
    }

    function applyFilterAndRender() {
      if (!messagesList) return;
      messagesList.innerHTML = '';
      let matchCount = 0;
      for (const msg of allMessages) {
        if (messageMatchesFilter(msg, activeFilter) && messageMatchesSearch(msg, searchQuery)) {
          const card = createChatCard(msg, {
            isMessageLabEnabled,
            isLab,
            onOpenUserContext: (m) => openUserContext(m),
            onMediaLoad: () => {
              if (followLatest && chatContainer) {
                scrollToBottom(false);
              }
            },
          });
          messagesList.appendChild(card);
          matchCount++;
        }
      }
      pruneDom();
      updateEmptyOrNoResultsState(matchCount);

      if (searchMatchCount) {
        if (searchQuery.trim().length > 0) {
          searchMatchCount.textContent = String(matchCount);
          searchMatchCount.style.display = 'inline-block';
        } else {
          searchMatchCount.style.display = 'none';
        }
      }

      if (followLatest) {
        scrollToBottom(false);
      }
    }

    function setFilter(newFilter) {
      if (!['all', 'important', 'mentions', 'replies', 'tech'].includes(newFilter)) return;
      activeFilter = newFilter;
      if (filterTabs && filterTabs.length > 0) {
        filterTabs.forEach(tab => {
          const matches = tab.dataset.filter === activeFilter;
          tab.classList.toggle('active', matches);
          tab.setAttribute('aria-selected', String(matches));
        });
      }
      if (activeFilter === 'tech') {
        unreadTech = 0;
        updateBadges();
      }
      applyFilterAndRender();
      checkResetUnread();
    }

    function setSearchQuery(q) {
      searchQuery = String(q || '');
      if (btnSearchClear) {
        btnSearchClear.style.display = searchQuery.length > 0 ? 'inline-flex' : 'none';
      }
      applyFilterAndRender();
    }

    function openSearchPanel() {
      isSearchOpen = true;
      if (searchPanel) searchPanel.style.display = 'flex';
      if (btnSearchToggle) {
        btnSearchToggle.classList.add('active');
        btnSearchToggle.setAttribute('aria-expanded', 'true');
      }
      if (searchInput) {
        searchInput.focus();
        if (typeof searchInput.select === 'function') searchInput.select();
      }
    }

    function closeSearchPanel() {
      isSearchOpen = false;
      if (searchPanel) searchPanel.style.display = 'none';
      if (btnSearchToggle) {
        btnSearchToggle.classList.remove('active');
        btnSearchToggle.setAttribute('aria-expanded', 'false');
      }
      if (searchQuery) {
        if (searchInput) searchInput.value = '';
        setSearchQuery('');
      }
    }

    function toggleSearchPanel() {
      if (isSearchOpen) closeSearchPanel();
      else openSearchPanel();
    }

    function appendMessageCard(message) {
      if (!messagesList) return null;
      if (messageMatchesFilter(message, activeFilter) && messageMatchesSearch(message, searchQuery)) {
        const card = createChatCard(message, {
          isMessageLabEnabled,
          isLab,
          onOpenUserContext: (m) => openUserContext(m),
          onMediaLoad: () => {
            if (followLatest && chatContainer) {
              scrollToBottom(false);
            }
          },
        });
        messagesList.appendChild(card);
        pruneDom();
        updateEmptyOrNoResultsState(messagesList.children.length);
        return card;
      }
      updateEmptyOrNoResultsState(messagesList.children.length);
      return null;
    }

    function handleIncomingMessage(message) {
      if (!message || !message.id) return;
      const msgId = String(message.id);

      if (seenMessageIds.has(msgId)) {
        return; // DEDUP
      }
      seenMessageIds.add(msgId);
      if (seenMessageIds.size > 2000) {
        const oldestId = seenMessageIds.values().next().value;
        seenMessageIds.delete(oldestId);
      }

      allMessages.push(message);
      if (allMessages.length > MAX_DOM_MESSAGES) {
        allMessages.shift();
      }

      const wasFollowLatest = followLatest;

      // Always classify and aggregate technical issues even when paused
      const techInfo = getMessageTechIssue(message);
      if (techAggregator && techInfo && techInfo.isTechnicalIssue) {
        techAggregator.ingest(message, techInfo);
        updateTechBannerUi(wasFollowLatest);
      }

      // Live update User Context Panel if open for this author
      if (isUserContextOpen()) {
        const incomingAuthorKey = getMessageAuthorKey(message);
        if (incomingAuthorKey === activeUserKey) {
          let wasNearBottom = true;
          if (userContextBody) {
            wasNearBottom = (userContextBody.scrollHeight - userContextBody.scrollTop - userContextBody.clientHeight) <= 30;
          }
          renderUserContext(false);
          if (wasNearBottom && userContextBody) {
            userContextBody.scrollTop = userContextBody.scrollHeight;
          }
        }
      }

      if (isPaused) {
        pausedQueue.push(message);
        if (pausedCountEl) pausedCountEl.textContent = String(pausedQueue.length);
        if (isMessageTechIssue(message)) {
          unreadTech++;
          pausedTechCountedIds.add(msgId);
          updateBadges();
        }
        return;
      }

      const appendedCard = appendMessageCard(message);
      setStatus('connected', 'Подключено');

      if (appendedCard && wasFollowLatest) {
        scrollToBottom(false);
      }

      const hasFocus = typeof documentObj.hasFocus === 'function' ? documentObj.hasFocus() : true;
      const isReadImmediately = hasFocus && wasFollowLatest;

      if (isReadImmediately) {
        checkResetUnread(false);
        if (isMessageTechIssue(message) && activeFilter !== 'tech') {
          unreadTech++;
          updateBadges();
        }
      } else {
        unreadTotal++;
        if (isMessageImportant(message)) unreadImportant++;
        if (isMessageMention(message)) unreadMentions++;
        if (isMessageReply(message)) unreadReplies++;
        if (isMessageTechIssue(message)) unreadTech++;

        if (!wasFollowLatest && btnScrollBottom) {
          btnScrollBottom.style.display = 'flex';
        }
        updateBadges();
      }
    }

    function resume() {
      if (!isPaused) return;
      isPaused = false;
      updatePausedUi();

      if (pausedQueue.length > 0) {
        const toFlush = [...pausedQueue];
        pausedQueue.length = 0;
        const wasFollowLatest = followLatest;
        let anyAppended = false;

        for (const msg of toFlush) {
          const card = appendMessageCard(msg);
          if (card) anyAppended = true;
        }
        setStatus('connected', 'Подключено');

        if (anyAppended && wasFollowLatest) {
          scrollToBottom(false);
        }

        const hasFocus = typeof documentObj.hasFocus === 'function' ? documentObj.hasFocus() : true;
        if (hasFocus && wasFollowLatest) {
          checkResetUnread(false);
        } else {
          for (const msg of toFlush) {
            unreadTotal++;
            if (isMessageImportant(msg)) unreadImportant++;
            if (isMessageMention(msg)) unreadMentions++;
            if (isMessageReply(msg)) unreadReplies++;
            const mId = String(msg.id || '');
            if (isMessageTechIssue(msg) && !pausedTechCountedIds.has(mId)) {
              unreadTech++;
            }
          }
          if (!wasFollowLatest && btnScrollBottom) {
            btnScrollBottom.style.display = 'flex';
          }
          updateBadges();
        }
        pausedTechCountedIds.clear();
      }
    }

    function pause() {
      if (isPaused) return;
      isPaused = true;
      updatePausedUi();
    }

    function togglePause() {
      if (isPaused) resume();
      else pause();
    }

    function clearView() {
      if (messagesList) messagesList.innerHTML = '';
      allMessages.length = 0;
      pausedQueue.length = 0;
      pausedTechCountedIds.clear();
      unreadTotal = 0;
      unreadImportant = 0;
      unreadMentions = 0;
      unreadReplies = 0;
      unreadTech = 0;
      followLatest = true;
      isScrolledUp = false;
      if (techAggregator) {
        techAggregator.clear();
      }
      updateTechBannerUi(true);
      if (btnScrollBottom) btnScrollBottom.style.display = 'none';
      if (pausedCountEl) pausedCountEl.textContent = '0';
      updateBadges();
      updateEmptyOrNoResultsState(0);
      setStatus('waiting', 'Ожидание сообщений');
      if (isUserContextOpen()) {
        renderUserContext(true);
      }
    }

    async function toggleAlwaysOnTop() {
      if (!monitorIpc || typeof monitorIpc.setAlwaysOnTop !== 'function') return;
      try {
        const nextState = !alwaysOnTop;
        const res = await monitorIpc.setAlwaysOnTop(nextState);
        alwaysOnTop = Boolean(res?.alwaysOnTop !== undefined ? res.alwaysOnTop : nextState);
        updateAotUi();
      } catch (err) {
        console.error('Failed to toggle Always on Top:', err);
      }
    }

    function updateAotUi() {
      if (btnAot) {
        btnAot.classList.toggle('active', alwaysOnTop);
        btnAot.setAttribute('aria-pressed', String(alwaysOnTop));
      }
    }

    // --- User Context Panel Logic ---

    function formatMessagesCountText(count) {
      if (I18n && typeof I18n.formatPlural === 'function') {
        return I18n.formatPlural(count, ['сообщение', 'сообщения', 'сообщений']);
      }
      const n = Math.abs(Number(count) || 0);
      const mod10 = n % 10;
      const mod100 = n % 100;
      if (mod100 >= 11 && mod100 <= 19) return `${n} сообщений`;
      if (mod10 === 1) return `${n} сообщение`;
      if (mod10 >= 2 && mod10 <= 4) return `${n} сообщения`;
      return `${n} сообщений`;
    }

    function isUserContextOpen() {
      return Boolean(isUserContextOpenState && userContextPanel && userContextPanel.style.display !== 'none');
    }

    function showUserContextToast(text) {
      if (!userContextToast) return;
      if (userContextToastTimer) {
        clearTimeout(userContextToastTimer);
        userContextToastTimer = null;
      }
      userContextToast.textContent = text || '';
      userContextToast.style.display = 'block';
      userContextToastTimer = setTimeout(() => {
        if (userContextToast) userContextToast.style.display = 'none';
        userContextToastTimer = null;
      }, 2200);
    }

    function jumpToMessage(messageId) {
      if (!messageId || !messagesList) return;
      const idStr = String(messageId);
      const targetCard = messagesList.querySelector(`[data-message-id="${idStr}"]`);

      if (!targetCard) {
        showUserContextToast('Сообщение уже вне текущей ленты');
        return;
      }

      followLatest = false;
      isScrolledUp = true;
      if (btnScrollBottom) btnScrollBottom.style.display = 'flex';

      try {
        targetCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        if (chatContainer) {
          chatContainer.scrollTop = targetCard.offsetTop - (chatContainer.clientHeight / 2);
        }
      }

      targetCard.classList.remove('jump-highlight');
      void targetCard.offsetWidth;
      targetCard.classList.add('jump-highlight');
      setTimeout(() => {
        targetCard.classList.remove('jump-highlight');
      }, 1800);
    }

    function renderUserContext(resetScroll = true) {
      if (!userContextPanel || !activeUserKey || !activeUserInfo) return;

      // 1. Header Avatar
      if (userContextAvatar) {
        userContextAvatar.innerHTML = '';
        if (activeUserInfo.avatar && isSafeEmojiUrl(activeUserInfo.avatar)) {
          const img = document.createElement('img');
          img.className = 'chat-avatar';
          img.src = activeUserInfo.avatar;
          img.alt = '';
          img.loading = 'lazy';
          img.draggable = false;
          img.onerror = () => {
            img.replaceWith(createFallbackAvatar(activeUserInfo.name));
          };
          userContextAvatar.appendChild(img);
        } else {
          userContextAvatar.appendChild(createFallbackAvatar(activeUserInfo.name));
        }
      }

      // 2. Header Username
      if (userContextUsername) {
        userContextUsername.textContent = activeUserInfo.name || 'Пользователь';
        userContextUsername.title = activeUserInfo.name || '';
      }

      // 3. Header Role Badge
      if (userContextRoleBadge) {
        userContextRoleBadge.innerHTML = '';
        if (activeUserInfo.role) {
          userContextRoleBadge.style.display = 'inline-flex';
          userContextRoleBadge.className = `chat-badge badge-${activeUserInfo.role}`;
          const badgeContent = createRoleBadgeElement(activeUserInfo.role);
          if (badgeContent) {
            userContextRoleBadge.appendChild(badgeContent.cloneNode(true));
          }
        } else {
          userContextRoleBadge.style.display = 'none';
        }
      }

      // 4. User messages & counts
      const allUserMessages = allMessages.filter(msg => getMessageAuthorKey(msg) === activeUserKey);
      const totalCount = allUserMessages.length;

      const roleLabel = getRoleDisplayName(activeUserInfo.role);

      if (userContextMeta) {
        userContextMeta.textContent = `${roleLabel} · ${formatMessagesCountText(totalCount)}`;
      }

      // 5. Search filtering
      const q = userContextSearchQuery.trim().toLowerCase();
      const filteredMessages = q
        ? allUserMessages.filter(msg => {
            const text = typeof msg.text === 'string' ? msg.text.toLowerCase() : '';
            return text.includes(q);
          })
        : allUserMessages;

      // 6. Pagination (last N messages, chronological: oldest at top, newest at bottom)
      const startIndex = Math.max(0, filteredMessages.length - userContextLimit);
      const visibleMessages = filteredMessages.slice(startIndex);
      const hasEarlier = startIndex > 0;

      if (btnUserContextShowMore) {
        btnUserContextShowMore.style.display = hasEarlier ? 'block' : 'none';
        btnUserContextShowMore.textContent = 'Показать более ранние (+10)';
      }

      // 7. Summary counts across allUserMessages
      let mentionCount = 0;
      let replyCount = 0;
      let techCount = 0;
      for (const msg of allUserMessages) {
        if (isMessageMention(msg)) mentionCount++;
        if (isMessageReply(msg)) replyCount++;
        if (isMessageTechIssue(msg)) techCount++;
      }

      if (userContextSummary) {
        if (q) {
          userContextSummary.textContent = `Найдено: ${filteredMessages.length} из ${totalCount} · ${mentionCount} упом. · ${replyCount} отв. · ${techCount} техжалоб`;
        } else if (totalCount <= userContextLimit) {
          userContextSummary.textContent = `Всего ${formatMessagesCountText(totalCount)} · ${mentionCount} упом. · ${replyCount} отв. · ${techCount} техжалоб`;
        } else {
          userContextSummary.textContent = `Последние ${visibleMessages.length} сообщений · ${mentionCount} упом. · ${replyCount} отв. · ${techCount} техжалоб`;
        }
      }

      // 8. Render message cards
      if (userContextMessagesList) {
        userContextMessagesList.innerHTML = '';
        if (visibleMessages.length === 0) {
          if (userContextEmpty) {
            userContextEmpty.style.display = 'block';
            userContextEmpty.textContent = q ? 'Ничего не найдено' : 'Сообщений пока нет';
          }
        } else {
          if (userContextEmpty) userContextEmpty.style.display = 'none';

          for (const msg of visibleMessages) {
            const msgCard = document.createElement('div');
            msgCard.className = 'user-context-msg';
            msgCard.dataset.messageId = String(msg.id || '');
            msgCard.setAttribute('role', 'button');
            msgCard.setAttribute('tabindex', '0');
            msgCard.setAttribute('title', 'Перейти к сообщению в ленте');

            // Header line (time + tags)
            const msgHeader = document.createElement('div');
            msgHeader.className = 'user-context-msg-header';

            const timeSpan = document.createElement('span');
            timeSpan.className = 'user-context-msg-time';
            timeSpan.textContent = formatMessageTime(msg) || '';
            msgHeader.appendChild(timeSpan);

            const tagsWrap = document.createElement('div');
            tagsWrap.className = 'user-context-msg-tags';

            if (isMessageMention(msg)) {
              const mentionTag = document.createElement('span');
              mentionTag.className = 'user-context-tag user-context-tag-mention';
              mentionTag.textContent = '@Упоминание';
              tagsWrap.appendChild(mentionTag);
            }

            if (isMessageReply(msg)) {
              const replyTag = document.createElement('span');
              replyTag.className = 'user-context-tag user-context-tag-reply';
              replyTag.textContent = '↳ Ответ';
              tagsWrap.appendChild(replyTag);
            }

            const techInfo = getMessageTechIssue(msg);
            if (techInfo && techInfo.shouldHighlight) {
              const techTag = document.createElement('span');
              techTag.className = 'user-context-tag user-context-tag-tech';
              const typeLabel = getTechIssueLabel(techInfo.type);
              techTag.textContent = `▲ Техпроблема: ${typeLabel}`;
              if (isMessageLabEnabled) {
                techTag.title = `type: ${techInfo.type} (${techInfo.confidence})`;
              }
              tagsWrap.appendChild(techTag);
            }

            msgHeader.appendChild(tagsWrap);
            msgCard.appendChild(msgHeader);

            // Reply snippet
            if (msg.reply && typeof msg.reply === 'object') {
              const replyAuthor = typeof msg.reply.author === 'string' ? msg.reply.author.trim() : '';
              const replyText = typeof msg.reply.text === 'string' ? msg.reply.text.trim() : '';
              if (replyAuthor || replyText) {
                const replyBlock = document.createElement('div');
                replyBlock.className = 'user-context-msg-reply';
                replyBlock.textContent = `↳ ${replyAuthor ? `@${replyAuthor}: ` : ''}${replyText}`;
                msgCard.appendChild(replyBlock);
              }
            }

            // Message text
            const textBlock = document.createElement('div');
            textBlock.className = 'user-context-msg-text';
            renderMessageSegments(textBlock, msg);
            msgCard.appendChild(textBlock);

            // Jump handlers
            msgCard.addEventListener('click', () => {
              jumpToMessage(msg.id);
            });
            msgCard.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                jumpToMessage(msg.id);
              }
            });

            userContextMessagesList.appendChild(msgCard);
          }
        }
      }

      if (resetScroll && userContextBody) {
        userContextBody.scrollTop = userContextBody.scrollHeight;
      }
    }

    function openUserContext(messageOrAuthor) {
      if (!userContextPanel) return;
      const authorInfo = getMessageAuthorInfo(messageOrAuthor);
      if (!authorInfo || !authorInfo.key) return;

      // Drawer Mutex: close Message Lab drawer if open
      if (messageLabInstance && typeof messageLabInstance.close === 'function') {
        messageLabInstance.close();
      }
      if (messageLabDrawer) {
        messageLabDrawer.style.display = 'none';
      }

      activeUserKey = authorInfo.key;
      activeUserInfo = authorInfo;
      userContextLimit = 10;
      userContextSearchQuery = '';
      isUserContextOpenState = true;

      if (userContextSearchInput) {
        userContextSearchInput.value = '';
      }
      if (btnUserContextSearchClear) {
        btnUserContextSearchClear.style.display = 'none';
      }

      userContextPanel.style.display = 'flex';
      void userContextPanel.offsetHeight;
      userContextPanel.classList.add('open');
      userContextPanel.setAttribute('aria-hidden', 'false');

      renderUserContext(true);
    }

    function closeUserContext() {
      if (!userContextPanel) return;
      isUserContextOpenState = false;
      userContextPanel.classList.remove('open');
      userContextPanel.style.display = 'none';
      userContextPanel.setAttribute('aria-hidden', 'true');
      if (userContextToast) {
        userContextToast.style.display = 'none';
      }
      if (userContextToastTimer) {
        clearTimeout(userContextToastTimer);
        userContextToastTimer = null;
      }
    }

    // Scroll container listener
    if (chatContainer) {
      chatContainer.addEventListener('scroll', () => {
        const nearBottom = isUserNearBottom();
        if (nearBottom) {
          followLatest = true;
          isScrolledUp = false;
          checkResetUnread(false);
          if (btnScrollBottom) btnScrollBottom.style.display = 'none';
        } else {
          followLatest = false;
          isScrolledUp = true;
        }
      });
    }

    // Window focus listener
    if (windowObj) {
      windowObj.addEventListener('focus', () => {
        checkResetUnread(true);
      });
    }

    // Filter tab buttons
    if (filterTabs && filterTabs.length > 0) {
      filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const filter = tab.dataset.filter;
          if (filter) setFilter(filter);
        });
      });
    }

    // Tech Issue Banner buttons
    if (btnTechShow) {
      btnTechShow.addEventListener('click', () => {
        setFilter('tech');
      });
    }

    if (btnTechDismiss) {
      btnTechDismiss.addEventListener('click', () => {
        dismissTechAlert();
      });
    }

    // Search controls
    if (btnSearchToggle) {
      btnSearchToggle.addEventListener('click', toggleSearchPanel);
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        setSearchQuery(e.target.value);
      });
    }

    if (btnSearchClear) {
      btnSearchClear.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        setSearchQuery('');
      });
    }

    // User Context Panel controls
    if (btnUserContextClose) {
      btnUserContextClose.addEventListener('click', closeUserContext);
    }

    if (btnUserContextCopy) {
      btnUserContextCopy.addEventListener('click', () => {
        if (activeUserInfo && activeUserInfo.name) {
          const nameToCopy = activeUserInfo.name;
          if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(nameToCopy).then(() => {
              showUserContextToast('Ник скопирован');
            }).catch(() => {
              showUserContextToast('Не удалось скопировать ник');
            });
          } else {
            showUserContextToast('Буфер обмена недоступен');
          }
        }
      });
    }

    if (btnUserContextShowMore) {
      btnUserContextShowMore.addEventListener('click', () => {
        let oldHeight = 0;
        let oldTop = 0;
        if (userContextBody) {
          oldHeight = userContextBody.scrollHeight;
          oldTop = userContextBody.scrollTop;
        }
        userContextLimit += 10;
        renderUserContext(false);
        if (userContextBody) {
          const heightDiff = userContextBody.scrollHeight - oldHeight;
          userContextBody.scrollTop = oldTop + heightDiff;
        }
      });
    }

    if (userContextSearchInput) {
      userContextSearchInput.addEventListener('input', (e) => {
        userContextSearchQuery = e.target.value || '';
        if (btnUserContextSearchClear) {
          btnUserContextSearchClear.style.display = userContextSearchQuery.length > 0 ? 'inline-flex' : 'none';
        }
        renderUserContext(true);
      });
    }

    if (btnUserContextSearchClear) {
      btnUserContextSearchClear.addEventListener('click', () => {
        userContextSearchQuery = '';
        if (userContextSearchInput) {
          userContextSearchInput.value = '';
          userContextSearchInput.focus();
        }
        btnUserContextSearchClear.style.display = 'none';
        renderUserContext(true);
      });
    }

    // Keyboard shortcuts
    if (documentObj) {
      documentObj.addEventListener('keydown', (e) => {
        const isCmdOrCtrl = e.ctrlKey || e.metaKey;

        // Ctrl+F / Cmd+F -> Toggle or Focus Search
        if (isCmdOrCtrl && (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
          e.preventDefault();
          openSearchPanel();
          return;
        }

        // Escape -> Clear user context search / close user context / search panel
        if (e.key === 'Escape') {
          if (isUserContextOpen()) {
            if (userContextSearchInput && userContextSearchInput.value) {
              userContextSearchInput.value = '';
              userContextSearchQuery = '';
              if (btnUserContextSearchClear) btnUserContextSearchClear.style.display = 'none';
              renderUserContext(true);
            } else {
              closeUserContext();
            }
            return;
          }
          if (isSearchOpen) {
            if (searchInput && searchInput.value) {
              searchInput.value = '';
              setSearchQuery('');
            } else {
              closeSearchPanel();
            }
          }
          return;
        }

        // Ctrl+1..5 -> Switch Filter Tabs
        if (isCmdOrCtrl && e.key === '1') {
          e.preventDefault();
          setFilter('all');
          return;
        }
        if (isCmdOrCtrl && e.key === '2') {
          e.preventDefault();
          setFilter('important');
          return;
        }
        if (isCmdOrCtrl && e.key === '3') {
          e.preventDefault();
          setFilter('mentions');
          return;
        }
        if (isCmdOrCtrl && e.key === '4') {
          e.preventDefault();
          setFilter('replies');
          return;
        }
        if (isCmdOrCtrl && e.key === '5') {
          e.preventDefault();
          setFilter('tech');
          return;
        }
      });
    }

    // Button interactions
    if (btnScrollBottom) {
      btnScrollBottom.addEventListener('click', () => scrollToBottom(true));
    }

    if (btnPause) {
      btnPause.addEventListener('click', togglePause);
    }

    if (btnResumeBanner) {
      btnResumeBanner.addEventListener('click', resume);
    }

    if (btnDensity) {
      btnDensity.addEventListener('click', toggleCompactMode);
    }

    if (btnClear) {
      btnClear.addEventListener('click', clearView);
    }

    if (btnAot) {
      btnAot.addEventListener('click', toggleAlwaysOnTop);
    }

    // Initial state & history
    async function init() {
      // Restore density / compact mode preference
      try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('boosty_monitor_compact') === '1') {
          setCompactMode(true);
        }
      } catch {}

      // Restore initial Always on Top state from IPC
      if (monitorIpc && typeof monitorIpc.getState === 'function') {
        try {
          const state = await monitorIpc.getState();
          alwaysOnTop = Boolean(state?.alwaysOnTop);
          updateAotUi();
        } catch (err) {
          console.warn('Could not retrieve monitor state:', err);
        }
      }

      // Periodic decay check for active technical issues
      if (techAggregator && !decayInterval) {
        decayInterval = setInterval(() => {
          updateTechBannerUi(followLatest);
        }, 5000);
        if (decayInterval && typeof decayInterval.unref === 'function') {
          decayInterval.unref();
        }
      }

      // Fetch initial history
      try {
        const fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);
        if (fetchFn) {
          const res = await fetchFn(`${apiOrigin}/history`);
          if (res && res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              const recent = data.slice(-HISTORY_INITIAL_LIMIT);
              for (const msg of recent) {
                if (msg && msg.id && !seenMessageIds.has(String(msg.id))) {
                  seenMessageIds.add(String(msg.id));
                  allMessages.push(msg);
                }
              }
              if (allMessages.length > 0) {
                applyFilterAndRender();
                scrollToBottom(false);
                setStatus('connected', 'Подключено');
              } else {
                setStatus('waiting', 'Ожидание сообщений');
              }
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load initial chat history:', err);
        setStatus('offline', 'Нет связи');
      }

      updateEmptyOrNoResultsState(messagesList ? messagesList.children.length : 0);

      // Connect SSE
      const ESClass = options.EventSource || (typeof EventSource !== 'undefined' ? EventSource : null);
      if (ESClass) {
        try {
          eventSource = new ESClass(`${apiOrigin}/events`);
          eventSource.onopen = () => {
            const hasMessages = messagesList && messagesList.children.length > 0;
            setStatus(hasMessages ? 'connected' : 'waiting', hasMessages ? 'Подключено' : 'Ожидание сообщений');
          };
          eventSource.onerror = () => {
            setStatus('offline', 'Нет связи');
          };
          eventSource.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              handleIncomingMessage(msg);
            } catch (err) {
              console.error('Failed to parse incoming SSE message:', err);
            }
          };
        } catch (err) {
          console.error('Failed to create EventSource:', err);
          setStatus('offline', 'Нет связи');
        }
      }

      if (appVariant?.badge) {
        if (badgeLab) {
          badgeLab.textContent = appVariant.badge;
          badgeLab.style.display = 'inline-flex';
          if (appVariant.isFresh) {
            badgeLab.classList.add('badge-fresh');
          } else {
            badgeLab.classList.remove('badge-fresh');
          }
        }
        if (documentObj) {
          documentObj.title = monitorBaseTitle;
        }
      } else {
        if (badgeLab) {
          badgeLab.style.display = 'none';
        }
      }

      // Initialize Message Lab (QA mode only)
      if (isMessageLabEnabled) {
        if (btnMessageLab) {
          btnMessageLab.style.display = 'inline-flex';
        }
        const LabModule = options.BoostyMessageLab || (typeof root !== 'undefined' ? root.BoostyMessageLab : null);
        if (LabModule && typeof LabModule.createMessageLab === 'function') {
          messageLabInstance = LabModule.createMessageLab({
            document: documentObj,
            drawer: messageLabDrawer,
            btnToggle: btnMessageLab,
            apiOrigin,
            fetch: options.fetch || (typeof fetch !== 'undefined' ? fetch : null),
            monitorApp: {
              pause,
              resume,
              togglePause,
              clearView,
              scrollToBottom,
              openUserContext,
              closeUserContext,
              isUserContextOpen: () => isUserContextOpen(),
              isFollowLatest: () => followLatest,
              setFollowLatest: (val) => {
                followLatest = Boolean(val);
                isScrolledUp = !followLatest;
                if (followLatest) scrollToBottom(false);
              },
            },
          });
        }
      } else {
        if (btnMessageLab) {
          btnMessageLab.style.display = 'none';
        }
        if (messageLabDrawer) {
          messageLabDrawer.style.display = 'none';
        }
      }
    }

    return {
      init,
      handleIncomingMessage,
      pause,
      resume,
      togglePause,
      clearView,
      toggleAlwaysOnTop,
      scrollToBottom,
      openUserContext,
      closeUserContext,
      isUserContextOpen,
      getUserContextState: () => ({
        isOpen: isUserContextOpen(),
        userKey: activeUserKey,
        userInfo: activeUserInfo,
        limit: userContextLimit,
        searchQuery: userContextSearchQuery,
      }),
      jumpToMessage,
      showUserContextToast,
      renderUserContext,
      isFollowLatest: () => followLatest,
      setFollowLatest: (val) => {
        followLatest = Boolean(val);
        isScrolledUp = !followLatest;
        if (followLatest) {
          scrollToBottom(false);
        }
      },
      getStatus: () => currentStatus,
      isPaused: () => isPaused,
      isScrolledUp: () => isScrolledUp,
      getPausedCount: () => pausedQueue.length,
      getUnreadCount: () => unreadTotal,
      getUnreadCounters: () => ({
        total: unreadTotal,
        important: unreadImportant,
        mentions: unreadMentions,
        replies: unreadReplies,
        tech: unreadTech,
      }),
      getActiveFilter: () => activeFilter,
      setFilter,
      getSearchQuery: () => searchQuery,
      setSearchQuery,
      openSearchPanel,
      closeSearchPanel,
      toggleSearchPanel,
      isSearchOpen: () => isSearchOpen,
      getRenderedCount: () => (messagesList ? messagesList.children.length : 0),
      getAllMessagesCount: () => allMessages.length,
      getAlwaysOnTop: () => alwaysOnTop,
      setCompactMode,
      isCompactMode: () => isCompact,
      isMessageLabEnabled: () => isMessageLabEnabled,
      getMessageLab: () => messageLabInstance,
      getAppVariant: () => appVariant,
      isLab: () => isLab,
      getTechAggregator: () => techAggregator,
      getActiveTechAlert: () => (techAggregator ? techAggregator.getActiveAlert() : null),
      dismissTechAlert,
      updateTechBannerUi,
      classifyMessageTechIssue: getMessageTechIssue,
      destroy: () => {
        if (decayInterval) {
          clearInterval(decayInterval);
          decayInterval = null;
        }
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        if (userContextToastTimer) {
          clearTimeout(userContextToastTimer);
          userContextToastTimer = null;
        }
        if (messageLabInstance && typeof messageLabInstance.close === 'function') {
          messageLabInstance.close();
        }
      },
    };
  }

  // Auto-init in browser environment
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      const app = createChatMonitorApp();
      if (app) {
        window.__chatMonitorApp = app;
        app.init().catch(err => console.error('Chat Monitor init failed:', err));
      }
    });
  }

  const exportObj = {
    createChatMonitorApp,
    createChatCard,
    formatMessageTime,
    normalizeAuthorRole,
    getMessageAuthorKey,
    getMessageAuthorInfo,
    createRoleBadgeElement,
    createTechIssueBadgeElement,
    renderMessageSegments,
    isSafeEmojiUrl,
    isMessageMention,
    isMessageReply,
    isMessageImportant,
    isMessageTechIssue,
    getMessageTechIssue,
    messageMatchesFilter,
    messageMatchesSearch,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj;
  }
  root.BoostyChatMonitor = exportObj;
})(typeof globalThis !== 'undefined' ? globalThis : this);
