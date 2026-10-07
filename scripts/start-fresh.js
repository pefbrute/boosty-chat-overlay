#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const electron = require('electron');
const { resetFreshUserData, getFreshUserDataPath } = require('../desktop/main/fresh-reset.js');

const argv = process.argv.slice(2);
const keepState = argv.includes('--keep-state') ||
  process.env.BOOSTY_FRESH_KEEP_STATE === '1' ||
  process.env.BOOSTY_FRESH_KEEP_STATE === 'true';

// Filter out our custom flag before forwarding args to Electron
const electronArgs = ['.', ...argv.filter(arg => arg !== '--keep-state')];

process.env.BOOSTY_APP_VARIANT = 'fresh';

if (keepState) {
  process.env.BOOSTY_FRESH_KEEP_STATE = '1';
  console.log('[Boosty Overlay Fresh] Starting with preserved state (--keep-state)');
} else {
  try {
    const targetPath = getFreshUserDataPath();
    const result = resetFreshUserData(targetPath);
    if (result.reset) {
      process.env.BOOSTY_FRESH_RESET_DONE = '1';
    }
  } catch (err) {
    console.error('[Boosty Overlay Fresh] Fatal: failed to perform clean slate reset:', err.message);
    process.exit(1);
  }
}

const child = spawn(electron, electronArgs, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
