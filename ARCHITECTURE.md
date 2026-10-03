# Архитектура проекта Boosty Chat Overlay

**Boosty Chat Overlay** — local-first Electron-приложение для стримеров, которое захватывает сообщения из Live Chat Boosty через браузерное расширение, передаёт их на локальный Node.js HTTP/SSE сервер и отображает в OBS Studio через Browser Source.

### Ключевые свойства
- **Local-first & Offline-friendly:** Весь конвейер работает на `127.0.0.1`. Внешние серверы и облачные бэкенды не используются.
- **Zero Credentials:** Приложение не запрашивает, не передаёт и не хранит авторизационные данные, куки или токены стримера с Boosty.
- **Автоматизация OBS:** Создание служебной сцены и встраивание Browser Source в сцену стримера через OBS WebSocket v5 без ручной настройки URL.
- **Автономный контроллер:** Electron управляет процессами сервера, браузеров, интеграцией с OBS и предоставляет GUI для настройки оверлея.

---

## 1. Потоки данных (Data Flow & Control Plane)

### Поток сообщений (Data Plane)
```text
Boosty Live Chat (DOM)
       │
       ▼ [extension/parser.js] (DOM extraction + fallback FNV-1a ID)
extension/content.js
       │ [chrome.runtime.sendMessage]
extension/background.js
       │ [POST http://127.0.0.1:17369/message]
server.js (HTTP Router)
       │
       ▼ [core/messages/model.js] (normalizeIncomingMessage)
core/messages/dedup.js (TTL 10m / 300 items)
       │ (если ID уникален)
       ▼
core/messages/history.js (Ring Buffer 50 msgs, назначение eventId)
       │
       ▼ [core/sse/hub.js] (SSE broadcast event: "message")
overlay/overlay.js
       │
       ▼ [overlay/renderer.js] (safe DOM render via textContent)
OBS Studio (Browser Source)
```

### Поток управления (Control Plane)
```text
Desktop GUI (Renderer: desktop/app.js)
       │
       ▼ [desktop/preload.js (contextBridge: window.boostyOverlay)]
IPC Channels (ipcRenderer.invoke)
       │
       ▼ [desktop/main/ipc.js] (Тонкий адаптер каналов)
 ┌─────┴─────────────────────────────────┐
 ▼                                       ▼
BrowserManager (desktop/browser/)       ObsService (desktop/obs/)
 - Обнаружение браузеров                 - obs-websocket-js v5 client
 - Установка расширения (unpacked)       - Авто-включение WebSocket
 - Открытие ссылок из whitelist          - Очередь мутаций сцен (mutex)
```

---

## 2. Структура директорий и зоны ответственности

```text
├── core/                  # Независимая от Electron/DOM серверная бизнес-логика
│   ├── config/            # defaults.js, schema.js, storage.js (настройки оверлея)
│   ├── health/            # tracker.js (состояние коннектора, расширения и счетчики)
│   ├── messages/          # model.js (нормализация), history.js (буфер), dedup.js (дедупликация)
│   └── sse/               # hub.js (управление SSE-клиентами, broadcast, Last-Event-ID)
├── desktop/               # Electron Main и Renderer окружение
│   ├── browser/           # manager.js (поиск браузеров, распаковка расширения, openUrl)
│   ├── main/              # ipc.js (регистрация и маршрутизация IPC-хендлеров)
│   ├── obs/               # client.js, config.js, scenes.js, service.js (OBS WebSocket)
│   ├── ui/                # status-hub.js (чистая функция deriveSystemStatus)
│   ├── app.css, app.js    # Renderer интерфейс панели управления стримера
│   ├── index.html         # Разметка дашборда, настроек и онбординга
│   ├── main.js            # Чистый bootstrap жизненного цикла Electron
│   └── preload.js         # Безопасный ContextBridge API
├── extension/             # Chromium-расширение (Manifest V3)
│   ├── parser.js          # Изолированный DOM-парсер сообщений Boosty
│   ├── content.js         # MutationObserver в DOM вкладки Boosty
│   └── background.js      # Фоновый воркер: HTTP POST на localhost и heartbeat
├── overlay/               # HTML/CSS/JS страница для OBS Browser Source
│   ├── index.html         # Прозрачный холст оверлея
│   ├── renderer.js        # Изолированный рендеринг карточки сообщения (textContent)
│   ├── overlay.js         # SSE-клиент, EventSource, Last-Event-ID, анимация стека
│   └── style.css          # Стили оверлея и CSS-переменные параметров
├── types/                 # TypeScript декларации контрактов данных (message.d.ts)
├── server.js              # Тонкий HTTP/SSE сервер (маршрутизация на модули core/)
└── scripts/               # Скрипты тестирования, валидации и сборки
```

