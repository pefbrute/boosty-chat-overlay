const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
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

server.listen(port, host, () => {
  console.log(`Boosty overlay: http://${host}:${port}/overlay/`);
  console.log(`Test message:  http://${host}:${port}/test`);
});

module.exports = {
  host,
  port,
  server,
  defaultConfig,
  normalizeConfig,
  normalizedConfig,
};
