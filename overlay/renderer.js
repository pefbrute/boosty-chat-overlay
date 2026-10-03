'use strict';

(function(root) {
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
    }
  }

  function createMessageCard(message) {
    const card = document.createElement('article');
    card.className = 'message';

    const authorName = typeof message.author === 'string'
      ? message.author
      : (message.author && typeof message.author === 'object' && typeof message.author.name === 'string' ? message.author.name : 'Пользователь');

    const avatarUrl = (message.author && typeof message.author === 'object' && typeof message.author.avatar === 'string' && message.author.avatar)
      ? message.author.avatar
      : (typeof message.avatar === 'string' ? message.avatar : '');

    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.alt = '';
    avatar.src = avatarUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

    const author = document.createElement('div');
    author.className = 'author';
    author.textContent = authorName || 'Пользователь';

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = message.text || '';

    card.append(avatar, author, text);
    return card;
  }

  const BoostyRenderer = {
    hexToRgba,
    applyAppearanceConfig,
    createMessageCard,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BoostyRenderer;
  }
  root.BoostyRenderer = BoostyRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
