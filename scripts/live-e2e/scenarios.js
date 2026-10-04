'use strict';

const fs = require('node:fs');
const path = require('node:path');
const parser = require('../../extension/parser.js');
const { sanitizeDom, scanForSecrets } = require('./sanitizer.js');

/**
 * Helper to capture OBS and Overlay screenshots for a specific scenario.
 */
async function captureScenarioScreenshots(options) {
  const { scenarioName, artifactDir, overlayPage, obsService, port = 17369 } = options;

  let overlayScreenshotFile = null;
  let obsScreenshotFile = null;

  // 1. Overlay browser screenshot
  if (overlayPage && artifactDir) {
    try {
      const fileName = `overlay-${scenarioName}.png`;
      const targetPath = path.join(artifactDir, fileName);
      await overlayPage.screenshot({ path: targetPath });
      overlayScreenshotFile = fileName;
    } catch (err) {
      console.warn(`[Scenario ${scenarioName}] Failed overlay screenshot:`, err.message);
    }
  }

  // 2. OBS CEF source screenshot
  if (obsService && artifactDir) {
    try {
      const client = obsService.getClient();
      const inputList = await client.call('GetInputList', { inputKind: 'browser_source' }).catch(() => ({ inputs: [] }));
      const candidateNames = ['Boosty Chat QA', 'Boosty Chat'];
      for (const input of (inputList.inputs || [])) {
        if (!candidateNames.includes(input.inputName)) {
          candidateNames.push(input.inputName);
        }
      }

      let bestBuffer = null;
      for (const sName of candidateNames) {
        try {
          const res = await client.call('GetSourceScreenshot', {
            sourceName: sName,
            imageFormat: 'png',
            imageWidth: 900,
            imageHeight: 700,
          });
          if (res?.imageData) {
            const raw = res.imageData.replace(/^data:image\/[a-z]+;base64,/, '');
            const b = Buffer.from(raw, 'base64');
            if (b.length > 100 && (!bestBuffer || b.length > bestBuffer.length)) {
              bestBuffer = b;
            }
          }
        } catch {}
      }

      if (bestBuffer) {
        const fileName = `obs-${scenarioName}.png`;
        const targetPath = path.join(artifactDir, fileName);
        fs.writeFileSync(targetPath, bestBuffer);
        obsScreenshotFile = fileName;
      }
    } catch (err) {
      console.warn(`[Scenario ${scenarioName}] Failed OBS screenshot:`, err.message);
    }
  }

  return {
    overlayScreenshotFile,
    obsScreenshotFile,
  };
}

/**
 * Saves sanitized real DOM fixture to artifacts directory and optionally to test fixtures.
 */
function saveScenarioDom(scenarioName, domHtml, options = {}) {
  const { artifactDir, captureFixture = false } = options;
  if (!domHtml || !artifactDir) return null;

  const domDir = path.join(artifactDir, 'dom');
  if (!fs.existsSync(domDir)) {
    fs.mkdirSync(domDir, { recursive: true });
  }

  const cleanHtml = sanitizeDom(domHtml);
  const targetFile = path.join(domDir, `${scenarioName}.html`);
  fs.writeFileSync(targetFile, cleanHtml, 'utf8');

  if (captureFixture || process.env.BOOSTY_LIVE_QA_CAPTURE_FIXTURE === '1') {
    const fixtureDir = path.join(__dirname, '../../test/fixtures/real');
    if (!fs.existsSync(fixtureDir)) {
      fs.mkdirSync(fixtureDir, { recursive: true });
    }
    fs.writeFileSync(path.join(fixtureDir, `${scenarioName}.html`), cleanHtml, 'utf8');
  }

  return `${scenarioName}.html`;
}

/**
 * Waits for a message containing specified pattern to appear in StreamChat DOM.
 */
