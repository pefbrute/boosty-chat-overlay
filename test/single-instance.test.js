const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

test('single instance lock prevents duplicate app processes and port collision', async (t) => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'boosty-si-test-'));
  const testPort = '17385';

  const env = {
    ...process.env,
    BOOSTY_OVERLAY_PORT: testPort,
    BOOSTY_OVERLAY_UI_TEST: '1',
  };

  // Launch primary instance
  const inst1 = spawn(electron, ['.', `--user-data-dir=${tmpUserData}`, '--headless'], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'pipe',
  });

  t.after(() => {
    try { inst1.kill('SIGKILL'); } catch {}
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}
  });

  // Wait for primary instance server to listen
  let listening = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${testPort}/diagnostic`, (res) => {
          if (res.statusCode === 200) resolve();
          else reject();
        });
        req.on('error', reject);
      });
      listening = true;
      break;
    } catch {}
  }

  assert.ok(listening, 'Primary instance must start server on specified port');

  // Launch secondary instance with identical user-data-dir
  const exitCodeInst2 = await new Promise((resolve) => {
    const inst2 = spawn(electron, ['.', `--user-data-dir=${tmpUserData}`, '--headless'], {
      cwd: path.resolve(__dirname, '..'),
      env,
      stdio: 'pipe',
    });
    inst2.on('exit', (code) => resolve(code));
  });

  assert.equal(exitCodeInst2, 0, 'Secondary instance must exit cleanly with code 0 without launching redundant servers');

  // Verify primary instance remains alive and uninterrupted
  const primaryAlive = await new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${testPort}/diagnostic`, (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
  });

  assert.equal(primaryAlive, true, 'Primary instance must remain healthy and active after second instance attempt');
});
