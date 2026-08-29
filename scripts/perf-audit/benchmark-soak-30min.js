const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT_DIR = path.join(__dirname, '..', '..');
const PORT = 18300;
const DURATION_MINUTES = 30;
const CHECKPOINT_INTERVAL_MINUTES = 5;
const MSG_INTERVAL_MS = 3000; // 1 message every 3 seconds (~600 messages in 30 mins)

// Helper to post a message
function sendMsg(index) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      id: `soak-msg-${index}-${Date.now()}`,
      author: `User_${(index % 30) + 1}`,
      text: `Live stream message #${index} at ${new Date().toISOString().slice(11, 19)}`,
      avatar: '',
      timestamp: Date.now(),
    });
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: '/message',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

function getProcessMemory(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const vmrssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
    const vmsizeMatch = status.match(/VmSize:\s+(\d+)\s+kB/);
    const parts = stat.split(' ');
    const utime = Number(parts[13]) || 0;
    const stime = Number(parts[14]) || 0;

    return {
      rssMb: vmrssMatch ? (Number(vmrssMatch[1]) / 1024).toFixed(2) : '0',
      vmsizeMb: vmsizeMatch ? (Number(vmsizeMatch[1]) / 1024).toFixed(2) : '0',
      cpuTicks: utime + stime,
    };
  } catch {
    return { rssMb: '0', vmsizeMb: '0', cpuTicks: 0 };
  }
}

async function main() {
  console.log(`=== 30-MINUTE SOAK TEST & MEMORY LEAK AUDIT ===`);
  console.log(`Duration: ${DURATION_MINUTES} minutes`);
  console.log(`Checkpoints: every ${CHECKPOINT_INTERVAL_MINUTES} minutes (0m, 5m, 10m, 15m, 20m, 25m, 30m)`);
  console.log(`Message Rate: 1 msg every ${MSG_INTERVAL_MS / 1000}s (~${(60 / (MSG_INTERVAL_MS / 1000)) * DURATION_MINUTES} total messages)\n`);

  const resultsFile = path.join(__dirname, 'soak-test-results.json');

  // 1. Start Server
  const server = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
    env: { ...process.env, BOOSTY_OVERLAY_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise(r => {
    server.stdout.on('data', d => {
      if (d.toString().includes('Boosty overlay:')) r();
    });
  });

  // 2. Start Chrome Headless loading Overlay
  const chrome = spawn('google-chrome', [
    '--headless=new',
    '--disable-gpu',
    `http://127.0.0.1:${PORT}/overlay/`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  await new Promise(r => setTimeout(r, 2000));

  // 3. Connect an SSE client to monitor events
  let sseReceivedCount = 0;
  const sseReq = http.request({
    host: '127.0.0.1',
    port: PORT,
    path: '/events',
    headers: { 'Accept': 'text/event-stream' }
  }, res => {
    let buffer = '';
    res.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) sseReceivedCount++;
      }
    });
  });
  sseReq.end();

  const checkpoints = [];
  const startTime = Date.now();
  let messageCounter = 0;

  async function recordCheckpoint(minute) {
    const serverMem = getProcessMemory(server.pid);
    const chromeMem = getProcessMemory(chrome.pid);

    // Fetch health from server
    let health = {};
    try {
      health = await new Promise((res) => {
        http.get(`http://127.0.0.1:${PORT}/health`, r => {
          let body = '';
          r.on('data', d => body += d);
          r.on('end', () => {
            try { res(JSON.parse(body)); } catch { res({}); }
          });
        });
      });
    } catch {}

    const checkpoint = {
      minute,
      timestamp: new Date().toISOString(),
      messagesSent: messageCounter,
      sseReceivedCount,
      server: {
        pid: server.pid,
        rssMb: serverMem.rssMb,
        vmsizeMb: serverMem.vmsizeMb,
      },
      overlayChrome: {
        pid: chrome.pid,
        rssMb: chromeMem.rssMb,
        vmsizeMb: chromeMem.vmsizeMb,
      },
      health: {
        receivedMessages: health.receivedMessages || 0,
        overlayClients: health.overlayClients || 0,
      }
    };

    checkpoints.push(checkpoint);
    fs.writeFileSync(resultsFile, JSON.stringify({ checkpoints }, null, 2));

    console.log(`[Checkpoint ${minute}m] Sent: ${messageCounter} msgs | Server RSS: ${serverMem.rssMb} MB | Chrome Overlay RSS: ${chromeMem.rssMb} MB | SSE Delivered: ${sseReceivedCount}`);
    return checkpoint;
  }

  // Initial checkpoint (0 min)
  await recordCheckpoint(0);

  // Interval timer for sending messages
  const msgTimer = setInterval(async () => {
    messageCounter++;
    await sendMsg(messageCounter);
  }, MSG_INTERVAL_MS);

  // Schedule checkpoints
  for (let m = CHECKPOINT_INTERVAL_MINUTES; m <= DURATION_MINUTES; m += CHECKPOINT_INTERVAL_MINUTES) {
    await new Promise(r => setTimeout(r, CHECKPOINT_INTERVAL_MINUTES * 60 * 1000));
    await recordCheckpoint(m);
  }

  clearInterval(msgTimer);
  sseReq.destroy();
  chrome.kill();
  server.kill();

  console.log('\n=== 30-MINUTE SOAK TEST COMPLETED ===');
  console.log('Results saved to:', resultsFile);

  // Analysis of results
  const first = checkpoints[0];
  const last = checkpoints[checkpoints.length - 1];
  const serverGrowthMb = Number(last.server.rssMb) - Number(first.server.rssMb);
  const chromeGrowthMb = Number(last.overlayChrome.rssMb) - Number(first.overlayChrome.rssMb);

  console.log('\nMemory Growth Summary:');
  console.log(`- Server RSS: ${first.server.rssMb} MB -> ${last.server.rssMb} MB (Change: ${serverGrowthMb >= 0 ? '+' : ''}${serverGrowthMb.toFixed(2)} MB over 30 mins)`);
  console.log(`- Overlay Browser RSS: ${first.overlayChrome.rssMb} MB -> ${last.overlayChrome.rssMb} MB (Change: ${chromeGrowthMb >= 0 ? '+' : ''}${chromeGrowthMb.toFixed(2)} MB over 30 mins)`);
}

main().catch(console.error);