async function waitForChatMessageInDom(adapter, pattern, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const checkScript = `(pat) => {
      const messages = Array.from(document.querySelectorAll(
        '[data-test-id="CHATMESSAGE:root"], [class*="ChatMessage-scss--module_root_"], [class*="ChatMessage_root"], [class*="ChatMessage"]'
      ));
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        const text = m.innerText || '';
        const html = m.outerHTML || '';
        if (text.includes(pat) || html.includes(pat)) {
          const rootEl = m.closest('[data-test-id="CHATMESSAGE:root"]') || m.closest('[class*="ChatMessage-scss--module_root_"]') || m.closest('[class*="ChatMessage_root"]') || m;
          const authorEl = rootEl.querySelector('[data-test-id="CHATMESSAGE:author"], [class*="ChatMessage_author"], [class*="Author"], [class*="name"]');
          const rawAuthorText = authorEl ? (authorEl.innerText || authorEl.textContent || '') : '';

          // Check for owner role badge icon
          const hasOwnerStar = Boolean(rootEl.querySelector('use[*|href*="icon-star"], [class*="badgeIcon"]'));
          const hasModeratorSword = Boolean(rootEl.querySelector('use[*|href*="icon-sword"]'));
          const hasSmileImg = Boolean(rootEl.querySelector('img[data-type="smile"]'));
          const hasMentionSpan = Boolean(rootEl.querySelector('span.mention, [class*="mention"]'));
          const hasReplyQuote = Boolean(rootEl.querySelector('[class*="reply" i], [class*="Reply" i]'));

          return {
            found: true,
            outerHTML: rootEl.outerHTML,
            innerText: rootEl.innerText,
            rawAuthorText,
            hasOwnerStar,
            hasModeratorSword,
            hasSmileImg,
            hasMentionSpan,
            hasReplyQuote,
            seenAt: Date.now(),
          };
        }
      }
      return { found: false };
    }`;

    const res = adapter.evalInTab(`(${checkScript})(${JSON.stringify(pattern)})`);
    if (res?.found) {
      return res;
    }
    await new Promise(r => setTimeout(r, 600));
  }
  return { found: false };
}

/**
 * Scenario 1: Plain Message
 */
async function runPlainScenario(context) {
  const { adapter, runId, artifactDir, overlayPage, obsService, port } = context;
  const messageText = `[BOOSTY-OVERLAY-QA ${runId}] plain 👋`;

  console.log(`[Scenario 1: Plain] Sending: "${messageText}"`);
  let sentRes = await adapter.sendMessageViaUi(runId, messageText, { allowSyntheticFallback: false, timeoutMs: 15000 });
  if (!sentRes.ok) {
    console.log('[Scenario 1: Plain] First send attempt timed out, retrying once after pubsub stabilization...');
    await new Promise(r => setTimeout(r, 2500));
    sentRes = await adapter.sendMessageViaUi(runId, messageText, { allowSyntheticFallback: false, timeoutMs: 25000 });
  }
  if (!sentRes.ok) {
    return { status: 'fail', error: `UI send failed: ${sentRes.error}` };
  }

  const domRes = await waitForChatMessageInDom(adapter, runId, 30000);
  if (!domRes.found) {
    return { status: 'fail', error: 'Plain message not found in StreamChat DOM after 30s' };
  }

  // Parse captured DOM with BoostyParser
  let parsed = null;
  try {
    const { parseHTML } = require('linkedom');
    const { document } = parseHTML(domRes.outerHTML);
    const rootEl = document.querySelector('[data-test-id*="CHATMESSAGE"], [class*="ChatMessage"]') || document.firstElementChild || document.body?.firstElementChild;
    parsed = parser.parseBoostyMessage(rootEl);
  } catch (err) {
    console.warn('[Scenario 1] Parser error on real DOM:', err.message);
  }

  // Save parser-output.json artifact
  if (parsed && artifactDir) {
    fs.writeFileSync(path.join(artifactDir, 'parser-output.json'), JSON.stringify(parsed, null, 2), 'utf8');
  }

  // Normalize message with model and save normalized-message.json artifact
  const { normalizeIncomingMessage } = require('../../core/messages/model.js');
  const normalizedMsg = normalizeIncomingMessage({
    id: parsed?.id,
    platform: 'boosty',
    author: parsed?.author,
    role: parsed?.role,
    text: parsed?.text,
    segments: parsed?.segments,
    avatar: parsed?.avatar,
    publishTime: parsed?.publishTime,
    reply: parsed?.reply,
  }, { receivedAt: Date.now() });

  if (artifactDir) {
    fs.writeFileSync(path.join(artifactDir, 'normalized-message.json'), JSON.stringify(normalizedMsg, null, 2), 'utf8');
  }

  // Check Overlay DOM author text via Playwright
  let overlayAuthor = null;
  if (overlayPage) {
    try {
      overlayAuthor = await overlayPage.evaluate((id) => {
        const cards = Array.from(document.querySelectorAll('.message'));
        const target = cards.find(c => c.textContent && c.textContent.includes(id));
        if (!target) return null;
        const nameEl = target.querySelector('.author-name') || target.querySelector('.author');
        return nameEl ? nameEl.textContent : null;
      }, runId);
    } catch {}
  }

  const rawDomAuthor = domRes.rawAuthorText || '';
  const parsedAuthor = parsed?.author || '';
  const normalizedAuthorName = normalizedMsg?.author?.name || '';
  const overlayVisibleAuthor = overlayAuthor || normalizedAuthorName;

  // Strict Live Assertion: author.name after parser/model MUST NOT end with presentation colon!
  const authorNameNormalized =
    typeof normalizedAuthorName === 'string' &&
    normalizedAuthorName.length > 0 &&
    !normalizedAuthorName.endsWith(':') &&
    typeof parsedAuthor === 'string' &&
    !parsedAuthor.endsWith(':') &&
    typeof overlayVisibleAuthor === 'string' &&
    !overlayVisibleAuthor.endsWith(':');

  const authorVerification = {
    rawDomAuthorText: rawDomAuthor,
    parserAuthor: parsedAuthor,
    normalizedAuthorName,
    overlayVisibleAuthor,
    authorNameNormalized,
  };

  if (!authorNameNormalized) {
    return {
      status: 'fail',
      error: `Author name contains unnormalized presentation colon: parsed="${parsedAuthor}", normalized="${normalizedAuthorName}", overlay="${overlayVisibleAuthor}"`,
      authorVerification,
      authorNameNormalized: false,
    };
  }

  const role = domRes.hasOwnerStar ? 'streamer' : (domRes.hasModeratorSword ? 'moderator' : 'not-present');
  const domFile = saveScenarioDom('plain', domRes.outerHTML, { artifactDir });
  const screenshots = await captureScenarioScreenshots({
    scenarioName: 'plain',
    artifactDir,
    overlayPage,
    obsService,
    port,
  });

  return {
    status: 'pass',
    message: messageText,
    role,
    domFile,
    screenshots,
    authorVerification,
    authorNameNormalized: true,
    timing: {
      sentAt: sentRes.sentAt,
      boostyDomSeenAt: domRes.seenAt,
    },
    latencyMs: {
      sendToBoostyDom: domRes.seenAt - sentRes.sentAt,
    },
  };
}

