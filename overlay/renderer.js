'use strict';

(function(root) {
  const ANIMATION_TYPES = ['none', 'fade', 'slide-up', 'slide-side'];
  const ANIMATION_DURATION_MIN = 150;
  const ANIMATION_DURATION_MAX = 1000;
  const ANIMATION_DURATION_DEFAULT = 280;

  const cardLifecycleMap = new WeakMap();
  let deterministicMode = false;

  try {
    if (typeof location !== 'undefined' && location.search && typeof URLSearchParams !== 'undefined') {
      const params = new URLSearchParams(location.search);
      if (params.get('deterministic') === '1') {
        deterministicMode = true;
      }
    }
  } catch {}

  function normalizeAnimationType(value, fallback = 'fade') {
    const safeFallback =
      typeof fallback === 'string' && ANIMATION_TYPES.includes(fallback.trim().toLowerCase())
        ? fallback.trim().toLowerCase()
        : 'fade';
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (ANIMATION_TYPES.includes(normalized)) {
        return normalized;
      }
    }
    return safeFallback;
  }

  function normalizeAnimationDuration(value, fallback = ANIMATION_DURATION_DEFAULT) {
    const parsedFallback = Number(fallback);
    const safeFallback = Number.isFinite(parsedFallback)
      ? Math.round(Math.min(ANIMATION_DURATION_MAX, Math.max(ANIMATION_DURATION_MIN, parsedFallback)))
      : ANIMATION_DURATION_DEFAULT;
    if (value === undefined || value === null || value === '' || typeof value === 'boolean') {
      return safeFallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return safeFallback;
    }
    return Math.round(Math.min(ANIMATION_DURATION_MAX, Math.max(ANIMATION_DURATION_MIN, parsed)));
  }

  function isReducedMotion() {
    try {
      return Boolean(
        typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    } catch {
      return false;
    }
  }

  function setDeterministicMode(enabled) {
    deterministicMode = Boolean(enabled);
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle('qa-deterministic', deterministicMode);
    }
  }

  function isDeterministicMode() {
    return deterministicMode;
  }

  function shouldAnimateCards(config, options = {}) {
    if (options && options.animate === false) return false;
    if (deterministicMode && (!options || options.forceAnimate !== true)) return false;
    if (isReducedMotion() && (!options || options.ignoreReducedMotion !== true)) return false;
    const rawType = config && (config.animationType !== undefined ? config.animationType : config.animation?.type);
    const animType = normalizeAnimationType(rawType, 'fade');
    return animType !== 'none';
  }

  function cancelCardAnimation(card) {
    if (!card) return;
    const state = cardLifecycleMap.get(card);
    if (state) {
      if (state.enterTimer) clearTimeout(state.enterTimer);
      if (state.exitTimer) clearTimeout(state.exitTimer);
      cardLifecycleMap.delete(card);
    }
  }

  function enterMessageCard(card, config, options = {}) {
    if (!card) return 0;
    cancelCardAnimation(card);
    card.classList.remove('message-enter', 'message-exit', 'disappearing');

    if (!shouldAnimateCards(config, options)) {
      card.classList.add('message-visible');
      card.dataset.lifecycle = 'visible';
      return 0;
    }

    const rawDuration = config && (config.animationDurationMs !== undefined ? config.animationDurationMs : config.animation?.durationMs);
    const durationMs = normalizeAnimationDuration(rawDuration, ANIMATION_DURATION_DEFAULT);

    card.classList.remove('message-visible');
    // Force reflow when re-triggering enter animation on an existing card
    if (options && options.restart === true) {
      void card.offsetWidth;
    }
    card.classList.add('message-enter');
    card.dataset.lifecycle = 'entering';

    const enterTimer = setTimeout(() => {
      const current = cardLifecycleMap.get(card);
      if (current && current.enterTimer === enterTimer) {
        cardLifecycleMap.delete(card);
      }
      if (!card.classList.contains('message-exit') && !card.classList.contains('disappearing')) {
        card.classList.remove('message-enter');
        card.classList.add('message-visible');
        card.dataset.lifecycle = 'visible';
      }
    }, durationMs);

    cardLifecycleMap.set(card, { enterTimer, exitTimer: null });
    return durationMs;
  }

  function exitMessageCard(card, config, onRemoved, options = {}) {
    if (!card || card.dataset.lifecycle === 'exiting' || card.dataset.lifecycle === 'removed') {
      return 0;
    }
    cancelCardAnimation(card);
    card.classList.remove('message-enter', 'message-visible');

    if (!shouldAnimateCards(config, options)) {
      card.dataset.lifecycle = 'removed';
      card.remove();
      if (typeof onRemoved === 'function') onRemoved(card);
      return 0;
    }

    const rawDuration = config && (config.animationDurationMs !== undefined ? config.animationDurationMs : config.animation?.durationMs);
    const durationMs = normalizeAnimationDuration(rawDuration, ANIMATION_DURATION_DEFAULT);
    const exitDurationMs = Math.min(durationMs, 350);

    card.classList.add('message-exit', 'disappearing');
    card.dataset.lifecycle = 'exiting';

    const exitTimer = setTimeout(() => {
      cardLifecycleMap.delete(card);
      card.dataset.lifecycle = 'removed';
      card.remove();
      if (typeof onRemoved === 'function') onRemoved(card);
    }, exitDurationMs);

    cardLifecycleMap.set(card, { enterTimer: null, exitTimer });
    return exitDurationMs;
  }

  function hexToRgba(hex, opacityPercent) {
    const cleanHex = String(hex || '#121216').replace(/^#/, '');
    let r = 18;
    let g = 18;
    let b = 22;
    if (cleanHex.length === 6) {
      r = parseInt(cleanHex.slice(0, 2), 16) || 0;
      g = parseInt(cleanHex.slice(2, 4), 16) || 0;
      b = parseInt(cleanHex.slice(4, 6), 16) || 0;
    }
    const alpha = Math.max(0, Math.min(100, Number(opacityPercent) ?? 88)) / 100;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
  }

  function applyAppearanceConfig(targetElement, config) {
    if (!targetElement || !config) return;
    const el = targetElement.style ? targetElement : document.documentElement;

    const accent = config.accentColor || '#f15f2c';
    const textColor = config.textColor || '#ffffff';
    const authorFontSize = config.authorFontSize ? `${config.authorFontSize}px` : '16px';
    const messageFontSize = config.fontSize ? `${config.fontSize}px` : '21px';
    const cardWidth = config.cardWidth ? `${config.cardWidth}px` : '520px';
    const borderRadius = `${config.borderRadius ?? 10}px`;
    const pad = config.cardPadding ?? 10;
    const cardPadding = `${pad}px ${Math.round(pad * 1.4)}px ${pad}px ${pad}px`;
    const messageGap = `${config.messageGap ?? 10}px`;
    const avatarSize = `${config.avatarSize ?? 42}px`;
    const backdropBlur = Number(config.backdropBlur) > 0 ? `blur(${config.backdropBlur}px)` : 'none';
    const cardShadow = config.shadow === false ? 'none' : '0 6px 24px rgb(0 0 0 / 28%)';
    const cardBgComputed = hexToRgba(config.backgroundColor || '#121216', config.backgroundOpacity ?? 88);

    const rawAnimType = config.animationType !== undefined ? config.animationType : config.animation?.type;
    const animType = normalizeAnimationType(rawAnimType, 'fade');
    const rawAnimDuration = config.animationDurationMs !== undefined ? config.animationDurationMs : config.animation?.durationMs;
    const animDurationMs = normalizeAnimationDuration(rawAnimDuration, ANIMATION_DURATION_DEFAULT);
    const exitDurationMs = Math.min(animDurationMs, 350);

    el.style.setProperty('--accent', accent);
    el.style.setProperty('--text-color', textColor);
    el.style.setProperty('--author-font-size', authorFontSize);
    el.style.setProperty('--message-font-size', messageFontSize);
    el.style.setProperty('--card-width', cardWidth);
    el.style.setProperty('--border-radius', borderRadius);
    el.style.setProperty('--card-padding', cardPadding);
    el.style.setProperty('--message-gap', messageGap);
    el.style.setProperty('--avatar-size', avatarSize);
    el.style.setProperty('--backdrop-blur', backdropBlur);
    el.style.setProperty('--card-shadow', cardShadow);
    el.style.setProperty('--card-bg-computed', cardBgComputed);
    el.style.setProperty('--message-animation-duration', `${animDurationMs}ms`);
    el.style.setProperty('--message-exit-duration', `${exitDurationMs}ms`);

    const offsetX = `${config.offsetX ?? 20}px`;
    const offsetY = `${config.offsetY ?? 20}px`;
    const stackMaxHeight = `${config.maxStackHeight ?? 800}px`;
    const textAlign = config.textAlign || 'left';

    el.style.setProperty('--overlay-offset-x', offsetX);
    el.style.setProperty('--overlay-offset-y', offsetY);
    el.style.setProperty('--stack-max-height', stackMaxHeight);
    el.style.setProperty('--text-align', textAlign);

    const body = document.body || (targetElement.tagName === 'BODY' ? targetElement : null);
    if (body) {
      body.classList.toggle('hide-avatars', config.showAvatars === false);
    }

    const doc = (targetElement && targetElement.ownerDocument) ? targetElement.ownerDocument : (typeof document !== 'undefined' ? document : null);
    const messagesContainer = doc && doc.querySelector ? doc.querySelector('#messages') : null;
    if (messagesContainer) {
      const hAnchor = config.horizontalAnchor || 'left';
      const vAnchor = config.verticalAnchor || 'bottom';
      const order = config.newMessagePosition || 'bottom';

      messagesContainer.classList.toggle('anchor-left', hAnchor === 'left');
      messagesContainer.classList.toggle('anchor-right', hAnchor === 'right');
      messagesContainer.classList.toggle('anchor-top', vAnchor === 'top');
      messagesContainer.classList.toggle('anchor-bottom', vAnchor === 'bottom');
      messagesContainer.classList.toggle('order-bottom', order === 'bottom');
      messagesContainer.classList.toggle('order-top', order === 'top');

      messagesContainer.classList.toggle('anim-none', animType === 'none');
      messagesContainer.classList.toggle('anim-fade', animType === 'fade');
      messagesContainer.classList.toggle('anim-slide-up', animType === 'slide-up');
      messagesContainer.classList.toggle('anim-slide-side', animType === 'slide-side');
      messagesContainer.dataset.animationType = animType;
    }
  }

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

  function renderMessageContent(textEl, message) {
    const segments = Array.isArray(message.segments) && message.segments.length > 0
      ? message.segments
      : null;

    if (!segments) {
      textEl.textContent = message.text || '';
      return;
    }

    let renderedCount = 0;
    for (const seg of segments) {
      if (!seg || typeof seg !== 'object') continue;

      if (seg.type === 'text') {
        if (typeof seg.text === 'string' && seg.text.length > 0) {
          textEl.appendChild(document.createTextNode(seg.text));
          renderedCount++;
        }
      } else if (seg.type === 'emoji') {
        const alt = typeof seg.alt === 'string' && seg.alt
          ? seg.alt
          : (typeof seg.id === 'string' && seg.id ? seg.id : ':emoji:');
        if (isSafeEmojiUrl(seg.url)) {
          const img = document.createElement('img');
          img.className = 'message-emoji';
          img.src = seg.url.trim();
          img.alt = alt;
          img.draggable = false;
          textEl.appendChild(img);
          renderedCount++;
        } else if (alt) {
          textEl.appendChild(document.createTextNode(alt));
          renderedCount++;
        }
      } else if (seg.type === 'mention') {
        const rawName = typeof seg.displayName === 'string'
          ? seg.displayName.trim().replace(/^@+/, '').trim()
          : '';
        if (rawName) {
          const mentionEl = document.createElement('span');
          mentionEl.className = 'message-mention';
          mentionEl.textContent = `@${rawName}`;
          textEl.appendChild(mentionEl);
          renderedCount++;
        }
      }
    }

    if (renderedCount === 0) {
      textEl.textContent = message.text || '';
    }
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
    badge.className = `author-role author-role--${validRole}`;
    badge.setAttribute('aria-label', validRole === 'streamer' ? 'Стример' : 'Модератор');

    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS ? document.createElementNS(svgNs, 'svg') : document.createElement('svg');
    svg.setAttribute('class', 'author-role-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const path = document.createElementNS ? document.createElementNS(svgNs, 'path') : document.createElement('path');
    if (validRole === 'streamer') {
      path.setAttribute(
        'd',
        'M8 1.35l1.98 4.02 4.44.64-3.21 3.13.76 4.42L8 11.47l-3.97 2.09.76-4.42L1.58 6.01l4.44-.64L8 1.35z'
      );
    } else {
      path.setAttribute(
        'd',
        'M14.5 1.5L13.8 4.9L8.2 10.5L9.8 12.1L8.6 13.3L6.7 11.4L4.1 14.0A1.48 1.48 0 0 1 2.0 11.9L4.6 9.3L2.7 7.4L3.9 6.2L5.5 7.8L11.1 2.2Z'
      );
    }

    svg.appendChild(path);
    badge.appendChild(svg);
    return badge;
  }

  function createMessageCard(message) {
    const card = document.createElement('article');
    card.className = 'message';
    card.dataset.lifecycle = 'created';

    const authorName = typeof message.author === 'string'
      ? message.author
      : (message.author && typeof message.author === 'object' && typeof message.author.name === 'string' ? message.author.name : 'Пользователь');

    const avatarUrl = (message.author && typeof message.author === 'object' && typeof message.author.avatar === 'string' && message.author.avatar)
      ? message.author.avatar
      : (typeof message.avatar === 'string' ? message.avatar : '');

    const authorRole = normalizeAuthorRole(
      message.author && typeof message.author === 'object' && message.author.role !== undefined
        ? message.author.role
        : message.role
    );

    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.alt = '';
    avatar.src = avatarUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

    const author = document.createElement('div');
    author.className = 'author author-line';
    const roleBadge = createRoleBadgeElement(authorRole);
    if (roleBadge) {
      author.appendChild(roleBadge);
    }
    const authorNameEl = document.createElement('span');
    authorNameEl.className = 'author-name';
    authorNameEl.textContent = authorName || 'Пользователь';
    author.appendChild(authorNameEl);

    const text = document.createElement('div');
    text.className = 'text';
    renderMessageContent(text, message);

    // Reply / Quote block handling
    let replyContainer = null;
    if (message.reply && typeof message.reply === 'object') {
      const replyAuthor = typeof message.reply.author === 'string' ? message.reply.author.trim() : '';
      const replyText = typeof message.reply.text === 'string' ? message.reply.text.trim() : '';
      if (replyAuthor || replyText) {
        replyContainer = document.createElement('div');
        replyContainer.className = 'message-reply reply';
        if (replyAuthor) {
          const replyAuthorEl = document.createElement('div');
          replyAuthorEl.className = 'message-reply-author';
          replyAuthorEl.textContent = replyAuthor;
          replyContainer.appendChild(replyAuthorEl);
        }
        if (replyText) {
          const replyTextEl = document.createElement('div');
          replyTextEl.className = 'message-reply-text';
          replyTextEl.textContent = replyText;
          replyContainer.appendChild(replyTextEl);
        }
      }
    }

    if (replyContainer) {
      card.classList.add('has-reply');
      card.append(replyContainer, avatar, author, text);
    } else {
      card.append(avatar, author, text);
    }
    return card;
  }

  const BoostyRenderer = {
    ANIMATION_TYPES,
    ANIMATION_DURATION_MIN,
    ANIMATION_DURATION_MAX,
    ANIMATION_DURATION_DEFAULT,
    normalizeAnimationType,
    normalizeAnimationDuration,
    isReducedMotion,
    setDeterministicMode,
    isDeterministicMode,
    shouldAnimateCards,
    cancelCardAnimation,
    enterMessageCard,
    exitMessageCard,
    hexToRgba,
    normalizeAuthorRole,
    isSafeEmojiUrl,
    applyAppearanceConfig,
    createMessageCard,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoostyRenderer;
  }
  root.BoostyRenderer = BoostyRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
