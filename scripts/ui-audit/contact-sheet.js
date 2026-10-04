'use strict';

function generateContactSheetHtml({ manifest }) {
  const { generatedAt, appVersion, git, screenshots, screenshotCount } = manifest;

  // Group screenshots by section
  const sections = [
    { id: 'dashboard', title: 'Dashboard' },
    { id: 'onboarding', title: 'Onboarding' },
    { id: 'settings', title: 'Settings' },
    { id: 'overlay', title: 'Overlay' },
  ];

  const cardsHtml = sections.map(section => {
    const items = screenshots.filter(s => s.section === section.id);
    if (!items.length) return '';

    const itemsHtml = items.map(item => `
      <div class="shot-card" data-section="${item.section}" onclick="openModal('${item.file}', '${item.state}', '${item.width}x${item.height}', '${escapeHtml(item.description)}')">
        <div class="shot-thumb-container">
          <img src="${item.file}" alt="${item.description}" loading="lazy" class="shot-thumb">
        </div>
        <div class="shot-info">
          <div class="shot-header">
            <span class="shot-index">#${item.index}</span>
            <span class="shot-badge">${item.section}</span>
            <span class="shot-res">${item.width}×${item.height}</span>
          </div>
          <div class="shot-state">State: <strong>${item.state}</strong></div>
          <div class="shot-desc">${escapeHtml(item.description)}</div>
          <div class="shot-file">${item.file.replace('screenshots/', '')}</div>
        </div>
      </div>
    `).join('\n');

    return `
      <div class="section-group">
        <h2 class="section-title">${section.title} <span class="section-count">(${items.length})</span></h2>
        <div class="gallery-grid">
          ${itemsHtml}
        </div>
      </div>
    `;
  }).join('\n');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Boosty Chat Overlay — UI/UX Audit Gallery</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1015;
      --card-bg: #181920;
      --card-border: #2a2b36;
      --text: #f0f0f5;
      --text-muted: #9a9ab0;
      --accent: #f15f2c;
      --badge-bg: #2d1d18;
      --badge-text: #f5845c;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      padding: 32px 24px;
      line-height: 1.5;
    }
    .header {
      max-width: 1400px;
      margin: 0 auto 32px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 24px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .header h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header h1 .logo-badge {
      width: 28px;
      height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .meta-bar strong { color: var(--text); }
    .meta-pill {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      padding: 4px 12px;
      border-radius: 999px;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .section-group {
      margin-bottom: 40px;
    }
    .section-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-count {
      font-size: 14px;
      color: var(--text-muted);
      font-weight: 400;
    }

    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
    }
    .shot-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
      display: flex;
      flex-direction: column;
    }
    .shot-card:hover {
      transform: translateY(-3px);
      border-color: var(--accent);
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .shot-thumb-container {
      background: #000;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      border-bottom: 1px solid var(--card-border);
    }
    .shot-thumb {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    .shot-info {
      padding: 14px 16px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .shot-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }
    .shot-index {
      font-weight: 800;
      color: var(--accent);
    }
    .shot-badge {
      background: var(--badge-bg);
      color: var(--badge-text);
      padding: 2px 8px;
      border-radius: 6px;
      text-transform: uppercase;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .shot-res {
      margin-left: auto;
      color: var(--text-muted);
      font-family: monospace;
    }
    .shot-state {
      font-size: 14px;
      color: var(--text);
    }
    .shot-desc {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.4;
      flex: 1;
    }
    .shot-file {
      font-family: monospace;
      font-size: 11px;
      color: #6a6a80;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Modal */
    .modal {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.88);
      backdrop-filter: blur(8px);
      z-index: 9999;
      flex-direction: column;
      padding: 20px;
      align-items: center;
      justify-content: center;
    }
    .modal.active { display: flex; }
    .modal-content {
      max-width: 95vw;
      max-height: 85vh;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    .modal-content img {
      max-width: 100%;
      max-height: 85vh;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.8);
      border: 1px solid var(--card-border);
      object-fit: contain;
    }
    .modal-info {
      margin-top: 14px;
      text-align: center;
      color: var(--text);
      font-size: 14px;
      max-width: 800px;
    }
    .modal-close {
      position: absolute;
      top: 20px;
      right: 24px;
      color: white;
      font-size: 32px;
      cursor: pointer;
      background: none;
      border: none;
      line-height: 1;
      padding: 8px;
    }
  </style>
</head>
<body>

  <header class="header">
    <h1>
      <span class="logo-badge"><svg xmlns="http://www.w3.org/2000/svg" viewBox="23.6 46.6 189 199" width="28" height="30"><defs><linearGradient id="bg" x1="145.08" y1="76.15" x2="80.59" y2="296.08" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#EF7829"/><stop offset="1" stop-color="#F15A2C"/></linearGradient></defs><path fill="url(#bg)" d="M44.3,164.5L76.9,51.6H127l-10.1,35c-0.1,0.2-0.2,0.4-0.3,0.6L90,179.6h24.8c-10.4,25.9-18.5,46.2-24.3,60.9 c-45.8-0.5-58.6-33.3-47.4-72.1 M90.7,240.6l60.4-86.9h-25.6l22.3-55.7c38.2,4,56.2,34.1,45.6,70.5 c-11.3,39.1-57.1,72.1-101.7,72.1C91.3,240.6,91,240.6,90.7,240.6z"/></svg></span>
      Boosty Chat Overlay — UI/UX Audit
    </h1>
    <div class="meta-bar">
      <span class="meta-pill">Screenshots: <strong>${screenshotCount}</strong></span>
      <span class="meta-pill">Commit: <strong>${git.commit}${git.dirty ? ' (dirty)' : ''}</strong></span>
      <span class="meta-pill">Branch: <strong>${git.branch}</strong></span>
      <span class="meta-pill">Date: <strong>${generatedAt}</strong></span>
    </div>
  </header>

  <main class="container">
    ${cardsHtml}
  </main>

  <div id="modal" class="modal" onclick="closeModal(event)">
    <button class="modal-close" onclick="closeModal(event)">&times;</button>
    <div class="modal-content" onclick="event.stopPropagation()">
      <img id="modal-img" src="" alt="">
    </div>
    <div id="modal-text" class="modal-info" onclick="event.stopPropagation()"></div>
  </div>

  <script>
    function openModal(file, state, res, desc) {
      document.getElementById('modal-img').src = file;
      document.getElementById('modal-text').innerHTML = '<strong>' + state + '</strong> (' + res + ') &mdash; ' + desc;
      document.getElementById('modal').classList.add('active');
    }
    function closeModal(e) {
      document.getElementById('modal').classList.remove('active');
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  generateContactSheetHtml,
};