---

## 3. Контракт сообщения (`NormalizedMessage`)

Все модули после `extension/parser.js` работают строго со спецификацией из `types/message.d.ts`:

```javascript
{
  id: "msg-12345",                    // Уникальный ID от платформы или детерминированный fallback ID
  platform: "boosty",                 // Источник сообщения
  author: {
    name: "StreamFan",                // Имя автора
    avatar: "https://.../avatar.jpg"  // URL аватара или null
  },
  text: "Привет стример!",            // Текст сообщения
  reply: {                            // Цитируемое сообщение или null
    author: "Streamer",
    text: "Всем привет"
  },
  publishedAt: "2026-10-03T18:00:00Z",// Время отправки в чате (строка из DOM или ISO)
  receivedAt: 1791050400000,          // Серверный timestamp приёма (ms), от него считается TTL
  eventId: 42                         // Порядковый номер в кольцевом буфере сервера
}
```

> **Важно:** `publishedAt` и `receivedAt` строго разделены. Время жизни карточки оверлея (TTL) отсчитывается исключительно от серверного `receivedAt`. Поле `eventId` назначается сервером и не может быть подделано клиентом.

---

## 4. Жизненный цикл сообщения (Message Lifecycle)

1. **Захват в DOM:** `extension/content.js` через `MutationObserver` отслеживает новые узлы чата Boosty.
2. **Разбор:** `extension/parser.js` извлекает автора, текст, аватар и ответ. При отсутствии нативного ID вычисляет хеш FNV-1a: `fnv1a(`${pathname}|${author}|${text}|${publishTime}`)`.
3. **Отправка:** `extension/background.js` отправляет payload методом `POST /message`.
4. **Нормализация:** `core/messages/model.js` (`normalizeIncomingMessage`) валидирует контракт и отсекает недопустимые поля.
5. **Дедупликация:** `core/messages/dedup.js` проверяет ID по кольцевому буферу последних 300 ID с TTL 10 минут.
6. **Назначение Event ID:** `core/messages/history.js` присваивает строго возрастающий `eventId` (1..N) и помещает в кольцевой буфер (50 сообщений).
7. **Broadcast:** `core/sse/hub.js` сериализует событие `event: message` и рассылает всем подключённым SSE-клиентам.
8. **Отображение:** `overlay/overlay.js` принимает событие, проверяет локальный буфер `seenMessageIds` (FIFO 300) и передаёт в `overlay/renderer.js` для безопасной вставки в DOM через `textContent`.

---

## 5. SSE-семантика и Reconnect

- **Эндпоинт:** `GET /events`. Заголовки: `Content-Type: text/event-stream`, `Cache-Control: no-cache`.
- **Replay истории:** При новом подключении клиенту сразу отправляются все актуальные сообщения из истории, чей TTL (`receivedAt + durationSeconds * 1000`) ещё не истёк.
- **Last-Event-ID:** При разрыве соединения браузерный `EventSource` передаёт заголовок `Last-Event-ID`. Сервер досылает только сообщения с `eventId > lastEventId`.
- **Heartbeat:** Сервер каждые 15 секунд отправляет `: ping\n\n` для предотвращения разрыва соединения прокси/браузером.

---

## 6. HTTP API сервера (Порт по умолчанию: 17369)

| Метод | Эндпоинт | Назначение |
|---|---|---|
| `GET` | `/health` | Диагностика: статус расширения, стрима, счетчик сообщений, версии |
| `GET` | `/config` | Получение текущей конфигурации внешнего вида оверлея |
| `POST` | `/config` | Сохранение настроек оверлея (санитизация, запись на диск, SSE-broadcast) |
| `POST` | `/connector`| Heartbeat от расширения Boosty (проверка активности и устаревания) |
| `POST` | `/message` | Приём нового сообщения от браузерного расширения |
| `GET` | `/events` | SSE-поток событий (`message`, `config`) для оверлея |
| `GET` | `/test` | Отправка синтетического тестового сообщения во все оверлеи |
| `GET` | `/overlay/*`| Раздача статических файлов оверлея (`index.html`, `style.css`, `overlay.js`) |

---

## 7. Конфигурация оверлея

