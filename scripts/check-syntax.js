const { execFileSync } = require('node:child_process');
const path = require('node:path');

const files = [
  'desktop/main.js',
  'desktop/preload.js',
  'desktop/app.js',
  'desktop/ui/status-hub.js',
  'desktop/browser/manager.js',
  'desktop/main/ipc.js',
  'desktop/obs/config.js',
  'desktop/obs/client.js',
  'desktop/obs/scenes.js',
  'desktop/obs/service.js',
  'server.js',
  'core/messages/model.js',
  'core/messages/history.js',
  'core/messages/dedup.js',
  'core/config/defaults.js',
  'core/config/schema.js',
  'core/config/storage.js',
  'core/health/tracker.js',
  'core/sse/hub.js',
  'overlay/renderer.js',
  'overlay/overlay.js',
  'extension/parser.js',
  'extension/content.js',
  'extension/background.js',
  'test/parser.test.js',
  'test/message-model.test.js',
  'test/config.test.js',
  'test/health-tracker.test.js',
  'test/message-history.test.js',
  'test/dedup.test.js',
  'test/sse-hub.test.js',
  'test/obs-config.test.js',
  'test/obs-client.test.js',
  'test/obs-scenes.test.js',
  'test/obs-service.test.js',
  'test/browser-manager.test.js',
  'test/ipc.test.js',
  'test/status-hub.test.js',
  'test/ui-redesign.test.js',
  'test/production-isolation.test.js',
  'scripts/verify-resilience.js',
  'scripts/test-server.js',
  'scripts/test-reconnect-electron.js',
  'scripts/test-parser-browser.js',
  'scripts/capture-boosty-dom.js',
  'scripts/run-electron-test.js',
  'scripts/ui-audit/capture.js',
  'scripts/ui-audit/runner.js',
  'scripts/ui-audit/states.js',
  'scripts/ui-audit/fixtures.js',
  'scripts/ui-audit/manifest.js',
  'scripts/ui-audit/contact-sheet.js',
  'scripts/ui-audit/archive.js',
  'scripts/ui-audit/overlay-wrapper.js',
  'scripts/visual-test-electron.js',
  'scripts/visual-test-overlay.js',
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
