/**
 * Boosty Chat Parser
 * Modular parser for Boosty Chat DOM elements.
 * Compatible with both Browser (extension content script) and Node.js (unit tests).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BoostyParser = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function queryRootElements(scope) {
    if (!scope || typeof scope.querySelectorAll !== "function") return [];
    const roots = scope.querySelectorAll(
      '[data-test-id="CHATMESSAGE:root"], [class*="ChatMessage-scss--module_root"], [class*="ChatMessage_root"], [class*="ChatMessageRoot"], [class*="chat-message-root"]'
    );
    if (roots.length > 0) return roots;

    // Fallback: match elements with ChatMessage that are message roots (not inner icons, buttons, or badges)
    const candidates = scope.querySelectorAll('[data-test-id*="CHATMESSAGE"], [class*="ChatMessage"]');
    return Array.from(candidates).filter(el => {
      const cls = String(el.className || "");
      return !cls.includes("button") && !cls.includes("Icon") && !cls.includes("avatar") && !cls.includes("badge") && !cls.includes("tooltip");
    });
  }

  function extractAuthor(root) {
    if (!root || typeof root.querySelector !== "function") return "";

    // 1. Explicit data-test-id
    const byTestId = root.querySelector('[data-test-id="CHATMESSAGE:author"], [data-test-id*="author"]');
    if (byTestId?.textContent?.trim()) return byTestId.textContent.trim();

    // 2. Specific author classes
    const byClass = root.querySelector(
      '[class*="ChatMessage_author"], [class*="ChatMessage__author"], [class*="Author_name"], [class*="authorName"], [class*="author-name"], [class*="Author"], [class*="author"]'
    );
    return byClass?.textContent?.trim() || "";
  }

  function extractText(root) {
    if (!root || typeof root.querySelector !== "function") return "";

    // 1. Explicit data-test-id
    let target = root.querySelector('[data-test-id="CHATMESSAGE:message"], [data-test-id*="message"], [data-test-id*="text"]');

    // 2. Specific text classes
    if (!target) {
      target = root.querySelector(
        '[class*="ChatMessage_text"], [class*="ChatMessage__text"], [class*="Message_text"], [class*="messageText"], [class*="message-text"], [class*="MessageText"]'
      );
    }

    // 3. Fallback: filter out header, avatar, author, time, reply
    if (!target) {
      const candidates = root.querySelectorAll('[class*="Message"], [class*="message"], [class*="Text"], [class*="text"]');
      for (const el of candidates) {
        const cls = String(el.className || "");
        if (
          !cls.includes("root") &&
          !cls.includes("header") &&
          !cls.includes("avatar") &&
          !cls.includes("author") &&
          !cls.includes("time") &&
          !cls.includes("reply") &&
          !cls.includes("content")
        ) {
          target = el;
          break;
        }
      }
    }

    if (!target) return "";

    // Handle inline emoji images with alt text
    const images = target.querySelectorAll ? target.querySelectorAll("img[alt]") : [];
    if (images.length > 0) {
      const clone = target.cloneNode(true);
      const cloneImgs = clone.querySelectorAll("img[alt]");
      for (const img of cloneImgs) {
        const alt = img.getAttribute("alt") || "";
        img.replaceWith(alt);
      }
      return clone.textContent?.trim() || "";
    }

    return target.textContent?.trim() || "";
  }

  function extractAvatarUrl(root) {
    if (!root || typeof root.querySelector !== "function") return "";

    // 1. Image inside avatar container
    const avatarImg = root.querySelector(
      '[class*="Avatar"] img, [class*="avatar"] img, img[class*="avatar"], img[class*="Avatar"], [data-test-id*="avatar"] img'
    );
    if (avatarImg?.src) return avatarImg.src;
    if (avatarImg?.getAttribute) {
      const src = avatarImg.getAttribute("src") || avatarImg.getAttribute("data-src");
      if (src) return src;
    }

    // 2. Any image in root that is NOT inside message text or reply
    const allImgs = root.querySelectorAll("img");
    for (const img of allImgs) {
      if (!img.closest('[data-test-id="CHATMESSAGE:message"], [class*="text"], [class*="reply"]')) {
        const src = img.src || img.getAttribute("src") || img.getAttribute("data-src");
        if (src) return src;
      }
    }

    // 3. Container or child with CSS background image
    const avatarContainers = root.querySelectorAll('[class*="Avatar"], [class*="avatar"], [data-test-id*="avatar"], [style*="url"]');
    for (const el of avatarContainers) {
      if (typeof getComputedStyle === "function") {
        try {
          const background = getComputedStyle(el).backgroundImage;
          const match = background?.match(/^url\(["']?(.*?)["']?\)$/);
          if (match?.[1]) return match[1];
        } catch {}
      }

      const styleAttr = (el.getAttribute && el.getAttribute("style")) || el.style?.backgroundImage || "";
      const match = styleAttr.match(/url\(["']?(.*?)["']?\)/);
      if (match?.[1]) return match[1];
    }

    return "";
  }

  function extractPublishTime(root) {
    if (!root || typeof root.querySelector !== "function") return "";
    const el = root.querySelector('[class*="publishTime"], [class*="time"], [data-test-id*="time"]');
    return el?.textContent?.trim() || "";
  }

  function extractReplyInfo(root) {
    if (!root || typeof root.querySelector !== "function") return null;
    const replyContainer = root.querySelector(
      '[data-test-id*="reply"], [class*="Reply"], [class*="reply"], [class*="Quote"], [class*="quote"]'
    );
    if (!replyContainer) return null;

    const replyAuthorEl = replyContainer.querySelector('[class*="author"], [class*="Author"], [class*="name"]');
    const replyTextEl = replyContainer.querySelector('[class*="text"], [class*="Text"], [class*="message"]');
    const author = replyAuthorEl?.textContent?.trim() || "";
    const text = replyTextEl?.textContent?.trim() || "";
    if (!author && !text) return null;

    return { author, text };
  }

  function hashString(str) {
    let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV-1a prime
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  let lastFailureLogTime = 0;
  const FAILURE_LOG_INTERVAL_MS = 5000;

  function logParserFailure(reason) {
    const now = Date.now();
    if (now - lastFailureLogTime > FAILURE_LOG_INTERVAL_MS) {
      lastFailureLogTime = now;
      console.warn(`[Boosty Parser] Failed to parse message (${reason})`);
    }
  }

  function extractMessageId(root, options = {}) {
    if (!root) return "";

    // 1. Explicit message ID on root
    const explicitId = (root.getAttribute && (root.getAttribute("data-message-id") || root.getAttribute("data-id"))) || root.id || "";
    if (explicitId) return explicitId;

    // 2. Stable attribute on sub-elements
    const subEl = root.querySelector && root.querySelector('[data-message-id], [data-id]');
    if (subEl) {
      const subId = subEl.getAttribute('data-message-id') || subEl.getAttribute('data-id');
      if (subId) return subId;
    }

    // 3. Deterministic fingerprint hash
    const author = extractAuthor(root);
    const text = extractText(root);
    const publishTime = extractPublishTime(root);
    const pathname = options.pathname || "";

    if (author && text) {
      // Примечание: если Boosty не предоставляет настоящий message ID, а publishTime имеет
      // точность только до минуты, два сообщения одного автора с одинаковым текстом
      // в одной и той же отображаемой минуте могут получить одинаковый fallback ID и быть
      // восприняты как дубль. Это осознанный компромисс ради детерминированности и дедупликации.
      const fingerprint = `${pathname}|${author}|${text}|${publishTime}`;
      return `fallback-${hashString(fingerprint)}`;
    }
    return "";
  }

  function parseBoostyMessage(root, options = {}) {
    if (!root) return null;
    const author = extractAuthor(root);
    const text = extractText(root);
    if (!author || !text) {
      // Only log if element matches chat message root selector to avoid false noise
      if (root.matches && (root.matches('[data-test-id*="CHATMESSAGE"]') || root.matches('[class*="ChatMessage"]'))) {
        logParserFailure(!author ? "missing author" : "missing text");
      }
      return null;
    }

    const avatar = extractAvatarUrl(root);
    const publishTime = extractPublishTime(root);
    const reply = extractReplyInfo(root);
    const id = extractMessageId(root, options);

    return {
      id,
      author,
      text,
      avatar,
      publishTime,
      reply,
    };
  }

  return {
    queryRootElements,
    extractAuthor,
    extractText,
    extractAvatarUrl,
    extractPublishTime,
    extractReplyInfo,
    extractMessageId,
    parseBoostyMessage,
  };
});
