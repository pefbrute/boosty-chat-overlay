#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

// 1. Argument parsing & validation
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const hasFlag = flag => args.includes(flag);

const isInteractive = hasFlag('--interactive');
const state = getArg('--state');
const scope = getArg('--scope');

// Validation: --interactive requires --state
if (isInteractive && !state) {
  console.error('\n✖ Error: --interactive requires --state <state-id>\n');
  console.error('Example:');
  console.error('  npm run ui:capture -- --scope settings --state appearance-custom --interactive\n');
  process.exit(1);
}

// 2. Prepare Electron child process arguments
const runnerScript = path.join(__dirname, 'runner.js');

const electronArgs = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  runnerScript,
  ...args,
];

// 3. Spawn Electron runner with UI_AUDIT_MODE=1
const child = spawn(electron, electronArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    UI_AUDIT_MODE: '1',
    ELECTRON_ENABLE_LOGGING: '0',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
