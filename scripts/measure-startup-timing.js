'use strict';

/**
 * Diagnostic Timing Script for Boosty Chat Overlay Startup
 *
 * Measures:
 * T0: Desktop process / renderer launch
 * T1: Local HTTP server ready on 127.0.0.1:17369
 * T2: First signal from extension (POST /connector)
 * T3: Boosty tab detected (source: 'content_tab' or tabs array)
 * T4: Stream / chat state detected
 * T5: Full healthy UI state reached
 *
 * Supports multi-run statistics:
 * node scripts/measure-startup-timing.js --runs 10
 */

const http = require('node:http');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const port = 17369;

function parseArgs() {
  const args = process.argv.slice(2);
  let runs = 1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runs' && args[i + 1]) {
      runs = Math.max(1, parseInt(args[i + 1], 10) || 1);
      i++;
    }
  }
  return { runs };
}

async function checkHealth() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/health`, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(400, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function cleanupPort() {
  try {
    const pids = execSync(`lsof -ti:${port} || true`).toString().trim();
    if (pids) {
      for (const pid of pids.split(/\s+/)) {
        try { process.kill(Number(pid), 'SIGTERM'); } catch {}
      }
    }
  } catch {}
}

async function measureSingleRun(runIndex, totalRuns) {
  console.log(`\n--- Run ${runIndex + 1}/${totalRuns} ---`);
  cleanupPort();
  await new Promise(r => setTimeout(r, 600));

  const t0 = Date.now();
  const electronBin = path.join(projectRoot, 'node_modules', '.bin', 'electron');
  const appProc = spawn(electronBin, ['.'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      BOOSTY_OVERLAY_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  appProc.stdout.on('data', () => {});
  appProc.stderr.on('data', () => {});

  let t1 = null;
  let t2 = null;
  let t3 = null;
  let t4 = null;
  let t5 = null;

  const maxWaitMs = 30_000;
  const pollIntervalMs = 150;
  const startWait = Date.now();

  while (Date.now() - startWait < maxWaitMs) {
    const health = await checkHealth();
    const now = Date.now();

    if (health && !t1) {
      t1 = now;
    }

    if (health?.extensionConnected || health?.extension?.state === 'connected' || health?.connectorLastSeenAt) {
      if (!t2) {
        t2 = now;
      }
    }

    if (health?.boostyConnected || health?.boosty?.state === 'tab-detected' || health?.boosty?.state === 'chat-detected' || health?.boostyTabUrl) {
      if (!t3) {
        t3 = now;
      }
    }

    if (health?.boosty?.hasChat || health?.boosty?.state === 'chat-detected') {
      if (!t4) {
        t4 = now;
      }
    }

    if (t2 && t3) {
      t5 = now;
      break;
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  // Graceful kill
  appProc.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));
  cleanupPort();

  const res = {
    run: runIndex + 1,
    t1: t1 ? t1 - t0 : null,
    t2: t2 ? t2 - t0 : null,
    t3: t3 ? t3 - t0 : null,
    t4: t4 ? t4 - t0 : null,
    t5: t5 ? t5 - t0 : null,
  };

  console.log(`  T1 (Server ready):  +${res.t1 ?? 'TIMEOUT'} ms`);
  console.log(`  T2 (Extension):     +${res.t2 ?? 'TIMEOUT'} ms`);
  console.log(`  T3 (Boosty tab):    +${res.t3 ?? 'TIMEOUT'} ms`);
  console.log(`  T5 (UI Ready):      +${res.t5 ?? 'TIMEOUT'} ms`);

  return res;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (upper >= sorted.length) return sorted[lower];
  return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

async function run() {
  const { runs } = parseArgs();
  console.log('====================================================');
  console.log(`   Measuring Startup Timing (${runs} runs)          `);
  console.log('====================================================');

  const results = [];
  for (let i = 0; i < runs; i++) {
    const res = await measureSingleRun(i, runs);
    results.push(res);
    if (i < runs - 1) {
      // Small pause between runs for socket teardown
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log('\n====================================================');
  console.log('   Startup Timing Series Summary                    ');
  console.log('====================================================');
  console.log('| Run | T1 (Server) | T2 (Ext) | T3 (Boosty) | T5 (Ready) |');
  console.log('|-----|-------------|----------|-------------|------------|');
  for (const r of results) {
    console.log(`| #${r.run.toString().padEnd(2)} | ${(r.t1 + ' ms').padEnd(11)} | ${(r.t2 + ' ms').padEnd(8)} | ${(r.t3 + ' ms').padEnd(11)} | ${(r.t5 + ' ms').padEnd(10)} |`);
  }

  const validT5 = results.map(r => r.t5).filter(t => t !== null).sort((a, b) => a - b);
  const validT1 = results.map(r => r.t1).filter(t => t !== null).sort((a, b) => a - b);
  const validT2 = results.map(r => r.t2).filter(t => t !== null).sort((a, b) => a - b);

  if (validT5.length > 0) {
    const median = percentile(validT5, 50);
    const p75 = percentile(validT5, 75);
    const p90 = percentile(validT5, 90);
    const max = validT5[validT5.length - 1];
    const min = validT5[0];

    console.log('\n--- Statistics (T5 Ready Duration) ---');
    console.log(`Sample size:  ${validT5.length}/${runs}`);
    console.log(`Min:          ${min} ms (${(min / 1000).toFixed(2)} s)`);
    console.log(`Median (p50): ${median} ms (${(median / 1000).toFixed(2)} s)`);
    console.log(`p75:          ${p75} ms (${(p75 / 1000).toFixed(2)} s)`);
    console.log(`p90:          ${p90} ms (${(p90 / 1000).toFixed(2)} s)`);
    console.log(`Max observed: ${max} ms (${(max / 1000).toFixed(2)} s)`);
    console.log('====================================================\n');
  }
}

run().catch(err => {
  console.error('Measurement failed:', err);
  cleanupPort();
  process.exit(1);
});
