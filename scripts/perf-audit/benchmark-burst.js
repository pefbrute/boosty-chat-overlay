const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT_DIR = path.join(__dirname, '..', '..');

// Helper for sending POST /message
function postMessage(port, msg) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(msg);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/message',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Connect SSE client and count received messages with arrival timestamps
function connectSse(port) {
  return new Promise((resolve, reject) => {
    const received = [];
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/events',
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
      },
    }, res => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep remainder
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              received.push({ data, timestamp: performance.now() });
            } catch {}
          }
        }
      });
      resolve({ req, res, received });
    });
    req.on('error', reject);
    req.end();
  });
}

// 1. Benchmark Server Burst & Latency for 50 Messages
async function benchmarkBurst(scenario = 'burst_immediate', count = 50) {
  const port = 18200;
  const server = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
    env: { ...process.env, BOOSTY_OVERLAY_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise(r => {
    server.stdout.on('data', d => {
      if (d.toString().includes('Boosty overlay:')) r();
    });
  });

  // Connect 2 SSE clients (simulating overlay + observer)
  const client1 = await connectSse(port);
  const client2 = await connectSse(port);
  await new Promise(r => setTimeout(r, 200));

  const latencies = [];
  const startProcStat = fs.readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(' ');
  const startCpuTicks = Number(startProcStat[13]) + Number(startProcStat[14]);
  const t0 = performance.now();

  if (scenario === 'burst_immediate') {
    // Fire all 50 in parallel as fast as possible
    const promises = [];
    for (let i = 0; i < count; i++) {
      const msg = {
        id: `bench-burst-${i}-${Date.now()}`,
        author: `Viewer_${i}`,
        text: `Message number ${i}: Привет стример! Тестируем производительность чата ${i}`,
        avatar: 'https://example.com/avatar.png',
      };
      const reqStart = performance.now();
      const p = postMessage(port, msg).then(res => {
        latencies.push(performance.now() - reqStart);
      });
      promises.push(p);
    }
    await Promise.all(promises);
  } else if (scenario === 'stream_10hz') {
    // 50 messages at 10 msgs/sec (every 100ms)
    for (let i = 0; i < count; i++) {
      const msg = {
        id: `bench-stream-${i}-${Date.now()}`,
        author: `Streamer_${i}`,
        text: `Stream message ${i}: Быстрый поток сообщений на стриме! ${i}`,
      };
      const reqStart = performance.now();
      await postMessage(port, msg);
      latencies.push(performance.now() - reqStart);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const totalTimeMs = performance.now() - t0;
  // Wait for SSE delivery to complete
  await new Promise(r => setTimeout(r, 300));

  const endProcStat = fs.readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(' ');
  const endCpuTicks = Number(endProcStat[13]) + Number(endProcStat[14]);
  const cpuTicksDiff = endCpuTicks - startCpuTicks;
  const cpuSeconds = cpuTicksDiff / 100;
  const totalSeconds = totalTimeMs / 1000;
  const cpuPercent = (cpuSeconds / totalSeconds) * 100;

  const memStatus = fs.readFileSync(`/proc/${server.pid}/status`, 'utf8');
  const rssKb = Number(memStatus.match(/VmRSS:\s+(\d+)\s+kB/)?.[1] || 0);

  client1.req.destroy();
  client2.req.destroy();
  server.kill();

  const sortedLat = [...latencies].sort((a, b) => a - b);
  const minLat = sortedLat[0];
  const maxLat = sortedLat[sortedLat.length - 1];
  const avgLat = sortedLat.reduce((a, b) => a + b, 0) / sortedLat.length;
  const p50 = sortedLat[Math.floor(sortedLat.length * 0.5)];
  const p95 = sortedLat[Math.floor(sortedLat.length * 0.95)];
  const p99 = sortedLat[Math.floor(sortedLat.length * 0.99)];

  return {
    scenario,
    totalMessages: count,
    totalTimeMs: totalTimeMs.toFixed(2),
    throughputMsgPerSec: (count / (totalTimeMs / 1000)).toFixed(2),
    cpuPercent: cpuPercent.toFixed(2),
    rssMb: (rssKb / 1024).toFixed(2),
    sseDeliveredClient1: client1.received.length,
    sseDeliveredClient2: client2.received.length,
    latency: {
      min: minLat.toFixed(2),
      avg: avgLat.toFixed(2),
      p50: p50.toFixed(2),
      p95: p95.toFixed(2),
      p99: p99.toFixed(2),
      max: maxLat.toFixed(2),
    }
  };
}

async function run() {
  console.log('=== BENCHMARK: 50 MESSAGES LOAD & CPU ===\n');

  console.log('1. Scenario: Burst of 50 messages (parallel instantaneous burst)...');
  const burstStats = await benchmarkBurst('burst_immediate', 50);
  console.log(JSON.stringify(burstStats, null, 2));
  console.log();

  console.log('2. Scenario: Stream of 50 messages at 10 msgs/sec (5 seconds continuous flow)...');
  const streamStats = await benchmarkBurst('stream_10hz', 50);
  console.log(JSON.stringify(streamStats, null, 2));
}

run().catch(console.error);
