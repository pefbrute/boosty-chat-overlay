/**
 * Server-Sent Events (SSE) Hub managing connected clients and event broadcasting.
 */
function createSseHub() {
  const clients = new Set();

  return {
    /**
     * Adds an active HTTP response as an SSE client.
     *
     * @param {object} response Node.js http.ServerResponse
     */
    addClient(response) {
      clients.add(response);
    },

    /**
     * Removes an SSE client.
     *
     * @param {object} response Node.js http.ServerResponse
     */
    removeClient(response) {
      clients.delete(response);
    },

    /**
     * Formats an SSE message payload string.
     *
     * @param {object} message
     * @returns {string}
     */
    formatMessageEvent(message) {
      return `id: ${message.eventId}\ndata: ${JSON.stringify(message)}\n\n`;
    },

    /**
     * Formats an SSE config payload string.
     *
     * @param {object} config
     * @returns {string}
     */
    formatConfigEvent(config) {
      return `event: config\ndata: ${JSON.stringify(config)}\n\n`;
    },

    /**
     * Broadcasts a chat message to all connected SSE clients.
     *
     * @param {object} message
     */
    broadcastMessage(message) {
      const event = this.formatMessageEvent(message);
      for (const client of clients) {
        try {
          client.write(event);
        } catch {
          clients.delete(client);
        }
      }
    },

    /**
     * Broadcasts updated overlay configuration to all connected SSE clients.
     *
     * @param {object} config
     */
    broadcastConfig(config) {
      const event = this.formatConfigEvent(config);
      for (const client of clients) {
        try {
          client.write(event);
        } catch {
          clients.delete(client);
        }
      }
    },

    /**
     * Current count of connected SSE clients.
     * @returns {number}
     */
    clientCount() {
      return clients.size;
    },

    /**
     * Clears all client references.
     */
    clear() {
      clients.clear();
    },
  };
}

module.exports = {
  createSseHub,
};