/**
 * Scenario 2: Custom Boosty Emoji
 */
async function runEmojiScenario(context) {
  const { adapter, runId, artifactDir, overlayPage, obsService, port } = context;

  console.log('[Scenario 2: Emoji] Opening smile selector via Boosty UI...');
  const openSmileScript = `() => {
    const smileBtn = document.querySelector(
      'button[class*="SmileButton" i], button[class*="smile" i], [class*="SmileButton" i], [class*="smileSelector" i] button, [class*="SmileSelector" i] button, button:has(use[*|href*="icon-smile"])'
    );
    if (!smileBtn) return { ok: false, reason: 'Smile picker button not found in chat publisher' };
    smileBtn.click();
    return { ok: true };
  }`;

  const openRes = adapter.evalInTab(openSmileScript);
  if (!openRes?.ok) {
    console.log(`[Scenario 2: Emoji] SKIPPED: ${openRes?.reason}`);
    return { status: 'skip', reason: openRes?.reason };
  }

  await new Promise(r => setTimeout(r, 800));

  // Select first available custom smile
  const pickSmileScript = `(id) => {
    const smile = document.querySelector('img[data-type="smile"], [class*="smileItem" i] img, [class*="Smile" i] img, [class*="SmilesPopup" i] img');
    if (!smile) return { ok: false, reason: 'No custom Boosty smile found in picker' };

    smile.click();

    // Now type runId text and send
    const input = document.querySelector('.ce-paragraph[contenteditable="true"], textarea, [contenteditable="true"], [class*="editor"]');
    if (input) {
      if (input.isContentEditable) {
        input.focus();
        document.execCommand('insertText', false, ' [QA ' + id + '] smile');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        input.value = (input.value || '') + ' [QA ' + id + '] smile';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    const sendBtn = document.querySelector(
      '[data-test-id="COMMON_PUBLISHER:SEND"], button[data-test-id*="send" i], button[type="submit"], [class*="SendButton" i], [class*="sendButton" i], [class*="sendContainer" i]'
    );
    if (sendBtn && !sendBtn.disabled) {
      const propsKey = Object.keys(sendBtn).find(k => k.startsWith('__reactProps'));
      const props = propsKey ? sendBtn[propsKey] : null;
      if (props?.onClick) {
        props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
      }
      sendBtn.click();
      return { ok: true, sentAt: Date.now() };
    }

    return { ok: false, reason: 'Send button disabled or not found' };
  }`;

  const pickRes = adapter.evalInTab(`(${pickSmileScript})(${JSON.stringify(runId)})`);
  if (!pickRes?.ok) {
    console.log(`[Scenario 2: Emoji] SKIPPED: ${pickRes?.reason}`);
    return { status: 'skip', reason: pickRes?.reason };
  }

  const domRes = await waitForChatMessageInDom(adapter, 'smile', 12000);
  if (!domRes.found) {
    return { status: 'fail', error: 'Custom smile message not found in StreamChat DOM' };
  }

  const domFile = saveScenarioDom('emoji', domRes.outerHTML, { artifactDir });
  const screenshots = await captureScenarioScreenshots({
    scenarioName: 'emoji',
    artifactDir,
    overlayPage,
    obsService,
    port,
  });

  return {
    status: 'pass',
    hasCustomSmileImg: domRes.hasSmileImg,
    domFile,
    screenshots,
    timing: {
      sentAt: pickRes.sentAt,
      boostyDomSeenAt: domRes.seenAt,
    },
  };
}

