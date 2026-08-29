const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT_DIR = path.join(__dirname, '..', '..');

// Helper to run child process and measure time to stdout / specific event
function measureServerStartup(runs = 10) {
  return new Promise(async (resolve) => {
    const times = [];
    for (let i = 0; i < runs; i++) {
      const port = 18000 + i;
      const t0 = performance.now();
      const child = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
        env: { ...process.env, BOOSTY_OVERLAY_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await new Promise((res) => {
        child.stdout.on('data', (data) => {
          if (data.toString().includes('Boosty overlay:')) {
            const elapsed = performance.now() - t0;
            times.push(elapsed);
            child.kill();
            res();
          }
        });
      });
      // Small pause between runs
      await new Promise(r => setTimeout(r, 50));
    }
    resolve(times);
  });
}

function measureElectronStartup(runs = 5) {
  return new Promise(async (resolve) => {
    const times = [];
    const electronPath = path.join(ROOT_DIR, 'node_modules', '.bin', 'electron');
    
    // Create a temporary launcher script for electron that logs performance timing
    const launcherScript = path.join(__dirname, 'electron-startup-measure.js');
    const scriptContent = `
      const { app, BrowserWindow } = require('electron');
      const path = require('path');
      const tStart = Number(process.env.BENCHMARK_START_TIME || Date.now());

      app.whenReady().then(() => {
        const tReady = Date.now() - tStart;
        const win = new BrowserWindow({
          width: 940,
          height: 700,
          show: false,
          webPreferences: {
            preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js')
          }
        });

        win.webContents.on('did-finish-load', () => {
          const tLoaded = Date.now() - tStart;
          console.log(JSON.stringify({ tReady, tLoaded }));
          app.quit();
        });

        win.loadFile(path.join(__dirname, '..', '..', 'desktop', 'index.html'));
      });
    `;
    fs.writeFileSync(launcherScript, scriptContent, 'utf8');

    for (let i = 0; i < runs; i++) {
      const t0 = Date.now();
      const child = spawn(electronPath, [launcherScript], {
        env: { ...process.env, BENCHMARK_START_TIME: String(t0) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await new Promise((res) => {
        child.stdout.on('data', (data) => {
          try {
            const parsed = JSON.parse(data.toString().trim());
            times.push(parsed);
            res();
          } catch {}
        });
        child.on('exit', () => res());
      });
      await new Promise(r => setTimeout(r, 100));
    }

    try { fs.unlinkSync(launcherScript); } catch {}
    resolve(times);
  });
}

function measureOverlayLoadTime(runs = 10) {
  return new Promise(async (resolve) => {
    // Start temporary server
    const port = 18999;
    const serverProcess = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
      env: { ...process.env, BOOSTY_OVERLAY_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise(r => {
      serverProcess.stdout.on('data', d => {
        if (d.toString().includes('Boosty overlay:')) r();
      });
    });

    const times = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      // Fetch html, css, js sequentially (simulating browser load)
      const fetchAsset = (file) => new Promise(res => {
        http.get(`http://127.0.0.1:${port}/overlay/${file}`, r => {
          r.on('data', () => {});
          r.on('end', res);
        });
      });
      const fetchConfig = () => new Promise(res => {
        http.get(`http://127.0.0.1:${port}/config`, r => {
          r.on('data', () => {});
          r.on('end', res);
        });
      });

      await fetchAsset('');
      await Promise.all([fetchAsset('style.css'), fetchAsset('overlay.js'), fetchConfig()]);
      const elapsed = performance.now() - t0;
      times.push(elapsed);
    }

    serverProcess.kill();
    resolve(times);
  });
}

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / sorted.length;
  const stdDev = Math.sqrt(variance);
  return { min: min.toFixed(2), max: max.toFixed(2), mean: mean.toFixed(2), median: median.toFixed(2), stdDev: stdDev.toFixed(2) };
}

async function run() {
  console.log('=== BENCHMARK: STARTUP TIMES ===\n');
  
  console.log('1. Measuring Standalone Server Startup (10 runs)...');
  const serverTimes = await measureServerStartup(10);
  console.log('Server startup times (ms):', serverTimes.map(t => t.toFixed(1)).join(', '));
  console.log('Server Stats:', stats(serverTimes));
  console.log();

  console.log('2. Measuring Overlay HTTP Resources & Config Fetch Time (10 runs)...');
  const overlayTimes = await measureOverlayLoadTime(10);
  console.log('Overlay fetch times (ms):', overlayTimes.map(t => t.toFixed(1)).join(', '));
  console.log('Overlay Stats:', stats(overlayTimes));
  console.log();

  console.log('3. Measuring Electron App Launch to DOM Ready / Loaded (5 runs)...');
  const electronData = await measureElectronStartup(5);
  const tReadyTimes = electronData.map(d => d.tReady);
  const tLoadedTimes = electronData.map(d => d.tLoaded);
  console.log('Electron app.whenReady times (ms):', tReadyTimes.join(', '));
  console.log('app.whenReady Stats:', stats(tReadyTimes));
  console.log('Electron did-finish-load times (ms):', tLoadedTimes.join(', '));
  console.log('did-finish-load Stats:', stats(tLoadedTimes));
}

run().catch(console.error);
