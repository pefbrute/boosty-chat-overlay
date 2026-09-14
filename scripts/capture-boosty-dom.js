/**
 * DevTools Snippet: Capture Real Boosty DOM Message with Strict Anonymization
 * 
 * Инструкция по использованию:
 * 1. Откройте страницу Boosty Live Chat в браузере (Chrome / Brave / Edge).
 * 2. Откройте инструменты разработчика (F12 -> Console).
 * 3. Вставьте и выполните этот скрипт.
 * 4. Скрипт найдёт последнее сообщение, аккуратно анонимизирует ник, текст,
 *    ссылки и URL аватаров, сохраняя структуру DOM, CSS-классы, data-test-id
 *    и inline emoji (сохраняя alt="..."),
 *    после чего скопирует готовый outerHTML в буфер обмена через copy().
 * 5. Вставьте скопированный HTML в нужный файл в test/fixtures/real/
 *    (например, test/fixtures/real/real-text-message.html).
 */
(function captureBoostyMessage(targetNode) {
  /**
   * Рекурсивно заменяет все непустые текстовые узлы (TEXT_NODE) на replacement,
   * не уничтожая вложенные HTML-элементы (span, strong, div, img и т.д.).
   * Если non-empty текстовых узлов несколько, первый получает replacement,
   * а последующие нейтрализуются или получают краткий заполнитель.
   */
  function anonymizeTextNodes(root, replacement = 'Тестовый текст', singleWord = false) {
    if (!root) return false;
    let replacedCount = 0;

    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3 /* Node.TEXT_NODE */) {
        const trimmed = (node.textContent || '').trim();
        if (trimmed.length > 0) {
          if (singleWord) {
            node.textContent = replacedCount === 0 ? replacement : '';
          } else {
            node.textContent = replacedCount === 0 ? replacement : ' текст';
          }
          replacedCount++;
        }
      } else if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
        // Не трогаем содержимое img и других листовых узлов
        if (node.tagName !== 'IMG') {
          for (const child of Array.from(node.childNodes)) {
            walk(child);
          }
        }
      }
    }

    walk(root);
    return replacedCount > 0;
  }

  function anonymizeElement(element) {
    if (!element) return null;
    const clone = element.cloneNode(true);

    let authorAnonymized = false;
    let messageAnonymized = false;
    let avatarUrlsAnonymized = 0;
    let hrefUrlsAnonymized = 0;

    // 1. Анонимизация автора (рекурсивная, чтобы сохранить вложенные span/badge/иконки)
    const authorEl = clone.querySelector('[data-test-id="CHATMESSAGE:author"], [data-test-id*="author"], [class*="ChatMessage_author"], [class*="Author"], [class*="author"]');
    if (authorEl) {
      authorAnonymized = anonymizeTextNodes(authorEl, 'Зритель_Тест', true);
    }

    // 2. Анонимизация текста сообщения (рекурсивная, с сохранением inline span, strong, emoji)
    const textEl = clone.querySelector('[data-test-id="CHATMESSAGE:message"], [data-test-id*="message"], [class*="ChatMessage_text"], [class*="Message_text"]');
    if (textEl) {
      messageAnonymized = anonymizeTextNodes(textEl, 'Тестовое сообщение из реального DOM Boosty', false);
    }

    // 3. Анонимизация цитирования / reply (рекурсивная)
    const replyContainer = clone.querySelector('[data-test-id*="reply"], [class*="Reply"], [class*="reply"]');
    if (replyContainer) {
      const replyAuthor = replyContainer.querySelector('[class*="author"], [class*="Author"], [class*="name"]');
      if (replyAuthor) anonymizeTextNodes(replyAuthor, 'Автор_Вопроса', true);
      const replyText = replyContainer.querySelector('[class*="text"], [class*="Text"], [class*="message"]');
      if (replyText) anonymizeTextNodes(replyText, 'Цитируемый текст вопроса', false);
    }

    // 4. Анонимизация всех картинок (аватары, emoji и любые другие)
    const allImgs = clone.querySelectorAll('img');
    for (const img of allImgs) {
      const isEmoji = Boolean(img.alt || img.closest('[data-test-id="CHATMESSAGE:message"], [class*="text"]'));
      if (isEmoji) {
        // Для emoji картинки подменяем URL на безопасную заглушку, НО СОХРАНЯЕМ alt="🔥"
        if (img.hasAttribute('src')) img.setAttribute('src', 'https://example.invalid/emoji.png');
        if (img.hasAttribute('data-src')) img.setAttribute('data-src', 'https://example.invalid/emoji.png');
        if (img.hasAttribute('srcset')) img.setAttribute('srcset', 'https://example.invalid/emoji.png 1x');
      } else {
        // Аватар
        if (img.hasAttribute('src')) { img.setAttribute('src', 'https://example.invalid/avatar.png'); avatarUrlsAnonymized++; }
        if (img.hasAttribute('data-src')) { img.setAttribute('data-src', 'https://example.invalid/avatar.png'); avatarUrlsAnonymized++; }
        if (img.hasAttribute('srcset')) { img.setAttribute('srcset', 'https://example.invalid/avatar.png 1x'); avatarUrlsAnonymized++; }
      }
    }

    // 5. Анонимизация background-image URL во всех элементах (аватары через CSS)
    const allElements = [clone, ...clone.querySelectorAll('*')];
    for (const el of allElements) {
      const styleAttr = el.getAttribute('style');
      if (styleAttr && /url\([^)]+\)/i.test(styleAttr)) {
        el.setAttribute('style', styleAttr.replace(/url\((['"]?)(?:.*?)\1\)/gi, "url('https://example.invalid/avatar.png')"));
        avatarUrlsAnonymized++;
      }

      // 6. Анонимизация ссылок href
      if (el.tagName === 'A' && el.hasAttribute('href')) {
        el.setAttribute('href', 'https://example.invalid/link');
        hrefUrlsAnonymized++;
      }

      // 7. Нейтрализация персональных идентификаторов в атрибутах пользователя
      for (const attr of Array.from(el.attributes || [])) {
        if (['data-user-id', 'data-author-id', 'data-profile-id', 'data-user-url'].includes(attr.name)) {
          el.setAttribute(attr.name, 'user-neutral-id');
        }
      }
    }

    return {
      clone,
      stats: {
        authorAnonymized,
        messageAnonymized,
        avatarUrlsAnonymized,
        hrefUrlsAnonymized,
      },
    };
  }

  // Поиск сообщений
  const roots = targetNode ? [targetNode] : (typeof document !== 'undefined' ? document.querySelectorAll(
    '[data-test-id="CHATMESSAGE:root"], [data-test-id*="CHATMESSAGE"], [class*="ChatMessage_root"], [class*="ChatMessage"]'
  ) : []);

  if (!roots.length) {
    if (typeof console !== 'undefined') {
      console.error('❌ Не найдено ни одного сообщения чата Boosty на текущей странице.');
      console.info('Убедитесь, что чат открыт и на экране есть хотя бы одно сообщение.');
    }
    return null;
  }

  const target = roots[roots.length - 1];
  const { clone, stats } = anonymizeElement(target);
  const html = clone.outerHTML;

  // Самопроверка перед выводом / копированием
  if (typeof console !== 'undefined') {
    console.log('--- Boosty DOM Capture Diagnostics ---');
    console.log(stats.authorAnonymized ? '✔ author anonymized' : 'ℹ author element not matched (or already neutral)');
    console.log(stats.messageAnonymized ? '✔ message anonymized' : 'ℹ message element not matched');
    console.log(stats.avatarUrlsAnonymized > 0 ? '✔ avatar URLs anonymized' : '✔ avatar URLs anonymized (0 detected)');
    console.log(stats.hrefUrlsAnonymized > 0 ? '✔ href URLs anonymized' : '✔ href URLs anonymized (0 detected)');
  }

  if (typeof copy === 'function') {
    copy(html);
    console.log('\n✅ Реальный DOM-элемент успешно анонимизирован и скопирован в буфер обмена!');
    console.log('Вставьте его (Ctrl+V) в файл: test/fixtures/real/real-<type>-message.html');
  } else if (typeof console !== 'undefined' && !targetNode) {
    console.log('\n✅ Анонимизированный HTML сообщения:');
    console.log(html);
  }

  return { html, stats, clone };
})(typeof window !== 'undefined' && window.__BOOSTY_CAPTURE_TEST_NODE__ ? window.__BOOSTY_CAPTURE_TEST_NODE__ : null);
