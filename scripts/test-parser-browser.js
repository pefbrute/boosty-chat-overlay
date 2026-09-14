const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');

// Disable hardware acceleration and set headless flags for CI/Linux
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        sandbox: true,
        contextIsolation: false, // Emulates pure script tag environment
        nodeIntegration: false,
      },
    });
  } catch (err) {
    console.warn('⚠ Integration test skipped: graphical environment unavailable (' + err.message + ')');
    process.exit(0);
  }

  const pageErrors = [];
  win.webContents.on('page-error', (event, err) => {
    pageErrors.push(err);
  });
  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 3) pageErrors.push(new Error(message));
  });

  const http = require('node:http');
  const fs = require('node:fs');
  const parserAbsPath = path.resolve(__dirname, '..', 'extension', 'parser.js');
  const parserCode = fs.readFileSync(parserAbsPath, 'utf8');
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Parser UMD Browser Test</title>
        <script>
          ${parserCode}
        </script>
      </head>
      <body>
        <div class="test-root" data-test-id="CHATMESSAGE:root">
          <span data-test-id="CHATMESSAGE:author">BrowserUser</span>
          <div data-test-id="CHATMESSAGE:message">BrowserText</div>
        </div>
      </body>
    </html>
  `;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  try {
    await win.loadURL(`http://127.0.0.1:${serverPort}/`);

    const result = await win.webContents.executeJavaScript(`
      (() => {
        const hasParser = typeof globalThis.BoostyParser !== 'undefined';
        if (!hasParser) return { ok: false, error: 'BoostyParser is undefined on globalThis' };

        const p = globalThis.BoostyParser;
        const fnCheck = (
          typeof p.parseBoostyMessage === 'function' &&
          typeof p.extractAuthor === 'function' &&
          typeof p.extractText === 'function' &&
          typeof p.extractMessageId === 'function'
        );
        if (!fnCheck) return { ok: false, error: 'Parser functions missing' };

        const root = document.querySelector('.test-root');
        const parsed = p.parseBoostyMessage(root);
        return {
          ok: true,
          parsed,
        };
      })()
    `);

    console.log('Test parsed result:', JSON.stringify(result));
    assert.strictEqual(pageErrors.length, 0, `Page should have 0 errors, got: ${pageErrors.map(e => e.message).join(', ')}`);
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.parsed.author, 'BrowserUser');
    assert.strictEqual(result.parsed.text, 'BrowserText');
    assert.ok(result.parsed.id.startsWith('fallback-'), 'Should generate fallback ID');

    console.log('✔ Browser UMD test: globalThis.BoostyParser successfully loaded without errors');
    server.close();
    win.destroy();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('❌ Browser UMD test failed:', err);
    try { server.close(); } catch {}
    if (win && !win.isDestroyed()) win.destroy();
    app.quit();
    process.exit(1);
  }
});
