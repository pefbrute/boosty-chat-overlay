'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const msgpack = require('@msgpack/msgpack');
const { _electron: electron } = require('playwright');

const projectRoot = path.resolve(__dirname, '..');
const TEST_SECRET = 'OBS_E2E_SECRET_9f3a';

/**
 * Starts a real OBS WebSocket v5 protocol server (supporting both obswebsocket.msgpack and obswebsocket.json)
 * with optional SHA256 salt/challenge password authentication.
 */
async function startObsWebSocketServer({ password = '', initialScenes = ['Gaming', 'Starting Soon'] } = {}) {
  let currentPassword = password;
  const scenes = initialScenes.map((name, idx) => ({
    sceneUuid: `scene-uuid-${idx + 1}`,
    sceneName: name,
    items: [],
  }));
  const inputs = []; // { inputUuid, inputName, inputKind, inputSettings }
  let nextSceneItemId = 1;
  let createInputCount = 0;
  let authFailureCount = 0;
  let successfulIdentifies = 0;

  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    handleProtocols: (protocols) => {
      if (protocols.has('obswebsocket.msgpack')) return 'obswebsocket.msgpack';
      if (protocols.has('obswebsocket.json')) return 'obswebsocket.json';
      return false;
    },
  });

  await new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });

  const port = wss.address().port;

  function computeExpectedAuth(pwd, salt, challenge) {
    const secret = crypto.createHash('sha256').update(pwd + salt).digest('base64');
    return crypto.createHash('sha256').update(secret + challenge).digest('base64');
  }

  wss.on('connection', (ws) => {
    const isMsgpack = ws.protocol === 'obswebsocket.msgpack';
    const salt = crypto.randomBytes(16).toString('base64');
    const challenge = crypto.randomBytes(16).toString('base64');
    let identified = false;

    const sendPacket = (packet) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (isMsgpack) {
        ws.send(Buffer.from(msgpack.encode(packet)));
      } else {
        ws.send(JSON.stringify(packet));
      }
    };

    // OpCode 0: Hello
    const helloData = {
      obsWebSocketVersion: '5.5.0',
      rpcVersion: 1,
    };
    if (currentPassword) {
      helloData.authentication = { challenge, salt };
    }
    sendPacket({ op: 0, d: helloData });

    ws.on('message', (raw, isBinary) => {
      let msg;
      try {
        msg = (isMsgpack || isBinary) ? msgpack.decode(raw) : JSON.parse(raw.toString());
      } catch {
        return;
      }

      // OpCode 1: Identify
      if (msg.op === 1) {
        if (currentPassword) {
          const clientAuth = msg.d?.authentication || '';
          const expectedAuth = computeExpectedAuth(currentPassword, salt, challenge);
          if (!clientAuth || clientAuth !== expectedAuth) {
            authFailureCount++;
            ws.close(4009, 'Authentication failed.');
            return;
          }
        }
        identified = true;
        successfulIdentifies++;
        // OpCode 2: Identified
        sendPacket({ op: 2, d: { negotiatedRpcVersion: 1 } });
        return;
      }

      if (!identified) {
        ws.close(4007, 'Not identified.');
        return;
      }

      // OpCode 6: Request
      if (msg.op === 6) {
        const { requestType, requestId, requestData = {} } = msg.d || {};
        let responseData = {};
        let result = true;
        let code = 100;
        let comment = undefined;

        if (requestType === 'GetVideoSettings') {
          responseData = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080 };
        } else if (requestType === 'GetSceneCollectionList') {
          responseData = { currentSceneCollectionName: 'Main Collection', sceneCollections: ['Main Collection'] };
        } else if (requestType === 'GetSceneList') {
          responseData = {
            currentProgramSceneName: scenes[0]?.sceneName || 'Gaming',
            currentProgramSceneUuid: scenes[0]?.sceneUuid || 'scene-uuid-1',
            scenes: scenes.map(s => ({ sceneUuid: s.sceneUuid, sceneName: s.sceneName })),
          };
        } else if (requestType === 'GetInputList') {
          responseData = {
            inputs: inputs.map(i => ({
              inputUuid: i.inputUuid,
              inputName: i.inputName,
              inputKind: i.inputKind,
              unversionedInputKind: i.inputKind,
            })),
          };
        } else if (requestType === 'GetInputSettings') {
          const found = inputs.find(
            i => (requestData.inputUuid && i.inputUuid === requestData.inputUuid) ||
                 (requestData.inputName && i.inputName === requestData.inputName)
          );
          if (found) {
            responseData = { inputSettings: { ...found.inputSettings }, inputKind: found.inputKind };
          } else {
            result = false;
            code = 600;
            comment = 'Input not found';
          }
        } else if (requestType === 'SetInputSettings') {
          const found = inputs.find(
            i => (requestData.inputUuid && i.inputUuid === requestData.inputUuid) ||
                 (requestData.inputName && i.inputName === requestData.inputName)
          );
          if (found) {
            found.inputSettings = requestData.overlay === false
              ? { ...requestData.inputSettings }
              : { ...found.inputSettings, ...requestData.inputSettings };
          }
        } else if (requestType === 'GetSceneItemList') {
          const sc = scenes.find(
            s => (requestData.sceneUuid && s.sceneUuid === requestData.sceneUuid) ||
                 (requestData.sceneName && s.sceneName === requestData.sceneName)
          );
          responseData = {
            sceneItems: sc ? sc.items.map(item => ({ ...item })) : [],
          };
        } else if (requestType === 'CreateInput') {
          createInputCount++;
          const sc = scenes.find(
            s => (requestData.sceneUuid && s.sceneUuid === requestData.sceneUuid) ||
                 (requestData.sceneName && s.sceneName === requestData.sceneName)
          );
          const inputUuid = `input-uuid-${createInputCount}`;
          const newInput = {
            inputUuid,
            inputName: requestData.inputName || 'Boosty Chat',
            inputKind: requestData.inputKind || 'browser_source',
            inputSettings: { ...(requestData.inputSettings || {}) },
          };
          inputs.push(newInput);
          const sceneItemId = nextSceneItemId++;
          if (sc) {
            sc.items.push({
              sceneItemId,
              sourceUuid: inputUuid,
              sourceName: newInput.inputName,
              inputKind: newInput.inputKind,
              sceneItemEnabled: requestData.sceneItemEnabled !== false,
              sceneItemTransform: {
                positionX: 0,
                positionY: 0,
                scaleX: 1,
                scaleY: 1,
                width: Number(newInput.inputSettings.width || 1920),
                height: Number(newInput.inputSettings.height || 1080),
                sourceWidth: Number(newInput.inputSettings.width || 1920),
                sourceHeight: Number(newInput.inputSettings.height || 1080),
                cropLeft: 0,
                cropRight: 0,
                cropTop: 0,
                cropBottom: 0,
                rotation: 0,
              },
            });
          }
          responseData = { inputUuid, sceneItemId };
        } else if (requestType === 'CreateSceneItem') {
          const sc = scenes.find(
            s => (requestData.sceneUuid && s.sceneUuid === requestData.sceneUuid) ||
                 (requestData.sceneName && s.sceneName === requestData.sceneName)
          );
          const foundInput = inputs.find(
            i => (requestData.sourceUuid && i.inputUuid === requestData.sourceUuid) ||
                 (requestData.sourceName && i.inputName === requestData.sourceName)
          );
          const sceneItemId = nextSceneItemId++;
          if (sc && foundInput) {
            sc.items.push({
              sceneItemId,
              sourceUuid: foundInput.inputUuid,
              sourceName: foundInput.inputName,
              inputKind: foundInput.inputKind,
              sceneItemEnabled: requestData.sceneItemEnabled !== false,
              sceneItemTransform: {
                positionX: 0,
                positionY: 0,
                scaleX: 1,
                scaleY: 1,
                width: Number(foundInput.inputSettings.width || 1920),
                height: Number(foundInput.inputSettings.height || 1080),
                sourceWidth: Number(foundInput.inputSettings.width || 1920),
                sourceHeight: Number(foundInput.inputSettings.height || 1080),
                cropLeft: 0,
                cropRight: 0,
                cropTop: 0,
                cropBottom: 0,
                rotation: 0,
              },
            });
          }
          responseData = { sceneItemId };
        } else if (requestType === 'SetSceneItemTransform') {
          const sc = scenes.find(
            s => (requestData.sceneUuid && s.sceneUuid === requestData.sceneUuid) ||
                 (requestData.sceneName && s.sceneName === requestData.sceneName)
          );
          const item = sc?.items.find(it => it.sceneItemId === requestData.sceneItemId);
          if (item && requestData.sceneItemTransform) {
            item.sceneItemTransform = {
              ...item.sceneItemTransform,
              ...requestData.sceneItemTransform,
            };
          }
        } else if (requestType === 'GetSceneItemTransform') {
          const sc = scenes.find(
            s => (requestData.sceneUuid && s.sceneUuid === requestData.sceneUuid) ||
                 (requestData.sceneName && s.sceneName === requestData.sceneName)
          );
          const item = sc?.items.find(it => it.sceneItemId === requestData.sceneItemId);
          responseData = {
            sceneItemTransform: item?.sceneItemTransform || {
              positionX: 0,
              positionY: 0,
              scaleX: 1,
              scaleY: 1,
              width: 1920,
              height: 1080,
              sourceWidth: 1920,
              sourceHeight: 1080,
              cropLeft: 0,
              cropRight: 0,
              cropTop: 0,
              cropBottom: 0,
              rotation: 0,
            },
          };
        } else if (requestType === 'SetSceneItemEnabled') {
          const sc = scenes.find(
            s => (requestData.sceneUuid && s.sceneUuid === requestData.sceneUuid) ||
                 (requestData.sceneName && s.sceneName === requestData.sceneName)
          );
          const item = sc?.items.find(it => it.sceneItemId === requestData.sceneItemId);
          if (item) {
            item.sceneItemEnabled = Boolean(requestData.sceneItemEnabled);
          }
        } else if (requestType === 'PressInputPropertiesButton') {
          responseData = {};
        }

        // OpCode 7: RequestResponse
        sendPacket({
          op: 7,
          d: {
            requestType,
            requestId,
            requestStatus: { result, code, ...(comment ? { comment } : {}) },
            responseData,
          },
        });
      }
    });
  });

  return {
    port,
    getInputs: () => inputs,
    getScenes: () => scenes,
    getCreateInputCount: () => createInputCount,
    getAuthFailureCount: () => authFailureCount,
    getSuccessfulIdentifies: () => successfulIdentifies,
    setPassword: (pwd) => { currentPassword = pwd; },
    close: () => new Promise(resolve => {
      for (const client of wss.clients) {
        try { client.terminate(); } catch {}
      }
      wss.close(() => resolve());
    }),
  };
}

