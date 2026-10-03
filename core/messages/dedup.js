/**
 * Sliding window deduplication cache for incoming message IDs.
 *
 * @param {object} [options]
 * @param {number} [options.ttlMs=5000] Time to live in milliseconds before an ID is eligible for re-acceptance.
 */
function createMessageDedup(options = {}) {
  const ttlMs = options.ttlMs ?? 5000;
  const recentMessageIds = new Map();

  return {
    /**
     * Attempts to remember a message ID.
     * Returns true if the message is fresh (new), or false if it is a duplicate within the TTL window.
     *
     * @param {string} id
     * @param {number} [now]
     * @returns {boolean} True if new, false if duplicate.
     */
    remember(id, now = Date.now()) {
      if (!id) return true;

      for (const [knownId, seenAt] of recentMessageIds) {
        if (now - seenAt > ttlMs) {
          recentMessageIds.delete(knownId);
        }
      }

      if (recentMessageIds.has(id)) {
        return false;
      }

      recentMessageIds.set(id, now);
      return true;
    },

    /**
     * Checks if an ID is currently remembered without modifying state.
     *
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
      return recentMessageIds.has(id);
    },

    /**
     * Clears all remembered IDs.
     */
    clear() {
      recentMessageIds.clear();
    },

    /**
     * Current count of remembered IDs.
     * @returns {number}
     */
    size() {
      return recentMessageIds.size;
    },
  };
}

module.exports = {
  createMessageDedup,
};
