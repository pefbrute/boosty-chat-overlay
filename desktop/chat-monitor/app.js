'use strict';

/**
 * Boosty Chat Monitor — Renderer Application
 * Lightweight, high-readability stream chat window for streamers.
 */

(function(root) {
  const MAX_DOM_MESSAGES = 500;
  const BOTTOM_THRESHOLD_PX = 45;
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

  function createRoleBadgeElement(role) {
    const validRole = normalizeAuthorRole(role);
    if (!validRole) return null;

    const badge = document.createElement('span');
    badge.className = `chat-badge badge-${validRole}`;
    badge.setAttribute('title', validRole === 'streamer' ? 'Стример' : 'Модератор');
    badge.setAttribute('aria-label', validRole === 'streamer' ? 'Стример' : 'Модератор');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (validRole === 'streamer') {
      path.setAttribute('d', 'M8 1.35l1.98 4.02 4.44.64-3.21 3.13.76 4.42L8 11.47l-3.97 2.09.76-4.42L1.58 6.01l4.44-.64L8 1.35z');
      path.setAttribute('fill', 'currentColor');
    } else {
      path.setAttribute('d', 'M14.5 1.5L13.8 4.9L8.2 10.5L9.8 12.1L8.6 13.3L6.7 11.4L4.1 14.0A1.48 1.48 0 0 1 2.0 11.9L4.6 9.3L2.7 7.4L3.9 6.2L5.5 7.8L11.1 2.2Z');
      path.setAttribute('fill', 'currentColor');
    }
    svg.appendChild(path);
    badge.appendChild(svg);
    return badge;
  }

  function renderMessageSegments(container, message) {
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

  function createChatCard(message) {
    const card = document.createElement('article');
    card.className = 'chat-item';
    card.dataset.messageId = String(message.id || '');
    if (message.eventId !== undefined) {
      card.dataset.eventId = String(message.eventId);
    }

    const authorRole = normalizeAuthorRole(
      message.author && typeof message.author === 'object' && message.author.role !== undefined
        ? message.author.role
        : message.role
    );
    if (authorRole) {
      card.classList.add(`role-${authorRole}`);
    }

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

        const authorSpan = document.createElement('span');
        authorSpan.className = 'reply-author';
        authorSpan.textContent = replyAuthor ? `@${replyAuthor}:` : '';

        const textSpan = document.createElement('span');
        textSpan.className = 'reply-text';
        textSpan.textContent = replyText;

        replyBlock.append(arrow, authorSpan, textSpan);
        card.appendChild(replyBlock);
      }
    }

    // Main Message Line
    const mainLine = document.createElement('div');
    mainLine.className = 'chat-main-line';

    // Timestamp
    const timeStr = formatMessageTime(message);
    if (timeStr) {
      const timeSpan = document.createElement('span');
      timeSpan.className = 'chat-time';
      timeSpan.textContent = timeStr;
      mainLine.appendChild(timeSpan);
    }

    // Role badge
    if (authorRole) {
      const roleBadge = createRoleBadgeElement(authorRole);
      if (roleBadge) mainLine.appendChild(roleBadge);
    }

    // Author
    const authorName = typeof message.author === 'string'
      ? message.author
      : (message.author && typeof message.author === 'object' && typeof message.author.name === 'string'
        ? message.author.name
        : 'Пользователь');

    const authorSpan = document.createElement('span');
    authorSpan.className = 'chat-author';
    if (authorRole) authorSpan.classList.add(`author-${authorRole}`);
    authorSpan.textContent = authorName;
    mainLine.appendChild(authorSpan);

    const colon = document.createElement('span');
    colon.className = 'chat-colon';
    colon.textContent = ': ';
    mainLine.appendChild(colon);

    // Content
    const contentSpan = document.createElement('div');
    contentSpan.className = 'chat-content';
    renderMessageSegments(contentSpan, message);
    mainLine.appendChild(contentSpan);

    card.appendChild(mainLine);
    return card;
  }

  /**
   * Initializes the Chat Monitor App logic on a given DOM container.
   */
  function createChatMonitorApp(options = {}) {
    const documentObj = options.document || (typeof document !== 'undefined' ? document : null);
    if (!documentObj) return null;

    const apiOrigin = options.apiOrigin || (root.boostyMonitor?.apiOrigin || 'http://127.0.0.1:17369');
    const monitorIpc = options.monitorIpc || root.boostyMonitor || null;

    // DOM Elements
    const chatContainer = options.chatContainer || documentObj.querySelector('#chat-container');
    const messagesList = options.messagesList || documentObj.querySelector('#messages-list');
    const emptyState = options.emptyState || documentObj.querySelector('#empty-state');
    const statusBadge = options.statusBadge || documentObj.querySelector('#monitor-status');
    const statusText = options.statusText || documentObj.querySelector('#monitor-status-text');
    const btnAot = options.btnAot || documentObj.querySelector('#btn-always-on-top');
    const btnPause = options.btnPause || documentObj.querySelector('#btn-pause');
    const btnPauseLabel = options.btnPauseLabel || documentObj.querySelector('#btn-pause-label');
    const pauseBanner = options.pauseBanner || documentObj.querySelector('#pause-banner');
    const pausedCountEl = options.pausedCountEl || documentObj.querySelector('#paused-count');
    const btnResumeBanner = options.btnResumeBanner || documentObj.querySelector('#btn-resume-banner');
    const btnClear = options.btnClear || documentObj.querySelector('#btn-clear');
    const btnScrollBottom = options.btnScrollBottom || documentObj.querySelector('#btn-scroll-bottom');
    const unreadCountBadge = options.unreadCountBadge || documentObj.querySelector('#unread-count-badge');

    // State
    const seenMessageIds = new Set();
    const pausedQueue = [];
    let isPaused = false;
    let isScrolledUp = false;
    let unreadCount = 0;
    let eventSource = null;
    let currentStatus = 'waiting';
    let alwaysOnTop = false;

    function setStatus(statusKey, text) {
      currentStatus = statusKey;
      if (statusBadge) {
        statusBadge.className = `status-badge status-${statusKey}`;
      }
      if (statusText) {
        statusText.textContent = text;
      }
    }

    function updateEmptyState() {
      if (!emptyState || !messagesList) return;
      if (messagesList.children.length === 0) {
        emptyState.style.display = 'flex';
      } else {
        emptyState.style.display = 'none';
      }
    }

    function isUserNearBottom() {
      if (!chatContainer) return true;
      const scrollHeight = chatContainer.scrollHeight || 0;
      const scrollTop = chatContainer.scrollTop || 0;
      const clientHeight = chatContainer.clientHeight || 0;
      return (scrollHeight - scrollTop - clientHeight) <= BOTTOM_THRESHOLD_PX;
    }

    function scrollToBottom(smooth = false) {
      if (!chatContainer) return;
      if (smooth && typeof chatContainer.scrollTo === 'function') {
        try {
          chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
        } catch {
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }
      } else {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
      isScrolledUp = false;
      unreadCount = 0;
      if (btnScrollBottom) btnScrollBottom.style.display = 'none';
    }

    function updatePausedUi() {
      if (btnPause) {
        btnPause.classList.toggle('active', isPaused);
        btnPause.setAttribute('aria-pressed', String(isPaused));
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

    function appendMessageCard(message) {
      if (!messagesList) return null;
      const card = createChatCard(message);
      messagesList.appendChild(card);
      updateEmptyState();
      pruneDom();
      return card;
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

      if (isPaused) {
        pausedQueue.push(message);
        if (pausedCountEl) pausedCountEl.textContent = String(pausedQueue.length);
        return;
      }

      appendMessageCard(message);
      setStatus('connected', 'Подключено');

      if (!isScrolledUp) {
        scrollToBottom(false);
      } else {
        unreadCount++;
        if (btnScrollBottom) {
          btnScrollBottom.style.display = 'flex';
        }
        if (unreadCountBadge) {
          unreadCountBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
          unreadCountBadge.style.display = 'inline-block';
        }
      }
    }

    function resume() {
      if (!isPaused) return;
      isPaused = false;
      updatePausedUi();

      if (pausedQueue.length > 0) {
        const toFlush = [...pausedQueue];
        pausedQueue.length = 0;
        for (const msg of toFlush) {
          appendMessageCard(msg);
        }
        setStatus('connected', 'Подключено');
        if (!isScrolledUp) {
          scrollToBottom(false);
        } else {
          unreadCount += toFlush.length;
          if (btnScrollBottom) btnScrollBottom.style.display = 'flex';
          if (unreadCountBadge) {
            unreadCountBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            unreadCountBadge.style.display = 'inline-block';
          }
        }
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
      pausedQueue.length = 0;
      unreadCount = 0;
      isScrolledUp = false;
      if (btnScrollBottom) btnScrollBottom.style.display = 'none';
      if (pausedCountEl) pausedCountEl.textContent = '0';
      updateEmptyState();
      setStatus('waiting', 'Ожидание сообщений');
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

    // Scroll container listener
    if (chatContainer) {
      chatContainer.addEventListener('scroll', () => {
        const nearBottom = isUserNearBottom();
        if (nearBottom) {
          isScrolledUp = false;
          unreadCount = 0;
          if (btnScrollBottom) btnScrollBottom.style.display = 'none';
        } else {
          isScrolledUp = true;
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

    if (btnClear) {
      btnClear.addEventListener('click', clearView);
    }

    if (btnAot) {
      btnAot.addEventListener('click', toggleAlwaysOnTop);
    }

    // Initial state & history
    async function init() {
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
                  appendMessageCard(msg);
                }
              }
              if (recent.length > 0) {
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

      updateEmptyState();

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
      getStatus: () => currentStatus,
      isPaused: () => isPaused,
      isScrolledUp: () => isScrolledUp,
      getPausedCount: () => pausedQueue.length,
      getUnreadCount: () => unreadCount,
      getRenderedCount: () => (messagesList ? messagesList.children.length : 0),
      getAlwaysOnTop: () => alwaysOnTop,
      destroy: () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
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
    createRoleBadgeElement,
    renderMessageSegments,
    isSafeEmojiUrl,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj;
  }
  root.BoostyChatMonitor = exportObj;
})(typeof globalThis !== 'undefined' ? globalThis : this);
