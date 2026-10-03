const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createObsClient } = require('../desktop/obs/client.js');

class MockOBSWebSocket extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.calls = [];
  }

  async connect(url, password) {
    if (password === 'wrong') {
      throw new Error('Authentication failed');
    }
    this.connected = true;
    this.url = url;
    this.password = password;
  }

  async disconnect() {
    this.connected = false;
    this.emit('ConnectionClosed');
  }

  async call(type, data) {
    this.calls.push({ type, data });
    return { ok: true, type, data };
  }
}

test('createObsClient handles restartRequired from config', async () => {
  const client = createObsClient({
    configResolver: () => ({
      restartRequired: true,
      port: 4455,
      password: '',
    }),
  });

  const res = await client.connect();
  assert.equal(res.restartRequired, true);
  assert.equal(client.isConnected(), false);
});

test('createObsClient connects, caches connection, and proxies calls', async () => {
  const client = createObsClient({
    OBSWebSocketClass: MockOBSWebSocket,
    configResolver: () => ({
      restartRequired: false,
      port: 4455,
      password: 'mypassword',
    }),
  });

  let connectedEventFired = false;
  client.on('Connected', () => {
    connectedEventFired = true;
  });

  const res1 = await client.connect();
  assert.equal(res1.restartRequired, false);
  assert.equal(client.isConnected(), true);
  assert.equal(connectedEventFired, true);

  // Cached connection
  const res2 = await client.connect();
  assert.equal(res1.obs, res2.obs);

  // Proxy call
  const callRes = await client.call('GetVersion');
  assert.equal(callRes.type, 'GetVersion');

  // Disconnect
  let closedEventFired = false;
  client.on('ConnectionClosed', () => {
    closedEventFired = true;
  });

  await client.disconnect();
  assert.equal(client.isConnected(), false);
  assert.equal(closedEventFired, true);
});

test('createObsClient handles connection failures cleanly', async () => {
  const client = createObsClient({
    OBSWebSocketClass: MockOBSWebSocket,
    configResolver: () => ({
      restartRequired: false,
      port: 4455,
      password: 'wrong',
    }),
  });

  await assert.rejects(
    async () => client.connect('wrong'),
    /Authentication failed/
  );
  assert.equal(client.isConnected(), false);
});
