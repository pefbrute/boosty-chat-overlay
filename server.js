const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { version: appVersion } = require('./package.json');
const { normalizeIncomingMessage, validateNormalizedMessage } = require('./core/messages/model.js');
const { defaultConfig } = require('./core/config/defaults.js');
const { normalizeConfig, normalizedConfig } = require('./core/config/schema.js');
const { createConfigStore } = require('./core/config/storage.js');
const { createHealthTracker } = require('./core/health/tracker.js');
const { createMessageHistory } = require('./core/messages/history.js');
const { createMessageDedup } = require('./core/messages/dedup.js');
const { createSseHub } = require('./core/sse/hub.js');

const host = '127.0.0.1';
const port = Number(process.env.BOOSTY_OVERLAY_PORT || 17369);
const configFile = process.env.BOOSTY_OVERLAY_CONFIG || path.join(__dirname, 'overlay-settings.json');

function getBundledExtensionVersion() {
  try {
    const manifestPath = path.join(__dirname, 'extension', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.version) return manifest.version;
    }
  } catch {}
  return appVersion || '0.4.0';
}
const bundledExtensionVersion = getBundledExtensionVersion();

const configStore = createConfigStore({ configFile });
const healthTracker = createHealthTracker({ appVersion, bundledExtensionVersion });
const messageHistory = createMessageHistory({ maxHistory: 50 });
const messageDedup = createMessageDedup({ ttlMs: 5000 });
const sseHub = createSseHub();

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

function broadcast(message, isTest = false) {
  messageHistory.add(message);
  healthTracker.recordMessage({
    extensionVersion: message.extensionVersion,
    now: message.receivedAt,
    isTest,
  });
  sseHub.broadcastMessage(message);
}

