const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

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
          <div id="video-player"><div class="timecode">00:00:00</div></div>
          <div id="chat-sidebar">
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

  const recoveryResults = await win.webContents.executeJavaScript(`
    new Promise(async (resolve) => {
      function createMessageElement(author, text) {
        const root = document.createElement('div');
        root.setAttribute('data-test-id', 'CHATMESSAGE:root');
        const a = document.createElement('span');
        a.setAttribute('data-test-id', 'CHATMESSAGE:author');
        a.textContent = author;
        const t = document.createElement('span');
        t.setAttribute('data-test-id', 'CHATMESSAGE:message');
        t.textContent = text;
        root.append(a, t);
        return root;
      }

      const received = [];
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
          received.push({ author, text });
        }
      }

      function findChatContainer() {
        const sample = document.querySelector('[data-test-id="CHATMESSAGE:root"]');
        if (sample) return sample.parentElement;
        return document.querySelector('#chat-messages-container, [data-test-id="CHAT:messages"], [class*="Chat_messages"]');
      }

      function processMessageNode(node) {
        if (!(node instanceof Element)) return;
        if (node.matches('[data-test-id="CHATMESSAGE:root"]')) {
          forwardAfter(node);
          return;
        }
        const roots = node.querySelectorAll('[data-test-id="CHATMESSAGE:root"]');
        for (const root of roots) {
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

      // 1. Initial attach
      startDiscovery();

      // 2. Send 5 messages into initial container
      const container1 = document.querySelector('#chat-messages-container');
      for (let i = 1; i <= 5; i++) {
        container1.append(createMessageElement('User_' + i, 'Msg ' + i));
      }
      await new Promise(r => setTimeout(r, 40));
      const countPhase1 = received.length;

      // 3. Simulate SPA navigation / Chat container destruction
      container1.remove();
      detachChatObserver();
      startDiscovery();
      const isReDiscovering = (discoveryObserver !== null);

      // 4. Create new chat container in DOM
      const sidebar = document.querySelector('#chat-sidebar');
      const newContainer = document.createElement('div');
      newContainer.id = 'chat-messages-container-recreated';
      newContainer.className = 'chat-messages';
      sidebar.append(newContainer);

      await new Promise(r => setTimeout(r, 40));

      // 5. Send 5 messages into the new container
      for (let i = 6; i <= 10; i++) {
        newContainer.append(createMessageElement('User_' + i, 'Msg ' + i));
      }
      await new Promise(r => setTimeout(r, 40));

      const countPhase2 = received.length;

      resolve({
        countPhase1,
        isReDiscovering,
        countPhase2,
        allMessagesReceived: received.length === 10,
        received
      });
    });
  `);

  console.log('=== SPA RECONNECTION / SELF-HEALING TEST ===');
  console.log(JSON.stringify(recoveryResults, null, 2));

  win.destroy();
  app.quit();
});
