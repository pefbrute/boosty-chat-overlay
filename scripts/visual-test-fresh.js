'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('playwright');

const projectRoot = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts/fresh');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function run() {
  console.log('[Visual Test Fresh] Starting Fresh Variant Visual QA...');

  // 1. Generate fresh-05-prod-lab-fresh-icons.png (Contact sheet of the 3 variant icons)
  console.log('[Visual Test Fresh] Generating 3-variant icon comparison contact sheet...');
  const prodIconPath = path.resolve(__dirname, '../build/icon.png');
  const labIconPath = path.resolve(__dirname, '../build/icon-lab.png');
  const freshIconPath = path.resolve(__dirname, '../build/icon-fresh.png');

  const prodBase64 = fs.readFileSync(prodIconPath).toString('base64');
  const labBase64 = fs.readFileSync(labIconPath).toString('base64');
  const freshBase64 = fs.readFileSync(freshIconPath).toString('base64');

  const contactHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    padding: 32px;
    background: #0f1117;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }
  h1 {
    margin: 0 0 8px 0;
    font-size: 22px;
    font-weight: 700;
    color: #f8fafc;
  }
  p {
    margin: 0 0 16px 0;
    font-size: 13px;
    color: #94a3b8;
  }
  .grid {
    display: flex;
    gap: 32px;
    justify-content: center;
  }
  .card {
    background: #181b24;
    border: 1px solid #2d3343;
    border-radius: 16px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 200px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
  }
  .card.fresh {
    border-color: rgba(16, 185, 129, 0.5);
    background: #152220;
  }
  .icon-img {
    width: 128px;
    height: 128px;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
  }
  .title {
    font-size: 15px;
    font-weight: 700;
    text-align: center;
  }
  .badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .badge-prod {
    background: rgba(239, 120, 41, 0.16);
    color: #f97316;
    border: 1px solid rgba(239, 120, 41, 0.3);
  }
  .badge-lab {
    background: rgba(139, 92, 246, 0.16);
    color: #a78bfa;
    border: 1px solid rgba(139, 92, 246, 0.35);
  }
  .badge-fresh {
    background: rgba(16, 185, 129, 0.16);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.35);
  }
</style>
</head>
<body>
  <h1>Boosty Chat Overlay — Application Variants</h1>
  <p>OS-level Visual Identity: Production vs Lab vs Fresh QA</p>
  <div class="grid">
    <div class="card">
      <img class="icon-img" src="data:image/png;base64,${prodBase64}" />
      <span class="badge badge-prod">Production</span>
      <span class="title">Boosty Chat Overlay</span>
    </div>
    <div class="card">
      <img class="icon-img" src="data:image/png;base64,${labBase64}" />
      <span class="badge badge-lab">LAB</span>
      <span class="title">Boosty Chat Overlay Lab</span>
    </div>
    <div class="card fresh">
      <img class="icon-img" src="data:image/png;base64,${freshBase64}" />
      <span class="badge badge-fresh">С нуля (NEW)</span>
      <span class="title">Boosty Chat Overlay Fresh</span>
    </div>
  </div>
