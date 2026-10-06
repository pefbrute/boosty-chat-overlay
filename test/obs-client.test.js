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

test('classifyObsError accurately distinguishes auth vs network failures', () => {
  const { classifyObsError } = require('../desktop/obs/client.js');

  // Auth failure codes
  assert.equal(classifyObsError({ code: 4005, message: 'Authentication failed.' }).isAuthError, true);
  assert.equal(classifyObsError({ code: 4009, message: 'Authentication failed.' }).isAuthError, true);
  assert.equal(classifyObsError({ code: 4002, message: 'Authentication required' }).isAuthError, true);
  assert.equal(classifyObsError({ message: 'Authentication failed' }).isAuthError, true);
  assert.equal(classifyObsError({ message: 'Socket not identified' }).isAuthError, true);

  // Network connection failure codes
  assert.equal(classifyObsError({ code: -1, message: 'connect ECONNREFUSED 127.0.0.1:4455' }).isConnectionError, true);
  assert.equal(classifyObsError({ message: 'getaddrinfo ENOTFOUND invalidhost' }).isConnectionError, true);
  assert.equal(classifyObsError({ message: 'connect ETIMEDOUT 192.168.1.99:4455' }).isConnectionError, true);

  // Cross checks
  assert.equal(classifyObsError({ code: -1, message: 'ECONNREFUSED' }).isAuthError, false);
  assert.equal(classifyObsError({ code: 4009, message: 'Authentication failed' }).isConnectionError, false);
});

test('createObsClient connects with configurable host, port, and password', async () => {
  const client = createObsClient({
    OBSWebSocketClass: MockOBSWebSocket,
  });

  const res = await client.connect({
    host: '192.168.1.100',
    port: 4456,
    password: 'correct_pass',
  });

  assert.equal(res.host, '192.168.1.100');
  assert.equal(res.port, 4456);
  assert.equal(res.password, 'correct_pass');
  assert.equal(res.obs.url, 'ws://192.168.1.100:4456');
  assert.equal(res.obs.password, 'correct_pass');
});

test('createObsClient suppresses spurious ConnectionClosed emitted during failed authentication', async () => {
  class AuthFailSocket extends EventEmitter {
    async connect(url, password) {
      if (password !== 'secret') {
        // Real obs-websocket-js emits ConnectionClosed before rejecting connect() on code 4009
        this.emit('ConnectionClosed');
        const err = new Error('Authentication failed.');
        err.code = 4009;
        throw err;
      }
      this.connected = true;
    }
    async disconnect() {
      this.connected = false;
      this.emit('ConnectionClosed');
    }
  }

  const client = createObsClient({
    OBSWebSocketClass: AuthFailSocket,
    configResolver: () => ({ restartRequired: false, port: 4455, password: '' }),
  });

  let closedCount = 0;
  client.on('ConnectionClosed', () => {
    closedCount++;
  });

  await assert.rejects(async () => client.connect({ password: 'wrong' }), /Authentication failed/);
  assert.equal(closedCount, 0, 'Spurious ConnectionClosed on failed handshake must not be emitted');

  const ok = await client.connect({ password: 'secret' });
  assert.equal(client.isConnected(), true);
  assert.ok(ok.obs);

  await client.disconnect();
  assert.equal(closedCount, 1, 'Explicit disconnect of active connection should emit ConnectionClosed once');
});
