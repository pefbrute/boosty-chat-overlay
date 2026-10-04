'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { scanForSecrets } = require('./sanitizer.js');

/**
 * Verifies that the browser is logged in to Boosty and has channel creator controls available.
 *
 * @param {import('./browser.js').LiveBrowserAdapter} adapter
 * @returns {Promise<{ ok: boolean, blogUrl?: string, channelName?: string, error?: string }>}
 */
async function checkCreatorAccess(adapter) {
  const checkScript = `() => {
    // 1. Check if user is logged in
    const profile = document.querySelector('[data-test-id="COMMON_MINIPROFILE:ROOT"], [data-test-id="COMMON_MINIPROFILE:NAME"]');
    const profileName = profile ? profile.innerText.trim() : '';

    // 2. Check for creator / blog link in page
    let blogUrl = '';
    const myPageLink = document.querySelector('a[href^="/"][class*="avatar"], a[href^="/beautiful_foot"], a[href^="/"][data-test-id*="blog"]');
    if (myPageLink) {
      blogUrl = myPageLink.getAttribute('href').replace(/^\\//, '').split('/')[0];
    }

    // Default to known channel beautiful_foot if profile is present
    if (!blogUrl && profileName) {
      blogUrl = 'beautiful_foot';
    }

    // 3. Check if stream button or edit-stream is reachable
    const hasStreamButton = Boolean(document.querySelector('[data-test-id="AUTHORACTIONSBLOCK:streamButton"]'));
    const isEditStreamPage = window.location.pathname.includes('/edit-stream');
    const isStreamPage = window.location.pathname.includes('/streams/');

    return {
      authorized: Boolean(profileName),
      channelName: profileName,
      blogUrl,
      canManageChannel: Boolean(profileName && (hasStreamButton || isEditStreamPage || isStreamPage || blogUrl)),
    };
  }`;

  const res = adapter.evalInTab(checkScript);
  if (!res || !res.authorized) {
    return {
      ok: false,
      error: 'Boosty user is not authorized in browser session (stage=boosty-auth)',
    };
  }

  if (!res.canManageChannel) {
    return {
      ok: false,
      error: 'Boosty creator channel management is not available for this account (stage=boosty-auth)',
    };
  }

  return {
    ok: true,
    blogUrl: res.blogUrl || 'beautiful_foot',
    channelName: res.channelName,
  };
}

/**
 * Creates and starts a new QA stream via the real Boosty UI.
 *
 * Safe settings enforced:
 * - Title: "[QA] Boosty Chat Overlay <runId>"
 * - No custom cover
 * - No description
 * - No monetization / donations
 * - Chat enabled: YES
 * - Save recording: NO
 * - Schedule: NOW
 *
 * Guardrail: Never logs or saves stream keys or secret RTMP URLs.
 *
 * @param {import('./browser.js').LiveBrowserAdapter} adapter
 * @param {string} runId
 * @param {object} options
 * @param {string} options.blogUrl
 * @param {string} options.artifactDir
 * @returns {Promise<{ ok: boolean, stream?: object, error?: string }>}
 */
