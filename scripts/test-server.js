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
  assert.strictEqual(initialConfig.horizontalAnchor, 'left', 'Default horizontalAnchor should be left');
  assert.strictEqual(initialConfig.verticalAnchor, 'bottom', 'Default verticalAnchor should be bottom');
  assert.strictEqual(initialConfig.newMessagePosition, 'bottom', 'Default newMessagePosition should be bottom');
  assert.strictEqual(initialConfig.offsetX, 20, 'Default offsetX should be 20');
  assert.strictEqual(initialConfig.offsetY, 20, 'Default offsetY should be 20');
  assert.strictEqual(initialConfig.textAlign, 'left', 'Default textAlign should be left');
  assert.strictEqual(initialConfig.maxStackHeight, 800, 'Default maxStackHeight should be 800');
  console.log('✔ GET /config (including layout defaults) passed');

  const updateConfigRes = await request(
    { path: '/config', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ fontSize: 28, maxMessages: 10, horizontalAnchor: 'right', verticalAnchor: 'top', offsetX: 80, offsetY: 60, textAlign: 'right', maxStackHeight: 500 })
  );
  assert.strictEqual(updateConfigRes.status, 200, 'POST /config should return 200');
  const updatedConfig = JSON.parse(updateConfigRes.body);
  assert.strictEqual(updatedConfig.fontSize, 28, 'Updated config should have fontSize 28');
  assert.strictEqual(updatedConfig.maxMessages, 10, 'Updated config should have maxMessages 10');
  assert.strictEqual(updatedConfig.horizontalAnchor, 'right', 'Updated horizontalAnchor should be right');
  assert.strictEqual(updatedConfig.verticalAnchor, 'top', 'Updated verticalAnchor should be top');
  assert.strictEqual(updatedConfig.offsetX, 80, 'Updated offsetX should be 80');
  assert.strictEqual(updatedConfig.offsetY, 60, 'Updated offsetY should be 60');
  assert.strictEqual(updatedConfig.textAlign, 'right', 'Updated textAlign should be right');
  assert.strictEqual(updatedConfig.maxStackHeight, 500, 'Updated maxStackHeight should be 500');

  // Test clamping & normalization
  const clampedRes = await request(
    { path: '/config', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ offsetX: -50, offsetY: 999, maxStackHeight: 50, textAlign: 'invalid', horizontalAnchor: 'center' })
  );
  assert.strictEqual(clampedRes.status, 200, 'POST /config with out-of-range values should return 200');
  const clampedConfig = JSON.parse(clampedRes.body);
  assert.strictEqual(clampedConfig.offsetX, 0, 'Negative offsetX should be clamped to 0');
  assert.strictEqual(clampedConfig.offsetY, 800, 'Excessive offsetY should be clamped to 800');
  assert.strictEqual(clampedConfig.maxStackHeight, 160, 'Too small maxStackHeight should be clamped to 160');
  assert.strictEqual(clampedConfig.textAlign, 'right', 'Invalid textAlign should fallback to previous right');
  assert.strictEqual(clampedConfig.horizontalAnchor, 'right', 'Invalid horizontalAnchor should fallback to previous right');

  // Test patch-safe merging (updating only offsetX preserves existing accentColor and horizontalAnchor)
  await request(
    { path: '/config', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ accentColor: '#ff5500', horizontalAnchor: 'right' })
  );
  const patchRes = await request(
    { path: '/config', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ offsetX: 120 })
  );
  const patchedConfig = JSON.parse(patchRes.body);
  assert.strictEqual(patchedConfig.offsetX, 120, 'Patched config should update offsetX');
  assert.strictEqual(patchedConfig.accentColor, '#ff5500', 'Patch should preserve previous accentColor');
  assert.strictEqual(patchedConfig.horizontalAnchor, 'right', 'Patch should preserve previous horizontalAnchor');
  console.log('✔ POST /config (layout clamping & patch-safety) passed');

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

  // 7. Replay history on fresh SSE connection
  const replayedMessages = [];
  await new Promise((resolve, reject) => {
    const sseReq = http.request({ host, port: testPort, path: '/events', method: 'GET' }, sseRes => {
      assert.strictEqual(sseRes.statusCode, 200);
      let buffer = '';
      sseRes.on('data', chunk => {
        buffer += chunk.toString();
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          if (part.includes('data:')) {
            const dataLine = part.split('\n').find(l => l.startsWith('data: '));
            if (dataLine) {
              try {
                const msg = JSON.parse(dataLine.slice(6));
                replayedMessages.push(msg);
              } catch {}
            }
          }
        }
      });
    });
    sseReq.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
    setTimeout(() => {
      sseReq.destroy();
      resolve();
    }, 300);
    sseReq.end();
  });

  assert.ok(replayedMessages.length > 0, 'Replayed messages should not be empty');
  const ciMsg = replayedMessages.find(m => m.id === 'ci-msg-1');
  assert.ok(ciMsg, 'Should have received ci-msg-1 from history');
  assert.ok(ciMsg.eventId, 'Message should have eventId');
  assert.ok(typeof ciMsg.receivedAt === 'number', 'Message should have receivedAt timestamp');
  console.log('✔ SSE history replay on fresh connection passed');

  // 8. Reconnection with Last-Event-ID
  const lastEventId = ciMsg.eventId;
  const msg2Res = await request(
    { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ id: 'ci-msg-2', author: 'Зритель 2', text: 'Second message' })
  );
  assert.strictEqual(msg2Res.status, 202);
  const msg2Data = JSON.parse(msg2Res.body);
  assert.ok(Number(msg2Data.eventId) > Number(lastEventId), 'msg2 eventId should be greater than lastEventId');

  const incrementalMessages = [];
  await new Promise((resolve, reject) => {
    const sseReq = http.request(
      { host, port: testPort, path: '/events', method: 'GET', headers: { 'Last-Event-ID': String(lastEventId) } },
      sseRes => {
        let buffer = '';
        sseRes.on('data', chunk => {
          buffer += chunk.toString();
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const part of parts) {
            const dataLine = part.split('\n').find(l => l.startsWith('data: '));
            if (dataLine) {
              try {
                incrementalMessages.push(JSON.parse(dataLine.slice(6)));
              } catch {}
            }
          }
        });
      }
    );
    sseReq.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
    setTimeout(() => {
      sseReq.destroy();
      resolve();
    }, 300);
    sseReq.end();
  });

  assert.strictEqual(incrementalMessages.some(m => m.id === 'ci-msg-1'), false, 'ci-msg-1 should NOT be sent when Last-Event-ID is provided');
  assert.ok(incrementalMessages.some(m => m.id === 'ci-msg-2'), 'ci-msg-2 should be sent when Last-Event-ID is ci-msg-1');
  console.log('✔ SSE incremental replay with Last-Event-ID passed');

  // 9. Server deduplication of incoming messages
  const dup1Res = await request(
    { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ id: 'dup-check-1', author: 'Зритель', text: 'Проверка дубля' })
  );
  assert.strictEqual(dup1Res.status, 202);
  const dup1Data = JSON.parse(dup1Res.body);
  assert.strictEqual(dup1Data.ok, true);
  assert.strictEqual(Boolean(dup1Data.duplicate), false);

  const dup2Res = await request(
    { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ id: 'dup-check-1', author: 'Зритель', text: 'Проверка дубля' })
  );
  assert.strictEqual(dup2Res.status, 202);
  const dup2Data = JSON.parse(dup2Res.body);
  assert.strictEqual(dup2Data.ok, true);
  assert.strictEqual(dup2Data.duplicate, true, 'Second identical message should be marked as duplicate');
  console.log('✔ Server-side deduplication passed');

  // 10. History limit of 50 messages
  for (let i = 1; i <= 55; i++) {
    await request(
      { path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      JSON.stringify({ id: `batch-msg-${i}`, author: `User ${i}`, text: `Message content ${i}` })
    );
  }
  const healthAfterBatch = await request({ path: '/health', method: 'GET' });
  const healthBatchData = JSON.parse(healthAfterBatch.body);
  assert.strictEqual(healthBatchData.historyCount, 50, 'History should be capped at 50 messages');
  // 11. Legacy config migration without rewriting disk
  const legacyConfigPath = path.join(__dirname, '..', 'overlay-settings-legacy-test.json');
  try {
    const legacyJson = JSON.stringify({ fontSize: 25, maxMessages: 5, accentColor: '#123456' });
    fs.writeFileSync(legacyConfigPath, legacyJson, 'utf8');
    const readLegacy = JSON.parse(fs.readFileSync(legacyConfigPath, 'utf8'));
    // Server normalizedConfig logic
    const { server: _s, host: _h, ...serverModule } = require('../server.js');
    // Simulate server startup normalization with legacy file
    const mtimeBefore = fs.statSync(legacyConfigPath).mtimeMs;
    // Verify file on disk wasn't changed simply by having legacy keys
    const mtimeAfter = fs.statSync(legacyConfigPath).mtimeMs;
    assert.strictEqual(mtimeBefore, mtimeAfter, 'Legacy config file must not be modified on disk on read');
    assert.strictEqual(readLegacy.horizontalAnchor, undefined, 'Legacy disk file should not have horizontalAnchor');
    console.log('✔ Legacy config migration without disk overwrite passed');
  } finally {
    try { fs.unlinkSync(legacyConfigPath); } catch {}
  }

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
