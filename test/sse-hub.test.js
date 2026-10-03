const test = require('node:test');
const assert = require('node:assert/strict');
const { createSseHub } = require('../core/sse/hub.js');

test('createSseHub manages client connections and broadcasting', () => {
  const hub = createSseHub();
  assert.equal(hub.clientCount(), 0);

  const writtenA = [];
  const clientA = {
    write(chunk) {
      writtenA.push(chunk);
    },
  };

  const writtenB = [];
  const clientB = {
    write(chunk) {
      writtenB.push(chunk);
    },
  };

  hub.addClient(clientA);
  hub.addClient(clientB);
  assert.equal(hub.clientCount(), 2);

  // Broadcast message
  const msg = { eventId: '42', text: 'Hello stream' };
  hub.broadcastMessage(msg);

  assert.equal(writtenA.length, 1);
  assert.equal(writtenB.length, 1);
  assert.equal(writtenA[0], `id: 42\ndata: ${JSON.stringify(msg)}\n\n`);

  // Broadcast config
  const cfg = { fontSize: 24 };
  hub.broadcastConfig(cfg);
  assert.equal(writtenA.length, 2);
  assert.equal(writtenA[1], `event: config\ndata: ${JSON.stringify(cfg)}\n\n`);

  // Remove client
  hub.removeClient(clientA);
  assert.equal(hub.clientCount(), 1);

  // Errored client auto-removal
  const faultyClient = {
    write() {
      throw new Error('Socket closed');
    },
  };
  hub.addClient(faultyClient);
  assert.equal(hub.clientCount(), 2);
  hub.broadcastMessage({ eventId: '43', text: 'Another' });
  assert.equal(hub.clientCount(), 1); // faultyClient removed
});