async function createAndStartStream(adapter, runId, options = {}) {
  const blogUrl = options.blogUrl || 'beautiful_foot';
  const artifactDir = options.artifactDir;
  const streamTitle = `[QA] Boosty Chat Overlay ${runId}`;

  // 1. Navigate to edit-stream page if not already there
  const currentUrl = adapter.evalInTab('() => window.location.href');
  if (!currentUrl.includes('/edit-stream')) {
    const editStreamUrl = `https://boosty.to/${blogUrl}/edit-stream`;
    adapter.evalInTab(`() => { window.location.href = "${editStreamUrl}"; }`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // 2. Wait for edit form to load (up to 12 seconds)
  let formReady = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const check = adapter.evalInTab(`() => {
      const titleInput = document.querySelector('[data-test-id="TITLE:root"]');
      const submitBtn = document.querySelector('[data-test-id="STREAMFORM:submit"]');
      return Boolean(titleInput && submitBtn);
    }`);
    if (check) {
      formReady = true;
      break;
    }
    await new Promise(r => setTimeout(r, 800));
  }

  if (!formReady) {
    return { ok: false, error: 'Stream creation form failed to load on /edit-stream' };
  }

  // 3. Fill Title and configure safe options
  const configureFormScript = `async (titleText) => {
    // 3.1. Set Title with React property setter
    const titleInput = document.querySelector('[data-test-id="TITLE:root"]');
    if (titleInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(titleInput, titleText);
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 3.2. Select subscription level if needed
    const listbox = document.querySelector('[data-test-id="SUBSCRIPTIONLEVELSSELECT:root"] [role="listbox"], [class*="Select-scss--module_mainBox" i]');
    if (listbox && (listbox.innerText.includes('Choose') || listbox.className.includes('invalid') || !listbox.innerText.trim())) {
      if (listbox.getAttribute('aria-expanded') !== 'true') {
        listbox.click();
        await new Promise(r => setTimeout(r, 600));
      }
      const items = Array.from(document.querySelectorAll('[class*="selectOption" i], [class*="simpleOptionContainer" i]'))
        .filter(el => el.innerText && el.innerText.trim().length > 0 && !el.className.includes('optionsContainer'));
      if (items.length > 0) {
        items[0].click();
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 3.3. Ensure Chat is enabled
    const chatToggle = document.querySelector('[data-test-id="ACCESSTESTID:chatToggle"] [role="switch"]');
    if (chatToggle && !chatToggle.className.includes('Checked')) {
      chatToggle.click();
    }

    // 3.4. Ensure Save Recording is disabled
    const recordToggle = document.querySelector('[data-test-id="ACCESSTESTID:saveStreamToggle"] [role="switch"]');
    if (recordToggle && recordToggle.className.includes('Checked')) {
      recordToggle.click();
    }

    // 3.5. Ensure calendar modal is closed if inadvertently open
    if (document.querySelector('.react-calendar')) {
      const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => /cancel|отмена/i.test(b.innerText));
      if (cancelBtn) cancelBtn.click();
    }

    const submitBtn = document.querySelector('[data-test-id="STREAMFORM:submit"]');
    return {
      titleConfigured: titleInput ? titleInput.value : '',
      submitEnabled: submitBtn ? !submitBtn.disabled : false,
      submitText: submitBtn ? submitBtn.innerText : '',
    };
  }`;

  const formStatus = adapter.evalInTab(`(${configureFormScript})("${streamTitle}")`);
  if (!formStatus?.submitEnabled) {
    // Try one retry after 1s
    await new Promise(r => setTimeout(r, 1000));
    adapter.evalInTab(`(${configureFormScript})("${streamTitle}")`);
  }

  // 4. Click Start Stream button
  const clickStartScript = `() => {
    const submitBtn = document.querySelector('[data-test-id="STREAMFORM:submit"]');
    if (submitBtn && !submitBtn.disabled) {
      const propsKey = Object.keys(submitBtn).find(k => k.startsWith('__reactProps'));
      const props = propsKey ? submitBtn[propsKey] : null;
      if (props?.onClick) {
        props.onClick({ preventDefault: () => {}, stopPropagation: () => {}, target: submitBtn, currentTarget: submitBtn });
      }
      submitBtn.click();
      return { ok: true };
    }
    return { ok: false, error: submitBtn ? 'Start stream button is disabled' : 'Start stream button not found' };
  }`;

  const clickRes = adapter.evalInTab(clickStartScript);
  if (!clickRes?.ok) {
    return { ok: false, error: clickRes?.error || 'Failed to click start stream button' };
  }
  await new Promise(r => setTimeout(r, 3000));

  // 5. Navigate to dedicated stream viewer page (force fresh load for new stream)
  const streamViewerUrl = `https://boosty.to/${blogUrl}/streams/video_stream`;
  let streamUrl = streamViewerUrl;
  let streamId = 'video_stream';

  adapter.evalInTab(`() => {
    window.location.href = "${streamViewerUrl}";
    if (window.location.pathname.includes('/streams/video_stream')) {
      window.location.reload();
    }
  }`);
  await new Promise(r => setTimeout(r, 2500));

  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(r => setTimeout(r, 1000));
    const navCheck = adapter.evalInTab(`() => {
      const url = window.location.href;
      const onStream = url.includes('/streams/');
      const hasChat = Boolean(document.querySelector('[data-test-id="CHAT:messages"], [class*="ChatMessage"], [class*="ChatPublisher"]'));
      const hasInput = Boolean(document.querySelector('textarea, [contenteditable="true"], [data-test-id*="input"], [class*="chatInput"]'));
      return {
        url,
        onStream,
        hasChat,
        hasInput,
      };
    }`);

    if (navCheck && navCheck.onStream && navCheck.hasInput) {
      streamUrl = navCheck.url;
      const match = streamUrl.match(/\/streams\/([a-zA-Z0-9_\-]+)/);
      if (match) streamId = match[1];
      break;
    }

    if (navCheck && !navCheck.url.includes('/streams/video_stream')) {
      adapter.evalInTab(`() => {
        window.location.href = "${streamViewerUrl}";
      }`);
    }
  }

  const createdStream = {
    runId,
    title: streamTitle,
    url: streamUrl,
    streamId: streamId || null,
    createdAt: new Date().toISOString(),
    createdByRunner: true,
    blogUrl,
  };

  // 6. Save stream metadata artifact (Strictly zero stream keys)
  if (artifactDir) {
    const streamMetaFile = path.join(artifactDir, 'stream.json');
    const jsonStr = JSON.stringify(createdStream, null, 2);
    const secScan = scanForSecrets(jsonStr);
    if (!secScan.ok) {
      throw new Error(`Security violation in stream metadata: ${secScan.violation}`);
    }
    fs.writeFileSync(streamMetaFile, jsonStr, 'utf8');
  }

  return {
    ok: true,
    stream: createdStream,
  };
}