function broadcastConfig() {
  sseHub.broadcastConfig(configStore.get());
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Allow-Private-Network',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Private-Network': 'true',
    });
    return response.end();
  }

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(302, { Location: '/overlay/' });
    return response.end();
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    const health = healthTracker.getHealthState({
      overlayClients: sseHub.clientCount(),
      historyCount: messageHistory.size(),
    });
    return sendJson(response, 200, health);
  }

  if (request.method === 'GET' && (url.pathname === '/diagnostic' || url.pathname === '/connector/diagnostic')) {
    const health = healthTracker.getHealthState({
      overlayClients: sseHub.clientCount(),
      historyCount: messageHistory.size(),
    });
    return sendJson(response, 200, {
      ok: true,
      timestamp: new Date().toISOString(),
      health,
      trace: healthTracker.getDiagnosticTrace(),
    });
  }

  if (request.method === 'GET' && url.pathname === '/history') {
    return sendJson(response, 200, messageHistory.getAll());
  }

  if (request.method === 'GET' && url.pathname === '/config') {
    return sendJson(response, 200, configStore.get());
  }

  if (request.method === 'POST' && url.pathname === '/config') {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 20_000) request.destroy();
    });
    request.on('end', () => {
      try {
        const updated = configStore.update(JSON.parse(body));
        broadcastConfig();
        return sendJson(response, 200, updated);
      } catch {
        return sendJson(response, 400, { error: 'Invalid config' });
      }
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/connector') {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 5000) request.destroy();
    });
    request.on('end', () => {
      try {
        if (body.trim()) {
          const data = JSON.parse(body);
          healthTracker.updateConnector(data);
        } else {
          healthTracker.updateConnector();
        }
      } catch {
        healthTracker.updateConnector();
      }
      return sendJson(response, 200, { ok: true });
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/events') {
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
    });
    response.write(': connected\n\n');

    const lastEventIdHeader = request.headers['last-event-id'];
    const lastEventIdParam = url.searchParams.get('lastEventId');
    const rawLastEventId = lastEventIdHeader || lastEventIdParam;

    const replayMessages = messageHistory.getAfterEventId(rawLastEventId);
    for (const msg of replayMessages) {
      response.write(sseHub.formatMessageEvent(msg));
    }

    sseHub.addClient(response);
    request.on('close', () => sseHub.removeClient(response));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/message') {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 100_000) request.destroy();
    });
    request.on('end', () => {
      try {
        const input = JSON.parse(body);
        const now = Date.now();
        const effectiveReceivedAt = (typeof input.receivedAt === 'number' && Number.isFinite(input.receivedAt) && input.receivedAt > 0)
          ? input.receivedAt
          : now;
        const message = normalizeIncomingMessage(input, { receivedAt: effectiveReceivedAt });
        const validation = validateNormalizedMessage(message);
        if (!validation.ok) {
          return sendJson(response, 400, { error: validation.error || 'Invalid message' });
        }

        const incomingVer = input.extensionVersion || input.version;
        healthTracker.recordMessage({
          extensionVersion: typeof incomingVer === 'string' ? incomingVer : undefined,
          now,
          isTest: false,
        });

        if (!messageDedup.remember(message.id)) {
          return sendJson(response, 202, { ok: true, duplicate: true });
        }

        broadcast(message);
        return sendJson(response, 202, { ok: true, eventId: message.eventId });
      } catch {
        return sendJson(response, 400, { error: 'Invalid JSON' });
      }
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/test') {
    const now = Date.now();
    const testMessage = normalizeIncomingMessage({
      id: `test-${now}`,
      platform: 'boosty',
      author: {
        name: 'Тестовый зритель',
        avatar: null,
      },
      text: 'Boosty → OBS работает 🎉',
      reply: null,
      publishedAt: null,
    }, { receivedAt: now });
    broadcast(testMessage, true);
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === 'GET' && url.pathname.startsWith('/overlay/')) {
    const relative = url.pathname === '/overlay/' ? 'index.html' : url.pathname.slice('/overlay/'.length);
    const safeName = path.basename(relative);
    const file = path.join(__dirname, 'overlay', safeName);
    const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' };
    fs.readFile(file, (error, data) => {
      if (error) return sendJson(response, 404, { error: 'Not found' });
      response.writeHead(200, {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`,
      });
      response.end(data);
    });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
});

let connectionIdCounter = 0;
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  if (url.pathname === '/connector' || url.pathname === '/ws') {
    // Validate Origin for security (Requirement 40)
    const origin = request.headers['origin'] || '';
    if (origin) {
      const isAllowedOrigin = origin.startsWith('chrome-extension://') ||
                              origin.startsWith('http://localhost') ||
                              origin.startsWith('http://127.0.0.1') ||
                              origin.startsWith('https://boosty.to');
      if (!isAllowedOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, request) => {
  const connectionId = `conn-${Date.now()}-${++connectionIdCounter}`;
  let isHandshakeComplete = false;

  // Handshake timeout: client must send HANDSHAKE within 5 seconds
  const handshakeTimer = setTimeout(() => {
    if (!isHandshakeComplete) {
      try {
        ws.close(4001, 'Handshake timeout');
      } catch {}
    }
  }, 5000);

  // Send greeting to client
  try {
    ws.send(JSON.stringify({
      type: 'GREETING',
      connectionId,
      serverVersion: appVersion,
      timestamp: Date.now(),
    }));
  } catch {}

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'HANDSHAKE') {
        isHandshakeComplete = true;
        clearTimeout(handshakeTimer);
        healthTracker.registerWsConnection(connectionId, {
          client: msg.client || 'boosty-chat-connector',
          version: msg.version || msg.extensionVersion,
          extensionVersion: msg.extensionVersion || msg.version,
          tabs: msg.tabs || [],
          clientGeneration: msg.generation,
        });
        ws.send(JSON.stringify({
          type: 'HANDSHAKE_ACK',
          connectionId,
          ok: true,
        }));
        return;
      }

      if (msg.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
        return;
      }

      if (msg.type === 'TAB_STATE') {
        healthTracker.updateTabState(msg.payload || msg, connectionId);
        return;
      }

      if (msg.type === 'TAB_CLOSED') {
        healthTracker.removeTab(msg.tabId, connectionId);
        return;
      }

      if (msg.type === 'MESSAGE' || msg.type === 'POST_MESSAGE') {
        const input = msg.payload || msg;
        const now = Date.now();
        const effectiveReceivedAt = (typeof input.receivedAt === 'number' && Number.isFinite(input.receivedAt) && input.receivedAt > 0)
          ? input.receivedAt
          : now;
        const message = normalizeIncomingMessage(input, { receivedAt: effectiveReceivedAt });
        const validation = validateNormalizedMessage(message);
        if (!validation.ok) {
          ws.send(JSON.stringify({ type: 'MESSAGE_ACK', id: input.id, ok: false, error: validation.error }));
          return;
        }

        const incomingVer = input.extensionVersion || input.version;
        healthTracker.recordMessage({
          extensionVersion: typeof incomingVer === 'string' ? incomingVer : undefined,
          author: message.author?.name,
          now,
          isTest: false,
        });

        if (!messageDedup.remember(message.id)) {
          ws.send(JSON.stringify({ type: 'MESSAGE_ACK', id: message.id, ok: true, duplicate: true }));
          return;
        }

        broadcast(message);
        ws.send(JSON.stringify({ type: 'MESSAGE_ACK', id: message.id, ok: true, eventId: message.eventId }));
        return;
      }
    } catch (err) {
      console.warn('[Server WS] Error processing message:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    clearTimeout(handshakeTimer);
    healthTracker.unregisterWsConnection(connectionId, reason?.toString() || `code_${code}`);
  });

  ws.on('error', (err) => {
    clearTimeout(handshakeTimer);
    healthTracker.unregisterWsConnection(connectionId, `error: ${err.message}`);
  });
});

server.listen(port, host, () => {
  console.log(`Boosty overlay: http://${host}:${port}/overlay/`);
  console.log(`Test message:  http://${host}:${port}/test`);
});

module.exports = {
  host,
  port,
  server,
  wss,
  sseHub,
  healthTracker,
  defaultConfig,
  normalizeConfig,
  normalizedConfig,
};