- **Хранение:** JSON-файл в пользовательской директории приложения (`userData/overlay-settings.json` или `~/.config/boosty-chat-overlay/`).
- **Схема и ограничения (`core/config/schema.js`):**
  - Стили: `fontSize` (12–48), `durationSeconds` (0–120, где 0 — бесконечно), `maxMessages` (1–30), `backgroundOpacity` (0–100), `cardWidth` (260–1200).
  - Расположение: `corner` (`top-left`, `top-right`, `bottom-left`, `bottom-right`), `direction` (`top`, `bottom`), `offsetX`/`offsetY` (0–300), `textAlign` (`left`, `center`, `right`), `maxStackHeight` (160–2160).
- **Синхронизация:** При вызове `POST /config` изменения сохраняются на диск и немедленно транслируются в оверлей через SSE-событие `event: config`.

---

## 8. OBS Service & Архитектурные инварианты OBS

Модули в `desktop/obs/` изолируют всю работу с OBS Studio:
- `client.js`: Управляет соединением `obs-websocket-js` v5, переподключениями и событиями.
- `config.js`: Находит конфигурационный файл OBS Studio (`global.ini` / `config.json`), определяет порт/пароль и путь к исполняемому файлу.
- `scenes.js`: Логика создания служебной сцены и встраивания источников.
- `service.js`: Фасад `ObsService`, предоставляющий единое API для Electron IPC.

### Критические инварианты OBS:
1. **Очередь мутаций (`createMutationQueue`):** Все вызовы модификации сцен (`addScene`, `removeScene`) строго сериализуются через promise chain (mutex), предотвращая гонки (race conditions).
2. **Защита смены коллекций:** При получении события `CurrentSceneCollectionChanging` любые мутации блокируются до завершения смены (`CurrentSceneCollectionChanged`).
3. **Идемпотентность служебной сцены:** Создаётся сцена `Boosty Chat Overlay`, содержащая Browser Source `Boosty Chat`. В выбранную сцену стримера добавляется сцена `Boosty Chat Overlay` как вложенный источник. Повторный вызов не дублирует источники.
4. **Безопасное удаление:** При переносе чата удаляется только связь со служебной сценой. Пользовательские источники стримера никогда не затрагиваются.

---

## 9. Browser Manager (`desktop/browser/manager.js`)

Отвечает за взаимодействие с браузерами стримера:
- Автоматически обнаруживает установленные Chromium-браузеры (Chrome, Brave, Edge, Chromium, Yandex).
- Распаковывает расширение из ресурсов сборки во временную папку стримера.
- Открывает внутренние страницы браузера (`brave://extensions/`, `chrome://extensions/`) с флагом `--new-window`.
- Предоставляет безопасный метод открытия внешних ссылок с проверкой белого списка URL.

---

## 10. Граница IPC (Renderer ↔ Main)

**Правило:** Renderer общается с Main процессом **исключительно** через `window.boostyOverlay`, объявленный в `desktop/preload.js`. Файл `desktop/main/ipc.js` содержит только тонкие адаптеры и валидацию аргументов. Бизнес-логика в `ipc.js` запрещена.

### Каналы IPC:
| Канал IPC | Назначение |
|---|---|
| `open-url` | Открытие проверенного URL в предпочитаемом браузере (whitelist) |
| `copy-overlay-url` | Копирование локального адреса оверлея в буфер обмена |
| `list-browsers` | Список установленных Chromium-браузеров |
| `prepare-browser-extension` | Распаковка и подготовка файлов расширения |
| `open-extension-folder` | Открытие папки расширения в файловом менеджере ОС |
| `open-browser-extensions-page` | Переход на страницу управления расширениями браузера |
| `copy-extensions-url` | Копирование адреса страниц расширений браузера |
| `launch-obs` | Запуск локального процесса OBS Studio |
| `has-obs-executable` | Проверка наличия установленного OBS Studio |
| `list-obs-scenes` | Получение списка сцен и статуса наличия оверлея |
| `add-obs-scene` | Добавление оверлея чата в указанную сцену |
| `remove-obs-scene` | Удаление оверлея чата из указанной сцены |
| `get-obs-status` | Текущий статус WebSocket-подключения к OBS |
| `get-app-version` | Текущая версия настольного приложения |

---

## 11. Status Hub (`desktop/ui/status-hub.js`)

Status Hub реализует единый источник правды для GUI дашборда:
- **Чистая функция `deriveSystemStatus(rawState)`**: Принимает сырое состояние (`health`, `obs`, `hasObsExecutable`, `isChecking`) и возвращает предсказуемое дерево состояний:
  - `obs`: подключение, перезапуск, отсутствие exe, кнопка `[Запустить OBS]`.
  - `extension`: активность, устаревшая версия, кнопка `[Настроить]` / `[Обновить]`.
  - `stream`: обнаружение стрима, URL, кнопка `[Открыть Boosty]`.
  - `overlay`: наличие чата в сценах, кнопка `[Добавить в сцену]` / `[Тестовое сообщение]`.
  - `overall`: общая готовность к стриму.

