const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const ROOT_DIR = path.join(__dirname, '..', '..');
const ELECTRON_BIN = path.join(ROOT_DIR, 'node_modules', '.bin', 'electron');

// 1. Measure Standalone Server Idle
async function benchmarkServerIdle(durationSec = 15) {
  const port = 18100;
  const child = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
    env: { ...process.env, BOOSTY_OVERLAY_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise(r => {
    child.stdout.on('data', d => {
      if (d.toString().includes('Boosty overlay:')) r();
    });
  });

  const samples = [];
  const startCpu = process.cpuUsage();
  const startTime = performance.now();

  for (let i = 0; i < durationSec * 2; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const statContent = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8');
      const statusContent = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8');
      const parts = statContent.split(' ');
      const utime = Number(parts[13]);
      const stime = Number(parts[14]);
      
      const vmrssMatch = statusContent.match(/VmRSS:\s+(\d+)\s+kB/);
      const vmsizeMatch = statusContent.match(/VmSize:\s+(\d+)\s+kB/);
      const rssKb = vmrssMatch ? Number(vmrssMatch[1]) : 0;
      const vmsizeKb = vmsizeMatch ? Number(vmsizeMatch[1]) : 0;

      samples.push({
        time: (i + 1) * 0.5,
        utime,
        stime,
        rssMb: (rssKb / 1024).toFixed(2),
        vmsizeMb: (vmsizeKb / 1024).toFixed(2),
      });
    } catch {}
  }

  child.kill();

  // Compute CPU% from tick differences
  let totalCpuPercent = 0;
  if (samples.length > 1) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const totalTicks = (last.utime + last.stime) - (first.utime + first.stime);
    const clockTicksPerSec = 100; // standard on linux
    const totalSeconds = samples[samples.length - 1].time - samples[0].time;
    totalCpuPercent = (totalTicks / clockTicksPerSec / totalSeconds) * 100;
  }

  const lastSample = samples[samples.length - 1] || {};
  return {
    cpuPercent: totalCpuPercent.toFixed(2),
    rssMb: lastSample.rssMb || '0',
    vmsizeMb: lastSample.vmsizeMb || '0',
    samplesCount: samples.length,
  };
}

