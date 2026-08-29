const endpoint = 'http://127.0.0.1:17369/message';
const processed = new WeakSet();
const initialMessages = new WeakSet();

document.querySelectorAll('[data-test-id="CHATMESSAGE:root"]').forEach(root => {
  processed.add(root);
  initialMessages.add(root);
});

function avatarUrl(root) {
  const image = root.querySelector('img');
  if (image?.src) return image.src;

  const avatar = root.querySelector('[class*="Avatar"]');
  if (!avatar) return '';
  const background = getComputedStyle(avatar).backgroundImage;
  const match = background.match(/^url\(["']?(.*?)["']?\)$/);
  return match?.[1] || '';
}

async function forward(root) {
  if (processed.has(root)) return;

  const author = root.querySelector('[data-test-id="CHATMESSAGE:author"]')?.textContent?.trim();
  const text = root.querySelector('[data-test-id="CHATMESSAGE:message"]')?.textContent?.trim();
  if (!author || !text) return;

  processed.add(root);
  const message = {
    author,
    text,
    avatar: avatarUrl(root),
    id: [
      location.pathname,
      root.querySelector('[class*="publishTime"]')?.textContent?.trim() || '',
      author,
      text,
    ].join('|'),
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.info('[Boosty Chat Connector] sent:', message);
  } catch (error) {
    processed.delete(root);
    console.error('[Boosty Chat Connector] local server unavailable:', error);
  }
}

function scan(container = document) {
  if (container instanceof Element) {
    const root = container.matches('[data-test-id="CHATMESSAGE:root"]')
      ? container
      : container.closest('[data-test-id="CHATMESSAGE:root"]');
    if (root) setTimeout(() => forward(root), 50);
  }
  container.querySelectorAll?.('[data-test-id="CHATMESSAGE:root"]').forEach(root => {
    setTimeout(() => forward(root), 50);
  });
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) scan(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
console.info('[Boosty Chat Connector] active');

async function heartbeat() {
  try {
    await fetch('http://127.0.0.1:17369/connector', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'content_tab', url: location.href, timestamp: Date.now() }),
    });
  } catch {
    // The desktop application is not running yet.
  }
}

heartbeat();
setInterval(heartbeat, 5_000);
