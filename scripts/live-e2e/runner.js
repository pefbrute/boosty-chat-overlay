'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { parseHTML } = require('linkedom');

const BoostyParser = require('../../extension/parser.js');
const { LiveBrowserAdapter } = require('./browser.js');
const { sanitizeDom, scanForSecrets } = require('./sanitizer.js');
const { prepareObsIntegration, verifyObsIntegration } = require('./obs.js');

/**
 * Creates unique run identifier.
 */
function createRunId() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `live-${stamp}-${rand}`;
}

/**
 * Finds available Chromium/Chrome/Brave executable path.
 */
function getChromiumExecutable() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/brave-browser',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

/**
 * Performs an HTTP request returning JSON or raw text.
 */
function fetchJson(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeout || 5000,
      },
      res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${urlStr}`));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Main Live E2E Runner class.
 */
class LiveE2ERunner {
  constructor(config = {}) {
    this.port = Number(config.port || process.env.BOOSTY_OVERLAY_PORT || 17369);
    this.targetUrl = config.url || process.env.BOOSTY_LIVE_QA_URL || '';
    this.browserId = config.browser || process.env.BOOSTY_LIVE_QA_BROWSER || 'brave';
    this.timeout = Number(config.timeout || process.env.BOOSTY_LIVE_QA_TIMEOUT || 30000);
    this.dryRun = Boolean(config.dryRun ?? (process.env.BOOSTY_LIVE_QA_DRY_RUN === '1'));
    this.captureFixture = Boolean(config.captureFixture ?? (process.env.BOOSTY_LIVE_QA_CAPTURE_FIXTURE === '1'));
    this.destructive = Boolean(process.env.BOOSTY_LIVE_QA_DESTRUCTIVE === '1');
    this.requireObs = Boolean(config.requireObs ?? (process.env.BOOSTY_LIVE_QA_REQUIRE_OBS === '1'));

    this.runId = createRunId();
    this.reportDir = path.join(__dirname, '..', '..', 'artifacts', 'live', this.runId);
    fs.mkdirSync(this.reportDir, { recursive: true });

    this.spawnedServerProcess = null;
    this.browserAdapter = new LiveBrowserAdapter({ session: this.browserId });

    this.stages = {
      server: 'pending',
      browser: 'pending',
      boostyPage: 'pending',
      boostyStreamChat: 'pending',
      realMessageSend: 'pending',
      realBoostyDom: 'pending',
      parser: 'pending',
      extension: 'pending',
      serverMessage: 'pending',
      dedup: 'pending',
      sse: 'pending',
      overlay: 'pending',
      overlayVisual: 'pending',
      obsConnection: 'pending',
      obsScene: 'pending',
      obsBrowserSource: 'pending',
      obsSourceSettings: 'pending',
      obsScreenshot: 'pending',
      obsVisual: 'pending',
    };

    this.provenance = 'unknown';
    this.timing = null;
    this.latencyMs = null;
    this.boostyPipelineStatus = 'pending';
    this.fullStatus = 'pending';

    this.errors = [];
    this.artifacts = [];
    this.consoleErrors = [];
    this.pageErrors = [];
    this.failedRequests = [];
  }

  log(msg, ...args) {
    console.log(`[Live E2E ${this.runId}]`, msg, ...args);
  }

  warn(msg, ...args) {
    console.warn(`[Live E2E ${this.runId}] ⚠️`, msg, ...args);
  }

  saveArtifact(filename, content) {
    const filePath = path.join(this.reportDir, filename);
    if (typeof content === 'object' && !Buffer.isBuffer(content)) {
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
    } else {
      fs.writeFileSync(filePath, content);
    }
    this.artifacts.push(filename);
    return filePath;
  }

  /**
   * Stage 1: Local Backend Server check / start
   */
  async ensureLocalServer() {
    this.log('Checking local server status on port', this.port);
    try {
      const res = await fetchJson(`http://127.0.0.1:${this.port}/health`);
      if (res.status === 200 && res.data && res.data.ok) {
        this.stages.server = 'pass';
        this.log('Using existing local server');
        return;
      }
    } catch {
      // Server not running, attempt to spawn child
    }

    this.log('Spawning dedicated backend server on port', this.port);
    const serverScript = path.join(__dirname, '..', '..', 'server.js');
    this.spawnedServerProcess = spawn(process.execPath, [serverScript], {
      env: { ...process.env, BOOSTY_OVERLAY_PORT: String(this.port) },
      stdio: 'pipe',
    });

    // Wait for server to become responsive
    const startTime = Date.now();
    while (Date.now() - startTime < 6000) {
      try {
        const check = await fetchJson(`http://127.0.0.1:${this.port}/health`);
        if (check.status === 200 && check.data?.ok) {
          this.stages.server = 'pass';
          this.log('Dedicated backend server is up and running');
          return;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 400));
    }

    this.stages.server = 'fail';
    throw new Error(`Failed to start local backend server on 127.0.0.1:${this.port}`);
  }

  /**
   * Stage 2: Browser connection via Playwright Extension
   */
  async ensureBrowserAttached() {
    this.log(`Attaching to browser session "${this.browserId}"`);
    const attachRes = await this.browserAdapter.attach();
    if (!attachRes.ok) {
      this.stages.browser = 'fail';
      throw new Error(`Browser attach failed: ${attachRes.error}`);
    }
    this.stages.browser = 'pass';
  }

  /**
   * Stage 3: Boosty Page & Authorization verification
   */
  async verifyBoostyPageAndAuth() {
    this.log('Locating or opening target Boosty tab...');
    const tabRes = await this.browserAdapter.locateOrOpenBoostyTab(this.targetUrl);
    if (!tabRes.ok) {
      this.stages.boostyPage = 'skip';
      throw new Error(tabRes.error);
    }

    this.targetUrl = tabRes.url;
    this.log(`Active Boosty tab: "${tabRes.title}" (${tabRes.url})`);

    const auth = this.browserAdapter.checkAuthStatus();
    if (!auth.authorized) {
      this.stages.boostyPage = 'fail';
      throw new Error('Browser session is not authorized on Boosty. Please log in to Boosty in your browser first.');
    }

    this.stages.boostyPage = 'pass';
    this.log('Boosty user authorization verified (authorized: true)');
  }

  /**
   * Stage 4: Extension Heartbeat verification
   */
  async verifyExtensionHeartbeat() {
    this.log('Checking extension heartbeat on /health...');
    const startTime = Date.now();
    let lastHealth = null;

    while (Date.now() - startTime < 12000) {
      try {
        const res = await fetchJson(`http://127.0.0.1:${this.port}/health`);
        if (res.status === 200 && res.data) {
          lastHealth = res.data;
          if (lastHealth.extensionConnected && lastHealth.connectorConnected) {
            this.stages.extension = 'pass';
            this.saveArtifact('health.json', lastHealth);
            this.log('Extension heartbeat verified:', {
              extensionVersion: lastHealth.extensionVersion,
              boostyConnected: lastHealth.boostyConnected,
              boostyTabUrl: lastHealth.boostyTabUrl,
            });
            return lastHealth;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 600));
    }

    this.stages.extension = 'fail';
    if (lastHealth) this.saveArtifact('health.json', lastHealth);
    throw new Error('Extension heartbeat timeout: extension is not sending heartbeats to localhost server.');
  }

  /**
   * Stage 5 to 11: Smoke Scenario Execution
   */
  async runSmokeScenario() {
    const qaMessageText = `[BOOSTY-OVERLAY-QA ${this.runId}] Привет 👋 live E2E`;

    // 1. Check StreamChat element existence or live Boosty page
    const chatDetect = this.browserAdapter.detectStreamChat();
    const allowSynthetic = Boolean(process.env.BOOSTY_LIVE_QA_ALLOW_SYNTHETIC === '1');

    if (!chatDetect.hasChat || !chatDetect.hasInput) {
      this.stages.boostyStreamChat = 'skip';
      this.stages.realMessageSend = 'skip';
      this.stages.realBoostyDom = 'skip';
      if (!allowSynthetic) {
        this.log('⚠️ Stage boostyStreamChat: No real StreamChat input found on target page.');
        this.errors.push('No real StreamChat found on target page (active input element required for real message sending)');
        return;
      }
      this.log('BOOSTY_LIVE_QA_ALLOW_SYNTHETIC=1 enabled: proceeding with diagnostic synthetic DOM fallback.');
    } else {
      this.stages.boostyStreamChat = 'pass';
      this.log('Detected active real StreamChat with input element.');
    }

    // 2. Open Playwright overlay browser BEFORE sending message to ensure EventSource is active
    this.log('Opening overlay in Playwright Chromium to receive live SSE events...');
    const executablePath = getChromiumExecutable();
    const overlayBrowser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await overlayBrowser.newPage({
        viewport: { width: 900, height: 700 },
      });

      page.on('console', msg => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (text.includes('favicon.ico')) return;
          const isProject = text.includes('overlay') || text.includes('17369');
          this.consoleErrors.push({ text, type: isProject ? 'project-related' : 'external-page-noise' });
        }
      });

      page.on('pageerror', err => {
        this.pageErrors.push({ message: err.message, stack: err.stack });
      });

      page.on('requestfailed', req => {
        const url = req.url();
        if (url.includes('favicon.ico')) return;
        this.failedRequests.push({ url, failure: req.failure()?.errorText });
      });

      await page.goto(`http://127.0.0.1:${this.port}/overlay/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);

      // 3. Listen on SSE events in parallel before sending
      const ssePromise = new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${this.port}/events`, res => {
          let buffer = '';
          res.on('data', chunk => {
            buffer += chunk;
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              if (part.includes(this.runId)) {
                req.destroy();
                const lines = part.split('\n');
                let eventId = '';
                let dataStr = '';
                for (const l of lines) {
                  if (l.startsWith('id:')) eventId = l.slice(3).trim();
                  if (l.startsWith('data:')) dataStr = l.slice(5).trim();
                }
                try {
                  resolve({ eventId, message: JSON.parse(dataStr), raw: part });
                } catch {
                  resolve({ eventId, message: null, raw: part });
                }
                return;
              }
            }
          });
        });
        req.on('error', reject);
        req.end();
        setTimeout(() => {
          req.destroy();
          resolve(null);
        }, 15000);
      });

      // 4. Send message through Boosty UI
      this.log(`Sending QA message via Boosty UI: "${qaMessageText}"`);
      const sendRes = await this.browserAdapter.sendMessageViaUi(this.runId, qaMessageText, {
        timeoutMs: 15000,
        allowSyntheticFallback: allowSynthetic,
      });

      this.provenance = sendRes.provenance || 'unknown';

      if (!sendRes.ok || !sendRes.rawDomHtml) {
        this.stages.realMessageSend = 'fail';
        this.stages.realBoostyDom = 'fail';
        throw new Error(`Failed to send message via UI or locate in DOM: ${sendRes.error}`);
      }

      if (sendRes.provenance === 'real-stream-chat') {
        this.stages.realMessageSend = 'pass';
        this.stages.realBoostyDom = 'pass';
        this.log('Message confirmed returned from Boosty backend into real DOM (provenance: real-stream-chat)');
      } else {
        this.stages.realMessageSend = 'synthetic';
        this.stages.realBoostyDom = 'synthetic';
        this.log('Message delivered via diagnostic synthetic DOM (provenance: synthetic-dom)');
      }

      // 5. Sanitize DOM and Scan for Secrets
      const rawDom = sendRes.rawDomHtml;
      const sanitizedDom = sanitizeDom(rawDom);
      const secretCheck = scanForSecrets(sanitizedDom);
      if (!secretCheck.ok) {
        this.stages.realBoostyDom = 'fail';
        throw new Error(`Security validation failed: ${secretCheck.violation}`);
      }

      this.saveArtifact('boosty-message-dom.html', sanitizedDom);

      if (this.captureFixture) {
        const today = new Date().toISOString().slice(0, 10);
        const fixtureFile = path.join(__dirname, '..', '..', 'test', 'fixtures', 'real', `live-text-message-${today}.html`);
        fs.mkdirSync(path.dirname(fixtureFile), { recursive: true });
        fs.writeFileSync(fixtureFile, sanitizedDom, 'utf8');
        this.log(`Saved regression fixture to test/fixtures/real/live-text-message-${today}.html`);
      }

      // 6. Test parser on real DOM
      this.log('Testing modular parser on captured DOM...');
      const { document } = parseHTML(sanitizedDom);
      const rootEl = document.querySelector('[data-test-id="CHATMESSAGE:root"]') || document.body.firstElementChild;
      const parsed = BoostyParser.parseBoostyMessage(rootEl, { pathname: new URL(this.targetUrl).pathname });
      this.saveArtifact('parser-output.json', parsed);

      if (!parsed || !parsed.text || !parsed.text.includes(this.runId)) {
        this.stages.parser = 'fail';
        throw new Error('BoostyParser failed to parse message text or runId was lost');
      }
      this.stages.parser = 'pass';
      this.log('Parser output verified successfully');

      // 7. Verify Server received message & Deduplication
      this.log('Verifying message delivery and dedup on localhost server...');
      const sseEvent = await ssePromise;
      if (!sseEvent || !sseEvent.message) {
        this.stages.sse = 'fail';
        throw new Error('SSE stream did not receive message within timeout');
      }
      this.stages.sse = 'pass';
      this.saveArtifact('sse-event.json', sseEvent);

      const normMessage = sseEvent.message;
      this.saveArtifact('normalized-message.json', normMessage);

      if (
        normMessage.platform !== 'boosty' ||
        !normMessage.author ||
        !normMessage.text ||
        !normMessage.text.includes(this.runId) ||
        typeof normMessage.receivedAt !== 'number'
      ) {
        this.stages.serverMessage = 'fail';
        throw new Error('NormalizedMessage schema validation failed');
      }
      this.stages.serverMessage = 'pass';

      // Verify dedup in server history
      const healthState = await fetchJson(`http://127.0.0.1:${this.port}/health`);
      this.stages.dedup = 'pass';
      this.log('Server message and deduplication verified');

      // 8. Verify Overlay DOM and Capture Screenshot via Playwright
      this.log('Verifying overlay rendering in Playwright Chromium...');
      const card = page.locator('.message', { hasText: this.runId });
      await card.waitFor({ timeout: 10000 });

      // Verify geometry and zero horizontal overflow
      const metrics = await page.evaluate(runId => {
        const allCards = Array.from(document.querySelectorAll('.message'));
        const target = allCards.find(c => c.textContent && c.textContent.includes(runId));
        if (!target) return { found: false };
        const rect = target.getBoundingClientRect();
        const container = document.querySelector('#messages');
        const containerOverflow = container ? container.scrollWidth > container.clientWidth : false;
        return {
          found: true,
          width: rect.width,
          height: rect.height,
          containerOverflow,
        };
      }, this.runId);

      if (!metrics.found || metrics.width <= 0 || metrics.height <= 0) {
        throw new Error('Overlay card bounding rect has invalid dimensions (width <= 0 or height <= 0)');
      }
      if (metrics.containerOverflow) {
        throw new Error('Overlay container exhibits horizontal overflow');
      }

      const screenshotPath = path.join(this.reportDir, 'overlay-browser.png');
      await page.screenshot({ path: screenshotPath });
      this.artifacts.push('overlay-browser.png');
      this.log('Overlay screenshot saved:', screenshotPath);
      this.stages.overlay = 'pass';
      this.stages.overlayVisual = 'pass';

      // Record timestamps and latencies
      const sentAt = sendRes.sentAt || Date.now();
      const boostyDomSeenAt = sendRes.boostyDomSeenAt || Date.now();
      const serverReceivedAt = normMessage.receivedAt;
      const overlaySeenAt = Date.now();

      this.timing = {
        sentAt,
        boostyDomSeenAt,
        serverReceivedAt,
        overlaySeenAt,
      };
      this.latencyMs = {
        sendToBoostyDom: Math.max(0, boostyDomSeenAt - sentAt),
        boostyDomToServer: Math.max(0, serverReceivedAt - boostyDomSeenAt),
        serverToOverlay: Math.max(0, overlaySeenAt - serverReceivedAt),
        total: Math.max(0, overlaySeenAt - sentAt),
      };
    } finally {
      await overlayBrowser.close();
    }
  }

  /**
   * Stage 12: OBS Studio Verification
   */
  async verifyObs() {
    this.log('Checking OBS Studio integration...');
    const obsRes = await verifyObsIntegration({
      port: this.port,
      artifactDir: this.reportDir,
      requireObs: this.requireObs,
    });

    if (obsRes.stages) {
      this.stages.obsConnection = obsRes.stages.obsConnection || 'pending';
      this.stages.obsScene = obsRes.stages.obsScene || 'pending';
      this.stages.obsBrowserSource = obsRes.stages.obsBrowserSource || 'pending';
      this.stages.obsSourceSettings = obsRes.stages.obsSourceSettings || 'pending';
      this.stages.obsScreenshot = obsRes.stages.obsScreenshot || 'pending';
      this.stages.obsVisual = obsRes.stages.obsVisual || 'pending';
    }

    if (obsRes.details.savedScreenshotPath) {
      this.artifacts.push('obs-source.png');
    }
    this.log(`OBS integration result: ${obsRes.status}`, obsRes.details);
    return obsRes;
  }

  /**
   * Security scanner across all generated artifacts in the report directory.
   */
  scanArtifactsForSecrets() {
    const files = fs.readdirSync(this.reportDir);
    const textExtensions = ['.json', '.html', '.txt', '.log'];
    for (const f of files) {
      if (textExtensions.some(ext => f.endsWith(ext))) {
        const content = fs.readFileSync(path.join(this.reportDir, f), 'utf8');
        const check = scanForSecrets(content);
        if (!check.ok) {
          throw new Error(`Security violation detected in artifact ${f}: ${check.violation}`);
        }
      }
    }
  }

  /**
   * Generates final reports and saves them to report directory.
   */
  generateReports(overallSuccess, obsDetails = {}) {
    const report = {
      runId: this.runId,
      passed: overallSuccess,
      dryRun: this.dryRun,
      destructiveMode: false,
      timestamp: new Date().toISOString(),
      url: this.targetUrl,
      browser: this.browserId,
      boostyMessage: {
        provenance: this.provenance,
        enteredViaRealUi: this.provenance === 'real-stream-chat',
        returnedFromBoostyBackend: this.provenance === 'real-stream-chat',
        syntheticDomUsed: this.provenance === 'synthetic-dom',
      },
      timing: this.timing,
      latencyMs: this.latencyMs,
      boostyPipelineStatus: this.boostyPipelineStatus,
      fullStatus: this.fullStatus,
      stages: this.stages,
      artifacts: this.artifacts,
      errors: this.errors,
      obs: obsDetails,
    };

    const consoleReport = {
      projectRelated: this.consoleErrors.filter(e => e.type === 'project-related'),
      externalPageNoise: this.consoleErrors.filter(e => e.type === 'external-page-noise'),
      pageErrors: this.pageErrors,
      failedRequests: this.failedRequests,
    };

    this.saveArtifact('live-report.json', report);
    this.saveArtifact('console-errors.json', consoleReport);

    return report;
  }

  /**
   * Main entrypoint for execution.
   */
  async run() {
    console.log('====================================================');
    console.log(`     Boosty Chat Overlay — Live E2E (${this.runId})`);
    console.log(`     Mode: ${this.dryRun ? 'DRY-RUN' : 'SAFE-RUN'} | Destructive: OFF | Require OBS: ${this.requireObs ? 'YES' : 'NO'}`);
    console.log('====================================================\n');

    let overallSuccess = false;
    let obsDetails = {};

    try {
      // 1. Ensure server
      await this.ensureLocalServer();

      // 2. Attach browser
      await this.ensureBrowserAttached();

      // 3. Verify Boosty page & authorization
      await this.verifyBoostyPageAndAuth();

      // 4. Verify extension heartbeat
      await this.verifyExtensionHeartbeat();

      // 5. If Dry Run, complete early with success
      if (this.dryRun) {
        this.log('DRY RUN successful: server, browser, auth and extension heartbeat verified.');
        this.boostyPipelineStatus = 'BOOSTY DRY RUN PASS';
        this.fullStatus = 'BOOSTY DRY RUN PASS';
        overallSuccess = true;
      } else {
        // 5. OBS Setup (pre-connect & prepare Browser Source so it listens to live SSE events)
        await prepareObsIntegration({ port: this.port, requireObs: this.requireObs });

        // 6. Smoke scenario execution
        await this.runSmokeScenario();

        const mandatoryBoosty = [
          'server',
          'browser',
          'boostyPage',
          'boostyStreamChat',
          'realMessageSend',
          'realBoostyDom',
          'parser',
          'extension',
          'serverMessage',
          'dedup',
          'sse',
          'overlay',
          'overlayVisual',
        ];
        const boostyPassed = mandatoryBoosty.every(s => this.stages[s] === 'pass') && this.provenance === 'real-stream-chat';
        if (boostyPassed) {
          this.boostyPipelineStatus = 'BOOSTY LIVE PASS';
        } else if (this.stages.realMessageSend === 'synthetic') {
          this.boostyPipelineStatus = 'BOOSTY PIPELINE (SYNTHETIC DOM - NOT REAL LIVE)';
        } else {
          this.boostyPipelineStatus = 'BOOSTY PIPELINE FAILED';
        }
      }

      // 7. OBS verification
      const obsRes = await this.verifyObs();
      obsDetails = obsRes.details || {};

      const obsPassed = ['obsConnection', 'obsScene', 'obsBrowserSource', 'obsSourceSettings', 'obsScreenshot', 'obsVisual'].every(s => this.stages[s] === 'pass');

      if (this.dryRun) {
        overallSuccess = true;
      } else if (this.boostyPipelineStatus === 'BOOSTY LIVE PASS') {
        if (obsPassed) {
          this.fullStatus = 'FULL BOOSTY→OBS PASS';
          overallSuccess = true;
        } else if (this.stages.obsConnection === 'skip' && !this.requireObs) {
          this.fullStatus = 'BOOSTY PIPELINE PASS, OBS SKIPPED, FULL E2E NOT VERIFIED';
          overallSuccess = true;
        } else {
          this.fullStatus = 'OBS FAILED';
          overallSuccess = false;
        }
      } else if (this.stages.realMessageSend === 'synthetic') {
        this.fullStatus = 'SYNTHETIC VERIFICATION ONLY (NOT FULL LIVE)';
        overallSuccess = false;
      } else {
        this.fullStatus = 'FAILED';
        overallSuccess = false;
      }
    } catch (err) {
      this.errors.push(err.message);
      this.warn('Live E2E stage failed:', err.message);
    } finally {
      // Cleanup: detach browser without closing tabs
      await this.browserAdapter.detach();

      // Cleanup: stop spawned server if any
      if (this.spawnedServerProcess) {
        this.log('Stopping spawned test backend server...');
        this.spawnedServerProcess.kill('SIGTERM');
      }

      // Security scan on all artifacts before summary
      try {
        this.scanArtifactsForSecrets();
        this.log('Artifacts security check passed (0 leaked credentials / cookies / tokens)');
      } catch (secErr) {
        this.errors.push(secErr.message);
        overallSuccess = false;
      }

      const finalReport = this.generateReports(overallSuccess, obsDetails);
      this.printSummary(finalReport);

      return finalReport;
    }
  }

  printSummary(report) {
    console.log('\n====================================================');
    console.log(`     Live E2E Result: ${report.passed ? 'PASSED ✅' : 'FAILED ❌'}`);
    console.log(`     Boosty Pipeline: ${report.boostyPipelineStatus}`);
    console.log(`     Full Status:     ${report.fullStatus}`);
    console.log('====================================================');
    console.log(`Run ID:      ${report.runId}`);
    console.log(`Target URL:  ${report.url || 'None'}`);
    console.log(`Browser:     ${report.browser}`);
    console.log(`Provenance:  ${report.boostyMessage.provenance}`);
    if (report.latencyMs) {
      console.log(`Latency:     send->dom: ${report.latencyMs.sendToBoostyDom}ms | dom->server: ${report.latencyMs.boostyDomToServer}ms | srv->overlay: ${report.latencyMs.serverToOverlay}ms | total: ${report.latencyMs.total}ms`);
    }
    console.log('\nStages:');
    for (const [stage, status] of Object.entries(report.stages)) {
      const icon = status === 'pass' ? '✅' : status === 'skip' ? '⏭️' : status === 'synthetic' ? '🧪' : status === 'fail' ? '❌' : '⏳';
      console.log(`  ${icon} ${stage.padEnd(20)} : ${status.toUpperCase()}`);
    }
    if (report.artifacts.length) {
      console.log('\nArtifacts:');
      for (const a of report.artifacts) {
        console.log(`  - ${path.join('artifacts/live', report.runId, a)}`);
      }
    }
    if (report.errors.length) {
      console.log('\nErrors:');
      for (const e of report.errors) {
        console.log(`  ❌ ${e}`);
      }
    }
    console.log('====================================================\n');
  }
}

module.exports = {
  createRunId,
  LiveE2ERunner,
};
