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
   * @typedef {Object} MessageAuthor
   * @property {string} name - Author display name
   * @property {string|null} avatar - Author avatar URL or null if absent
   */

  /**
   * @typedef {Object} MessageReply
   * @property {string} author - Author name of the quoted message
   * @property {string} text - Text of the quoted message
   */

  /**
   * @typedef {Object} NormalizedMessage
   * @property {string} id - Unique message identifier
   * @property {string} platform - Source platform identifier ('boosty')
   * @property {MessageAuthor} author - Structured author information
   * @property {string} text - Cleaned message text
   * @property {MessageReply|null} reply - Optional reply quote context
   * @property {string|null} publishedAt - Original message time from platform or null
   * @property {number} receivedAt - Server timestamp in ms when message was ingested
   * @property {string} [eventId] - Sequential SSE event ID assigned by server
   */

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

    if (typeof input.author === 'string') {
      const trimmed = input.author.trim();
      if (trimmed) authorName = trimmed;
      if (typeof input.avatar === 'string' && input.avatar.trim()) {
        authorAvatar = input.avatar.trim();
      }
    } else if (input.author && typeof input.author === 'object') {
      const name = String(input.author.name || input.author.author || '').trim();
      if (name) authorName = name;

      const avatarFromAuthor = typeof input.author.avatar === 'string' ? input.author.avatar.trim() : '';
      const avatarFromRoot = typeof input.avatar === 'string' ? input.avatar.trim() : '';
      const finalAvatar = avatarFromAuthor || avatarFromRoot;
      if (finalAvatar) authorAvatar = finalAvatar;
    } else if (typeof input.avatar === 'string' && input.avatar.trim()) {
      authorAvatar = input.avatar.trim();
    }

    // 4. Text
    const text = typeof input.text === 'string' ? input.text.trim() : '';

    // 5. Reply context (if present and meaningful)
    let reply = null;
    if (input.reply && typeof input.reply === 'object') {
      const repAuthor = typeof input.reply.author === 'string' ? input.reply.author.trim() : '';
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
      },
      text,
      reply,
      publishedAt,
      receivedAt,
    };

    if (eventId !== undefined) {
      normalized.eventId = eventId;
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

    if (typeof message.text !== 'string' || !message.text) {
      return { ok: false, error: 'Message text must be a non-empty string' };
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
    normalizeIncomingMessage,
    validateNormalizedMessage,
  };
});
