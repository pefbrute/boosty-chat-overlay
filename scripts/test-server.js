const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

// Configure test environment
const testPort = 17379;
process.env.BOOSTY_OVERLAY_PORT = String(testPort);
const tmpConfig = path.join(__dirname, '..', 'overlay-settings-test.json');
process.env.BOOSTY_OVERLAY_CONFIG = tmpConfig;

// Clean up any old test config
try { fs.unlinkSync(tmpConfig); } catch {}

const { server, host } = require('../server.js');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port: testPort, ...options }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('Starting server tests on port ' + testPort + '...');

  // 1. Health check
  const healthRes = await request({ path: '/health', method: 'GET' });
  assert.strictEqual(healthRes.status, 200, 'Health endpoint should return 200');
  const healthData = JSON.parse(healthRes.body);
  assert.strictEqual(healthData.ok, true, 'Health ok flag should be true');
  console.log('✔ GET /health passed');

  // 2. Overlay static files
  const indexRes = await request({ path: '/overlay/', method: 'GET' });
  assert.strictEqual(indexRes.status, 200, 'Overlay root should return 200');
  assert.match(indexRes.headers['content-type'], /text\/html/, 'Overlay root content-type should be html');
  assert.match(indexRes.body, /id="messages"/, 'Overlay HTML should contain messages container');
  console.log('✔ GET /overlay/ (index.html) passed');

  const cssRes = await request({ path: '/overlay/style.css', method: 'GET' });
  assert.strictEqual(cssRes.status, 200, 'style.css should return 200');
  assert.match(cssRes.headers['content-type'], /text\/css/, 'style.css content-type should be css');
  console.log('✔ GET /overlay/style.css passed');

  const jsRes = await request({ path: '/overlay/overlay.js', method: 'GET' });
  assert.strictEqual(jsRes.status, 200, 'overlay.js should return 200');
  assert.match(jsRes.headers['content-type'], /text\/javascript/, 'overlay.js content-type should be javascript');
  console.log('✔ GET /overlay/overlay.js passed');

  // 3. Config get & post
  const configRes = await request({ path: '/config', method: 'GET' });
  assert.strictEqual(configRes.status, 200, 'GET /config should return 200');
  const initialConfig = JSON.parse(configRes.body);
  assert.strictEqual(typeof initialConfig.fontSize, 'number', 'Config fontSize should be a number');
  console.log('✔ GET /config passed');

  const updateConfigRes = await request(
    { path: '/config', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ fontSize: 28, maxMessages: 10 })
  );
  assert.strictEqual(updateConfigRes.status, 200, 'POST /config should return 200');
  const updatedConfig = JSON.parse(updateConfigRes.body);
  assert.strictEqual(updatedConfig.fontSize, 28, 'Updated config should have fontSize 28');
  assert.strictEqual(updatedConfig.maxMessages, 10, 'Updated config should have maxMessages 10');
  console.log('✔ POST /config passed');

  // 4. Connector heartbeat (background & content_tab)
  const bgConnectorRes = await request(
    { path: '/connector', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ source: 'background', extensionVersion: '0.3.9', timestamp: Date.now() })
  );
  assert.strictEqual(bgConnectorRes.status, 200, 'POST /connector background should return 200');

  let checkHealth = await request({ path: '/health', method: 'GET' });
  let healthState = JSON.parse(checkHealth.body);
  assert.strictEqual(healthState.extensionConnected, true, 'extensionConnected should be true after background heartbeat');
  assert.strictEqual(healthState.boostyConnected, false, 'boostyConnected should be false before content_tab heartbeat');
  assert.strictEqual(healthState.extensionVersion, '0.3.9', 'extensionVersion should be 0.3.9');
  assert.strictEqual(healthState.bundledExtensionVersion, '0.4.0', 'bundledExtensionVersion should be 0.4.0');
  assert.strictEqual(healthState.isOutdated, true, 'isOutdated should be true for 0.3.9 < 0.4.0');
  console.log('✔ POST /connector (outdated check) passed');

  const updateConnectorRes = await request(
    { path: '/connector', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ source: 'background', extensionVersion: '0.4.0', timestamp: Date.now() })
  );
  assert.strictEqual(updateConnectorRes.status, 200, 'POST /connector update should return 200');

  checkHealth = await request({ path: '/health', method: 'GET' });
  healthState = JSON.parse(checkHealth.body);
  assert.strictEqual(healthState.extensionVersion, '0.4.0', 'extensionVersion should be 0.4.0');
  assert.strictEqual(healthState.isOutdated, false, 'isOutdated should be false for 0.4.0');

  const tabConnectorRes = await request(
    { path: '/connector', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ source: 'content_tab', extensionVersion: '0.4.0', url: 'https://boosty.to/stream', timestamp: Date.now() })
  );
  assert.strictEqual(tabConnectorRes.status, 200, 'POST /connector content_tab should return 200');

  checkHealth = await request({ path: '/health', method: 'GET' });
  healthState = JSON.parse(checkHealth.body);
  assert.strictEqual(healthState.extensionConnected, true, 'extensionConnected should be true');
  assert.strictEqual(healthState.boostyConnected, true, 'boostyConnected should be true after content_tab heartbeat');
  console.log('✔ POST /connector (content_tab heartbeat) passed');

  // 5. Test message trigger
  const testRes = await request({ path: '/test', method: 'GET' });
  assert.strictEqual(testRes.status, 200, 'GET /test should return 200');
  console.log('✔ GET /test passed');

  // 6. SSE Event stream and message delivery
  await new Promise((resolve, reject) => {
    const sseReq = http.request({ host, port: testPort, path: '/events', method: 'GET' }, sseRes => {
      assert.strictEqual(sseRes.statusCode, 200, 'GET /events should return 200');
      assert.match(sseRes.headers['content-type'], /text\/event-stream/, 'SSE content-type should be event-stream');

      let receivedEvent = false;

      sseRes.on('data', chunk => {
        const text = chunk.toString();
        if (text.includes('Тестовый пользователь') || text.includes('Hello from CI')) {
          receivedEvent = true;
          sseReq.destroy();
          resolve();
        }
      });

      // Send a message after connecting to SSE
      setTimeout(async () => {
        try {
          const msgRes = await request(
            { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
            JSON.stringify({
              id: 'ci-msg-1',
              author: 'Тестовый пользователь',
              text: 'Hello from CI test',
            })
          );
          assert.strictEqual(msgRes.status, 202, 'POST /message should return 202');
        } catch (err) {
          sseReq.destroy();
          reject(err);
        }
      }, 100);

      setTimeout(() => {
        if (!receivedEvent) {
          sseReq.destroy();
          reject(new Error('Timed out waiting for SSE message event'));
        }
      }, 3000);
    });

    sseReq.on('error', err => {
      // Ignore abort errors from destroying request
      if (err.code !== 'ECONNRESET') reject(err);
    });
    sseReq.end();
  });
  console.log('✔ GET /events & POST /message SSE delivery passed');

  console.log('\nAll server tests passed successfully!');
}

runTests()
  .then(() => {
    server.close(() => {
      try { fs.unlinkSync(tmpConfig); } catch {}
      process.exit(0);
    });
  })
  .catch(err => {
    console.error('Test failed:', err);
    server.close(() => {
      try { fs.unlinkSync(tmpConfig); } catch {}
      process.exit(1);
    });
  });
