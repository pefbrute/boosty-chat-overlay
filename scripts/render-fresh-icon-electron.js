const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      offscreen: true
    }
  });

  const svgPath = path.resolve(__dirname, '../build/icon-fresh.svg');
  const svgContent = fs.readFileSync(svgPath, 'utf8');
  const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent);

  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 512px;
    height: 512px;
    background: transparent;
    overflow: hidden;
  }
  img {
    width: 512px;
    height: 512px;
    display: block;
  }
</style>
</head>
<body>
  <img src="${dataUrl}" />
</body>
</html>`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  // Wait a short moment to ensure SVG image renders
  await new Promise((r) => setTimeout(r, 600));

  const image = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: 512,
    height: 512
  });

  const outPath = path.resolve(__dirname, '../build/icon-fresh.png');
  fs.writeFileSync(outPath, image.toPNG());
  console.log(`Rendered icon-fresh.png successfully (${fs.statSync(outPath).size} bytes)`);

  app.quit();
});