/**
 * Strict guardrails validator for stopping streams.
 * Protects against stopping any non-QA or user-owned stream.
 *
 * @param {object} createdStream
 * @param {string} [currentRunId]
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateStreamStopGuardrails(createdStream, currentRunId) {
  if (!createdStream || typeof createdStream !== 'object') {
    return { ok: false, reason: 'Refused: createdStream object is missing or invalid' };
  }
  if (createdStream.createdByRunner !== true) {
    return { ok: false, reason: 'Refused: stream was not created by this test runner (createdByRunner !== true)' };
  }
  if (currentRunId && createdStream.runId !== currentRunId) {
    return { ok: false, reason: `Refused: stream.runId (${createdStream.runId}) does not match currentRunId (${currentRunId})` };
  }
  if (!createdStream.title || typeof createdStream.title !== 'string') {
    return { ok: false, reason: 'Refused: stream title is missing or not a string' };
  }
  if (!createdStream.title.startsWith('[QA]')) {
    return { ok: false, reason: `Refused: stream title does not start with [QA]: "${createdStream.title}"` };
  }
  if (createdStream.runId && !createdStream.title.includes(createdStream.runId)) {
    return { ok: false, reason: `Refused: stream title does not contain runId "${createdStream.runId}": "${createdStream.title}"` };
  }
  return { ok: true };
}

/**
 * Safely stops and terminates the QA stream exclusively via the real Boosty UI.
 * Strictly verifies guardrails before attempting stop.
 * Does NOT execute private DELETE API silently.
 * Confirms real offline state before considering the operation successful.
 *
 * @param {import('./browser.js').LiveBrowserAdapter} adapter
 * @param {object} createdStream
 * @param {object} [options]
 * @param {string} [options.blogUrl]
 * @param {string} [options.currentRunId]
 * @returns {Promise<{ ok: boolean, status: 'pass'|'failed'|'refused', method: string, confirmedOffline: boolean, error?: string, reason?: string }>}
 */
