#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LiveE2ERunner } = require('./live-e2e/runner.js');

// Lightweight .env loader without external dependencies
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}

loadEnvFile(path.join(__dirname, '..', '.env'));
loadEnvFile(path.join(__dirname, '..', '.env.local'));

async function main() {
  const runner = new LiveE2ERunner();
  const report = await runner.run();

  if (report.passed) {
    process.exit(0);
  } else {
    // If skipped due to missing URL/Stream, exit with 0 or 2 depending on mode
    const isCleanSkip = report.stages.boostyPage === 'skip' || report.stages.sendMessage === 'skip';
    if (isCleanSkip && !process.env.BOOSTY_LIVE_QA_STRICT) {
      console.warn('ℹ️ Live E2E finished with skipped stages (no active stream chat detected).');
      process.exit(0);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal Live E2E error:', err);
  process.exit(1);
});