</body>
</html>`;

  // 2. Launch Fresh app in isolated temporary userData
  const testUserData = path.join(os.tmpdir(), `boosty-visual-fresh-${Date.now()}`, 'Boosty Chat Overlay Fresh');
  fs.mkdirSync(testUserData, { recursive: true });

  const appEnv = {
    ...process.env,
    BOOSTY_APP_VARIANT: 'fresh',
    BOOSTY_OVERLAY_USER_DATA: testUserData,
    BOOSTY_OVERLAY_PORT: '17399',
    BOOSTY_OVERLAY_UI_TEST: '1',
  };

  const app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      path.join(projectRoot, 'desktop', 'main.js'),
    ],
    cwd: projectRoot,
    env: appEnv,
  });

  const page = await app.firstWindow();
  page.on('console', msg => console.log(`[Electron Renderer Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.error('[Electron Renderer Error]', err));

  await page.waitForLoadState('domcontentloaded');

  // Contact sheet
  const iconPage = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({
      width: 800,
      height: 400,
      show: false,
      backgroundColor: '#0f1117',
      webPreferences: { offscreen: true }
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise(r => setTimeout(r, 600));
    const image = await win.webContents.capturePage();
    win.destroy();
    return image.toPNG().toString('base64');
  }, contactHtml);

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'fresh-05-prod-lab-fresh-icons.png'),
    Buffer.from(iconPage, 'base64')
  );
  console.log('[Visual Test Fresh] Saved fresh-05-prod-lab-fresh-icons.png');

  // Wait for app initialization
  await page.waitForFunction(() => window.__APP_INITIALIZED__ === true || document.readyState === 'complete');
  await page.waitForTimeout(1000);

  // 3. fresh-02-first-launch.png: Entire window upon cold start
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'fresh-02-first-launch.png'),
  });
  console.log('[Visual Test Fresh] Saved fresh-02-first-launch.png');

  // 4. fresh-03-onboarding.png: Focused onboarding wizard view
  const onboardingView = await page.$('#onboarding-view');
  if (onboardingView) {
    await onboardingView.screenshot({
      path: path.join(ARTIFACTS_DIR, 'fresh-03-onboarding.png'),
    });
    console.log('[Visual Test Fresh] Saved fresh-03-onboarding.png');
  }

  // 5. fresh-04-internal-badge.png: Close-up of onboarding header with "С нуля" badge
  const headerBadgeContainer = await page.$('#onboarding-view .app-header');
  if (headerBadgeContainer) {
    await headerBadgeContainer.screenshot({
      path: path.join(ARTIFACTS_DIR, 'fresh-04-internal-badge.png'),
    });
    console.log('[Visual Test Fresh] Saved fresh-04-internal-badge.png');
  }

  // 6. fresh-01-app-menu-icon.png: Visual simulation of .desktop launcher and taskbar icon
  const menuSimHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    padding: 32px;
    background: #181920;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 600px;
  }
  .desktop-item {
    display: flex;
    align-items: center;
    gap: 20px;
    background: #232530;
    border: 1px solid #323648;
    border-radius: 12px;
    padding: 16px 20px;
  }
  .desktop-item.active {
    border-color: #10b981;
    background: #182823;
  }
  .app-icon {
    width: 64px;
    height: 64px;
    flex-shrink: 0;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .name {
    font-size: 16px;
    font-weight: 700;
    color: #f8fafc;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .desc {
    font-size: 13px;
    color: #94a3b8;
  }
  .exec {
    font-family: monospace;
    font-size: 11px;
    color: #64748b;
  }
  .badge-fresh {
    background: rgba(16, 185, 129, 0.16);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.35);
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 700;
  }
</style>
</head>
<body>
  <div style="font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b;">
    OS Application Launcher Registration
  </div>
  <div class="desktop-item active">
    <img class="app-icon" src="data:image/png;base64,${freshBase64}" />
    <div class="info">
      <div class="name">
        Boosty Chat Overlay Fresh
        <span class="badge-fresh">С нуля</span>
      </div>
      <div class="desc">Test onboarding and first-run experience with a clean slate</div>
      <div class="exec">~/.local/share/applications/boosty-chat-overlay-fresh.desktop</div>
    </div>
  </div>
</body>
</html>`;

  const menuImg = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({
      width: 680,
      height: 220,
      show: false,
      backgroundColor: '#181920',
      webPreferences: { offscreen: true }
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise(r => setTimeout(r, 400));
    const image = await win.webContents.capturePage();
    win.destroy();
    return image.toPNG().toString('base64');
  }, menuSimHtml);

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'fresh-01-app-menu-icon.png'),
    Buffer.from(menuImg, 'base64')
  );
  console.log('[Visual Test Fresh] Saved fresh-01-app-menu-icon.png');

  await app.close();

  // Cleanup test user data
  fs.rmSync(path.dirname(testUserData), { recursive: true, force: true });
  console.log('[Visual Test Fresh] All screenshots captured successfully in artifacts/fresh/');
}

run().catch((err) => {
  console.error('[Visual Test Fresh] Error:', err);
  process.exit(1);
});
