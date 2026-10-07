#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const electron = require('electron');

process.env.BOOSTY_OVERLAY_MESSAGE_LAB = '1';

const child = spawn(electron, ['.'], {
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
