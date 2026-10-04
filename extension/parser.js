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

  function normalizeAuthorName(raw) {
    if (typeof raw !== "string") return "";
    // Boosty renders author name as [author.name, ":"] inside CHATMESSAGE:author.
    // Strip at most one trailing presentation colon while preserving colons inside nicknames.
    return raw.trim().replace(/:\s*$/, "").trim();
  }

  function extractAuthor(root) {
    if (!root || typeof root.querySelector !== "function") return "";

    // 1. Explicit data-test-id
    const byTestId = root.querySelector('[data-test-id="CHATMESSAGE:author"], [data-test-id*="author"]');
    if (byTestId?.textContent?.trim()) return normalizeAuthorName(byTestId.textContent);

    // 2. Specific author classes
    const byClass = root.querySelector(
      '[class*="ChatMessage_author"], [class*="ChatMessage__author"], [class*="Author_name"], [class*="authorName"], [class*="author-name"], [class*="Author"], [class*="author"]'
    );
    return normalizeAuthorName(byClass?.textContent || "");
  }

  function extractAuthorRole(root) {
    if (!root || typeof root.querySelectorAll !== "function") return null;

    const authorEl =
      root.querySelector('[data-test-id="CHATMESSAGE:author"], [data-test-id*="author"]') ||
      root.querySelector(
        '[class*="ChatMessage_author"], [class*="ChatMessage__author"], [class*="Author_name"], [class*="authorName"], [class*="author-name"], [class*="Author"], [class*="author"]'
      );

    const searchScope = authorEl && authorEl.parentElement ? authorEl.parentElement : root;
    const useNodes = searchScope.querySelectorAll ? searchScope.querySelectorAll("svg use, use") : [];

    for (const use of useNodes) {
      if (!use || typeof use.getAttribute !== "function") continue;
      if (
        use.closest &&
        use.closest(
          '[data-test-id="CHATMESSAGE:message"], [data-test-id*="reply"], [class*="Reply"], [class*="reply"], [class*="Quote"], [class*="quote"], blockquote, button, [class*="button"]'
        )
      ) {
        continue;
      }

      const rawHref = (use.getAttribute("href") || use.getAttribute("xlink:href") || "").trim().toLowerCase();
      if (!rawHref) continue;

      if (/(?:^|#)icon-star(?=$|[-_])/i.test(rawHref)) {
        return "streamer";
      }
      if (/(?:^|#)icon-sword(?=$|[-_])/i.test(rawHref)) {
        return "moderator";
      }
    }

    return null;
  }

  function findMessageContainer(root) {
    if (!root || typeof root.querySelector !== "function") return null;

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

    return target || null;
  }

  function isSafeEmojiUrl(url) {
    if (typeof url !== "string") return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (/^data:image\/(png|webp|gif|jpeg|jpg|svg\+xml)[;,]/i.test(trimmed)) {
      return true;
    }
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }

  function isExcludedMessageSubtree(el) {
    if (!el || typeof el.getAttribute !== "function") return false;
    // Boosty places a smile hover tooltip div inside [data-test-id="CHATMESSAGE:message"]
    // and writes the hovered emoji alt code into its innerText. We must exclude tooltip
    // and embedded quote/reply containers from message text and segment traversal.
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "tooltip") return true;

    const testId = (el.getAttribute("data-test-id") || "").toLowerCase();
    if (testId.includes("tooltip") || testId.includes("reply")) return true;

    const cls = String(el.className || "").toLowerCase();
    if (cls.includes("tooltip") || cls.includes("reply") || cls.includes("quote")) {
      return true;
    }
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "BLOCKQUOTE" || tag === "SCRIPT" || tag === "STYLE") {
      return true;
    }
    return false;
  }

  function isMentionElement(el) {
    if (!el || typeof el.getAttribute !== "function") return false;
    if (el.hasAttribute && (el.hasAttribute("data-mention-id") || el.hasAttribute("data-display-name"))) {
      return true;
    }
    if (el.classList && el.classList.contains("mention")) {
      return true;
    }
    const cls = String(el.className || "");
    return /\bmention\b/.test(cls);
  }

  function isCustomSmileImage(el) {
    if (!el || String(el.tagName || "").toUpperCase() !== "IMG") return false;
    const dataType = (el.getAttribute && el.getAttribute("data-type")) || el.dataset?.type || "";
    return dataType === "smile";
  }

  function normalizeDomTextNodeValue(rawValue) {
    if (typeof rawValue !== "string" || !rawValue) return "";
    // Remove HTML template formatting newlines/indentation at node boundaries,
    // and collapse internal multiline indentation to a single space while preserving inline spaces.
    return rawValue
      .replace(/^\s*[\r\n]+\s*/, "")
      .replace(/\s*[\r\n]+\s*$/, "")
      .replace(/\s*[\r\n]+\s*/g, " ");
  }

  function appendTextSegment(segments, textValue) {
    if (!textValue) return;
    const prev = segments.length > 0 ? segments[segments.length - 1] : null;
    if (prev && prev.type === "text") {
      prev.text += textValue;
    } else {
      segments.push({ type: "text", text: textValue });
    }
  }

  function extractSegments(root) {
    const target = findMessageContainer(root);
    if (!target) return [];

    const rawSegments = [];

    function walk(node) {
      if (!node) return;
      const nodeType = node.nodeType;

      // Text node (Node.TEXT_NODE === 3)
      if (nodeType === 3) {
        const textVal = normalizeDomTextNodeValue(node.nodeValue ?? node.textContent ?? "");
        if (textVal) {
          appendTextSegment(rawSegments, textVal);
        }
        return;
      }

      // Element node (Node.ELEMENT_NODE === 1)
      if (nodeType === 1) {
        if (node !== target && isExcludedMessageSubtree(node)) {
          return;
        }

        // 1. Boosty custom emoji: img[data-type="smile"]
        if (isCustomSmileImage(node)) {
          const rawId = (node.getAttribute && node.getAttribute("data-id")) || node.dataset?.id || "";
          const id = rawId.trim() || null;
          const rawAlt = (node.getAttribute && node.getAttribute("alt")) || "";
          const alt = rawAlt.trim() || id || ":emoji:";
          const rawUrl = ((node.getAttribute && node.getAttribute("src")) || node.src || "").trim();

          if (isSafeEmojiUrl(rawUrl)) {
            rawSegments.push({
              type: "emoji",
              id,
              alt,
              url: rawUrl,
            });
          } else if (alt) {
            appendTextSegment(rawSegments, alt);
          }
          return;
        }

        // 2. Legacy / generic inline <img alt="..."> (non-smile)
        if (String(node.tagName || "").toUpperCase() === "IMG") {
          const alt = (node.getAttribute && node.getAttribute("alt")) || "";
          if (alt) {
            appendTextSegment(rawSegments, alt);
          }
          return;
        }

        // 3. Mention element: span.mention[data-mention-id][data-display-name]
        if (node !== target && isMentionElement(node)) {
          const rawUserId = (node.getAttribute && node.getAttribute("data-mention-id")) || node.dataset?.mentionId || "";
          const userId = rawUserId.trim() || null;
          const rawDisplay =
            (node.getAttribute && node.getAttribute("data-display-name")) ||
            node.dataset?.displayName ||
            node.textContent ||
            "";
          const displayName = rawDisplay.trim().replace(/^@+/, "").trim();
          if (displayName) {
            rawSegments.push({
              type: "mention",
              userId,
              displayName,
            });
          }
          return;
        }

        // 4. Recurse into child nodes in DOM order
        const children = node.childNodes || [];
        for (let i = 0; i < children.length; i++) {
          walk(children[i]);
        }
      }
    }

    walk(target);

    // Trim leading whitespace on the first text segment
    while (rawSegments.length > 0 && rawSegments[0].type === "text") {
      rawSegments[0].text = rawSegments[0].text.replace(/^\s+/, "");
      if (!rawSegments[0].text) {
        rawSegments.shift();
      } else {
        break;
      }
    }

    // Trim trailing whitespace on the last text segment
    while (rawSegments.length > 0 && rawSegments[rawSegments.length - 1].type === "text") {
      const lastIdx = rawSegments.length - 1;
      rawSegments[lastIdx].text = rawSegments[lastIdx].text.replace(/\s+$/, "");
      if (!rawSegments[lastIdx].text) {
        rawSegments.pop();
      } else {
        break;
      }
    }

    return rawSegments;
  }

  function segmentsToPlainText(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return "";
    return segments
      .map(seg => {
        if (!seg || typeof seg !== "object") return "";
        if (seg.type === "text") return seg.text || "";
        if (seg.type === "emoji") return seg.alt || seg.id || "";
        if (seg.type === "mention") {
          const name = String(seg.displayName || "").replace(/^@+/, "").trim();
          return name ? `@${name}` : "";
        }
        return "";
      })
      .join("")
      .trim();
  }

  function extractText(root) {
    if (!root || typeof root.querySelector !== "function") return "";
    const segments = extractSegments(root);
    return segmentsToPlainText(segments);
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
    const candidates = root.querySelectorAll
      ? root.querySelectorAll('[data-test-id*="reply"], [class*="Reply"], [class*="reply"], [class*="Quote"], [class*="quote"], blockquote')
      : [];

    let replyContainer = null;
    for (const el of candidates) {
      const tag = String(el.tagName || "").toUpperCase();
      const cls = String(el.className || "").toLowerCase();
      if (tag === "BUTTON" || cls.includes("button")) continue;
      replyContainer = el;
      break;
    }

    if (!replyContainer) return null;

    const replyAuthorEl = replyContainer.querySelector('[class*="author"], [class*="Author"], [class*="name"]');
    const replyTextEl = replyContainer.querySelector('[class*="text"], [class*="Text"], [class*="message"]');
    const author = normalizeAuthorName(replyAuthorEl?.textContent || "");
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

    // 2. Stable attribute on sub-elements (excluding smile images which use data-id=":emoji:")
    const subCandidates = root.querySelectorAll ? root.querySelectorAll('[data-message-id], [data-id]') : [];
    for (const subEl of subCandidates) {
      if (isCustomSmileImage(subEl) || String(subEl.tagName || "").toUpperCase() === "IMG") continue;
      if (subEl.closest && subEl.closest('[data-test-id="CHATMESSAGE:message"]')) continue;
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
    const segments = extractSegments(root);
    const text = segmentsToPlainText(segments);
    if (!author || (!text && segments.length === 0)) {
      // Only log if element matches chat message root selector to avoid false noise
      if (root.matches && (root.matches('[data-test-id*="CHATMESSAGE"]') || root.matches('[class*="ChatMessage"]'))) {
        logParserFailure(!author ? "missing author" : "missing text");
      }
      return null;
    }

    const role = extractAuthorRole(root);
    const avatar = extractAvatarUrl(root);
    const publishTime = extractPublishTime(root);
    const reply = extractReplyInfo(root);
    const id = extractMessageId(root, options);

    return {
      id,
      author,
      role,
      text,
      segments,
      avatar,
      publishTime,
      reply,
    };
  }

  return {
    queryRootElements,
    normalizeAuthorName,
    extractAuthor,
    extractAuthorRole,
    extractSegments,
    extractText,
    extractAvatarUrl,
    extractPublishTime,
    extractReplyInfo,
    extractMessageId,
    parseBoostyMessage,
  };
});