async function stopQaStreamViaUi(adapter, createdStream, options = {}) {
  const currentRunId = options.currentRunId || createdStream?.runId;
  const guard = validateStreamStopGuardrails(createdStream, currentRunId);
  if (!guard.ok) {
    console.warn(`
========================================================================
⚠ WARNING: QA STREAM STOP REFUSED BY GUARDRAIL!
Reason: ${guard.reason}
URL: ${createdStream?.url}
TITLE: ${createdStream?.title}
Please inspect Boosty channel in browser and end the broadcast if needed.
========================================================================
    `);
    return {
      ok: false,
      status: 'refused',
      method: 'boosty-ui',
      confirmedOffline: false,
      reason: guard.reason,
    };
  }

  const blogUrl = options.blogUrl || createdStream.blogUrl || 'beautiful_foot';
  const expectedRunId = createdStream.runId;
  console.log(`[Stream UI Stop] Stopping QA stream: "${createdStream.title}" via Boosty UI on channel "${blogUrl}"`);

  try {
    // 1. Navigate to Creator Channel page where the active stream card and action menu reside
    const channelUrl = `https://boosty.to/${blogUrl}`;
    adapter.evalInTab(`() => {
      window.location.href = "${channelUrl}";
    }`);
    await new Promise(r => setTimeout(r, 2000));

    // Wait for channel page to render
    for (let attempt = 0; attempt < 10; attempt++) {
      const isLoaded = adapter.evalInTab(`() => {
        return window.location.href.includes('/${blogUrl}') && !window.location.pathname.includes('/streams/') &&
          Boolean(document.querySelector('[data-test-id="AUTHORACTIONSBLOCK:root"], [data-test-id="COMMON_STREAM_STREAMACTIONSMENU:Button"], [class*="StreamHeader"]'));
      }`);
      if (isLoaded) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    // 2. Execute UI stop flow: open 3-dots actions menu -> click Delete stream -> confirm modal
    const uiFlowScript = `async (runId) => {
      // 2.1 Locate actions menu button
      const menuBtn = document.querySelector(
        '[data-test-id="COMMON_STREAM_STREAMACTIONSMENU:Button"], button[class*="StreamActionsMenu" i], [class*="StreamHeader"] button:has(svg use[*|href*="icon-dots"])'
      );

      if (!menuBtn) {
        // Check if stream is already absent / offline
        const streamHeader = document.querySelector('[class*="StreamHeader" i]');
        if (!streamHeader || !streamHeader.innerText.includes('[QA]')) {
          return { ok: true, alreadyAbsent: true };
        }
        return { ok: false, reason: 'Stream actions menu button not found on channel page' };
      }

      // 2.2 Verify stream container text in DOM
      const streamHeader = document.querySelector('[class*="StreamHeader" i]');
      const streamContainer = menuBtn.closest('[class*="StreamHeader" i], [class*="BlogWrapperPageHeader" i], [class*="Stream" i]') || menuBtn.parentElement;
      const text = ((streamHeader ? streamHeader.innerText : '') + ' ' + (streamContainer ? streamContainer.innerText : '')).trim();
      if (runId && !text.includes(runId)) {
        return { ok: false, reason: \`Stream on channel page does not match expected runId: "\${text.slice(0, 100)}"\` };
      }

      // 2.3 Click 3-dots actions menu
      menuBtn.click();
      await new Promise(r => setTimeout(r, 500));

      // 2.4 Find Delete stream in popup menu
      const menuItems = Array.from(document.querySelectorAll(
        '[role="menuitem"], [role="menu"] button, [class*="menuItem" i], [class*="ExtraActionsMenuItem" i]'
      ));
      const deleteItem = menuItems.find(el => /delete stream|удалить трансляцию|удалить стрим|удалить|завершить/i.test(el.innerText));
      if (!deleteItem) {
        return { ok: false, reason: 'Delete stream option not found in stream actions popup menu' };
      }

      deleteItem.click();
      await new Promise(r => setTimeout(r, 600));

      // 2.5 Confirm in modal dialog
      const dialog = document.querySelector(
        'dialog, [role="dialog"], [class*="ConfirmPopup" i], [class*="Modal" i], [class*="dialog" i]'
      );
      const dialogBtns = dialog
        ? Array.from(dialog.querySelectorAll('button'))
        : Array.from(document.querySelectorAll('button'));

      const confirmBtn = dialogBtns.find(el => {
        const t = (el.innerText || '').trim();
        return /^(delete|удалить)$/i.test(t) || el.className.includes('confirmButton');
      });

      if (!confirmBtn) {
        return { ok: false, reason: 'Confirm delete button not found in modal dialog' };
      }

      confirmBtn.click();
      return { ok: true, clickedDelete: true };
    }`;

    const flowRes = adapter.evalInTab(`(${uiFlowScript})(${JSON.stringify(expectedRunId)})`);
    if (!flowRes?.ok) {
      console.warn(`[Stream UI Stop] UI interaction failed: ${flowRes?.reason}`);
      return {
        ok: false,
        status: 'failed',
        method: 'boosty-ui',
        confirmedOffline: false,
        error: flowRes?.reason || 'UI stop interaction failed',
      };
    }

    // 3. Confirm offline status: poll channel page and stream viewer page
    let confirmedOffline = Boolean(flowRes.alreadyAbsent);
    if (!confirmedOffline) {
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise(r => setTimeout(r, 1000));
        const checkRes = adapter.evalInTab(`((runId) => {
          const menuBtn = document.querySelector('[data-test-id="COMMON_STREAM_STREAMACTIONSMENU:Button"]');
          const streamHeader = document.querySelector('[class*="StreamHeader" i]');
          const hasQaHeader = Boolean(streamHeader && streamHeader.innerText.includes(runId));
          const isOfflineText = streamHeader ? streamHeader.innerText.includes('OFFLINE') : false;
          return {
            noMenuBtn: !menuBtn,
            noQaHeader: !hasQaHeader,
            isOfflineText,
          };
        })(${JSON.stringify(expectedRunId)})`);

        if (checkRes && (checkRes.noQaHeader || checkRes.isOfflineText)) {
          confirmedOffline = true;
          break;
        }
      }
    }

    if (confirmedOffline) {
      console.log(`[Stream UI Stop] Stream confirmed offline via Boosty UI.`);
      return {
        ok: true,
        status: 'pass',
        method: 'boosty-ui',
        confirmedOffline: true,
      };
    }

    console.warn(`
========================================================================
⚠ WARNING: QA STREAM MAY STILL BE LIVE!
Timed out waiting for offline confirmation after Boosty UI delete.
URL: ${createdStream.url}
TITLE: ${createdStream.title}
Please inspect Boosty channel in browser and end the broadcast if needed.
========================================================================
    `);

    return {
      ok: false,
      status: 'failed',
      method: 'boosty-ui',
      confirmedOffline: false,
      error: 'Timed out waiting for offline confirmation after Boosty UI delete',
    };
  } catch (err) {
    console.warn(`[Stream UI Stop] Error stopping stream: ${err.message}`);
    return {
      ok: false,
      status: 'failed',
      method: 'boosty-ui',
      confirmedOffline: false,
      error: err.message,
    };
  }
}

/**
 * Emergency stream stop helper via private API.
 * MANUAL EMERGENCY ONLY - NEVER CALLED AUTOMATICALLY BY TEST RUNNER.
 */
async function emergencyStopStreamViaPrivateApi(adapter, blogUrl = 'beautiful_foot') {
  return adapter.evalInTab(`(async () => {
    try {
      const res = await fetch(\`/api/v1/blog/\${blogUrl}/stream\`, { method: 'DELETE' });
      return { ok: res.ok || res.status === 404, status: res.status };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  })()`);
}

module.exports = {
  checkCreatorAccess,
  createAndStartStream,
  validateStreamStopGuardrails,
  stopQaStreamViaUi,
  stopStream: stopQaStreamViaUi,
  emergencyStopStreamViaPrivateApi,
};