/**
 * Scenario 3: Reply Message
 */
async function runReplyScenario(context) {
  const { adapter, runId, artifactDir, overlayPage, obsService, port } = context;

  console.log('[Scenario 3: Reply] Finding first message and clicking Reply...');
  const triggerReplyScript = `(id) => {
    const messages = Array.from(document.querySelectorAll(
      '[data-test-id="CHATMESSAGE:root"], [class*="ChatMessage-scss--module_root_"], [class*="ChatMessage_root"], [class*="ChatMessage"]'
    ));
    if (messages.length === 0) return { ok: false, reason: 'No messages found in chat to reply to' };

    const targetMsg = messages[messages.length - 1];

    // Hover message to reveal buttons
    targetMsg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    targetMsg.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    // Find reply button on message
    const replyBtn = targetMsg.querySelector(
      'button:has(use[*|href*="reply" i]), button:has(use[*|href*="answer" i]), button:has(use[*|href*="quote" i]), button[class*="reply" i], [class*="buttons"] button:not(:has(use[*|href*="trash"]))'
    );
    if (replyBtn) {
      replyBtn.click();
    } else {
      return { ok: false, reason: 'Reply button not available for this message in StreamChat' };
    }

    // Type reply text
    const replyText = '[QA ' + id + '] reply to plain';
    const input = document.querySelector('.ce-paragraph[contenteditable="true"], textarea, [contenteditable="true"], [class*="editor"]');
    if (!input) return { ok: false, reason: 'Chat input element not found' };

    if (input.isContentEditable) {
      input.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, replyText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      input.value = replyText;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const sendBtn = document.querySelector(
      '[data-test-id="COMMON_PUBLISHER:SEND"], button[data-test-id*="send" i], button[type="submit"], [class*="SendButton" i], [class*="sendButton" i], [class*="sendContainer" i]'
    );
    if (sendBtn && !sendBtn.disabled) {
      const propsKey = Object.keys(sendBtn).find(k => k.startsWith('__reactProps'));
      const props = propsKey ? sendBtn[propsKey] : null;
      if (props?.onClick) {
        props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
      }
      sendBtn.click();
      return { ok: true, sentAt: Date.now() };
    }

    return { ok: false, reason: 'Send button disabled or not found' };
  }`;

  const replyRes = adapter.evalInTab(`(${triggerReplyScript})(${JSON.stringify(runId)})`);
  if (!replyRes?.ok) {
    console.log(`[Scenario 3: Reply] SKIPPED: ${replyRes?.reason}`);
    return { status: 'skip', reason: replyRes?.reason };
  }

  const domRes = await waitForChatMessageInDom(adapter, 'reply to plain', 12000);
  if (!domRes.found) {
    return { status: 'fail', error: 'Reply message not found in StreamChat DOM' };
  }

  const domFile = saveScenarioDom('reply', domRes.outerHTML, { artifactDir });
  const screenshots = await captureScenarioScreenshots({
    scenarioName: 'reply',
    artifactDir,
    overlayPage,
    obsService,
    port,
  });

  return {
    status: 'pass',
    hasReplyQuote: domRes.hasReplyQuote,
    domFile,
    screenshots,
    timing: {
      sentAt: replyRes.sentAt,
      boostyDomSeenAt: domRes.seenAt,
    },
  };
}