---

## 12. Инварианты безопасности (Security Invariants)

1. **Safe Text Rendering:** Пользовательские тексты и имена авторов вставляются в DOM исключительно через свойство `textContent` (`overlay/renderer.js`, `desktop/app.js`). Выполнение произвольного HTML/JS из чата исключено.
2. **Local-first isolation:** Все серверные сокеты слушают `127.0.0.1`. Приложение не принимает входящие подключения из внешней сети.
3. **URL Whitelist:** IPC-хендлер `open-url` принимает только ссылки, начинающиеся с `https://boosty.to/` или `http://127.0.0.1:17369/`.
4. **Учётные данные:** В приложении отсутствуют механизмы авторизации Boosty; токены и куки сессий пользователя недоступны серверу и приложению.
5. **Пароли OBS:** Пароль OBS WebSocket хранится только в локальном конфиге стримера или передаётся в оперативной памяти; логирование паролей категорически запрещено.

---

## 13. Тестовая архитектура

```bash
npm run check              # Проверка синтаксиса всех 57 JS-файлов через V8 CLI (--check)
npm test                   # Модульные и интеграционные тесты без запуска UI
npm run test:integration  # Интеграционные тесты в реальном экземпляре Electron
npm run test:all          # Полный запуск всех наборов тестов
```

### Структура тестовых наборов:
- `test/parser.test.js`: Синтетические фикстуры DOM Boosty, длинные тексты, смайлы, ответы, fallback ID.
- `test/message-model.test.js`: Валидация и нормализация схемы `NormalizedMessage`.
- `test/config.test.js`, `health-tracker.test.js`, `dedup.test.js`, `sse-hub.test.js`, `message-history.test.js`: Юнит-тесты модулей `core/`.
- `test/obs-*.test.js`: Модульные тесты клиента OBS, парсера конфигураций, очереди мутаций и сервиса.
- `test/browser-manager.test.js`, `test/ipc.test.js`, `test/status-hub.test.js`: Тесты подсистем Electron.
- `test/ui-redesign.test.js`, `test/overlay-layout.test.js`: E2E-тесты в Electron (геометрия, привязка к 4 углам, превью, клавиатурная навигация).

---

## 14. Главные архитектурные инварианты (Strict Rules)

1. **Не переносить логику OBS обратно в `desktop/main.js`:** Вся работа с OBS должна оставаться внутри `desktop/obs/`.
2. **Не помещать бизнес-логику в IPC:** Обработчики в `desktop/main/ipc.js` должны быть тонкими связующими звеньями (glue code).
3. **Не смешивать `publishedAt` и `receivedAt`:** Первое — время отправки в чате, второе — серверное время приёма для расчёта TTL.
4. **Не модифицировать алгоритм fallback FNV-1a ID:** Без строгой необходимости обратной совместимости изменение хеша сломает дедупликацию в активных сессиях.
5. **Не ломать Last-Event-ID replay:** Кольцевой буфер и досылка сообщений при реконнекте гарантируют отсутствие пропусков донатов и сообщений на стриме.
6. **Не заменять local-first облачными решениями:** Вся обработка обязана происходить на машине стримера.
7. **Сохранять очереди мутаций OBS:** Любые действия над источниками OBS должны проходить через `createMutationQueue`.

---

## 15. Карта внесения изменений (Where to change what)