// 2. Measure Electron App in Idle (Main + Renderer + GPU + Server)
function benchmarkElectronIdle(durationSec = 20) {
  return new Promise((resolve) => {
    const harnessScript = path.join(__dirname, 'electron-idle-harness.js');
    const code = `
      const { app, BrowserWindow } = require('electron');
      const path = require('path');
      const fs = require('fs');

      let mainWindow;
      let localServer;

      app.whenReady().then(async () => {
        process.env.BOOSTY_OVERLAY_CONFIG = path.join(app.getPath('userData'), 'overlay-settings-bench.json');
        localServer = require('../../server.js').server;

        mainWindow = new BrowserWindow({
          width: 940,
          height: 700,
          show: false,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
          }
        });

        mainWindow.loadFile(path.join(__dirname, '..', '..', 'desktop', 'index.html'));

        // Wait 3 seconds for initial load and stabilization
        await new Promise(r => setTimeout(r, 3000));

        const samples = [];
        const durationSec = ${durationSec};
        const interval = 1000;
        const totalSamples = durationSec;

        for (let i = 0; i < totalSamples; i++) {
          await new Promise(r => setTimeout(r, interval));
          const metrics = app.getAppMetrics();
          const mainMem = process.memoryUsage();
          
          let totalWorkingSetKb = 0;
          const processDetails = metrics.map(m => {
            totalWorkingSetKb += (m.memory.workingSetSize || 0);
            return {
              type: m.type,
              pid: m.pid,
              cpuPercent: m.cpu.percentCPUUsage,
              idleWakeups: m.cpu.idleWakeupsPerSecond,
              workingSetMb: ((m.memory.workingSetSize || 0) / 1024).toFixed(2),
            };
          });

          samples.push({
            second: i + 1,
            mainHeapUsedMb: (mainMem.heapUsed / 1024 / 1024).toFixed(2),
            mainHeapTotalMb: (mainMem.heapTotal / 1024 / 1024).toFixed(2),
            mainRssMb: (mainMem.rss / 1024 / 1024).toFixed(2),
            totalWorkingSetMb: (totalWorkingSetKb / 1024).toFixed(2),
            processes: processDetails
          });
        }

        console.log('BENCHMARK_RESULT:' + JSON.stringify(samples));
        app.quit();
      });
    `;
    fs.writeFileSync(harnessScript, code, 'utf8');

    const child = spawn(ELECTRON_BIN, [harnessScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resultJson = '';
    child.stdout.on('data', data => {
      const str = data.toString();
      const match = str.match(/BENCHMARK_RESULT:(.+)/);
      if (match) {
        resultJson = match[1];
      }
    });

    child.on('close', () => {
      try { fs.unlinkSync(harnessScript); } catch {}
      try {
        const samples = JSON.parse(resultJson);
        resolve(samples);
      } catch (e) {
        resolve([]);
      }
    });
  });
}

// 3. Measure Overlay Idle in Chrome/Headless Browser
async function benchmarkOverlayIdle(durationSec = 15) {
  // Start server
  const port = 18105;
  const server = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
    env: { ...process.env, BOOSTY_OVERLAY_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise(r => {
    server.stdout.on('data', d => {
      if (d.toString().includes('Boosty overlay:')) r();
    });
  });

  // Launch Chrome headlessly to load overlay
  const chrome = spawn('google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=9222',
    `http://127.0.0.1:${port}/overlay/`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  await new Promise(r => setTimeout(r, 2000));

  const samples = [];
  for (let i = 0; i < durationSec * 2; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const status = fs.readFileSync(`/proc/${chrome.pid}/status`, 'utf8');
      const vmrssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
      const rssKb = vmrssMatch ? Number(vmrssMatch[1]) : 0;
      samples.push({ rssMb: (rssKb / 1024).toFixed(2) });
    } catch {}
  }

  chrome.kill();
  server.kill();

  const last = samples[samples.length - 1];
  return { rssMb: last?.rssMb || '0' };
}

async function run() {
  console.log('=== BENCHMARK: CPU & RAM IDLE ===\n');

  console.log('1. Measuring Standalone Server Idle (15s)...');
  const serverStats = await benchmarkServerIdle(15);
  console.log('Standalone Server Idle Metrics:', serverStats);
  console.log();

  console.log('2. Measuring Full Electron Desktop App Idle (20s)...');
  const electronSamples = await benchmarkElectronIdle(20);
  if (electronSamples.length > 0) {
    const lastSample = electronSamples[electronSamples.length - 1];
    console.log('Electron Process Breakdown (Last Sample):');
    for (const proc of lastSample.processes) {
      console.log(` - [${proc.type}] PID ${proc.pid}: CPU: ${proc.cpuPercent.toFixed(1)}%, RAM: ${proc.workingSetMb} MB, Wakeups/s: ${proc.idleWakeups}`);
    }
    console.log(`Main Process Node Heap Used: ${lastSample.mainHeapUsedMb} MB / Total: ${lastSample.mainHeapTotalMb} MB, Main RSS: ${lastSample.mainRssMb} MB`);
    console.log(`Total Working Set (all Electron processes): ${lastSample.totalWorkingSetMb} MB`);

    // Calculate averages over the 20s run
    const avgCpuByProc = {};
    for (const s of electronSamples) {
      for (const p of s.processes) {
        avgCpuByProc[p.type] = (avgCpuByProc[p.type] || 0) + p.cpuPercent / electronSamples.length;
      }
    }
    console.log('\nAverage CPU% by Process Type over 20s:');
    for (const [type, avgCpu] of Object.entries(avgCpuByProc)) {
      console.log(` - ${type}: ${avgCpu.toFixed(2)}%`);
    }
  } else {
    console.log('Failed to capture Electron samples.');
  }
  console.log();

  console.log('3. Measuring Overlay Client in Chrome Headless (15s)...');
  const overlayStats = await benchmarkOverlayIdle(15);
  console.log('Overlay Browser Client RSS:', overlayStats.rssMb, 'MB');
}

run().catch(console.error);