/**
 * Scenario 4: User Mention
 */
async function runMentionScenario(context) {
  const { adapter, runId, artifactDir, overlayPage, obsService, port } = context;

  console.log('[Scenario 4: Mention] Testing @mention in chat...');
  const triggerMentionScript = `(id) => {
    const input = document.querySelector('.ce-paragraph[contenteditable="true"], textarea, [contenteditable="true"], [class*="editor"]');
    if (!input) return { ok: false, reason: 'Chat input not found' };

    input.focus();
    if (input.isContentEditable) {
      document.execCommand('insertText', false, '@');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.value = '@';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Check for autocomplete dropdown
    const dropdown = document.querySelector('[class*="Mention" i], [class*="mention" i], [class*="suggest" i]');
    if (!dropdown) {
      return { ok: false, reason: 'Mention autocomplete dropdown did not appear for @ in StreamChat' };
    }

    // Select first mention item if available
    const item = dropdown.querySelector('[role="option"], [class*="item" i], div');
    if (item) {
      item.click();
    }

    const sendBtn = document.querySelector('button[type="submit"], [class*="send" i] button');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      return { ok: true, sentAt: Date.now() };
    }

    return { ok: false, reason: 'Could not send mention message' };
  }`;

  const mentionRes = adapter.evalInTab(`(${triggerMentionScript})(${JSON.stringify(runId)})`);
  if (!mentionRes?.ok) {
    console.log(`[Scenario 4: Mention] SKIPPED: ${mentionRes?.reason}`);
    return { status: 'skip', reason: mentionRes?.reason };
  }

  const domRes = await waitForChatMessageInDom(adapter, 'mention', 12000);
  if (!domRes.found) {
    return { status: 'fail', error: 'Mention message not found in StreamChat DOM' };
  }

  const domFile = saveScenarioDom('mention', domRes.outerHTML, { artifactDir });
  const screenshots = await captureScenarioScreenshots({
    scenarioName: 'mention',
    artifactDir,
    overlayPage,
    obsService,
    port,
  });

  return {
    status: 'pass',
    hasMentionSpan: domRes.hasMentionSpan,
    domFile,
    screenshots,
  };
}

/**
 * Scenario 5: Long Message
 */
async function runLongMessageScenario(context) {
  const { adapter, runId, artifactDir, overlayPage, obsService, port } = context;
  const longText = `[QA ${runId}] Long text testing layout wrapping and overflow stability in overlay and OBS Studio browser source rendering: проверка отображения длинного текста с кириллицей и эмодзи на нескольких строках подряд без выпадения из карточки! Дополнительный текст для проверки безопасного переноса.`;

  console.log(`[Scenario 5: Long Message] Sending ${longText.length} characters...`);
  const sentRes = await adapter.sendMessageViaUi(runId, longText, { allowSyntheticFallback: false, timeoutMs: 30000 });
  if (!sentRes.ok) {
    return { status: 'fail', error: `UI send failed: ${sentRes.error}` };
  }

  const domRes = await waitForChatMessageInDom(adapter, 'overflow stability', 30000);
  if (!domRes.found) {
    return { status: 'fail', error: 'Long message not found in StreamChat DOM' };
  }

  const domFile = saveScenarioDom('long-message', domRes.outerHTML, { artifactDir });
  const screenshots = await captureScenarioScreenshots({
    scenarioName: 'long-message',
    artifactDir,
    overlayPage,
    obsService,
    port,
  });

  return {
    status: 'pass',
    length: longText.length,
    domFile,
    screenshots,
    timing: {
      sentAt: sentRes.sentAt,
      boostyDomSeenAt: domRes.seenAt,
    },
    latencyMs: {
      sendToBoostyDom: domRes.seenAt - sentRes.sentAt,
    },
  };
}

module.exports = {
  runPlainScenario,
  runEmojiScenario,
  runReplyScenario,
  runMentionScenario,
  runLongMessageScenario,
};
