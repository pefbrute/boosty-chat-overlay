# Исследование метаданных Boosty Live Chat и приоритизация следующей фичи

> **Дата исследования:** 2026-10-04  
> **Статус:** Техническое исследование (без изменения рабочего кода приложения)  
> **Источники данных:**
> 1. Реальный слепок DOM чата стрима Boosty: [`test/fixtures/real/real-text-message.html`](file:///home/fedor/projects/boosty-chat-overlay/test/fixtures/real/real-text-message.html) (захвачен через [`scripts/capture-boosty-dom.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/capture-boosty-dom.js)).
> 2. Синтетические тестовые фикстуры проекта: [`test/fixtures/`](file:///home/fedor/projects/boosty-chat-overlay/test/fixtures/).
> 3. Реальные продакшен-бандлы фронтенда Boosty (`https://static.boosty.to/js/index.CH_HwnKF.js` — чанк `StreamChat`, `app.BlBxVZq7.js` — `BlockRenderer` / `ContentRenderer`, `icons.DQhLEk5Z.js` — SVG-спрайт иконок), проверенные через браузерный воркфлоу.
> 4. Текущий пайплайн проекта: [`extension/parser.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/parser.js), [`extension/content.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/content.js), [`core/messages/model.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/model.js), [`overlay/renderer.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/renderer.js), [`overlay/overlay.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/overlay.js), [`overlay/style.css`](file:///home/fedor/projects/boosty-chat-overlay/overlay/style.css).

---

## 1. Что парсер извлекает сейчас

Текущий парсер ([`extension/parser.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/parser.js)) и нормализатор ([`core/messages/model.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/model.js)) извлекают из каждого узла сообщения (`[data-test-id="CHATMESSAGE:root"]`) следующие поля:

| Поле `RawMessage` (`parser.js`) | Поле `NormalizedMessage` (`model.js`) | Как извлекается сейчас | Статус в `overlay/` |
| :--- | :--- | :--- | :--- |
| `id` | `id` | Атрибуты `data-message-id` / `data-id` / `id`. Так как в реальном DOM Boosty их **нет**, всегда вычисляется детерминированный `fnv1a(author \| publishTime \| text \| avatarUrl)` (`boosty-xxxxxxxx`) | Используется для дедупликации (`seenIds`) и `data-id` карточки |
| `author` | `author` | `textContent` из `[data-test-id="CHATMESSAGE:author"]` | Отображается в `.author-name` |
| `avatarUrl` | `avatarUrl` | `img.src` из `[class*="avatar"] img` или regex из `style="background-image: url(...)"` на `<div class="...avatar...">` | Отображается в `<img class="avatar">` (если не включён `hideAvatars`) |
| `text` | `text` | Клонируется `[data-test-id="CHATMESSAGE:message"]`, удаляются вложенные блоки цитат, все `<img alt="...">` заменяются на строку `img.getAttribute("alt")`, берётся `.textContent.trim()` | Отображается в `.message-text` через `textContent` |
| `publishTime` | `publishedAt` | `textContent` из `[class*="publishTime"]` (например, `"17:02"`) | **Теряется на этапе рендера** (в `NormalizedMessage` поле `publishedAt` есть, но [`overlay/renderer.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/renderer.js) его не выводит) |
| `reply` | `reply` | Ищется дочерний блок `[class*="reply"], [class*="quote"], blockquote` (исключая кнопки `button`), извлекаются `{ author, text }` | Отображается в `.message-reply` (`↪ Автор` + текст) |
| `timestamp` | `receivedAt` | Генерируется на клиенте/сервере (`new Date().toISOString()`) | Используется для `messageTtlSeconds` (автоскрытие) |

---

## 2. Полная анатомия реального DOM `ChatMessage` в Boosty

Анализ реального слепка [`test/fixtures/real/real-text-message.html`](file:///home/fedor/projects/boosty-chat-overlay/test/fixtures/real/real-text-message.html) и продакшен-компонента `ChatMessage` (`index.CH_HwnKF.js`) показывает точную структуру DOM-дерева сообщения в `StreamChat`:

```html
<div class="ChatMessage-scss--module_root_T1qVW ChatBoxBase-scss--module_message_lWMhc" data-test-id="CHATMESSAGE:root">
  <div class="ChatMessage-scss--module_body_r992W">
    <!-- 1. Время публикации -->
    <div class="ChatMessage-scss--module_publishTime_cvz-1">17:02</div>

    <!-- 2. Контейнер автора, аватарки и бейджа роли -->
    <div class="ChatMessage-scss--module_authorContainer_w-1K-">
      <!-- Аватарка (div с inline background-image) -->
      <div
        class="Avatar-scss--module_root_f257B Avatar-scss--module_extraSmall3_493-n ChatMessage-scss--module_avatar_bb-O5"
        style="background-image: url(&quot;https://images.boosty.to/user/123456/avatar?...&quot;);"
        data-test-id=" AVATAR:ROOTWith Image"
      ></div>

      <!-- Бейдж роли (присутствует ТОЛЬКО у владельца блога/стримера или модератора) -->
      <div class="TooltipFloating-scss--module_root_sMYJO ChatMessage-scss--module_badgeIconContainer_ZZ-7j" data-test-id="TOOLTIP:ROOT">
        <div tabindex="0">
          <span class="Icon-scss--module_block_ecqog ChatMessage-scss--module_badgeIcon_-Idv-">
            <svg class="Icon-scss--module_svg_SRc3X">
              <use xlink:href="#icon-star-4f3444cf"></use>
            </svg>
          </span>
        </div>
      </div>

      <!-- Имя автора с индивидуальным цветом и двоеточием -->
      <span
        class="ChatMessage-scss--module_name_dxAEt"
        data-test-id="CHATMESSAGE:author"
        style="color: rgb(139, 63, 253);"
      >Зритель_Тест:</span>
    </div>

    <!-- 3. Тело сообщения (рендерится через ContentRenderer / BlockRenderer) -->
    <span class="ChatMessage-scss--module_text_f16-k" data-test-id="CHATMESSAGE:message">
      <div>
        <div class="BlockRenderer-scss--module_root_12345">
          <span class="BlockRenderer-scss--module_markup_Tk8dH">
            Текст сообщения
            <!-- Кастомный смайл Boosty (если есть) -->
            <img
              translate="no"
              alt=":heart:"
              src="https://static.boosty.to/assets/images/small.xxxxxx.png"
              srcset="https://static.boosty.to/assets/images/medium.xxxxxx.png 2x, https://static.boosty.to/assets/images/large.xxxxxx.png 3x"
              style="vertical-align: middle; width: 1.75rem; height: 1.75rem; cursor: pointer;"
              data-id=":heart:"
              data-type="smile"
            />
            <!-- Упоминание @mention (при ответе через кнопку Reply в чате) -->
            <span
              class="mention currentUserMention BlockRenderer-scss--module_mention_..."
              data-mention-id="987654"
              data-display-name="Иван"
              contenteditable="false"
            >Иван</span>
          </span>
        </div>
      </div>
      <!-- Скрытый тултип для ховера по смайлу -->
      <div class="ChatMessage-scss--module_tooltip_... ChatMessage-scss--module_tooltipHidden_..."></div>
    </span>
  </div>

  <!-- 4. Кнопки быстрых действий при наведении (Delete / Reply / Moderation) -->
  <div class="ChatMessage-scss--module_buttons_...">
    <div class="ChatMessage-scss--module_buttonWrapper_...">
      <button class="ChatMessage-scss--module_button_... ChatMessage-scss--module_reply_qAebQ" type="button">
        <svg class="..."><use xlink:href="#icon-reply-..."></use></svg>
      </button>
    </div>
  </div>
</div>
```

---

## 3. Что подтверждено реальным DOM и продакшен-кодом vs что не верифицировано / отсутствует

### Подтверждено (Confirmed in Real DOM & Production Bundle)
1. **Бейджи ролей (`isOwner` / `isChatModerator`):** В компоненте `ChatMessage` (`index.CH_HwnKF.js`) рендерится ровно один бейдж:
   - `x.isChatModerator` → `<use xlink:href="#icon-sword-b9560ef8">` (тултип: модератор).
   - `x.isOwner` → `<use xlink:href="#icon-star-4f3444cf">` (тултип: автор блога / стример). Подтверждено напрямую в [`test/fixtures/real/real-text-message.html`](file:///home/fedor/projects/boosty-chat-overlay/test/fixtures/real/real-text-message.html#L8-L16).
2. **Индивидуальный цвет никнейма (`nicknameColor`) и двоеточие в имени автора:**
   - Boosty вычисляет детерминированный цвет никнейма из 16 цветов палитры (`#D66E34`, `#B8AAFF`, `#00579F`, `#8B3FFD`, `#59A840`, `#D45124`, `#DE6489`, `#20BBA1`, `#F8B301`, `#0099BB`, `#7BBEFF`, `#E542FF`, `#A36C59`, `#8BA259`, `#00A9FF`, `#A20BFF`) и записывает его в inline-стиль `style="color: rgb(...);"` на `[data-test-id="CHATMESSAGE:author"]`.
   - В живом React-шаблоне `ChatMessage` имя автора рендерится как `children: [x.name, ":"]`. В [`real-text-message.html`](file:///home/fedor/projects/boosty-chat-overlay/test/fixtures/real/real-text-message.html) двоеточие отсутствовало только потому, что [`scripts/capture-boosty-dom.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/capture-boosty-dom.js#L134) заменял `el.textContent` целиком. В реальном же чате `extractAuthor()` получает имя с двоеточием на конце (например, `"Зритель:"`).
3. **Кастомные смайлы Boosty (`img[data-type="smile"]`):**
   - Рендерятся функцией `Rv()` в `BlockRenderer` как `<img data-type="smile" data-id=":code:" alt=":code:" src="https://static.boosty.to/assets/images/small.<hash>.png" srcset="...">`.
   - Встроенный набор Boosty включает десятки кастомных графических смайлов (`HEART`, `CLAPPING_HANDS`, `HIGH_VOLTAGE`, `BEAMING_FACE`, `PARTY_POPPER`, `STAR`, `GEMSTONE`, `GASPAR`, `MONEY_FACE`, `ROCKET`, `EXPLODING_HEAD`, `THINKING_FACE`, `CHECK_MARK` и др.).
4. **Механизм Reply и `@mention` в реальном `StreamChat`:**
   - В `StreamChat` клик по кнопке ответа (`onReplyClick`) вызывает `ee = () => A(x)` (передаёт объект автора `x` в `ChatPublisherWrapper`), что вставляет в поле ввода inline-упоминание `<span class="mention" data-mention-id="..." data-display-name="Имя">Имя</span>`.
   - Если в сообщении упомянут текущий пользователь, корневой `<div data-test-id="CHATMESSAGE:root">` получает класс `ChatMessage-scss--module_hasRootMention_vKvAQ`.
5. **Модификаторы состояния сообщения на корневом элементе `CHATMESSAGE:root`:**
   - `ChatMessage-scss--module_msgBanned_3BBCc` — сообщение удалено/забанено модератором (внутри вместо текста появляется блок `banActions`).
   - `ChatMessage-scss--module_userBanned_Bf7gw` — автор сообщения забанен.
   - `ChatMessage-scss--module_private_TEySd` — флаг `message.isPrivate`.
   - `ChatMessage-scss--module_hasRootMention_vKvAQ` — сообщение содержит упоминание текущего пользователя.
6. **Системные сообщения (`ChatSystemMessage`):**
   - Рендерятся отдельным компонентом `<div class="ChatSystemMessage-scss--module_root_Fjn2U ChatBoxBase-scss--module_infoMessage_8xB2v">` без `data-test-id="CHATMESSAGE:root"`.

### Отсутствует в DOM строки чата / Не верифицировано (Absent in Message DOM / Unknown)
1. **Бейджи подписчиков и платных тиров (`subscriber` / `paid tier`) в строке сообщения:**
   - **Проверено по коду `StreamChat` (`index.CH_HwnKF.js`):** В самом `ChatMessage` уровень подписки пользователя **НЕ рендерится**. Компонент `ModerationPopupSubscriptionLevel` запрашивается асинхронно через `fetchStreamChatUserStat` только при открытии попапа модерации по клику на пользователя. В DOM самого сообщения нет ни класса, ни иконки тира подписки.
2. **Донаты / Платные выделенные сообщения (Superchat / Highlighted message) внутри `StreamChat`:**
   - `unknown / not verified in live DOM` (в продакшен-чанке `StreamChat` `index.CH_HwnKF.js` нет отдельных компонентов доната внутри `ChatBoxBase`; донаты на стримах Boosty обычно идут через сторонние виджеты вроде DonationAlerts или отдельные события вне `ChatMessage`).
3. **Закреплённые сообщения (Pinned messages):**
   - `unknown / not verified` — в чанке `StreamChat` (`ChatBoxBase` / `ChatMessage`) нет структуры закреплённого сообщения.

---

## 4. Что мы сейчас теряем (Главные потери данных)

1. **Кастомные графические смайлы Boosty (`img[data-type="smile"]`) — КРИТИЧЕСКАЯ ПОТЕРЯ:**
   - В [`extension/parser.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/parser.js#L82-L85) цикл `clone.querySelectorAll('img[alt]')` заменяет каждый `<img data-type="smile" alt=":heart:" src="https://static.boosty.to/...">` на текстовый узел с содержимым `alt`.
   - Для встроенных смайлов Boosty атрибут `alt` содержит технический код вида `:heart:` или `:gaspar:` (а не Unicode-символ). В результате в OBS-оверлее вместо картинки смайла зритель и стример видят сырой текст `:heart:` или пустоту, если сообщение состояло только из смайла без `alt`.
2. **Скрытый баг с тултипом смайла в `extractText()`:**
   - Внутри `[data-test-id="CHATMESSAGE:message"]` Boosty рендерит `<div class="ChatMessage-scss--module_tooltip_...">`. Когда пользователь в браузере наводит мышь на смайл в чате, Boosty записывает `f.current.innerText = gs` (код смайла) внутрь этого `div`. Так как `extractText()` берёт `.textContent` всего `[data-test-id="CHATMESSAGE:message"]`, текст активного тултипа склеивается с концом сообщения!
3. **Роли автора (`streamer` / `moderator`):**
   - Иконка звезды (`#icon-star-4f3444cf`) у стримера/автора канала и иконка меча (`#icon-sword-b9560ef8`) у модератора полностью игнорируются парсером. В оверлее сообщения самого стримера и модераторов визуально неотличимы от обычных зрителей.
4. **Двоеточие в конце имени автора (`"Никнейм:"`):**
   - В реальном DOM `textContent` элемента `[data-test-id="CHATMESSAGE:author"]` заканчивается символом `:` (`children: [x.name, ":"]`). Сейчас `extractAuthor()` возвращает `"Никнейм:"` без очистки завершающего двоеточия.
5. **Индивидуальный цвет автора (`nicknameColor`):**
   - Inline-стиль `style="color: rgb(...)"` на `[data-test-id="CHATMESSAGE:author"]` игнорируется, и все авторы в оверлее рисуются одним и тем же белым/серым цветом.
6. **Удалённые/забаненные сообщения (`msgBanned` / `userBanned`):**
   - Когда сообщение банится (`ChatMessage-scss--module_msgBanned_3BBCc`), Boosty заменяет `<span data-test-id="CHATMESSAGE:message">` на блок кнопок разбана (`banActions`). Сейчас парсер отфильтровывает такие узлы только косвенно (так как пропадает `CHATMESSAGE:message` и `text` становится пустым), но не проверяет флаг `msgBanned` явно.

---

## 5. Детальная таблица всех исследованных полей DOM

| Название поля | Где находится в DOM | Пример DOM | Текущий `parser.js` | Стабильность селектора | Ценность для Overlay | Сложность реализации |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Unicode Emoji** | Текстовые узлы внутри `[data-test-id="CHATMESSAGE:message"]` | `Привет 🔥👍` | **Извлекает** (сохраняется в `.textContent`) | Высокая (нативный UTF-8) | Высокая (уже работает) | Нет (0) |
| **2. Custom Boosty Emoji (`smile`)** | `[data-test-id="CHATMESSAGE:message"] img[data-type="smile"]` | `<img alt=":heart:" src="https://static.boosty.to/assets/images/small.xxx.png" srcset="... 2x" data-id=":heart:" data-type="smile">` | **Теряет картинку** (заменяет `<img>` на сырой текст `alt`, например `:heart:`) | **Высокая** (`img[data-type="smile"]` — явный data-атрибут в `BlockRenderer`) | **Очень высокая** (зрители активно шлют фирменные смайлы Boosty; сейчас оверлей выводит `:code:` вместо эмодзи) | Средняя (переход к `segments` или рендер безопасных `<img>` + учёт сообщений только из смайлов) |
| **3. Бейдж владельца / стримера (`isOwner`)** | `[class*="badgeIconContainer"] svg use` внутри `authorContainer` | `<use xlink:href="#icon-star-4f3444cf"></use>` | **Игнорирует** | **Высокая** (`[class*="badgeIcon"] use[*|href*="icon-star"]`) | **Высокая** (мгновенно выделяет сообщения стримера/автора блога в чате) | Низкая |
| **4. Бейдж модератора (`isChatModerator`)** | `[class*="badgeIconContainer"] svg use` внутри `authorContainer` | `<use xlink:href="#icon-sword-b9560ef8"></use>` | **Игнорирует** | **Высокая** (`[class*="badgeIcon"] use[*|href*="icon-sword"]`) | **Высокая** (выделяет модераторов чата) | Низкая |
| **5. Цвет никнейма (`authorColor`)** | Атрибут `style` на `[data-test-id="CHATMESSAGE:author"]` | `<span data-test-id="CHATMESSAGE:author" style="color: rgb(139, 63, 253);">Ник:</span>` | **Игнорирует** | **Высокая** (`authorEl.style.color` на стабильном `data-test-id`) | **Средняя / Высокая** (делает чат живым и узнаваемым, но требует проверки контрастности в `dark`/`light` темах) | Низкая |
| **6. Двоеточие в имени автора** | Хвостовой текстовый узел `":"` внутри `[data-test-id="CHATMESSAGE:author"]` | `<span data-test-id="CHATMESSAGE:author">Иван:</span>` | **Не очищает** (оставляет `:` в конце `author`) | Высокая | Средняя (аккуратность типографики, особенно в бейджах и ответах) | Тривиальная (`.replace(/:\s*$/, '')`) |
| **7. Упоминания (`@mention`)** | `[data-test-id="CHATMESSAGE:message"] span.mention[data-mention-id]` | `<span class="mention currentUserMention" data-mention-id="123" data-display-name="Иван">Иван</span>` | **Теряет структуру** (превращает в обычный плоский текст без выделения и без `@`) | **Высокая** (`span.mention[data-mention-id]`, плюс `[class*="hasRootMention"]` на корне) | **Высокая** (в `StreamChat` кнопка Reply работает именно через вставку `span.mention`, а не через `blockquote`) | Низкая / Средняя (можно подсвечивать mention-сегмент или связывать с предыдущим сообщением автора) |
| **8. Ссылки (`links`)** | `[data-test-id="CHATMESSAGE:message"] a[href]` | `<a href="https://..." target="_blank" rel="noopener noreferrer nofollow">текст</a>` | **Теряет `href` / семантику** (оставляет только `textContent`) | Высокая (`a[href]`) | Низкая (в OBS Browser Source по ссылкам не кликают, достаточно читаемого текста) | Низкая |
| **9. Время публикации (`publishTime`)** | `[class*="publishTime"]` внутри `ChatMessage` | `<div class="ChatMessage-scss--module_publishTime_cvz-1">17:02</div>` | **Извлекает** в `publishedAt`, но `overlay/renderer.js` **не отображает** | Средняя (`[class*="publishTime"]`) | Низкая / Опциональная (в компактном стрим-оверлее таймстемпы часто создают визуальный шум) | Низкая |
| **10. Забаненное сообщение (`msgBanned` / `userBanned`)** | Классы на корневом `[data-test-id="CHATMESSAGE:root"]` | `<div class="... ChatMessage-scss--module_msgBanned_3BBCc ...">` | **Игнорирует явно** (отсеивается только если `CHATMESSAGE:message` исчез из DOM) | Средняя (`[class*="msgBanned"]`, `[class*="userBanned"]`) | Средняя (защита от попадания текста кнопок модерации в чат) | Низкая |
| **11. Системные сообщения (`ChatSystemMessage`)** | Отдельный узел `[class*="ChatSystemMessage-scss--module_root"]` в списке чата | `<div class="ChatSystemMessage-scss--module_root_Fjn2U ChatBoxBase-scss--module_infoMessage_8xB2v">...</div>` | **Игнорирует** | Средняя (`[class*="ChatSystemMessage"]`) | Низкая (служебные уведомления чата обычно не нужны на экране стрима) | Низкая |
| **12. Подписчик / Платный тир (`subscriber` / `tier`)** | **Отсутствует в DOM сообщения** (загружается только по клику в попапе модерации) | Нет в `ChatMessage` | Неприменимо | Неприменимо | Высокая, но **недоступно в DOM без сетевых запросов** | Невозможно из чистого DOM чата |
| **13. Вложения / Картинки (`attachments`)** | В `StreamChat` отправка пользовательских картинок отключена (только `img[data-type="smile"]`) | Нет в `StreamChat` | Неприменимо | Неприменимо | Низкая | Неприменимо |
| **14. Донаты / Закрепы (`donations` / `pinned`)** | `unknown / not verified` в `StreamChat` DOM | Не обнаружено в чанке `StreamChat` | Неприменимо | Неприменимо | — | — |

---

## 6. Углублённый анализ ключевых доменов

### 6.1. Отдельный разбор: Emoji и Rich Content (`segments`)

В Boosty Live Chat встречаются два совершенно разных типа эмодзи:
1. **Стандартные Unicode-эмодзи (`🔥`, `😂`, `👍`):**
   - Живут как обычные UTF-8 символы в текстовых узлах.
   - Уже идеально проходят через `textContent` и рендерятся шрифтом ОС в `overlay/`.
2. **Кастомные смайлы Boosty (`img[data-type="smile"]`):**
   - Вставляются через пикер смайлов Boosty.
   - В DOM представлены тегом `<img>` с явно заданным `data-type="smile"`, `data-id=":name:"`, `alt=":name:"` и `src="https://static.boosty.to/assets/images/small.<hash>.png"` (плюс `srcset` с `medium` `2x` и `large` `3x`).
   - **Что происходит сейчас:** [`extension/parser.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/parser.js#L82-L85) заменяет `<img alt=":heart:">` на текстовую строку `":heart:"`. Если зритель отправляет 3 фирменных смайла Boosty подряд, в оверлее вместо картинок выводится `:heart: :heart: :heart:`. А если у `<img>` по какой-то причине пустой `alt`, сообщение вообще отбрасывается как пустое!
   - **Оценка модели `segments`:**
     Переход к опциональному массиву `segments` в `NormalizedMessage` (с сохранением плоского поля `text` для обратной совместимости, дедупликации FNV-1a и логов) — **архитектурно самое чистое и безопасное решение**:
     ```js
     text: "Привет :heart:", // сохраняется для обратной совместимости и хеширования ID
     segments: [
       { type: "text", text: "Привет " },
       {
         type: "emote",
         name: ":heart:",
         url: "https://static.boosty.to/assets/images/small.xxx.png",
         srcset: "https://static.boosty.to/assets/images/medium.xxx.png 2x"
       }
     ]
     ```
     - В [`core/messages/model.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/model.js) сообщение считается валидным, если непустой `text` **или** в `segments` есть хотя бы один `emote`.
     - Все URL картинок смайлов проходят строгую валидацию (`https://static.boosty.to/` или `https://images.boosty.to/`), а в [`overlay/renderer.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/renderer.js) создаются исключительно через `document.createElement('img')` (без `innerHTML`), что гарантирует 100% защиту от XSS.

### 6.2. Отдельный разбор: Badges и роли авторов

1. **Какие роли реально есть в DOM сообщения:**
   В коде компонента `ChatMessage` (`index.CH_HwnKF.js`):
   ```js
   const de = x.isChatModerator ? Ma : x.isOwner ? va : null;
   ```
   - `isOwner` (стример / владелец блога) → SVG use `#icon-star-4f3444cf` внутри `[class*="badgeIcon"]`.
   - `isChatModerator` (модератор чата) → SVG use `#icon-sword-b9560ef8` внутри `[class*="badgeIcon"]`.
2. **Чего в DOM сообщения НЕТ:**
   - Статуса платного подписчика / уровня тира (`SubscriptionLevel`). Boosty подгружает его отдельным запросом только при клике модератора по нику пользователя. Поэтому пытаться парсить тиры подписок из DOM чата бессмысленно.
3. **Как лучше представить в `NormalizedMessage`:**
   Поле `role: 'streamer' | 'moderator' | null` (или компактный массив `badges: ['streamer']`). В `overlay/` это позволяет аккуратно отрисовать встроенную SVG-иконку короны/звезды для стримера и меча/щита для модератора + легкий акцент на имени автора.

### 6.3. Отдельный разбор: Как реально работает Reply / `@mention` в `StreamChat`

1. Недавно мы реализовали поддержку блока `reply: { author, text }` в `overlay/`. Это отлично работает, когда в DOM присутствует вложенный цитируемый блок (`[class*="reply"], [class*="quote"], blockquote`).
2. Однако исследование бандла `StreamChat` (`index.CH_HwnKF.js`) показало важную деталь: **в живом чате стрима Boosty кнопка «Ответить» (`ChatMessage-scss--module_reply_qAebQ`) не создаёт вложенный `blockquote` с текстом цитаты, а вставляет в редактор узел `<span class="mention" data-mention-id="..." data-display-name="Имя">Имя</span>`!**
3. При этом:
   - В самом `span.mention` текст не содержит символа `@` (просто `Имя`), либо оформляется CSS-классом `mention` в Boosty. Когда наш `parser.js` делает `.textContent`, `<span class="mention">Иван</span> привет` превращается в обычный текст `"Иван привет"`, теряя визуальное выделение обращения!
   - Более того, так как расширение или сервер помнит недавние сообщения чата, при наличии в начале сообщения `<span class="mention" data-display-name="Иван">` мы можем:
     1) Визуально подсвечивать `@Иван` как mention-пилюлю внутри текста (через `segments` типа `{ type: 'mention', name: 'Иван' }`).
     2) Опционально (если `reply` не пришёл из `blockquote`) находить последнее сообщение автора `"Иван"` в буфере и автоматически заполнять `reply: { author, text }`!

---

## 7. Что стоит и чего НЕ стоит добавлять в `NormalizedMessage`

### Стоит добавить (в порядке итераций):
1. `segments?: Array<{ type: 'text', text: string } | { type: 'emote', name: string, url: string } | { type: 'mention', name: string }>` — позволяет рендерить кастомные смайлы Boosty (`img[data-type="smile"]`) и подсвечивать `@mention`, не ломая обратную совместимость с полем `text: string`.
2. `role?: 'streamer' | 'moderator' | null` (или `badges?: string[]`) — надёжно определяется по `svg use[xlink:href*="#icon-star"]` и `svg use[xlink:href*="#icon-sword"]`.
3. `authorColor?: string | null` — индивидуальный цвет никнейма из `style.color` на `[data-test-id="CHATMESSAGE:author"]`.
4. Нормализация `author`: очистка хвостового двоеточия (`"Зритель:"` → `"Зритель"`), которое Boosty добавляет в `CHATMESSAGE:author`, и исключение скрытого `.ChatMessage-scss--module_tooltip_*` при клонировании текста сообщения.

### НЕ стоит трогать / добавлять:
1. **Уровни платной подписки (Tiers):** их нет в DOM сообщения, любые попытки делать дополнительные XHR-запросы на каждое сообщение из контент-скрипта приведут к rate-limit и хрупкости.
2. **Системные сообщения (`ChatSystemMessage`):** не несут ценности для зрителей на экране стрима.
3. **Кликабельные ссылки (`<a>`):** в OBS Browser Source интерактивность не нужна и потенциально опасна.

---

## 8. Приоритизация следующих фич (P1 / P2 / P3) и статус реализации

### Приоритет P1 (Максимальная ценность для стримера и зрителей, высокая надёжность DOM)
1. ✅ **[РЕАЛИЗОВАНО] Кастомные смайлы Boosty (`img[data-type="smile"]`) + чистое извлечение текста и `@mention` (`segments`) + фикс `.tooltip` и двоеточия в `author`:**
   - **Статус:** Полностью реализовано в `extension/parser.js`, `extension/content.js`, `core/messages/model.js`, `types/message.d.ts`, `overlay/renderer.js`, `overlay/style.css`. Покрыто unit-тестами (`test/parser.test.js`, `test/message-model.test.js`) и 7 сценариями визуального QA (`scripts/visual-test-overlay.js`).
2. ✅ **[РЕАЛИЗОВАНО] Streamer/moderator roles — IMPLEMENTED (`streamer` ★ / `moderator` ⚔):**
   - **Статус:** Извлечение `#icon-star-*` (`streamer`) и `#icon-sword-*` (`moderator`) в `extension/parser.js`, передача через `extension/content.js`, строгая нормализация по whitelist (`'streamer' | 'moderator' | null`) в `core/messages/model.js`, собственные SVG-бейджи `.author-role--streamer` и `.author-role--moderator` в `overlay/renderer.js` и `overlay/style.css`. Покрыто фикстурами (`streamer-message.html`, `moderator-message.html`, `normal-user-message.html`), unit-тестами и 7 сценариями визуального QA.

### Приоритет P2 (Хорошее визуальное улучшение, средний приоритет)
3. **Связывание реальной кнопки Reply в `StreamChat` (`span.mention`) с блоком цитаты `reply`:**
   - Поскольку кнопка Reply в `StreamChat` создаёт `span.mention[data-display-name]` в начале сообщения, можно подтягивать текст последнего сообщения упомянутого автора в уже готовый UI-блок `.message-reply`.
4. **Индивидуальные цвета никнеймов (`authorColor` из `style.color`):**
   - Делает чат визуально богаче и ближе к оригинальному чату Boosty (требует аккуратной адаптации яркости/контраста для `light` и `dark` тем оверлея).

### Приоритет P3 (Низкий приоритет / Опционально)
5. **Опциональное отображение времени сообщения (`publishedAt`)** по флагу конфигурации.
6. **Обработка бана/удаления сообщения в реальном времени** (удаление карточки из оверлея при появлении класса `msgBanned` на уже отправленном узле DOM).

---

### Статус рекомендации

> ✅ **Фича №1 (Кастомные смайлы Boosty `img[data-type="smile"]` и `@mention` через безопасную модель `segments`, плюс исправление утечки `.tooltip` и двоеточия в `author`) — IMPLEMENTED.**
>
> ✅ **Фича №2 (Streamer/moderator roles — IMPLEMENTED: бейджи ролей Стримера и Модератора на базе `#icon-star-*` и `#icon-sword-*`).**
