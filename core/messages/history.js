/**
 * In-memory ring buffer for recent chat messages and SSE event replay.
 *
 * @param {object} [options]
 * @param {number} [options.maxHistory=50]
 */
function createMessageHistory(options = {}) {
  const maxHistory = options.maxHistory ?? 50;
  const history = [];
  let nextEventId = 0;

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
      }
      if (!message.receivedAt) {
        message.receivedAt = Date.now();
      }

      history.push(message);
      while (history.length > maxHistory) {
        history.shift();
      }

      return message;
    },

    /**
     * Returns a copy of all retained messages in chronological order.
     * @returns {Array<object>}
     */
    getAll() {
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
     * Clears all retained messages.
     */
    clear() {
      history.length = 0;
    },

    /**
     * Current event ID sequence counter.
     * @returns {number}
     */
    getCurrentEventId() {
      return nextEventId;
    },
  };
}

module.exports = {
  createMessageHistory,
};
