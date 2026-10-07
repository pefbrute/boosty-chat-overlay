/**
 * Core Message Model
 * Defines the canonical normalized chat message schema and validation functions.
 * Compatible with Node.js and Browser environments.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BoostyMessageModel = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * @typedef {'streamer' | 'moderator' | null} AuthorRole
   */

  /**
   * @typedef {Object} MessageAuthor
   * @property {string} name - Author display name
   * @property {string|null} avatar - Author avatar URL or null if absent
   * @property {AuthorRole} role - Confirmed Boosty author role ('streamer' | 'moderator' | null)
   */

  /**
   * @typedef {Object} MessageReply
   * @property {string} author - Author name of the quoted message
   * @property {string} text - Text of the quoted message
   */

  /**
   * @typedef {Object} TextSegment
   * @property {'text'} type
   * @property {string} text
   */

  /**
   * @typedef {Object} EmojiSegment
   * @property {'emoji'} type
   * @property {string|null} id
   * @property {string} alt
   * @property {string} url
   */

  /**
   * @typedef {Object} MentionSegment
   * @property {'mention'} type
   * @property {string|null} userId
   * @property {string} displayName
   */

  /**
   * @typedef {TextSegment | EmojiSegment | MentionSegment} MessageSegment
   */

  /**
   * @typedef {Object} NormalizedMessage
   * @property {string} id - Unique message identifier
   * @property {string} platform - Source platform identifier ('boosty')
   * @property {MessageAuthor} author - Structured author information
   * @property {string} text - Cleaned message text
   * @property {MessageSegment[]|null} segments - Structured message segments or null for legacy messages
   * @property {MessageReply|null} reply - Optional reply quote context
   * @property {string|null} publishedAt - Original message time from platform or null
   * @property {number} receivedAt - Server timestamp in ms when message was ingested
   * @property {string} [eventId] - Sequential SSE event ID assigned by server
   */

  /**
   * Normalizes an author role against the strict whitelist ('streamer' | 'moderator').
   * Unknown or invalid values normalize to null.
   *
   * @param {any} rawRole
   * @returns {AuthorRole}
   */
  function normalizeAuthorRole(rawRole) {
    if (typeof rawRole !== 'string') return null;
    const clean = rawRole.trim().toLowerCase();
    if (clean === 'streamer' || clean === 'moderator') {
      return clean;
    }
    return null;
  }

  /**
   * Validates that an emoji image URL uses a safe allowed scheme (https:, http:, or safe data:image/).
   *
   * @param {any} url
   * @returns {boolean}
   */
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

  /**
   * Normalizes and filters an array of message segments.
   * Unknown segment types or emoji segments with unsafe URLs are safely dropped.
   *
   * @param {any} rawSegments
   * @returns {MessageSegment[]|null}
   */
  function normalizeSegments(rawSegments) {
    if (!Array.isArray(rawSegments)) return null;

    /** @type {MessageSegment[]} */
    const normalized = [];

    for (const seg of rawSegments) {
      if (!seg || typeof seg !== 'object') continue;

      if (seg.type === 'text') {
        if (typeof seg.text === 'string' && seg.text.length > 0) {
          normalized.push({
            type: 'text',
            text: seg.text,
          });
        }
      } else if (seg.type === 'emoji') {
        if (!isSafeEmojiUrl(seg.url)) continue;
        const url = seg.url.trim();
        const id = (typeof seg.id === 'string' && seg.id.trim()) ? seg.id.trim() : null;
        const alt = (typeof seg.alt === 'string' && seg.alt.trim())
          ? seg.alt.trim()
          : (id || ':emoji:');
        normalized.push({
          type: 'emoji',
          id,
          alt,
          url,
        });
      } else if (seg.type === 'mention') {
        const rawDisplay = typeof seg.displayName === 'string'
          ? seg.displayName.trim().replace(/^@+/, '').trim()
          : '';
        if (!rawDisplay) continue;
        const userId = (typeof seg.userId === 'string' && seg.userId.trim()) ? seg.userId.trim() : null;
        normalized.push({
          type: 'mention',
          userId,
          displayName: rawDisplay,
        });
      }
      // Unknown segment types are safely dropped
    }

    return normalized.length > 0 ? normalized : null;
  }

  function cleanAuthorName(rawName) {
    if (typeof rawName !== 'string') return '';
    return rawName.trim().replace(/:\s*$/, '').trim();
  }

  /**
   * Normalizes any incoming message payload (raw from extension, legacy format, or external source)
   * into a canonical NormalizedMessage structure.
   *
   * @param {Record<string, any>} raw - Incoming raw message payload
   * @param {Object} [options] - Normalization context options
   * @param {string} [options.defaultPlatform='boosty'] - Fallback platform identifier
   * @param {number} [options.receivedAt] - Explicit receivedAt timestamp in ms
   * @param {string} [options.eventId] - Explicit server event sequence ID
   * @param {Function} [options.generateId] - Fallback ID generator if raw.id is empty
   * @returns {NormalizedMessage}
   */
  function normalizeIncomingMessage(raw, options = {}) {
    const input = (raw && typeof raw === 'object') ? raw : {};

    // 1. Message ID
    let id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id && typeof options.generateId === 'function') {
      id = options.generateId();
    }
    if (!id) {
      const now = Date.now();
      id = `gen-${now}-${Math.random().toString(36).slice(2, 7)}`;
    }

    // 2. Platform
    const platform = (typeof input.platform === 'string' && input.platform.trim())
      ? input.platform.trim().toLowerCase()
      : (options.defaultPlatform || 'boosty').toLowerCase();

    // 3. Author (supports string, legacy object, or structured MessageAuthor)
    let authorName = 'Boosty';
    let authorAvatar = null;
    let authorRole = null;

    if (typeof input.author === 'string') {
      const trimmed = cleanAuthorName(input.author);
      if (trimmed) authorName = trimmed;
      if (typeof input.avatar === 'string' && input.avatar.trim()) {
        authorAvatar = input.avatar.trim();
      }
      authorRole = normalizeAuthorRole(input.role);
    } else if (input.author && typeof input.author === 'object') {
      const name = cleanAuthorName(String(input.author.name || input.author.author || ''));
      if (name) authorName = name;

      const avatarFromAuthor = typeof input.author.avatar === 'string' ? input.author.avatar.trim() : '';
      const avatarFromRoot = typeof input.avatar === 'string' ? input.avatar.trim() : '';
      const finalAvatar = avatarFromAuthor || avatarFromRoot;
      if (finalAvatar) authorAvatar = finalAvatar;

      authorRole = normalizeAuthorRole(input.author.role !== undefined ? input.author.role : input.role);
    } else {
      if (typeof input.avatar === 'string' && input.avatar.trim()) {
        authorAvatar = input.avatar.trim();
      }
      authorRole = normalizeAuthorRole(input.role);
    }

    // 4. Structured segments & Text
    const segments = normalizeSegments(input.segments);
    let text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text && segments && segments.length > 0) {
      text = segments
        .map(seg => {
          if (seg.type === 'text') return seg.text;
          if (seg.type === 'emoji') return seg.alt || seg.id || ':emoji:';
          if (seg.type === 'mention') return `@${seg.displayName}`;
          return '';
        })
        .join('')
        .trim();
    }

    // 5. Reply context (if present and meaningful)
    let reply = null;
    if (input.reply && typeof input.reply === 'object') {
      const repAuthor = typeof input.reply.author === 'string' ? cleanAuthorName(input.reply.author) : '';
      const repText = typeof input.reply.text === 'string' ? input.reply.text.trim() : '';
      if (repAuthor || repText) {
        reply = { author: repAuthor, text: repText };
      }
    }

    // 6. Published time on platform (accepts publishedAt or legacy publishTime)
    let publishedAt = null;
    const rawPubTime = input.publishedAt !== undefined ? input.publishedAt : input.publishTime;
    if (typeof rawPubTime === 'string' && rawPubTime.trim()) {
      publishedAt = rawPubTime.trim();
    } else if (typeof rawPubTime === 'number' && Number.isFinite(rawPubTime)) {
      publishedAt = new Date(rawPubTime).toISOString();
    }

    // 7. Received timestamp on server (source data must not dictate server ingestion time)
    let receivedAt;
    if (typeof options.receivedAt === 'number' && Number.isFinite(options.receivedAt) && options.receivedAt > 0) {
      receivedAt = options.receivedAt;
    } else if (typeof input.receivedAt === 'number' && Number.isFinite(input.receivedAt) && input.receivedAt > 0) {
      receivedAt = input.receivedAt;
    } else {
      receivedAt = Date.now();
    }

    // 8. Event sequence ID (managed strictly by server SSE layer)
    const eventId = options.eventId !== undefined
      ? String(options.eventId)
      : (input.eventId !== undefined ? String(input.eventId) : undefined);

    /** @type {NormalizedMessage} */
    const normalized = {
      id,
      platform,
      author: {
        name: authorName,
        avatar: authorAvatar,
        role: authorRole,
      },
      text,
      segments,
      reply,
      publishedAt,
      receivedAt,
    };

    if (eventId !== undefined) {
      normalized.eventId = eventId;
    }

    if (typeof input.source === 'string' && input.source.trim()) {
      normalized.source = input.source.trim();
    }
    if (input.qaSynthetic === true) {
      normalized.qaSynthetic = true;
    }

    return normalized;
  }

  /**
   * Validates that a message conforms strictly to the NormalizedMessage contract.
   *
   * @param {any} message - Object to validate
   * @returns {{ ok: boolean, error?: string, message?: NormalizedMessage }}
   */
  function validateNormalizedMessage(message) {
    if (!message || typeof message !== 'object') {
      return { ok: false, error: 'Message must be a non-null object' };
    }

    if (typeof message.id !== 'string' || !message.id) {
      return { ok: false, error: 'Message id must be a non-empty string' };
    }

    if (typeof message.platform !== 'string' || !message.platform) {
      return { ok: false, error: 'Message platform must be a non-empty string' };
    }

    if (!message.author || typeof message.author !== 'object') {
      return { ok: false, error: 'Message author must be an object' };
    }

    if (typeof message.author.name !== 'string' || !message.author.name) {
      return { ok: false, error: 'Message author.name must be a non-empty string' };
    }

    if (message.author.avatar !== null && typeof message.author.avatar !== 'string') {
      return { ok: false, error: 'Message author.avatar must be a string or null' };
    }

    if (
      message.author.role !== null &&
      message.author.role !== undefined &&
      message.author.role !== 'streamer' &&
      message.author.role !== 'moderator'
    ) {
      return { ok: false, error: 'Message author.role must be "streamer", "moderator", or null' };
    }

    if (typeof message.text !== 'string' || !message.text) {
      return { ok: false, error: 'Message text must be a non-empty string' };
    }

    if (message.segments !== null && message.segments !== undefined) {
      if (!Array.isArray(message.segments)) {
        return { ok: false, error: 'Message segments must be an array or null' };
      }
      for (const seg of message.segments) {
        if (!seg || typeof seg !== 'object') {
          return { ok: false, error: 'Each segment must be an object' };
        }
        if (seg.type === 'text') {
          if (typeof seg.text !== 'string' || !seg.text) {
            return { ok: false, error: 'Text segment must have a non-empty text string' };
          }
        } else if (seg.type === 'emoji') {
          if (seg.id !== null && typeof seg.id !== 'string') {
            return { ok: false, error: 'Emoji segment id must be a string or null' };
          }
          if (typeof seg.alt !== 'string' || !seg.alt) {
            return { ok: false, error: 'Emoji segment alt must be a non-empty string' };
          }
          if (!isSafeEmojiUrl(seg.url)) {
            return { ok: false, error: 'Emoji segment url must be a valid safe URL' };
          }
        } else if (seg.type === 'mention') {
          if (seg.userId !== null && typeof seg.userId !== 'string') {
            return { ok: false, error: 'Mention segment userId must be a string or null' };
          }
          if (typeof seg.displayName !== 'string' || !seg.displayName) {
            return { ok: false, error: 'Mention segment displayName must be a non-empty string' };
          }
        } else {
          return { ok: false, error: `Unsupported segment type: ${String(seg.type)}` };
        }
      }
    }

    if (message.reply !== null) {
      if (typeof message.reply !== 'object') {
        return { ok: false, error: 'Message reply must be an object or null' };
      }
      if (typeof message.reply.author !== 'string' || typeof message.reply.text !== 'string') {
        return { ok: false, error: 'Message reply must contain author and text strings' };
      }
    }

    if (message.publishedAt !== null && typeof message.publishedAt !== 'string') {
      return { ok: false, error: 'Message publishedAt must be a string or null' };
    }

    if (typeof message.receivedAt !== 'number' || !Number.isFinite(message.receivedAt) || message.receivedAt <= 0) {
      return { ok: false, error: 'Message receivedAt must be a positive finite timestamp number' };
    }

    if (message.eventId !== undefined && (typeof message.eventId !== 'string' || !message.eventId)) {
      return { ok: false, error: 'Message eventId must be a non-empty string when present' };
    }

    return { ok: true, message };
  }

  return {
    cleanAuthorName,
    normalizeAuthorRole,
    isSafeEmojiUrl,
    normalizeSegments,
    normalizeIncomingMessage,
    validateNormalizedMessage,
  };
});
