'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

describe('Onboarding Mini Lesson v2 — Visual Accuracy & Compactness', () => {
  test('1. Video configuration and total duration (10–14 seconds)', async () => {
    const configPath = path.join(projectRoot, 'tools', 'tutorial-video', 'src', 'config.js');
    const content = fs.readFileSync(configPath, 'utf8');

    // Parse scene timings from config file
    assert.match(content, /scene1DurationFrames:\s*75/);
    assert.match(content, /scene2DurationFrames:\s*75/);
    assert.match(content, /scene3DurationFrames:\s*210/);

    const totalFrames = 75 + 75 + 210; // 360 frames
    const fps = 30;
    const durationSeconds = totalFrames / fps;

    assert.equal(totalFrames, 360);
    assert.equal(durationSeconds, 12.0);
    assert.ok(durationSeconds >= 10 && durationSeconds <= 14, 'Duration must be in 10–14 second range');
  });

  test('2. Scene 1 — Address bar typing & Enter test (ТЗ sections 1, 2, 24)', () => {
    const scene1Path = path.join(projectRoot, 'tools', 'tutorial-video', 'src', 'scenes', 'Scene1OpenExtensions.jsx');
    const content = fs.readFileSync(scene1Path, 'utf8');

    // Target URL must be exactly browser://extensions without typos
    assert.match(content, /fullUrl\s*=\s*'browser:\/\/extensions'/);

    // Typing speed test: from frame 22 to frame 50 (~28 frames / 30 fps = ~0.93 seconds)
    assert.match(content, /interpolate\(frame,\s*\[22,\s*50\]/);
    const typingDurationSec = (50 - 22) / 30;
    assert.ok(typingDurationSec >= 0.7 && typingDurationSec <= 1.2, 'Typing duration must be 0.7–1.2s');

    // Enter key hint and post-Enter page load
    assert.match(content, /showEnterHint/);
    assert.match(content, /pageLoaded\s*=\s*frame\s*>=\s*60/);
  });

  test('3. Scene 2 — Target accuracy & click timing test (ТЗ sections 3, 4, 5, 23)', () => {
    const scene2Path = path.join(projectRoot, 'tools', 'tutorial-video', 'src', 'scenes', 'Scene2DeveloperMode.jsx');
    const content = fs.readFileSync(scene2Path, 'utf8');

    // Target coordinates
    assert.match(content, /targetX\s*=/);
    assert.match(content, /targetY\s*=/);

    // Click sequence: cursor down -> up -> toggle switch
    assert.match(content, /isClicking\s*=\s*frame\s*>=\s*36\s*&&\s*frame\s*<=\s*43/);
    assert.match(content, /isToggleSwitched\s*=\s*frame\s*>=\s*48/);

    // Natural click-to-switch delay: (48 - 43) frames = 5 frames = 167ms (within 100-250ms range)
    const delayMs = ((48 - 43) / 30) * 1000;
    assert.ok(delayMs >= 100 && delayMs <= 250, `Delay (${delayMs}ms) must be within 100–250ms`);
  });

  test('4. Scene 3 — Drag source & drop test (ТЗ sections 6, 7, 8, 9, 25, 26)', () => {
    const scene3Path = path.join(projectRoot, 'tools', 'tutorial-video', 'src', 'scenes', 'Scene3DragFolder.jsx');
    const content = fs.readFileSync(scene3Path, 'utf8');

    // File manager window as drag origin
    assert.match(content, /FileManagerWindow/);

    // Folder is static before mouse down
    assert.match(content, /isMouseDown\s*=\s*frame\s*>=\s*35/);

    // Drag is continuous between frame 48 and 112 (~2 seconds)
    assert.match(content, /isDragging\s*=\s*frame\s*>=\s*48\s*&&\s*frame\s*<\s*112/);

    // Drop occurs at frame 112
    assert.match(content, /isDropped\s*=\s*frame\s*>=\s*112/);

    // Boosty installed card appears only after drop (frame >= 122)
    assert.match(content, /hasBoostyInstalled\s*=\s*frame\s*>=\s*122/);

    // Completion badge
    assert.match(content, /isComplete\s*=\s*frame\s*>=\s*145/);
  });

  test('5. Static diagram fallback & Poster assets exist and are valid', () => {
    const svgPath = path.join(projectRoot, 'desktop', 'assets', 'tutorials', 'yandex-extension-install-diagram.svg');
    const posterPath = path.join(projectRoot, 'desktop', 'assets', 'tutorials', 'yandex-extension-install-poster.png');
    const webmPath = path.join(projectRoot, 'desktop', 'assets', 'tutorials', 'yandex-extension-install.webm');

    assert.ok(fs.existsSync(svgPath), 'Diagram SVG must exist');
    const svgContent = fs.readFileSync(svgPath, 'utf8');
    assert.match(svgContent, /viewBox="0 0 940 230"/);
    assert.match(svgContent, /browser:\/\/extensions/);
    assert.match(svgContent, /Режим разработчика/);
    assert.match(svgContent, /Перетащите папку extension/);
    assert.match(svgContent, /boosty-chat-overlay\//);
    assert.match(svgContent, /extension\//);

    assert.ok(fs.existsSync(posterPath), 'Poster PNG must exist');
    const posterStat = fs.statSync(posterPath);
    assert.ok(posterStat.size > 10000, 'Poster must be a valid non-empty image');

    assert.ok(fs.existsSync(webmPath), 'Video WebM must exist');
    const webmStat = fs.statSync(webmPath);
    assert.ok(webmStat.size > 50000, 'WebM video must be non-empty');
    assert.ok(webmStat.size < 2 * 1024 * 1024, 'WebM video must be compact (< 2MB)');
  });

  test('6. Desktop Onboarding UI: badge title, compact sizing, and lightbox modal (ТЗ sections 14–18)', () => {
    const htmlPath = path.join(projectRoot, 'desktop', 'index.html');
    const cssPath = path.join(projectRoot, 'desktop', 'app.css');
    const jsPath = path.join(projectRoot, 'desktop', 'app.js');

    const html = fs.readFileSync(htmlPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');
    const js = fs.readFileSync(jsPath, 'utf8');

    // Renamed badge per ТЗ section 18
    assert.match(html, /<span class="ob-tutorial-badge">Как установить — 10 сек<\/span>/);
    assert.doesNotMatch(html, /Мини-урок 10 сек/);

    // Expand button per ТЗ section 17
    assert.match(html, /id="ob-tutorial-expand-btn"/);
    assert.match(html, /id="ob-tutorial-lightbox"/);

    // CSS compact height in range 180–230px per ТЗ section 15
    assert.match(css, /max-height:\s*220px;/);
    assert.match(css, /max-height:\s*(180|190)px;/);
    assert.match(css, /\.ob-tutorial-lightbox/);

    // JS handles expand button and lightbox
    assert.match(js, /expandBtn\?\.addEventListener\('click',\s*openLightbox\)/);
    assert.match(js, /closeLightbox/);
  });

  test('7. v3 String Audit & Explicit extension folder clarification (ТЗ v3 sections 1–17)', () => {
    const html = fs.readFileSync(path.join(projectRoot, 'desktop', 'index.html'), 'utf8');
    const metadataContent = fs.readFileSync(path.join(projectRoot, 'desktop', 'browser', 'metadata.js'), 'utf8');
    const ruCopy = fs.readFileSync(path.join(projectRoot, 'tools', 'tutorial-video', 'src', 'copy', 'ru.js'), 'utf8');
    const fmWindow = fs.readFileSync(path.join(projectRoot, 'tools', 'tutorial-video', 'src', 'components', 'FileManagerWindow.jsx'), 'utf8');
    const folderCard = fs.readFileSync(path.join(projectRoot, 'tools', 'tutorial-video', 'src', 'components', 'FolderCard.jsx'), 'utf8');
    const browserFrame = fs.readFileSync(path.join(projectRoot, 'tools', 'tutorial-video', 'src', 'components', 'BrowserFrame.jsx'), 'utf8');
    const posterContent = fs.readFileSync(path.join(projectRoot, 'tools', 'tutorial-video', 'src', 'ExtensionInstallPoster.jsx'), 'utf8');

    // Forbidden ambiguous / wrong folder phrases (ТЗ section 3 & 17)
    const forbiddenPatterns = [
      /Перетащите папку Boosty Chat Overlay/i,
      /Перетащите Boosty Chat Overlay/i,
      /выберите папку Boosty Chat Overlay/i,
      /Перетащите эту папку/i,
      /выберите папку приложения/i,
    ];

    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(html, pattern, `index.html must not contain ${pattern}`);
      assert.doesNotMatch(metadataContent, pattern, `metadata.js must not contain ${pattern}`);
      assert.doesNotMatch(ruCopy, pattern, `ru.js must not contain ${pattern}`);
      assert.doesNotMatch(fmWindow, pattern, `FileManagerWindow.jsx must not contain ${pattern}`);
      assert.doesNotMatch(folderCard, pattern, `FolderCard.jsx must not contain ${pattern}`);
    }

    // Step 3 HTML & Metadata required texts (ТЗ section 2)
    assert.match(html, /Перетащите папку extension/);
    assert.match(html, /Откройте папку расширения и перетащите именно папку extension в окно страницы расширений браузера\./);
    assert.match(html, /📁 Открыть папку extension/);
    assert.match(html, /✓ Папка extension открыта/);
    assert.match(html, /Зажмите папку extension мышью и перетащите её на страницу расширений\./);
    assert.match(html, /Нажмите <strong>«Загрузить распакованное расширение»<\/strong> и выберите папку <strong>extension<\/strong>\./);

    // Video components distinguish folder `extension` from installed card `Boosty Chat Overlay`
    assert.match(fmWindow, /boosty-chat-overlay\//);
    assert.match(fmWindow, /📁 extension/);
    assert.match(fmWindow, /Папка расширения/);
    assert.doesNotMatch(fmWindow, /Boosty Chat Overlay/, 'FileManagerWindow must not call the folder Boosty Chat Overlay');

    assert.match(folderCard, /📁 extension/);
    assert.match(folderCard, /Папка расширения/);
    assert.doesNotMatch(folderCard, /Boosty Chat Overlay/, 'Dragged FolderCard must not say Boosty Chat Overlay');

    assert.match(browserFrame, /Отпустите папку extension здесь/);
    assert.match(browserFrame, /✓ Расширение установлено/);
    assert.match(browserFrame, /Boosty Chat Overlay/, 'Installed extension card must be named Boosty Chat Overlay');

    assert.match(posterContent, /Перетащите папку extension/);
  });

  test('8. Copy path & Open folder actions target the extension directory (ТЗ sections 13–15)', () => {
    const { createBrowserManager } = require('../desktop/browser/manager.js');

    let copiedText = '';
    let shownItemPath = '';
    const mgr = createBrowserManager({
      clipboardModule: {
        writeText(t) {
          copiedText = t;
        },
      },
      shellModule: {
        showItemInFolder(p) {
          shownItemPath = p;
        },
      },
    });

    const copyRes = mgr.copyExtensionPath();
    assert.equal(copyRes.ok, true);
    assert.match(copyRes.extensionDir, /[\\/]extension$/);
    assert.equal(copiedText, copyRes.extensionDir);

    const openRes = mgr.openExtensionFolder();
    assert.equal(openRes.ok, true);
    assert.match(openRes.extensionDir, /[\\/]extension$/);
    assert.equal(shownItemPath, openRes.extensionDir);
  });
});

