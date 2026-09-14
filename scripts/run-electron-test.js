const { spawn } = require('node:child_process');
const electron = require('electron');

const script = process.argv[2];
if (!script) {
  console.error('Usage: node scripts/run-electron-test.js <script>');
  process.exit(1);
}

const args = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  script,
  ...process.argv.slice(3),
];

const child = spawn(electron, args, {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
