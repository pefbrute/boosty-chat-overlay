const { OBSWebSocket } = require('obs-websocket-js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function obsConfigPath() {
  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.config', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
  }
  return path.join(process.env.APPDATA || '', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
}

async function runObsAudit() {
  console.log('=== BENCHMARK & AUDIT: OBS WEBSOCKET REQUESTS ===\n');

  const confPath = obsConfigPath();
  let conf = { server_port: 4455, auth_required: false, server_password: '' };
  try {
    conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  } catch {}

  const obs = new OBSWebSocket();
  try {
    await obs.connect(`ws://127.0.0.1:${conf.server_port || 4455}`, conf.auth_required ? conf.server_password : '');
    console.log(`Connected to live OBS WebSocket on port ${conf.server_port || 4455}`);

    // Track request count per call to fetchActualObsState
    let requestCount = 0;
    const originalCall = obs.call.bind(obs);
    const callLog = [];

    obs.call = async function(requestType, requestData) {
      requestCount++;
      const t0 = performance.now();
      try {
        const res = await originalCall(requestType, requestData);
        const duration = performance.now() - t0;
        callLog.push({ requestType, duration: duration.toFixed(2), ok: true });
        return res;
      } catch (err) {
        const duration = performance.now() - t0;
        callLog.push({ requestType, duration: duration.toFixed(2), ok: false, error: err.message });
        throw err;
      }
    };

    // 1. Run single state fetch simulation
    console.log('1. Measuring a single fetchActualObsState execution against live OBS...');
    requestCount = 0;
    callLog.length = 0;
    const t0 = performance.now();

    // Replicate fetchActualObsState logic from desktop/main.js
    const [collectionData, sceneListData, inputListData] = await Promise.all([
      obs.call('GetSceneCollectionList').catch(() => ({ currentSceneCollectionName: '' })),
      obs.call('GetSceneList'),
      obs.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] })),
    ]);

    const inputs = inputListData.inputs || [];
    for (const input of inputs) {
      await obs.call('GetInputSettings', { inputUuid: input.inputUuid }).catch(() => null);
    }

    const rawScenes = sceneListData.scenes || [];
    const userScenes = rawScenes.filter(s => s.sceneName !== 'Boosty Chat Overlay');
    for (const s of userScenes) {
      await obs.call('GetSceneItemList', { sceneUuid: s.sceneUuid }).catch(() => null);
    }

    const singleFetchDuration = performance.now() - t0;
    console.log(`Single fetch completed in ${singleFetchDuration.toFixed(2)} ms with ${requestCount} WebSocket calls:`);
    const callCounts = {};
    for (const c of callLog) {
      callCounts[c.requestType] = (callCounts[c.requestType] || 0) + 1;
    }
    console.log('Call breakdown per fetch:', callCounts);
    console.log(`Scenes count: ${userScenes.length}, Browser inputs count: ${inputs.length}`);
    console.log();

    // 2. Compute Rates for Steady-State Idle (Before vs After)
    console.log('2. Steady-State Idle Request Rates (Before vs After Optimization):\n');
    const beforeMainInterval = 2.5;
    const beforeRendererInterval = 10;
    const beforeFetchesPerMin = (60 / beforeMainInterval) + (60 / beforeRendererInterval); // 30 fetches/min
    const beforeReqsPerMin = beforeFetchesPerMin * requestCount;
    const beforeReqsPerHour = beforeReqsPerMin * 60;

    const afterMainInterval = 60; // 60s fallback
    const afterRendererInterval = 0; // removed
    const afterFetchesPerMin = (60 / afterMainInterval); // 1 fetch/min in steady idle
    const afterReqsPerMin = afterFetchesPerMin * requestCount;
    const afterReqsPerHour = afterReqsPerMin * 60;

    console.log(`[BEFORE Optimization]`);
    console.log(`- Main Process Sync: Every ${beforeMainInterval}s (${60 / beforeMainInterval} fetches/min)`);
    console.log(`- Renderer Sync: Every ${beforeRendererInterval}s (${60 / beforeRendererInterval} fetches/min)`);
    console.log(`- Total Cycles: ${beforeFetchesPerMin} cycles/min`);
    console.log(`- Requests / min in Idle: ${beforeReqsPerMin} req/min`);
    console.log(`- Requests / hour in Idle: ${beforeReqsPerHour.toLocaleString()} req/hour\n`);

    console.log(`[AFTER Optimization (P0)]`);
    console.log(`- Main Process Sync: Every ${afterMainInterval}s (${afterFetchesPerMin} fetch/min fallback)`);
    console.log(`- Renderer Sync: 0 (Event-driven via IPC onObsStateChanged)`);
    console.log(`- Total Cycles: ${afterFetchesPerMin} cycle/min`);
    console.log(`- Requests / min in Idle: ${afterReqsPerMin} req/min (≤10 req/min acceptance target)`);
    console.log(`- Requests / hour in Idle: ${afterReqsPerHour.toLocaleString()} req/hour`);
    console.log(`- Reduction: -${(((beforeReqsPerMin - afterReqsPerMin) / beforeReqsPerMin) * 100).toFixed(1)}% network traffic reduction in Idle!\n`);

    // 3. Scaling analysis (with N scenes, M inputs)
    console.log('3. Scaling Analysis with larger OBS setups:');
    const scenarios = [
      { name: 'Small setup', scenes: 2, inputs: 1 },
      { name: 'Medium streamer setup', scenes: 6, inputs: 4 },
      { name: 'Complex professional setup', scenes: 15, inputs: 10 },
      { name: 'Studio setup with VTuber/nested', scenes: 30, inputs: 25 },
    ];

    console.log('| Setup Profile | Scenes | Inputs | Calls/Fetch | Calls/min (Idle) | Calls/hour (Idle) | Time spent in IPC/WS per min |');
    console.log('|---|---|---|---|---|---|---|');
    for (const sc of scenarios) {
      // 3 base (GetSceneCollectionList, GetSceneList, GetInputList) + inputs (GetInputSettings) + scenes (GetSceneItemList)
      const callsPerFetch = 3 + sc.inputs + sc.scenes;
      const minCalls = afterFetchesPerMin * callsPerFetch;
      const hrCalls = minCalls * 60;
      const estTimePerFetchMs = 3 * 2 + sc.inputs * 2 + sc.scenes * 2; // ~2ms per WS call
      const timePerMinMs = afterFetchesPerMin * estTimePerFetchMs;
      console.log(`| ${sc.name} | ${sc.scenes} | ${sc.inputs} | ${callsPerFetch} | ${minCalls} | ${hrCalls.toLocaleString()} | ~${(timePerMinMs/1000).toFixed(2)}s (${((timePerMinMs/60000)*100).toFixed(1)}% time) |`);
    }

    await obs.disconnect();
  } catch (err) {
    console.log('OBS not running or connection failed:', err.message);
  }
}

runObsAudit().catch(console.error);
