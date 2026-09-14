'use strict';

/**
 * Audit Stream Background for Overlay
 * Injects a 16:9 test canvas background directly into the overlay DOM:
 *  - Zone A: Dark gameplay
 *  - Zone B: Light / bright
 *  - Zone C: Busy / high-contrast
 *  - Zone D: Ambient gradient
 */
const INJECTION_SCRIPT = `
(function() {
  const existing = document.getElementById('stream-canvas-audit');
  if (existing) return;

  const style = document.createElement('style');
  style.id = 'stream-canvas-audit-style';
  style.textContent = \`
    .stream-canvas {
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      z-index: 0;
      pointer-events: none;
    }
    .zone-dark {
      background: linear-gradient(135deg, #090a0f 0%, #151922 100%);
      border-right: 1px solid rgba(255,255,255,0.06);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding: 24px;
      color: #333d4e;
      font-family: monospace;
      font-size: 14px;
    }
    .zone-light {
      background: linear-gradient(135deg, #d8dee9 0%, #eceff4 100%);
      border-bottom: 1px solid rgba(0,0,0,0.08);
      padding: 24px;
      color: #7b889b;
      font-family: monospace;
      font-size: 14px;
    }
    .zone-busy {
      background: 
        repeating-linear-gradient(45deg, #1e222b, #1e222b 12px, #262c38 12px, #262c38 24px),
        radial-gradient(circle at center, #ff4500 0%, #1a1a24 70%);
      background-blend-mode: overlay;
      border-right: 1px solid rgba(255,255,255,0.08);
      padding: 24px;
      color: rgba(255,255,255,0.4);
      font-family: monospace;
      font-size: 14px;
      position: relative;
    }
    .zone-busy::after {
      content: "STREAM CONTENT AREA // HIGH CONTRAST TEST ZONE // 1080p";
      position: absolute;
      bottom: 24px;
      left: 24px;
      color: rgba(255, 255, 255, 0.2);
      font-weight: bold;
      font-size: 18px;
    }
    .zone-moderate {
      background: radial-gradient(circle at bottom right, #2c1a1d, #12131a 80%);
      padding: 24px;
      color: #404452;
      font-family: monospace;
      font-size: 14px;
    }
    .canvas-watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 1;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 24px;
      font-weight: 800;
      color: rgba(255, 255, 255, 0.08);
      letter-spacing: 4px;
      pointer-events: none;
      text-transform: uppercase;
      border: 2px dashed rgba(255, 255, 255, 0.06);
      padding: 18px 36px;
      border-radius: 12px;
    }
    #messages {
      z-index: 10 !important;
    }
  \`;
  document.head.appendChild(style);

  const canvas = document.createElement('div');
  canvas.id = 'stream-canvas-audit';
  canvas.className = 'stream-canvas';
  canvas.innerHTML = \`
    <div class="zone-dark">ZONE A: DARK STREAM BACKGROUND</div>
    <div class="zone-light">ZONE B: LIGHT/BRIGHT STREAM BACKGROUND</div>
    <div class="zone-busy">ZONE C: BUSY / NOISY GRAPHICS BACKGROUND</div>
    <div class="zone-moderate">ZONE D: AMBIENT STREAM BACKGROUND</div>
    <div class="canvas-watermark">UI Audit 16:9 Stream Canvas</div>
  \`;
  document.body.insertBefore(canvas, document.body.firstChild);
})();
`;

function getOverlayBackgroundInjectionScript() {
  return INJECTION_SCRIPT;
}

module.exports = {
  getOverlayBackgroundInjectionScript,
};
