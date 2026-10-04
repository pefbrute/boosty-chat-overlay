'use strict';

const { execFileSync } = require('node:child_process');

/**
 * Executes a playwright-cli command safely.
 *
 * @param {Array<string>} args
 * @param {object} [options]
 * @returns {string}
 */
function runPlaywrightCli(args, options = {}) {
  const env = { ...process.env, ...options.env };
  try {
    return execFileSync('playwright-cli', args, {
      env,
      encoding: 'utf8',
      timeout: options.timeout || 25000,
    });
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : '';
    const stderr = error.stderr ? String(error.stderr) : '';
    const combined = `${stderr}\n${stdout}`.trim() || error.message;
    const err = new Error(`playwright-cli error (${args.join(' ')}): ${combined}`);
    err.code = error.status;
    throw err;
  }
}

/**
 * Browser adapter for live Brave/Chrome instance via Playwright Extension.
 */
class LiveBrowserAdapter {
  constructor(options = {}) {
    this.session = options.session || 'brave';
    this.attached = false;
    this.targetTabId = null;
  }

  /**
   * Attaches to the existing browser session without restarting the browser.
   */
  async attach() {
    try {
      runPlaywrightCli(['attach', '--extension=chrome', `-s=${this.session}`], { timeout: 15000 });
      this.attached = true;
      return { ok: true };
    } catch (err) {
      this.attached = false;
      return { ok: false, error: err.message };
    }
  }

  /**
   * Safely detaches from the browser without closing any user tabs or browser windows.
   */
  async detach() {
    if (!this.attached) return;
    try {
      runPlaywrightCli([`-s=${this.session}`, 'detach'], { timeout: 8000 });
    } catch {} finally {
      this.attached = false;
    }
  }

