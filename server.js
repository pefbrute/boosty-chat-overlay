const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = '127.0.0.1';
const port = Number(process.env.BOOSTY_OVERLAY_PORT || 17369);
const configFile = process.env.BOOSTY_OVERLAY_CONFIG || path.join(__dirname, 'overlay-settings.json');
const clients = new Set();
const recentMessageIds = new Map();
let receivedMessages = 0;
let lastMessageAt = null;
let connectorLastSeenAt = null;
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
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

function broadcast(message) {
  receivedMessages += 1;
  lastMessageAt = Date.now();
  const event = `data: ${JSON.stringify(message)}\n\n`;
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
  const accentColor = /^#[0-9a-f]{6}$/i.test(input.accentColor || '')
    ? input.accentColor
    : overlayConfig.accentColor;
  return {
    durationSeconds: number(input.durationSeconds, 3, 120, overlayConfig.durationSeconds),
    maxMessages: Math.round(number(input.maxMessages, 1, 20, overlayConfig.maxMessages)),
    fontSize: Math.round(number(input.fontSize, 12, 48, overlayConfig.fontSize)),
    accentColor,
    backgroundOpacity: Math.round(number(input.backgroundOpacity, 0, 100, overlayConfig.backgroundOpacity)),
    showAvatars: input.showAvatars !== false,
  };
}

function rememberMessage(id) {
  const now = Date.now();
  for (const [knownId, seenAt] of recentMessageIds) {
    if (now - seenAt > 10 * 60_000) recentMessageIds.delete(knownId);
  }
  if (recentMessageIds.has(id)) return false;
  recentMessageIds.set(id, now);
  return true;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Origin': '*',
    });
    return response.end();
  }

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(302, { Location: '/overlay/' });
    return response.end();
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    return sendJson(response, 200, {
      ok: true,
      overlayClients: clients.size,
      receivedMessages,
      lastMessageAt,
      connectorConnected: connectorLastSeenAt !== null && Date.now() - connectorLastSeenAt < 12_000,
      connectorLastSeenAt,
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
    connectorLastSeenAt = Date.now();
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === 'GET' && url.pathname === '/events') {
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });
    response.write(': connected\n\n');
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
        const message = {
          id: String(input.id || `${Date.now()}-${Math.random()}`),
          author: String(input.author || 'Boosty'),
          text: String(input.text || '').trim(),
          avatar: typeof input.avatar === 'string' ? input.avatar : '',
          timestamp: Date.now(),
        };
        if (!message.text) return sendJson(response, 400, { error: 'Empty message' });
        connectorLastSeenAt = Date.now();
        if (!rememberMessage(message.id)) return sendJson(response, 202, { ok: true, duplicate: true });
        broadcast(message);
        return sendJson(response, 202, { ok: true });
      } catch {
        return sendJson(response, 400, { error: 'Invalid JSON' });
      }
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/test') {
    broadcast({
      id: `test-${Date.now()}`,
      author: 'Тестовый зритель',
      text: 'Boosty → OBS работает 🎉',
      avatar: '',
      timestamp: Date.now(),
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
