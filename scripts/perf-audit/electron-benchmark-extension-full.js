const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
  });

  const html = `
    <!doctype html>
    <html>
      <body>
        <div id="app">
          <div id="video-player">
            <div class="timecode">00:00:00</div>
            <div class="progress-bar"><div class="fill" style="width: 0%;"></div></div>
          </div>
          <div id="donations-ticker"><div class="alert">User donated 100 RUB</div></div>
          <div id="reactions-container"></div>
          <div id="chat-sidebar">
            <div class="chat-header">Live Chat</div>
            <div id="chat-messages-container" class="chat-messages">
              <div data-test-id="CHATMESSAGE:root">
                <span data-test-id="CHATMESSAGE:author">InitUser</span>
                <span data-test-id="CHATMESSAGE:message">Initial message</span>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const results = await win.webContents.executeJavaScript(`
    new Promise(async (resolve) => {
      function createMessageElement(index) {
        const root = document.createElement('div');
        root.setAttribute('data-test-id', 'CHATMESSAGE:root');
        root.className = 'chat-message-item';

        const author = document.createElement('span');
        author.setAttribute('data-test-id', 'CHATMESSAGE:author');
        author.textContent = 'Viewer_' + index;

        const text = document.createElement('span');
        text.setAttribute('data-test-id', 'CHATMESSAGE:message');
        text.textContent = 'Message text content ' + index;

        root.append(author, text);
        return root;
      }

      function createNoiseElement(index) {
        const reaction = document.createElement('span');
        reaction.className = 'reaction-badge';
        reaction.textContent = '🔥' + index;
        return reaction;
      }

      // ==========================================
      // 1. BENCHMARK BEFORE OPTIMIZATION
      // ==========================================
      let beforeStats = {
        callbacksCount: 0,
        domNodesInspected: 0,
        querySelectorsExecuted: 0,
        messagesForwarded: 0,
        durationMs: 0,
      };

      {
        const processed = new WeakSet();
        document.querySelectorAll('[data-test-id="CHATMESSAGE:root"]').forEach(r => processed.add(r));

        function forwardBefore(root) {
          if (processed.has(root)) return;
          const author = root.querySelector('[data-test-id="CHATMESSAGE:author"]')?.textContent?.trim();
          const text = root.querySelector('[data-test-id="CHATMESSAGE:message"]')?.textContent?.trim();
          if (author && text) {
            processed.add(root);
            beforeStats.messagesForwarded++;
          }
        }

        function scanBefore(container) {
          beforeStats.domNodesInspected++;
          if (container instanceof Element) {
            beforeStats.querySelectorsExecuted += 2;
            const root = container.matches('[data-test-id="CHATMESSAGE:root"]')
              ? container
              : container.closest('[data-test-id="CHATMESSAGE:root"]');
            if (root) forwardBefore(root);
          }
          if (container.querySelectorAll) {
            beforeStats.querySelectorsExecuted++;
            container.querySelectorAll('[data-test-id="CHATMESSAGE:root"]').forEach(root => {
              beforeStats.domNodesInspected++;
              forwardBefore(root);
            });
          }
        }

        const observerBefore = new MutationObserver(records => {
          beforeStats.callbacksCount++;
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node instanceof Element) scanBefore(node);
            }
          }
        });

        observerBefore.observe(document.documentElement, { childList: true, subtree: true });

        const t0 = performance.now();

        // 100 non-chat mutations (player, reactions)
        const reactionsContainer = document.querySelector('#reactions-container');
        const timecode = document.querySelector('.timecode');
        for (let i = 0; i < 100; i++) {
          reactionsContainer.append(createNoiseElement(i));
          timecode.textContent = '00:01:' + (i < 10 ? '0' + i : i);
        }

        // 50 chat messages
        const chatContainer = document.querySelector('#chat-messages-container');
        for (let i = 0; i < 50; i++) {
          chatContainer.append(createMessageElement(i));
        }

        await new Promise(r => setTimeout(r, 60));
        const t1 = performance.now();
        beforeStats.durationMs = (t1 - t0).toFixed(2);
        observerBefore.disconnect();
      }

      // Reset DOM state for fair test
      document.querySelector('#reactions-container').innerHTML = '';
      document.querySelector('#chat-messages-container').innerHTML = '';

      // ==========================================
      // 2. BENCHMARK AFTER OPTIMIZATION (P2)
      // ==========================================
      let afterStats = {
        callbacksCount: 0,
        domNodesInspected: 0,
        querySelectorsExecuted: 0,
        messagesForwarded: 0,
        durationMs: 0,
        nonChatInterference: 0,
      };

      {
        const processed = new WeakSet();
        let currentChatContainer = null;
        let chatObserver = null;
        let discoveryObserver = null;
        let initialLoadDone = false;

        function forwardAfter(root) {
          if (processed.has(root)) return;
          const author = root.querySelector('[data-test-id="CHATMESSAGE:author"]')?.textContent?.trim();
          const text = root.querySelector('[data-test-id="CHATMESSAGE:message"]')?.textContent?.trim();
          if (author && text) {
            processed.add(root);
            afterStats.messagesForwarded++;
          }
        }

        function findChatContainer() {
          const sample = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
          if (sample) return sample.parentElement;
          return document.querySelector('#chat-messages-container, [data-test-id="CHAT:messages"], [class*="Chat_messages"]');
        }

        function processMessageNode(node) {
          if (!(node instanceof Element)) return;
          afterStats.domNodesInspected++;
          afterStats.querySelectorsExecuted++;
          if (node.matches('[data-test-id="CHATMESSAGE:root"]')) {
            forwardAfter(node);
            return;
          }
          afterStats.querySelectorsExecuted++;
          const roots = node.querySelectorAll('[data-test-id="CHATMESSAGE:root"]');
          for (const root of roots) {
            afterStats.domNodesInspected++;
            forwardAfter(root);
          }
        }

        function attachChatObserver(container) {
          if (!container || currentChatContainer === container) return;
          if (chatObserver) chatObserver.disconnect();
          currentChatContainer = container;

          if (!initialLoadDone) {
            container.querySelectorAll('[data-test-id="CHATMESSAGE:root"]').forEach(root => processed.add(root));
            initialLoadDone = true;
          }

          chatObserver = new MutationObserver(records => {
            afterStats.callbacksCount++;
            if (!container.isConnected) {
              detachChatObserver();
              startDiscovery();
              return;
            }
            for (const record of records) {
              for (const node of record.addedNodes) {
                processMessageNode(node);
              }
            }
          });

          chatObserver.observe(container, { childList: true, subtree: true });

          if (discoveryObserver) {
            discoveryObserver.disconnect();
            discoveryObserver = null;
          }
        }

        function detachChatObserver() {
          if (chatObserver) {
            chatObserver.disconnect();
            chatObserver = null;
          }
          currentChatContainer = null;
        }

        function startDiscovery() {
          if (currentChatContainer?.isConnected) return;
          if (discoveryObserver) return;

          const container = findChatContainer();
          if (container) {
            attachChatObserver(container);
            return;
          }

          discoveryObserver = new MutationObserver(records => {
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches('[data-test-id="CHATMESSAGE:root"]') || node.querySelector('[data-test-id="CHATMESSAGE:root"]')) {
                  if (!currentChatContainer) {
                    const found = findChatContainer();
                    if (found) attachChatObserver(found);
                  }
                  processMessageNode(node);
                }
              }
            }
          });

          discoveryObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
        }

        startDiscovery();

        const t0 = performance.now();

        // 100 non-chat mutations (player, reactions)
        const reactionsContainer = document.querySelector('#reactions-container');
        const timecode = document.querySelector('.timecode');
        for (let i = 0; i < 100; i++) {
          reactionsContainer.append(createNoiseElement(i));
          timecode.textContent = '00:01:' + (i < 10 ? '0' + i : i);
        }

        // 50 chat messages
        const chatContainer = document.querySelector('#chat-messages-container');
        for (let i = 0; i < 50; i++) {
          chatContainer.append(createMessageElement(i));
        }

        await new Promise(r => setTimeout(r, 60));
        const t1 = performance.now();
        afterStats.durationMs = (t1 - t0).toFixed(2);
        detachChatObserver();
      }

      resolve({ beforeStats, afterStats });
    });
  `);

  console.log('=== EXTENSION MUTATIONOBSERVER BENCHMARK (P2 BEFORE VS AFTER) ===');
  console.log(JSON.stringify(results, null, 2));

  win.destroy();
  app.quit();
});