  /**
   * Evaluates a script inside the currently selected tab.
   * Auto-recovers and re-attaches if session was momentarily interrupted.
   *
   * @param {string} script Function string or expression
   * @param {object} [options]
   * @returns {any}
   */
  evalInTab(script, options = {}) {
    const retries = options.retries ?? 2;
    for (let i = 0; i <= retries; i++) {
      try {
        const raw = runPlaywrightCli([`-s=${this.session}`, '--raw', 'eval', script], { timeout: options.timeout || 20000 });
        try {
          return JSON.parse(raw);
        } catch {
          return raw.trim();
        }
      } catch (err) {
        if (i === retries) throw err;
        if (err.message.includes('not open') || err.message.includes('Session closed') || err.message.includes('Target closed')) {
          try {
            runPlaywrightCli(['attach', '--extension=chrome', `-s=${this.session}`], { timeout: 15000 });
            runPlaywrightCli([`-s=${this.session}`, 'tab-select', '1']);
          } catch {}
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
      }
    }
  }

  /**
   * Selects tab 0 (Welcome tab) and queries all open tabs.
   *
   * @returns {Promise<Array<object>>}
   */
  async getAllBrowserTabs() {
    runPlaywrightCli([`-s=${this.session}`, 'tab-select', '0']);
    const script = `async () => {
      const res = await chrome.runtime.sendMessage({ type: "getTabs" });
      return res?.tabs || [];
    }`;
    return this.evalInTab(script);
  }

  /**
   * Finds or navigates a tab to the target Boosty URL and groups it into the session.
   *
   * @param {string} [targetUrl]
   * @returns {Promise<{ ok: boolean, tabId?: number, url?: string, title?: string, error?: string }>}
   */
  async locateOrOpenBoostyTab(targetUrl) {
    const tabs = await this.getAllBrowserTabs();

    let targetTab = null;
    if (targetUrl) {
      const cleanTarget = targetUrl.replace(/\/$/, '').toLowerCase();
      targetTab = tabs.find(t => t.url && t.url.replace(/\/$/, '').toLowerCase() === cleanTarget);
      if (!targetTab) {
        targetTab = tabs.find(t => t.url && t.url.toLowerCase().startsWith(cleanTarget));
      }
      if (!targetTab) {
        // Open tab-new with the explicit URL
        runPlaywrightCli([`-s=${this.session}`, 'tab-new', targetUrl], { timeout: 20000 });
        const refreshed = await this.getAllBrowserTabs();
        targetTab = refreshed.find(t => t.url && t.url.toLowerCase().startsWith(targetUrl.toLowerCase())) || refreshed[refreshed.length - 1];
      }
    } else {
      // Auto-detect open Boosty stream tab or fallback to any Boosty tab
      const streamTab = tabs.find(t => t.url && t.url.includes('boosty.to') && t.url.includes('/streams/'));
      targetTab = streamTab || tabs.find(t => t.url && t.url.includes('boosty.to'));
    }

    if (!targetTab) {
      return {
        ok: false,
        error: 'No active Boosty tab found in browser and BOOSTY_LIVE_QA_URL is not set.',
      };
    }

    this.targetTabId = targetTab.id;

    // Group target tab into the session
    const groupScript = `async () => {
      const all = await chrome.runtime.sendMessage({ type: "getTabs" });
      const current = all.tabs.find(t => t.id === all.currentTabId);
      await chrome.tabs.group({ groupId: current.groupId, tabIds: [${targetTab.id}] });
      return { ok: true };
    }`;
    this.evalInTab(groupScript);

    // Find index of target tab in session tab-list
    const tabListRaw = runPlaywrightCli([`-s=${this.session}`, 'tab-list']);
    const lines = tabListRaw.split('\n');
    let targetIndex = 1;
    for (const line of lines) {
      if ((targetTab.url && line.includes(targetTab.url)) || (targetTab.title && line.includes(targetTab.title))) {
        const match = line.match(/^[-*]\s*(\d+):/);
        if (match) {
          targetIndex = Number(match[1]);
          break;
        }
      }
    }

    runPlaywrightCli([`-s=${this.session}`, 'tab-select', String(targetIndex)]);

    return {
      ok: true,
      tabId: targetTab.id,
      url: targetTab.url,
      title: targetTab.title,
    };
  }

  /**
   * Checks authorization status on the current page.
   *
   * @returns {object}
   */
  checkAuthStatus() {
    const script = `() => {
      const bodyText = document.body ? document.body.innerText : '';
      const isLoginPrompt = bodyText.includes('Log in') && bodyText.includes('Sign up') && !bodyText.includes('My page');
      const hasMyPage = Boolean(document.querySelector('a[href*="/beautiful_foot"], a[href^="/"][class*="avatar"], [class*="Header_profile"]'));
      const hasAvatar = Boolean(document.querySelector('[class*="Avatar"], [data-test-id*="avatar"]'));
      return {
        authorized: !isLoginPrompt && (hasMyPage || hasAvatar || bodyText.includes('My subscriptions') || bodyText.includes('My page')),
        hasLoginPrompt: isLoginPrompt,
      };
    }`;
    return this.evalInTab(script);
  }

  /**
   * Detects whether StreamChat container and input elements exist on page.
   *
   * @returns {object}
   */
  detectStreamChat() {
    const script = `() => {
      const chatContainer = document.querySelector(
        '[data-test-id="CHAT:messages"], [class*="ChatBoxBase"], [class*="Chat_messages"], [class*="chat-messages"], [class*="ChatMessage"]'
      );
      const inputEl = document.querySelector(
        'textarea, [contenteditable="true"], [data-test-id*="input"], [class*="chatInput"], [class*="ChatBoxBase"] textarea'
      );
      const sendBtn = document.querySelector(
        'button[data-test-id*="send"], button[type="submit"], [class*="SendButton"], [class*="sendButton"]'
      );
      return {
        hasChat: Boolean(chatContainer),
        hasInput: Boolean(inputEl),
        hasSendButton: Boolean(sendBtn),
        inputTagName: inputEl ? inputEl.tagName : null,
      };
    }`;
    return this.evalInTab(script);
  }

  /**
   * Sends a QA message through the Boosty chat UI and waits for it to appear in DOM.
   * Strict real-stream-chat by default; synthetic DOM mounting is only used if explicitly allowed.
   *
   * @param {string} runId
   * @param {string} fullMessageText
   * @param {object} [options]
   * @param {number} [options.timeoutMs=15000]
   * @param {boolean} [options.allowSyntheticFallback=false]
   * @returns {Promise<{ ok: boolean, provenance: 'real-stream-chat'|'synthetic-dom'|'unknown', method?: string, sentAt?: number, boostyDomSeenAt?: number, rawDomHtml?: string, error?: string }>}
   */
  async sendMessageViaUi(runId, fullMessageText, options = {}) {
    const timeoutMs = typeof options === 'number' ? options : (options?.timeoutMs || 15000);
    const allowSyntheticFallback = Boolean(typeof options === 'object' && options?.allowSyntheticFallback);

    const sendScript = `async (text, id, allowSynthetic) => {
      const input = document.querySelector('.ce-paragraph[contenteditable="true"], textarea, [contenteditable="true"], [data-test-id*="input"], [class*="chatInput"], [class*="ChatBoxBase"] textarea');
      const now = Date.now();

      if (input) {
        input.focus();
        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
          const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(input, text);
          } else {
            input.value = text;
          }
          input.dispatchEvent(new Event('beforeinput', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (input.isContentEditable) {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(input);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('insertText', false, text);
          input.dispatchEvent(new Event('beforeinput', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Wait up to 2.5s for React send button to become enabled
        for (let attempt = 0; attempt < 12; attempt++) {
          await new Promise(r => setTimeout(r, 200));
          const sendBtn = document.querySelector(
            '[data-test-id="COMMON_PUBLISHER:SEND"], button[data-test-id*="send" i], button[type="submit"], [class*="SendButton" i], [class*="sendButton" i], [class*="sendContainer" i]'
          );
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return { ok: true, provenance: 'real-stream-chat', method: 'click_button', sentAt: now };
          }
        }

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return { ok: true, provenance: 'real-stream-chat', method: 'enter_key', sentAt: now };
      }

      if (!allowSynthetic) {
        return {
          ok: false,
          provenance: 'unknown',
          error: 'No real StreamChat input element (textarea / contenteditable) found on target Boosty page',
        };
      }

      // Diagnostic synthetic DOM fallback
      const root = document.createElement('div');
      root.setAttribute('data-test-id', 'CHATMESSAGE:root');
      root.className = 'ChatMessage-scss--module_root_T1qVW ChatBoxBase-scss--module_message_lWMhc';
      root.innerHTML = \`
        <div class="ChatMessage-scss--module_body_r992W">
          <div class="ChatMessage-scss--module_publishTime_cvz-1">12:00</div>
          <div class="ChatMessage-scss--module_authorContainer_w-1K-">
            <div class="Avatar-scss--module_root_f257B ChatMessage-scss--module_avatar_bb-O5" data-test-id="AVATAR:ROOT"></div>
            <span class="ChatMessage-scss--module_name_dxAEt" data-test-id="CHATMESSAGE:author">QA_User:</span>
          </div>
          <span class="ChatMessage-scss--module_text_f16-k" data-test-id="CHATMESSAGE:message">
            <div>
              <div class="BlockRenderer-scss--module_root">
                <span class="BlockRenderer-scss--module_markup">\${text}</span>
              </div>
            </div>
          </span>
        </div>
      \`;
      document.body.appendChild(root);
      return { ok: true, provenance: 'synthetic-dom', method: 'live_dom_mount', sentAt: now };
    }`;

    const sendRes = this.evalInTab(`(${sendScript})(${JSON.stringify(fullMessageText)}, ${JSON.stringify(runId)}, ${JSON.stringify(allowSyntheticFallback)})`);
    if (!sendRes || !sendRes.ok) {
      return {
        ok: false,
        provenance: sendRes?.provenance || 'unknown',
        error: sendRes?.error || 'Failed to submit chat message in UI',
      };
    }

    // Wait for the message in DOM containing runId
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const pollScript = `(id) => {
        const roots = document.querySelectorAll('[data-test-id="CHATMESSAGE:root"], [class*="ChatMessage"]');
        for (const r of roots) {
          if (r.textContent && r.textContent.includes(id)) {
            return { found: true, html: r.outerHTML };
          }
        }
        const allSpans = document.querySelectorAll('[class*="BlockRenderer"]');
        for (const s of allSpans) {
          if (s.textContent && s.textContent.includes(id)) {
            const root = s.closest('[data-test-id="CHATMESSAGE:root"], [class*="ChatMessage"]') || s;
            return { found: true, html: root.outerHTML };
          }
        }
        return { found: false };
      }`;

      const pollRes = this.evalInTab(`(${pollScript})(${JSON.stringify(runId)})`);
      if (pollRes && pollRes.found && pollRes.html) {
        return {
          ok: true,
          provenance: sendRes.provenance,
          method: sendRes.method,
          sentAt: sendRes.sentAt,
          boostyDomSeenAt: Date.now(),
          rawDomHtml: pollRes.html,
        };
      }

      await new Promise(r => setTimeout(r, 600));
    }

    return {
      ok: false,
      provenance: sendRes.provenance,
      error: `Timeout (${timeoutMs}ms) waiting for message with runId ${runId} to appear in Boosty DOM`,
    };
  }
}

module.exports = {
  runPlaywrightCli,
  LiveBrowserAdapter,
};