| Задача / Что нужно изменить | Целевой модуль |
|---|---|
| Изменение парсинга DOM Boosty (селекторы, разметка) | [`extension/parser.js`](file:///home/fedor/projects/boosty-chat-overlay/extension/parser.js) |
| Изменение контракта сообщения или полей | [`core/messages/model.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/model.js) и [`types/message.d.ts`](file:///home/fedor/projects/boosty-chat-overlay/types/message.d.ts) |
| Поведение истории, буфера или дедупликации | [`core/messages/history.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/history.js), [`core/messages/dedup.js`](file:///home/fedor/projects/boosty-chat-overlay/core/messages/dedup.js) |
| Параметры конфигурации оверлея или валидация | [`core/config/defaults.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/defaults.js), [`core/config/schema.js`](file:///home/fedor/projects/boosty-chat-overlay/core/config/schema.js) |
| Поведение SSE, заголовки, heartbeat | [`core/sse/hub.js`](file:///home/fedor/projects/boosty-chat-overlay/core/sse/hub.js), [`server.js`](file:///home/fedor/projects/boosty-chat-overlay/server.js) |
| Логика подключения и работы со сценами OBS | [`desktop/obs/`](file:///home/fedor/projects/boosty-chat-overlay/desktop/obs/) (`client.js`, `scenes.js`, `service.js`) |
| Обнаружение браузеров, распаковка расширения | [`desktop/browser/manager.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/browser/manager.js) |
| Добавление нового IPC-вызова | [`desktop/main/ipc.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/main/ipc.js) и [`desktop/preload.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/preload.js) |
| Логика вывода статусов и кнопок решений (Status Hub) | [`desktop/ui/status-hub.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/ui/status-hub.js) |
| Вёрстка и оформление карточки сообщения в OBS | [`overlay/renderer.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/renderer.js), [`overlay/style.css`](file:///home/fedor/projects/boosty-chat-overlay/overlay/style.css) |
| Поведение оверлея при получении сообщений | [`overlay/overlay.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/overlay.js) |
| Сценарии визуального QA настольного интерфейса | [`scripts/visual-test-electron.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-electron.js) |

---

## 16. Electron UI Visual QA (`npm run test:ui:visual`)

Для автономной визуальной верификации графического интерфейса в проект интегрирован раннер визуального тестирования на базе Playwright Electron (`scripts/visual-test-electron.js`).

### Что проверяет раннер:
1. **Запуск реального Electron-приложения:** Тестируется настоящее упакованное окно приложения (Renderer + Preload + Main), а не отдельный браузер Chromium.
2. **Мульти-вьюпорт адаптивность (Responsive Check):**
   - Большой десктоп: `1280x850` (`dashboard-1280x850.png`)
   - Среднее окно: `1000x750` (`dashboard-1000x750.png`)
   - Компактный размер: `800x650` (`dashboard-800x650.png`)
   - Автоматически проверяются: отсутствие нежелательного горизонтального скролла (`scrollWidth <= innerWidth`), корректность размеров карточек статуса и интерактивных кнопок (`width > 0 && height > 0`).
3. **Детерминированные состояния Status Hub:**
   - `state-all-ready.png` (Готово к стриму)
   - `state-obs-offline.png` (OBS не запущен, CTA «Запустить OBS»)
   - `state-obs-restart-required.png` (Требуется перезапуск OBS)
   - `state-extension-offline.png` (Расширение не подключено, CTA «Настроить»)
   - `state-extension-outdated.png` (Расширение устарело)
   - `state-stream-missing.png` (Стрим не открыт, CTA «Открыть Boosty»)
   - `state-overlay-missing.png` (Оверлей не добавлен в активную сцену)
4. **Стресс-сценарий длинного текста (`state-long-content.png`):**
   - Экстремально длинные URL и названия сцен OBS для проверки отсутствия поломки вёрстки и переноса строк.
5. **Основные экраны и модальные окна:**
   - Экран настройки внешнего вида с переключением пресетов (`appearance.png`).
   - Мастер первоначальной настройки (`onboarding.png`).
   - Модальное окно подключения расширения (`modal-extension-setup.png`).
   - Доступность с клавиатуры (фокус по нажатию `Tab`).
6. **Сбор ошибок и отчёты:**
   - Все ошибки консоли Chromium и необработанные исключения страницы сохраняются в `artifacts/ui/console-errors.json`.
   - Итоговый структурированный JSON-отчёт сохраняется в `artifacts/ui/visual-report.json`.

### Изоляция тестового режима:
- Тестовые хуки (`window.__BOOSTY_UI_TEST__` и `window.boostyAudit`) активны **только** при установке переменной окружения `BOOSTY_OVERLAY_UI_TEST=1`.
- В обычном production-режиме эти хуки гарантированно отсутствуют (`undefined`), что подтверждается тестом `test/production-isolation.test.js`.
- В тестовом режиме Electron не обращается к реальному OBS и реальному интернету, гарантируя 100% стабильность и повторяемость.

> [!IMPORTANT]
> **Обязательное правило для AI-агентов:** При любых изменениях стилей или разметки настольного интерфейса (`desktop/index.html`, `desktop/app.css`, `desktop/app.js`, `desktop/ui/`) агент обязан:
> 1. Запустить `npm run test:ui:visual`.
> 2. Убедиться в отсутствии консольных и структурных ошибок (`consoleErrorsCount === 0`, `layoutIssuesCount === 0`).
> 3. Изучить сформированные скриншоты в папке `artifacts/ui/` с помощью инструмента `view_file` для проверки визуального ритма, отступов и читаемости текста.

