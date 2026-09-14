const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = '127.0.0.1';
const port = Number(process.env.BOOSTY_OVERLAY_PORT || 17369);
const configFile = process.env.BOOSTY_OVERLAY_CONFIG || path.join(__dirname, 'overlay-settings.json');
const clients = new Set();
const recentMessageIds = new Map();
const MAX_HISTORY = 50;
const messageHistory = [];
let nextEventId = 0;
const { version: appVersion } = require('./package.json');
let extensionVersion = null;

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

function compareSemver(v1, v2) {
  if (!v1 || !v2) return 0;
  const p1 = String(v1).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const p2 = String(v2).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

let receivedMessages = 0;
let lastMessageAt = null;
let connectorLastSeenAt = null;
let extensionLastSeenAt = null;
let boostyLastSeenAt = null;
let boostyTabUrl = null;
const defaultConfig = {
  durationSeconds: 20,
  maxMessages: 6,
  fontSize: 21,
  accentColor: '#f15f2c',
  backgroundOpacity: 88,
  showAvatars: true,
};
let overlayConfig = { ...defaultConfig };

try {
  overlayConfig = { ...defaultConfig, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
} catch {
  // First launch: defaults are used until the user saves settings.
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

function broadcast(message) {
  receivedMessages += 1;
  lastMessageAt = Date.now();
  if (!message.eventId) {
    nextEventId += 1;
    message.eventId = String(nextEventId);
  }
  if (!message.receivedAt) {
    message.receivedAt = Date.now();
  }
  messageHistory.push(message);
  while (messageHistory.length > MAX_HISTORY) {
    messageHistory.shift();
  }
  const event = `id: ${message.eventId}\ndata: ${JSON.stringify(message)}\n\n`;
  for (const client of clients) client.write(event);
}

function broadcastConfig() {
  const event = `event: config\ndata: ${JSON.stringify(overlayConfig)}\n\n`;
  for (const client of clients) client.write(event);
}

function normalizedConfig(input) {
  const number = (value, min, max, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const accentColor = /^#[0-9a-f]{6}$/i.test(input?.accentColor ?? '')
    ? input.accentColor
    : overlayConfig.accentColor;
  return {
    durationSeconds: Math.round(number(input?.durationSeconds, 0, 120, overlayConfig.durationSeconds ?? 20)),
    maxMessages: Math.round(number(input?.maxMessages, 1, 20, overlayConfig.maxMessages ?? 6)),
    fontSize: Math.round(number(input?.fontSize, 12, 48, overlayConfig.fontSize ?? 21)),
    accentColor,
    backgroundOpacity: Math.round(number(input?.backgroundOpacity, 0, 100, overlayConfig.backgroundOpacity ?? 88)),
    showAvatars: input?.showAvatars !== false,
  };
}

function rememberMessage(id) {
  const now = Date.now();
  for (const [knownId, seenAt] of recentMessageIds) {
    if (now - seenAt > 5_000) recentMessageIds.delete(knownId);
  }
  if (recentMessageIds.has(id)) return false;
  recentMessageIds.set(id, now);
  return true;
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
    const now = Date.now();
    const isExtensionConnected = extensionLastSeenAt !== null && now - extensionLastSeenAt < 60_000;
    const isBoostyConnected = boostyLastSeenAt !== null && now - boostyLastSeenAt < 12_000;
    const isConnectorConnected = (connectorLastSeenAt !== null && now - connectorLastSeenAt < 12_000) || isBoostyConnected;
    const isOutdated = Boolean(isExtensionConnected && extensionVersion && compareSemver(extensionVersion, bundledExtensionVersion) < 0);
    return sendJson(response, 200, {
      ok: true,
      appVersion,
      bundledExtensionVersion,
      extensionVersion,
      isOutdated,
      overlayClients: clients.size,
      receivedMessages,
      lastMessageAt,
      historyCount: messageHistory.length,
      connectorConnected: isConnectorConnected,
      extensionConnected: isExtensionConnected,
      boostyConnected: isBoostyConnected,
      connectorLastSeenAt,
      extensionLastSeenAt,
      boostyLastSeenAt,
      boostyTabUrl,
    });
  }

  if (request.method === 'GET' && url.pathname === '/config') {
    return sendJson(response, 200, overlayConfig);
  }

  if (request.method === 'POST' && url.pathname === '/config') {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 20_000) request.destroy();
    });
    request.on('end', () => {
      try {
        overlayConfig = normalizedConfig(JSON.parse(body));
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        fs.writeFileSync(configFile, `${JSON.stringify(overlayConfig, null, 2)}\n`, { mode: 0o600 });
        broadcastConfig();
        return sendJson(response, 200, overlayConfig);
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
      const now = Date.now();
      connectorLastSeenAt = now;
      extensionLastSeenAt = now;
      try {
        if (body.trim()) {
          const data = JSON.parse(body);
          const incomingVer = data.extensionVersion || data.version;
          if (incomingVer && typeof incomingVer === 'string') {
            extensionVersion = incomingVer;
          }
          if (data.source === 'content_tab') {
            boostyLastSeenAt = now;
            if (typeof data.url === 'string') boostyTabUrl = data.url;
          }
        }
      } catch {}
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

    let replayMessages = [];
    if (rawLastEventId !== undefined && rawLastEventId !== null && rawLastEventId !== '') {
      const parsedLastId = Number(rawLastEventId);
      if (Number.isFinite(parsedLastId)) {
        replayMessages = messageHistory.filter(m => Number(m.eventId) > parsedLastId);
      } else {
        const idx = messageHistory.findIndex(m => String(m.eventId) === String(rawLastEventId));
        replayMessages = idx !== -1 ? messageHistory.slice(idx + 1) : messageHistory;
      }
    } else {
      replayMessages = messageHistory.slice();
    }

    for (const msg of replayMessages) {
      response.write(`id: ${msg.eventId}\ndata: ${JSON.stringify(msg)}\n\n`);
    }

    clients.add(response);
    request.on('close', () => clients.delete(response));
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
        const message = {
          id: String(input.id || `${now}-${Math.random().toString(36).slice(2, 7)}`),
          author: String(input.author || 'Boosty'),
          text: String(input.text || '').trim(),
          avatar: typeof input.avatar === 'string' ? input.avatar : '',
          timestamp: Number(input.timestamp) || now,
          receivedAt: now,
        };
        if (!message.text) return sendJson(response, 400, { error: 'Empty message' });
        connectorLastSeenAt = now;
        extensionLastSeenAt = now;
        boostyLastSeenAt = now;
        const incomingVer = input.extensionVersion || input.version;
        if (incomingVer && typeof incomingVer === 'string') {
          extensionVersion = incomingVer;
        }
        if (!rememberMessage(message.id)) return sendJson(response, 202, { ok: true, duplicate: true });
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
    broadcast({
      id: `test-${now}`,
      author: 'Тестовый зритель',
      text: 'Boosty → OBS работает 🎉',
      avatar: '',
      timestamp: now,
      receivedAt: now,
    });
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

module.exports = { host, port, server };
