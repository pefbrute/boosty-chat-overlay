const { execFileSync } = require('node:child_process');
const path = require('node:path');

const files = [
  'desktop/main.js',
  'desktop/preload.js',
  'desktop/app.js',
  'server.js',
  'overlay/overlay.js',
  'extension/parser.js',
  'extension/content.js',
  'extension/background.js',
  'test/parser.test.js',
  'scripts/verify-resilience.js',
  'scripts/test-server.js',
  'scripts/test-reconnect-electron.js',
  'scripts/test-parser-browser.js',
  'scripts/capture-boosty-dom.js',
  'scripts/run-electron-test.js',
];

const rootDir = path.resolve(__dirname, '..');

for (const relFile of files) {
  const absPath = path.join(rootDir, relFile);
  console.log(`Checking syntax: ${relFile}`);
  try {
    execFileSync(process.execPath, ['--check', absPath], { stdio: 'inherit' });
  } catch (err) {
    console.error(`Syntax check failed for ${relFile}`);
    process.exit(1);
  }
}

console.log('All JavaScript files passed syntax check.');
