'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeFileSyncAtomic } = require('../config/storage.js');

const DEFAULT_MAX_HISTORY = 1000;
const MAX_TEXT_LENGTH = 4000;

/**
 * Sanitizes a message before storing in persistent history.
 * Ensures vital fields are preserved (id, eventId, receivedAt, publishedAt,
 * author with role, text, segments, reply, mentions) while stripping non-serializable properties.
 *
 * @param {object} message
 * @returns {object}
 */
function sanitizeMessageForStorage(message) {
  if (!message || typeof message !== 'object') return null;

  const text = typeof message.text === 'string'
    ? (message.text.length > MAX_TEXT_LENGTH ? message.text.slice(0, MAX_TEXT_LENGTH) : message.text)
    : '';

  const sanitized = {
    id: String(message.id || `msg-${Date.now()}`),
    platform: message.platform || 'boosty',
    text,
    eventId: String(message.eventId || ''),
    receivedAt: typeof message.receivedAt === 'number' ? message.receivedAt : Date.now(),
    publishedAt: message.publishedAt !== undefined ? message.publishedAt : null,
  };

  if (message.author && typeof message.author === 'object') {
    sanitized.author = {
      name: typeof message.author.name === 'string' ? message.author.name : 'Пользователь',
      avatar: typeof message.author.avatar === 'string' ? message.author.avatar : null,
      role: message.author.role || null,
    };
    if (message.author.id !== undefined) sanitized.author.id = message.author.id;
  } else if (typeof message.author === 'string') {
    sanitized.author = { name: message.author, avatar: null, role: null };
  }

  if (Array.isArray(message.segments)) {
    sanitized.segments = message.segments.slice(0, 50);
  }

  if (message.reply && typeof message.reply === 'object') {
    sanitized.reply = {
      author: typeof message.reply.author === 'string' ? message.reply.author : '',
      text: typeof message.reply.text === 'string'
        ? (message.reply.text.length > 500 ? message.reply.text.slice(0, 500) : message.reply.text)
        : '',
    };
  }

  if (Array.isArray(message.mentions)) {
    sanitized.mentions = message.mentions.slice(0, 20);
  }

  if (message.source) sanitized.source = message.source;
  if (message.qaSynthetic) sanitized.qaSynthetic = true;

  return sanitized;
}

/**
 * In-memory ring buffer with optional resilient disk persistence
 * for recent chat messages and SSE event replay.
 *
 * @param {object} [options]
 * @param {number} [options.maxHistory=1000] Maximum number of messages to retain.
 * @param {string|null} [options.storageFile=null] Optional path for disk persistence.
 * @param {number} [options.debounceMs=300] Debounce interval for disk writes.
 */
function createMessageHistory(options = {}) {
  const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY;
  const storageFile = options.storageFile || null;
  const debounceMs = options.debounceMs ?? 300;

  const history = [];
  let nextEventId = 0;
  let saveTimer = null;

  function scheduleSave() {
    if (!storageFile) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flush();
    }, debounceMs);
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!storageFile) return;
    try {
      const payload = `${JSON.stringify(history, null, 2)}\n`;
      writeFileSyncAtomic(storageFile, payload, 0o600);
    } catch (err) {
      console.warn('[MessageHistory] Failed to persist chat history to disk:', err.message);
    }
  }

  function loadInitial() {
    if (!storageFile) return;
    try {
      if (fs.existsSync(storageFile)) {
        const raw = fs.readFileSync(storageFile, 'utf8');
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const clean = sanitizeMessageForStorage(item);
              if (clean && (clean.text || (Array.isArray(clean.segments) && clean.segments.length > 0))) {
                history.push(clean);
                const numEventId = Number(clean.eventId);
                if (Number.isFinite(numEventId) && numEventId > nextEventId) {
                  nextEventId = numEventId;
                }
              }
            }
            while (history.length > maxHistory) {
              history.shift();
            }
          }
        } catch (parseErr) {
          console.warn('[MessageHistory] Failed to parse history file, preserving backup:', parseErr.message);
          try {
            fs.copyFileSync(storageFile, `${storageFile}.corrupt.${Date.now()}`);
          } catch {}
        }
      }
    } catch (readErr) {
      console.warn('[MessageHistory] Error reading history file:', readErr.message);
    }
  }

  loadInitial();

  return {
    /**
     * Appends a message to history, ensuring it has eventId and receivedAt.
     *
     * @param {object} message
     * @returns {object} The mutated message with eventId and receivedAt.
     */
    add(message) {
      if (!message.eventId) {
        nextEventId += 1;
        message.eventId = String(nextEventId);
      } else {
        const num = Number(message.eventId);
        if (Number.isFinite(num) && num > nextEventId) {
          nextEventId = num;
        }
      }

      if (!message.receivedAt) {
        message.receivedAt = Date.now();
      }

      const storable = sanitizeMessageForStorage(message);
      if (storable) {
        history.push(storable);
        while (history.length > maxHistory) {
          history.shift();
        }
        scheduleSave();
      }

      return message;
    },

    /**
     * Returns a copy of all retained messages in chronological order,
     * optionally sliced to the last `limit` messages.
     *
     * @param {number|null} [limit=null]
     * @returns {Array<object>}
     */
    getAll(limit = null) {
      if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
        return history.slice(-limit);
      }
      return history.slice();
    },

    /**
     * Returns messages after the specified event ID for Last-Event-ID replay.
     *
     * @param {string|number|null|undefined} rawLastEventId
     * @returns {Array<object>}
     */
    getAfterEventId(rawLastEventId) {
      if (rawLastEventId === undefined || rawLastEventId === null || rawLastEventId === '') {
        return history.slice();
      }

      const parsedLastId = Number(rawLastEventId);
      if (Number.isFinite(parsedLastId)) {
        return history.filter(m => Number(m.eventId) > parsedLastId);
      }

      const idx = history.findIndex(m => String(m.eventId) === String(rawLastEventId));
      return idx !== -1 ? history.slice(idx + 1) : history.slice();
    },

    /**
     * Returns the current count of retained messages.
     * @returns {number}
     */
    size() {
      return history.length;
    },

    /**
     * Clears all retained messages in memory and flushes to disk.
     */
    clear() {
      history.length = 0;
      flush();
    },

    /**
     * Immediately flushes any debounced in-memory messages to disk.
     */
    flush() {
      flush();
    },

    /**
     * Current event ID sequence counter.
     * @returns {number}
     */
    getCurrentEventId() {
      return nextEventId;
    },

    /**
     * Configured storage file path.
     * @returns {string|null}
     */
    getStorageFile() {
      return storageFile;
    },
  };
}

module.exports = {
  DEFAULT_MAX_HISTORY,
  createMessageHistory,
  sanitizeMessageForStorage,
};