/**
 * Connects a simulated MV3 extension WebSocket client to the local overlay server.
 */
async function connectSimulatedExtension(overlayPort) {
  const ws = new WebSocket(`ws://127.0.0.1:${overlayPort}/connector`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  ws.send(JSON.stringify({
    type: 'HANDSHAKE',
    client: 'boosty-chat-connector',
    version: '0.4.0',
    extensionVersion: '0.4.0',
    extensionId: 'bcoadgccgjomlcadhmeognidaoocohdp',
    tabs: [
      {
        tabId: 101,
        url: 'https://boosty.to/streamer/streams/only-chat',
        hasChat: true,
        lastSeenAt: Date.now(),
      },
    ],
  }));

  const sendTabState = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'TAB_STATE',
        payload: {
          tabId: 101,
          url: 'https://boosty.to/streamer/streams/only-chat',
          hasChat: true,
          extensionVersion: '0.4.0',
        },
      }));
    }
  };

  sendTabState();
  const heartbeatTimer = setInterval(sendTabState, 1500);

  return {
    ws,
    close: () => {
      clearInterval(heartbeatTimer);
      try { ws.close(); } catch {}
    },
  };
}

/**
 * Connects an SSE listener to /events (simulating the OBS Browser Source overlay client).
 */
function connectSseOverlayClient(overlayPort) {
  const receivedEvents = [];
  const rawChunks = [];
  let req = null;

  const readyPromise = new Promise((resolve, reject) => {
    req = http.get(`http://127.0.0.1:${overlayPort}/events`, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        rawChunks.push(chunk);
        const blocks = chunk.split('\n\n');
        for (const block of blocks) {
          const dataLine = block.split('\n').find(l => l.startsWith('data: '));
          if (dataLine) {
            try {
              receivedEvents.push(JSON.parse(dataLine.slice(6)));
            } catch {}
          }
        }
      });
      resolve();
    });
    req.on('error', reject);
  });

  return {
    readyPromise,
    getEvents: () => receivedEvents,
    getRawOutput: () => rawChunks.join(''),
    close: () => {
      try { req?.destroy(); } catch {}
    },
  };
}

async function waitForCondition(fn, { timeoutMs = 10000, intervalMs = 100, description = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const val = await fn();
      if (val) return val;
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for ${description}${lastErr ? `: ${lastErr.message}` : ''}`);
}

async function launchIsolatedElectron({ userDataDir, overlayPort, obsConfigPath }) {
  const consoleLogs = [];
  const electronApp = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      path.join(projectRoot, 'desktop', 'main.js'),
    ],
    env: {
      ...process.env,
      BOOSTY_OVERLAY_USER_DATA: userDataDir,
      BOOSTY_OVERLAY_PORT: String(overlayPort),
      BOOSTY_OVERLAY_OBS_CONFIG_PATH: obsConfigPath,
      BOOSTY_OVERLAY_HIDE_WINDOW: '1',
      BOOSTY_OVERLAY_OBS_SYNC_MS: '2000',
    },
  });

  const win = await electronApp.firstWindow();
  win.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await win.waitForFunction(() => window.__APP_INITIALIZED__ === true, null, { timeout: 15000 });
  return {
    electronApp,
    win,
    getConsoleLogs: () => consoleLogs.join('\n'),
    quit: async () => {
      try {
        await electronApp.evaluate(({ app }) => {
          app.quit();
        });
      } catch {}
      try {
        await electronApp.close();
      } catch {}
    },
  };
}

test('Scenario A: Fresh userData -> Onboarding (OBS without password) -> Finish -> Immediate Dashboard Ready without restart', async () => {
  const runId = `${process.pid}-a-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), `boosty-overlay-fresh-e2e-${runId}`);
  const obsConfigPath = path.join(userDataDir, 'obs-websocket-config.json');
  const settingsFilePath = path.join(userDataDir, 'overlay-settings.json');
  const overlayPort = 17411;

  // Verify userData does not exist yet
  assert.equal(fs.existsSync(userDataDir), false, 'Fresh userData directory must not exist before launch');
  assert.equal(fs.existsSync(settingsFilePath), false, 'overlay-settings.json must not exist before launch');

  const obsServer = await startObsWebSocketServer({ password: '' });
  // Write isolated OBS WebSocket config pointing to our test OBS server port (no password)
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(obsConfigPath, JSON.stringify({
    server_enabled: true,
    server_port: obsServer.port,
    auth_required: false,
    server_password: '',
  }, null, 2));

  let appSession = null;
  let extSim = null;
  let sseClient = null;

  try {
    appSession = await launchIsolatedElectron({ userDataDir, overlayPort, obsConfigPath });
    const { win } = appSession;

    // 1. Verify fresh startup state
    const initialUiState = await win.evaluate(() => ({
      onboardingCompleted: localStorage.getItem('onboardingCompleted'),
      onboardingDisplay: document.querySelector('#onboarding-view')?.style.display,
      mainShellDisplay: document.querySelector('#main-app-shell')?.style.display,
      step1Active: document.querySelector('#step-1')?.classList.contains('active'),
      step1NextDisabled: document.querySelector('#ob-step1-next-btn')?.disabled,
      boostyAuditUndefined: typeof window.boostyAudit === 'undefined',
    }));

    assert.equal(initialUiState.onboardingCompleted, null, 'onboardingCompleted must not be set on fresh launch');
    assert.equal(initialUiState.onboardingDisplay, 'block', 'Onboarding view must open on fresh launch');
    assert.equal(initialUiState.mainShellDisplay, 'none', 'Main dashboard shell must be hidden during onboarding');
    assert.equal(initialUiState.step1Active, true, 'Step 1 of onboarding must be active');
    assert.equal(initialUiState.step1NextDisabled, true, 'Step 1 Next button must be disabled before extension connects');
    assert.equal(initialUiState.boostyAuditUndefined, true, 'Production mode must not expose window.boostyAudit');

    // Connect SSE overlay client and simulated extension
    sseClient = connectSseOverlayClient(overlayPort);
    await sseClient.readyPromise;
    extSim = await connectSimulatedExtension(overlayPort);

    // Wait for Step 1 to detect extension and enable Next button
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#ob-step1-next-btn')?.disabled === false),
      { description: 'Step 1 extension connected & Next enabled' }
    );

    // Click Step 1 -> Step 2
    await win.click('#ob-step1-next-btn');
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#step-2')?.classList.contains('active')),
      { description: 'Step 2 active' }
    );

    // Verify Step 2 Boosty badge is connected
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#ob-boosty-status-badge')?.classList.contains('connected')),
      { description: 'Step 2 Boosty status badge connected' }
    );

    // Click Step 2 -> Step 3
    await win.click('#ob-step2-next-btn');
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#step-3')?.classList.contains('active')),
      { description: 'Step 3 active' }
    );

    // Wait for OBS to connect on Step 3 and populate scenes
    await waitForCondition(
      () => win.evaluate(() => {
        const badgeOk = document.querySelector('#ob-obs-status-badge')?.classList.contains('connected');
        const select = document.querySelector('#ob-obs-scene-select');
        return badgeOk && select && !select.disabled && select.options.length >= 1;
      }),
      { description: 'Step 3 OBS connected and scene list populated' }
    );

    // Before adding chat to scene, Step 3 Next button must be disabled
    const beforeAddNextDisabled = await win.evaluate(() => document.querySelector('#ob-step3-next-btn')?.disabled);
    assert.equal(beforeAddNextDisabled, true, 'Step 3 Next button must be disabled before chat source is added to scene');

    // Click "Добавить чат" (#ob-add-obs-btn)
    await win.click('#ob-add-obs-btn');
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#ob-step3-next-btn')?.disabled === false),
      { description: 'Canonical Browser Source created and Step 3 Next enabled' }
    );
    assert.equal(obsServer.getInputs().length, 1, 'Exactly 1 canonical Browser Source created in OBS');
    assert.equal(obsServer.getInputs()[0].inputName, 'Boosty Chat');

    // Click Step 3 -> Step 4
    await win.click('#ob-step3-next-btn');
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#step-4')?.classList.contains('active')),
      { description: 'Step 4 active' }
    );

    // Click Finish (#ob-finish-btn) -> Transition to Dashboard WITHOUT restarting app
    await win.click('#ob-finish-btn');

    // Immediately verify Dashboard state in the SAME process
    await waitForCondition(
      () => win.evaluate(() => {
        const obHidden = document.querySelector('#onboarding-view')?.style.display === 'none';
        const shellVisible = document.querySelector('#main-app-shell')?.style.display === 'grid';
        const obsPillOk = document.querySelector('#dash-obs-pill')?.classList.contains('ready');
        const extPillOk = document.querySelector('#dash-ext-pill')?.classList.contains('ready');
        const boostyPillOk = document.querySelector('#dash-boosty-pill')?.classList.contains('ready');
        const overlayPillOk = document.querySelector('#dash-overlay-pill')?.classList.contains('ready');
        const obsBadgeOk = document.querySelector('#dash-obs-badge')?.classList.contains('connected');
        return obHidden && shellVisible && obsPillOk && extPillOk && boostyPillOk && overlayPillOk && obsBadgeOk;
      }),
      { description: 'Dashboard immediately shows all 4 services connected without restart' }
    );

    // Send test message and verify end-to-end delivery to overlay SSE stream
    const prevEventCount = sseClient.getEvents().length;
    const testRes = await fetch(`http://127.0.0.1:${overlayPort}/test`);
    const testJson = await testRes.json();
    assert.equal(testJson.ok, true, 'Test message endpoint returned ok: true');

    await waitForCondition(
      () => sseClient.getEvents().length > prevEventCount,
      { description: 'Overlay SSE client received test message' }
    );
  } finally {
    sseClient?.close();
    extSim?.close();
    await appSession?.quit();
    await obsServer.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('Scenario B & C + 30s Stability + Restart + Secret Redaction: Fresh onboarding preserves OBS password connection after finish', async () => {
  const runId = `${process.pid}-bc-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), `boosty-overlay-fresh-e2e-${runId}`);
  const obsConfigPath = path.join(userDataDir, 'obs-websocket-config.json');
  const settingsFilePath = path.join(userDataDir, 'overlay-settings.json');
  const overlayPort = 17412;

  assert.equal(fs.existsSync(userDataDir), false);
  assert.equal(fs.existsSync(settingsFilePath), false);

  // Start OBS WebSocket server requiring authentication with TEST_SECRET
  // Note: We do NOT put server_password in obsConfigPath so the user MUST enter it in Onboarding Step 3
  const obsServer = await startObsWebSocketServer({ password: TEST_SECRET });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(obsConfigPath, JSON.stringify({
    server_enabled: true,
    server_port: obsServer.port,
    auth_required: true,
    server_password: '',
  }, null, 2));

  let appSession = null;
  let extSim = null;
  let sseClient = null;

  try {
    appSession = await launchIsolatedElectron({ userDataDir, overlayPort, obsConfigPath });
    let { win } = appSession;

    // Connect SSE overlay client and simulated extension
    sseClient = connectSseOverlayClient(overlayPort);
    await sseClient.readyPromise;
    extSim = await connectSimulatedExtension(overlayPort);

    // Step 1 -> Step 2 -> Step 3
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#ob-step1-next-btn')?.disabled === false),
      { description: 'Step 1 Next button enabled' }
    );
    await win.click('#ob-step1-next-btn');
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#step-2')?.classList.contains('active')),
      { description: 'Step 2 active' }
    );
    await win.click('#ob-step2-next-btn');
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#step-3')?.classList.contains('active')),
      { description: 'Step 3 active' }
    );

    // --- Scenario C: Wrong password in onboarding Step 3 ---
    await win.fill('#ob-obs-password', 'WRONG_OBS_PASSWORD_000');
    await win.click('#ob-obs-save-password-btn');

    await waitForCondition(
      () => win.evaluate(() => {
        const badgeErr = document.querySelector('#ob-obs-status-badge')?.classList.contains('error');
        const alertEl = document.querySelector('#ob-obs-auth-alert');
        const alertVisible = alertEl && alertEl.style.display !== 'none' && alertEl.textContent.includes('OBS найден, но не удалось авторизоваться');
        const nextDisabled = document.querySelector('#ob-step3-next-btn')?.disabled === true;
        return badgeErr && alertVisible && nextDisabled;
      }),
      { description: 'Step 3 shows auth-failed state and disables Next button on wrong password' }
    );
    assert.ok(obsServer.getAuthFailureCount() >= 1, 'OBS server recorded authentication failure');

    // --- Scenario B & C Recovery: Replace with correct password in the SAME process ---
    await win.fill('#ob-obs-password', TEST_SECRET);
    await win.click('#ob-obs-save-password-btn');

    await waitForCondition(
      () => win.evaluate(() => {
        const badgeOk = document.querySelector('#ob-obs-status-badge')?.classList.contains('connected');
        const alertHidden = document.querySelector('#ob-obs-auth-alert')?.style.display === 'none';
        const select = document.querySelector('#ob-obs-scene-select');
        return badgeOk && alertHidden && select && !select.disabled && select.options.length > 0;
      }),
      { description: 'Step 3 recovers and connects to OBS with valid password without restart' }
    );

    // Add canonical Browser Source to scene in Step 3
    await win.click('#ob-add-obs-btn');
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#ob-step3-next-btn')?.disabled === false),
      { description: 'Browser Source added and Step 3 Next button enabled' }
    );

    // Advance to Step 4 and click Finish (#ob-finish-btn)
    await win.click('#ob-step3-next-btn');
    await waitForCondition(
      () => win.evaluate(() => document.querySelector('#step-4')?.classList.contains('active')),
      { description: 'Step 4 active' }
    );
    await win.click('#ob-finish-btn');

    // --- Regression Check: fresh onboarding preserves OBS connection after finish (NO RESTART) ---
    const postFinishState = await waitForCondition(
      () => win.evaluate(async () => {
        const obHidden = document.querySelector('#onboarding-view')?.style.display === 'none';
        const shellVisible = document.querySelector('#main-app-shell')?.style.display === 'grid';
        const obsPillOk = document.querySelector('#dash-obs-pill')?.classList.contains('ready');
        const extPillOk = document.querySelector('#dash-ext-pill')?.classList.contains('ready');
        const boostyPillOk = document.querySelector('#dash-boosty-pill')?.classList.contains('ready');
        const overlayPillOk = document.querySelector('#dash-overlay-pill')?.classList.contains('ready');
        const dashObsBadgeOk = document.querySelector('#dash-obs-badge')?.classList.contains('connected');
        const dashAuthAlertHidden = document.querySelector('#dash-obs-auth-alert')?.style.display === 'none';
        const obsStatus = await window.boostyOverlay.getObsStatus();
        const obsConnCfg = await window.boostyOverlay.getObsConnectionConfig();
        if (obHidden && shellVisible && obsPillOk && extPillOk && boostyPillOk && overlayPillOk && dashObsBadgeOk && dashAuthAlertHidden && obsStatus?.connected) {
          return { obsStatus, obsConnCfg };
        }
        return null;
      }),
      { description: 'fresh onboarding preserves OBS connection after finish' }
    );

    assert.equal(postFinishState.obsStatus.connected, true);
    assert.equal(postFinishState.obsStatus.authFailed, false);
    assert.equal(postFinishState.obsConnCfg.password, TEST_SECRET);
    assert.equal(obsServer.getInputs().length, 1);

    // Send test message immediately after Finish
    const eventsBeforeTest = sseClient.getEvents().length;
    const testResp1 = await fetch(`http://127.0.0.1:${overlayPort}/test`);
    assert.equal((await testResp1.json()).ok, true);
    await waitForCondition(
      () => sseClient.getEvents().length > eventsBeforeTest,
      { description: 'Test message delivered immediately after onboarding finish' }
    );

    // --- 30-Second Stability Window (covering ~15 OBS sync cycles & ~25 health cycles) ---
    const stabilityStart = Date.now();
    const stabilityDurationMs = 30500;
    let obsDropCount = 0;
    let authFailedSeen = false;
    let maxDuplicatesSeen = 0;

    while (Date.now() - stabilityStart < stabilityDurationMs) {
      const snap = await win.evaluate(async () => {
        const status = await window.boostyOverlay.getObsStatus();
        return {
          connected: Boolean(status?.connected),
          authFailed: Boolean(status?.authFailed),
          duplicateCount: Number(status?.duplicateCount || 0),
          obsPillReady: document.querySelector('#dash-obs-pill')?.classList.contains('ready'),
          extPillReady: document.querySelector('#dash-ext-pill')?.classList.contains('ready'),
          boostyPillReady: document.querySelector('#dash-boosty-pill')?.classList.contains('ready'),
          overlayPillReady: document.querySelector('#dash-overlay-pill')?.classList.contains('ready'),
        };
      });

      if (!snap.connected || !snap.obsPillReady) obsDropCount++;
      if (snap.authFailed) authFailedSeen = true;
      if (snap.duplicateCount > maxDuplicatesSeen) maxDuplicatesSeen = snap.duplicateCount;

      await new Promise(r => setTimeout(r, 1000));
    }

    assert.equal(obsDropCount, 0, 'OBS connection must not drop during 30s post-onboarding stability window');
    assert.equal(authFailedSeen, false, 'authFailed must never appear during 30s stability window');
    assert.equal(maxDuplicatesSeen, 0, 'Zero duplicate Browser Sources during 30s stability window');
    assert.equal(obsServer.getInputs().length, 1, 'Strictly 1 Browser Source in OBS after 30s stability window');

    // --- Secret Redaction Scan before restart ---
    const configHttpText = await (await fetch(`http://127.0.0.1:${overlayPort}/config`)).text();
    const diagHttpText = await (await fetch(`http://127.0.0.1:${overlayPort}/diagnostic`)).text();
    const healthHttpText = await (await fetch(`http://127.0.0.1:${overlayPort}/health`)).text();
    const sseRawText = sseClient.getRawOutput();
    const consoleLogsText = appSession.getConsoleLogs();

    assert.equal(configHttpText.includes(TEST_SECRET), false, 'GET /config must not leak obsPassword');
    assert.equal(diagHttpText.includes(TEST_SECRET), false, 'GET /diagnostic must not leak obsPassword');
    assert.equal(healthHttpText.includes(TEST_SECRET), false, 'GET /health must not leak obsPassword');
    assert.equal(sseRawText.includes(TEST_SECRET), false, 'SSE /events stream must not leak obsPassword');
    assert.equal(consoleLogsText.includes(TEST_SECRET), false, 'Renderer console logs must not leak obsPassword');

    // Verify overlay-settings.json on disk persisted the password
    const savedDiskConfig = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
    assert.equal(savedDiskConfig.obsPassword, TEST_SECRET, 'overlay-settings.json in isolated userData must persist obsPassword');
    assert.equal(savedDiskConfig.obsPort, obsServer.port, 'overlay-settings.json in isolated userData must persist obsPort');

    // --- Post-Onboarding Restart Persistence Check ---
    sseClient.close();
    extSim.close();
    await appSession.quit();
    appSession = null;

    // Wait briefly for port release, then relaunch Electron with the SAME userDataDir
    await new Promise(r => setTimeout(r, 500));
    appSession = await launchIsolatedElectron({ userDataDir, overlayPort, obsConfigPath });
    win = appSession.win;

    sseClient = connectSseOverlayClient(overlayPort);
    await sseClient.readyPromise;
    extSim = await connectSimulatedExtension(overlayPort);

    const afterRestartState = await waitForCondition(
      () => win.evaluate(async () => {
        const obHidden = document.querySelector('#onboarding-view')?.style.display === 'none';
        const shellVisible = document.querySelector('#main-app-shell')?.style.display === 'grid';
        const obsPillOk = document.querySelector('#dash-obs-pill')?.classList.contains('ready');
        const extPillOk = document.querySelector('#dash-ext-pill')?.classList.contains('ready');
        const boostyPillOk = document.querySelector('#dash-boosty-pill')?.classList.contains('ready');
        const overlayPillOk = document.querySelector('#dash-overlay-pill')?.classList.contains('ready');
        const status = await window.boostyOverlay.getObsStatus();
        if (obHidden && shellVisible && obsPillOk && extPillOk && boostyPillOk && overlayPillOk && status?.connected) {
          return status;
        }
        return null;
      }),
      { description: 'After restart, onboarding stays closed and OBS auto-connects with saved password' }
    );

    assert.equal(afterRestartState.connected, true);
    assert.equal(afterRestartState.authFailed, false);
    assert.equal(obsServer.getInputs().length, 1, 'Still strictly 1 Browser Source after restart');

    // Send test message after restart
    const eventsBeforeRestartTest = sseClient.getEvents().length;
    const testResp2 = await fetch(`http://127.0.0.1:${overlayPort}/test`);
    assert.equal((await testResp2.json()).ok, true);
    await waitForCondition(
      () => sseClient.getEvents().length > eventsBeforeRestartTest,
      { description: 'Test message works after restart' }
    );
  } finally {
    sseClient?.close();
    extSim?.close();
    await appSession?.quit();
    await obsServer.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
