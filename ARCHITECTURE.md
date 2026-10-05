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
│   ├── config/            # defaults.js, presets.js, profiles.js, schema.js, size-presets.js, storage.js (настройки, пресеты, профили, размеры)
│   ├── health/            # tracker.js (состояние коннектора, расширения и счетчики)
│   ├── layout/            # positioning.js (координатная математика Drag & Drop, snap, clamp)
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
    name: "StreamFan",                // Имя автора (без презентационного двоеточия)
    avatar: "https://.../avatar.jpg", // URL аватара или null
    role: "streamer"                  // Роль автора ('streamer' | 'moderator' | null)
  },
  text: "Привет :heart: @Streamer!",  // Плоский текст сообщения (fallback, поиск и FNV-1a хеш)
  segments: [                         // Структурированные сегменты (text | emoji | mention) или null
    { type: "text", text: "Привет " },
    { type: "emoji", id: ":heart:", alt: ":heart:", url: "https://static.boosty.to/..." },
    { type: "text", text: " " },
    { type: "mention", userId: "123", displayName: "Streamer" },
    { type: "text", text: "!" }
  ],
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
2. **Разбор:** `extension/parser.js` обходит контейнер сообщения по DOM-узлам, формируя массив `segments` (`text`, `emoji` из `img[data-type="smile"]`, `mention` из `span.mention`) и плоский `text` (исключая скрытый `.tooltip`), очищает презентационное двоеточие в `author`, извлекает роль автора (`streamer` по `#icon-star-*`, `moderator` по `#icon-sword-*`), аватар и ответ. При отсутствии нативного ID вычисляет хеш FNV-1a: `fnv1a(`${pathname}|${author}|${text}|${publishTime}`)`.
3. **Отправка:** `extension/background.js` отправляет payload методом `POST /message`.
4. **Нормализация:** `core/messages/model.js` (`normalizeIncomingMessage`) валидирует контракт, проверяет whitelist ролей (`streamer` / `moderator` / `null`), безопасность URL смайлов (`isSafeEmojiUrl`) и отсекает неизвестные типы сегментов.
5. **Дедупликация:** `core/messages/dedup.js` проверяет ID по кольцевому буферу последних 300 ID с TTL 10 минут.
6. **Назначение Event ID:** `core/messages/history.js` присваивает строго возрастающий `eventId` (1..N) и помещает в кольцевой буфер (50 сообщений).
7. **Broadcast:** `core/sse/hub.js` сериализует событие `event: message` и рассылает всем подключённым SSE-клиентам.
8. **Отображение:** `overlay/overlay.js` принимает событие, проверяет локальный буфер `seenMessageIds` (FIFO 300) и передаёт в `overlay/renderer.js` для безопасной DOM-отрисовки (`createTextNode`, `.author-role`, `img.message-emoji`, `span.message-mention`, без `innerHTML`).

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
- `transform.js`: Каноническая геометрия оверлея (`buildCanonicalOverlayTransform`, `isObsOverlayTransformCanonical`).
- `scenes.js`: Логика создания служебной сцены, встраивания источников и нормализации холста (`normalizeOverlayTransform`).
- `service.js`: Фасад `ObsService`, предоставляющий единое API для Electron IPC.

### Критические инварианты OBS:
1. **Очередь мутаций (`createMutationQueue`):** Все вызовы модификации сцен (`addScene`, `removeScene`, `fitOverlayToCanvas`) строго сериализуются через promise chain (mutex), предотвращая гонки (race conditions).
2. **Защита смены коллекций:** При получении события `CurrentSceneCollectionChanging` любые мутации блокируются до завершения смены (`CurrentSceneCollectionChanged`).
3. **Каноническая модель холста (Full Canvas 1:1 Viewport):**
   - Внутренний вьюпорт Browser Source (`SetInputSettings` `width`, `height`) обязан динамически совпадать с базовым разрешением холста OBS (`GetVideoSettings` `baseWidth`, `baseHeight`), например 1920×1080, 2560×1440 или 4K. Запрещён хардкод 1920×1080.
   - Transform элемента сцены (`SetSceneItemTransform`) обязан быть строго каноническим 1:1: `position: (0, 0)`, `scale: (1.0, 1.0)`, `alignment: 5` (`OBS_ALIGN_TOP | OBS_ALIGN_LEFT`), без кропа, поворота или bounds-масштабирования (`boundsType: 'OBS_BOUNDS_NONE'`).
   - Позиционирование чата (`horizontalAnchor`, `verticalAnchor`, `offsetX`, `offsetY`) выполняется исключительно CSS-движком оверлея относительно полного эфирного холста, исключая искажения шрифтов и размытие растровых текстур при аппаратном масштабировании OBS.
4. **Недеструктивный контроль и ручная подгонка:**
   - Состояние каноничности отслеживается через `canvasStatus` (`isCanonical`, `baseWidth`, `baseHeight`, `sourceWidth`, `sourceHeight`, `scaleX`, `scaleY`).
   - При отклонении стример видит явное предупреждение и действие «Подогнать оверлей под холст OBS» (IPC `fit-obs-overlay`), автоматически приводящее входные параметры Browser Source и трансформацию к 1:1 без скрытых изменений настроек видеокарты или потока.
5. **Идемпотентность служебной сцены:** Создаётся сцена `Boosty Chat Overlay`, содержащая Browser Source `Boosty Chat`. В выбранную сцену стримера добавляется сцена `Boosty Chat Overlay` как вложенный источник. Повторный вызов не дублирует источники.
6. **Безопасное удаление:** При переносе чата удаляется только связь со служебной сценой. Пользовательские источники стримера никогда не затрагиваются.

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
| `list-obs-scenes` | Получение списка сцен, статуса оверлея и геометрии холста OBS |
| `add-obs-scene` | Добавление оверлея чата в указанную сцену с авто-калибровкой холста |
| `remove-obs-scene` | Удаление оверлея чата из указанной сцены |
| `fit-obs-overlay` | Приведение Browser Source и трансформов к размеру базового холста OBS (1:1) |
| `get-obs-status` | Текущий статус WebSocket-подключения к OBS |
| `get-app-version` | Текущая версия настольного приложения |

---

## 11. Status Hub & Жизненный цикл подключения (`desktop/ui/status-hub.js`, `core/health/tracker.js`)

Status Hub реализует единый источник правды для GUI дашборда и устраняет ложные негативные состояния при старте:

### Модель состояний жизненного цикла:
Вместо бинарных флагов `true`/`false` компоненты работают по гранулярным машинам состояний:
- **Расширение (`extension.state`):**
  - `checking`: Приложение только запустилось или проверяет доступность. На карточке отображается нейтральное «Проверяем… / Ищем связь с браузером».
  - `connected`: Сигнал от фонового скрипта расширения получен и регулярен (до 5 сек). Отображается «Активно / v0.4.0».
  - `reconnecting`: Сигнал прервался на 5–15 сек. Отображается «Переподключение… / Последний сигнал X сек назад».
  - `unavailable`: Сигнал отсутствует более 15 сек (или после истечения startup grace period 6 сек). Отображается «Не обнаружено» с кнопкой `[Настроить]`.
- **Boosty (`boosty.state`):**
  - `checking`: Поиск открытых вкладок. Отображается «Ищем вкладку… / Проверяем открытые страницы».
  - `tab-detected`: Вкладка `boosty.to` открыта, но блок стрим-чата отсутствует (профиль автора, блог или оффлайн). Отображается «Вкладка открыта / Ожидаем чат».
  - `chat-detected`: Чат стрима обнаружен и MutationObserver активен. Отображается «Чат подключён / URL».
  - `unavailable`: Вкладка Boosty закрыта или не найдена. Отображается «Вкладка не найдена» (вместо пугающего «Недоступно») с кнопкой `[Открыть Boosty]`.

### Адаптивный Reconnect & Heartbeat (Zero-Lag Recovery):
1. **Adaptive Backoff при обрыве связи (`extension/background.js`):**
   При недоступности бэкенда Electron расширение не зависает в таймерах `chrome.alarms` на 60 сек, а производит экспоненциальный retry с задержками: `1s -> 2s -> 3s -> 5s (capped)`. При успешном соединении интервал сбрасывается на регулярный 3-секундный heartbeat.
2. **Immediate Announce (`extension/content.js`):**
   При загрузке страницы, смене видимости (`visibilitychange`), фокусе окна (`focus`) и SPA-навигации (`history.pushState`, `popstate`) content script немедленно отправляет свой статус в background и на локальный сервер, не дожидаясь тика таймера.
3. **Реестр активных вкладок (`activeBoostyTabs`):**
   Фоновый воркер расширения агрегирует состояние открытых вкладок Boosty и мгновенно очищает закрытые вкладки через `chrome.tabs.onRemoved`, предотвращая троттлинг фоновых вкладок браузера в Chromium.
4. **Спокойный Startup Grace Period & Connectivity Progress / ETA:**
   Вместо показа пугающего «Не обнаружено / Недоступно» при запуске приложения или reconnect, система отображает честный, спокойный прогресс подключения с реальными контрольными точками (milestones), живым таймером и эмпирическим ETA.
   - **Контрольные точки (Milestones):**
     - `Локальный сервер`: готов сразу после старта бэкенда Electron (T1 ~0.6 сек).
     - `Расширение`: поиск соединения с background service worker Chromium.
     - `Вкладка Boosty`: поиск открытой вкладки `boosty.to`.
     - `Чат`: проверка готовности контейнера чата стрима.
     Каждая точка имеет состояние: `done` (выполнено), `active` (выполняется), `pending` (ожидает очереди).
   - **Живой таймер и честный ETA:**
     Отображается: `Прошло X.X сек · Обычно занимает до 5 сек`. Никаких фальшивых процентов (вроде «73%») или обратных отсчётов, если точный момент неизвестен.
   - **Порог задержки (Longer-Than-Usual Threshold):**
     Если процесс превышает нормальный эмпирический порог (`CONNECTIVITY_NORMAL_THRESHOLD_MS = 5500`), баннер меняет акцент на мягкий янтарный с заголовком «Это занимает чуть дольше обычного… / Обычно подключаемся примерно за 5 сек». Это сохраняет спокойствие пользователя и исключает ложные отчёты об ошибке.
   - **Последовательная зависимость (Sequential Dependency):**
     Карточка Boosty явно сообщает «Ожидаем расширение / Сначала проверяем связь с браузером» до тех пор, пока расширение не подключено, предотвращая бессмысленный статус «Ищем вкладку» в отсутствие канала связи с браузером.
   - **Баннер восстановления (Recovery Toast/Banner):**
     При успешном завершении подключения после фазы `checking` или `reconnecting` верхняя плашка отображает спокойный статус «Подключение восстановлено / Подключение восстановлено за X.X сек. Все системы в норме.» в течение 2 секунд (`RECOVERY_FLASH_DURATION_MS = 2000`), после чего плавно переходит в стандартный статус «Готово к стриму».

### Эмпирические замеры времени запуска (Startup Timing Distribution):
Серия из 10 реальных последовательных измерений (`scripts/measure-startup-timing.js`) на системе с запущенным Brave, вкладкой Boosty (`https://boosty.to/beautiful_foot`) и установленным расширением показала:

| Запуск | T1 (Сервер готов) | T2 (Расширение) | T3 (Вкладка Boosty) | T4 (Чат) | T5 (UI готов) |
|---|---|---|---|---|---|
| Run 1 | +0.649 с | +2.552 с | +2.552 с | +2.552 с | **+2.552 с** |
| Run 2 | +0.597 с | +2.585 с | +2.585 с | +2.585 с | **+2.585 с** |
| Run 3 | +0.601 с | +2.545 с | +2.545 с | +2.545 с | **+2.545 с** |
| Run 4 | +0.607 с | +2.569 с | +2.569 с | +2.569 с | **+2.569 с** |
| Run 5 | +0.574 с | +2.536 с | +2.536 с | +2.536 с | **+2.536 с** |
| Run 6 | +0.609 с | +2.576 с | +2.576 с | +2.576 с | **+2.576 с** |
| Run 7 | +0.612 с | +2.529 с | +2.529 с | +2.529 с | **+2.529 с** |
| Run 8 | +0.560 с | +2.571 с | +2.571 с | +2.571 с | **+2.571 с** |
| Run 9 | +0.582 с | +2.541 с | +2.541 с | +2.541 с | **+2.541 с** |
| Run 10 | +0.627 с | +2.384 с | +2.384 с | +2.384 с | **+2.384 с** |

**Статистические показатели:**
- **T1 (Локальный сервер):** 560–649 мс (~0.6 сек)
- **T2/T3/T5 (Полная готовность системы):**
  - **Медиана (p50):** `2.55 с`
  - **75-й перцентиль (p75):** `2.57 с`
  - **90-й перцентиль (p90):** `2.58 с`
  - **Максимальное наблюдаемое (warm):** `2.585 с`
  - **Холодный старт (cold baseline):** `4.65 с`
- **Архитектурные константы UX:**
  - Ожидаемое время готовности (`CONNECTIVITY_EXPECTED_READY_MS`): `5000 мс` («Обычно занимает до 5 сек»)
  - Порог превышения нормы (`CONNECTIVITY_NORMAL_THRESHOLD_MS`): `5500 мс` («Это занимает чуть дольше обычного…»)
  - Длительность показа плашки восстановления (`RECOVERY_FLASH_DURATION_MS`): `2000 мс`

5. **Чистая функция `deriveSystemStatus(rawState)`**: Принимает сырое состояние (`health`, `obs`, `hasObsExecutable`, `isChecking`, `elapsedMs`, `isRecoveredRecently`, `recoveryDurationMs`) и детерминированно вычисляет статус:
   - `obs`: подключение, перезапуск, отсутствие exe, кнопка `[Запустить OBS]`.
   - `extension`: активность, устаревшая версия, кнопка `[Настроить]` / `[Обновить]`.
   - `stream`: обнаружение вкладки vs чата, последовательная зависимость от расширения, кнопка `[Открыть Boosty]`.
   - `overlay`: наличие чата в сценах, кнопка `[Добавить в сцену]` / `[Тестовое сообщение]`.
   - `overall`: общая готовность к стриму, контрольные точки (`milestones`), секундомер (`elapsedText`), ожидаемое время (`expectedText`) и статус восстановления (`recoveryText`).

---

## 11.2. Транспортная архитектура v2: Persistent WebSocket & MV3 Lifecycle

После выявления проблемы засыпания Chromium Manifest V3 Service Worker и троттлинга таймеров в фоновых вкладках (`setTimeout(3000)` урезается браузером до 1 раза в минуту или замораживается), система была переведена с HTTP-heartbeat polling на connection-oriented WebSocket транспорт:

1. **Персистентный WebSocket канал (`ws://127.0.0.1:17369/connector`):**
   - Background worker расширения держит постоянный WebSocket сокет к локальному серверу.
   - Сервер валидирует заголовок `Origin` (`chrome-extension://`, `localhost`, `127.0.0.1`, `boosty.to`) и разрывает неавторизованные соединения.
   - Рукопожатие (`HANDSHAKE` / `HANDSHAKE_ACK`) с таймаутом 5 секунд.
2. **Keepalive Ping/Pong (20 секунд):**
   - Регулярный трафик сообщений предотвращает переход сервис-воркера в idle suspension в Chromium 116+ / Brave.
3. **Порт между вкладкой и фоновым процессом (`chrome.runtime.connect({ name: 'boosty_tab' })`):**
   - Контентный скрипт открывает двусторонний порт к воркеру.
   - Изменения DOM (появление чата, смена URL, скрытие вкладки) отправляются мгновенно через события порта (`TAB_STATE`), минуя интервалы таймеров.
   - Закрытие вкладки детектируется автоматически через `port.onDisconnect`, отправляя `TAB_CLOSED` на сервер без ожидания TTL.
4. **Сохранение реестра вкладок в `chrome.storage.session`:**
   - При гибернации воркера список активных вкладок сохраняется в сессионном хранилище и мгновенно восстанавливается при пробуждении.
5. **Монотонные поколения подключений (`connectionGeneration`):**
   - Каждое новое подключение инкрементирует генерацию (`conn-1`, `conn-2`...).
   - Устаревшие асинхронные события отключения от старых сокетов игнорируются, исключая гонки и ложные переходы в `unavailable`.
6. **Сохранение статуса Boosty при временном реконнекте (Tab State Retention):**
   - Кратковременный разрыв WebSocket (до 15 секунд) переводит расширение в статус `reconnecting`, но сохраняет последнюю активную вкладку Boosty в статусе `chat-detected`.
7. **Кольцевой буфер диагностики (Diagnostic Trace Buffer):**
   - Хранит до 200 последних событий жизненного цикла (подключения, отключения, мутации вкладок).
   - Экспортируется через IPC и кнопку в UI («Экспорт диагностики подключения») для анализа инцидентов.

---

## 11.3. Decision Gate: WebSocket vs Native Messaging Host

| Критерий | Model A: HTTP Polling (legacy) | Model B: Persistent WebSocket (текущая) | Model C: Native Messaging Host |
|---|---|---|---|
| **Надёжность при MV3 Sleep** | ❌ Низкая (SW засыпает через 30с, будильник alarms урезан до 1 мин) | ✅ Высокая (WS трафик каждые 20с держит SW активным) | ✅ Абсолютная (браузер сам держит процесс хоста) |
| **Устойчивость к троттлингу вкладок** | ❌ Плохая (`setInterval` в фоне замораживается) | ✅ Отличная (события Port через `chrome.runtime.connect`) | ✅ Отличная (события Port через background) |
| **Поддержка Chrome / Brave** | ✅ Полная | ✅ Полная (Chrome 116+, Brave) | ✅ Полная |
| **Кроссплатформенность** | ✅ Windows, macOS, Linux без доп. файлов | ✅ Windows, macOS, Linux без доп. файлов | ⚠️ Требуются реестр Windows (`HKCU\Software\Google\Chrome\NativeMessagingHosts`) и JSON манифесты в Linux/macOS |
| **Сложность установки стримером** | ✅ Нулевая | ✅ Нулевая (только распакованное расширение) | ❌ Высокая (инсталлятор должен прописывать пути к исполняемому файлу в реестр ОС) |
| **Безопасность** | ⚠️ Базовая (CORS) | ✅ Высокая (Origin validation, localhost binding, handshake guard) | ✅ Максимальная (строгая привязка extension ID к manifest.json хоста) |
| **Скорость переподключения** | 2000–5000 мс | **200–400 мс (медиана 353 мс)** | < 100 мс |

### Финальный вердикт:
**Model B (Persistent WebSocket с HTTP fallback)** является оптимальным production-решением. Она полностью устраняет флаппинг и ложные отключения, удерживает воркер живым, даёт реконнект за 350 мс и не требует сложной регистрации Native Messaging в системном реестре Windows/Linux, сохраняя установку расширения в один клик. Model C остаётся как потенциальный fallback только в случае гипотетического ужесточения политик Chromium в отношении WebSocket в будущих версиях Manifest V3.

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
| Каноничный векторный ассет логотипа Boosty | [`desktop/assets/boosty.svg`](file:///home/fedor/projects/boosty-chat-overlay/desktop/assets/boosty.svg) |
| Добавление нового IPC-вызова | [`desktop/main/ipc.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/main/ipc.js) и [`desktop/preload.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/preload.js) |
| Логика вывода статусов и кнопок решений (Status Hub) | [`desktop/ui/status-hub.js`](file:///home/fedor/projects/boosty-chat-overlay/desktop/ui/status-hub.js) |
| Вёрстка и оформление карточки сообщения в OBS | [`overlay/renderer.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/renderer.js), [`overlay/style.css`](file:///home/fedor/projects/boosty-chat-overlay/overlay/style.css) |
| Поведение оверлея при получении сообщений | [`overlay/overlay.js`](file:///home/fedor/projects/boosty-chat-overlay/overlay/overlay.js) |
| Сценарии визуального QA настольного интерфейса | [`scripts/visual-test-electron.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-electron.js) |
| Сценарии визуального QA OBS-оверлея | [`scripts/visual-test-overlay.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-overlay.js) |

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

---

## 17. OBS Overlay Visual QA (`npm run test:overlay:visual`)

Для сквозного визуального тестирования страницы чата, встраиваемой в OBS Browser Source (`overlay/index.html`, `overlay/overlay.js`, `overlay/renderer.js`, `overlay/style.css`), создан специализированный раннер [`scripts/visual-test-overlay.js`](file:///home/fedor/projects/boosty-chat-overlay/scripts/visual-test-overlay.js).

### Что проверяет раннер:
1. **Реальный пайплайн доставки:** Запускается локальный HTTP-сервер на изолированном порту, страница открывается в Chromium через Playwright, сообщения подаются через настоящий `POST /message`, а конфигурация — через `POST /config`.
2. **Сценарии контента чата:**
   - Одиночное сообщение (`single-message.png`).
   - Стек из нескольких сообщений с контролем отсутствия наложения bounding boxes (`multiple-messages.png`).
   - Сообщение с цитатой/ответом (`reply-message.png`).
   - Длинный текст на 350+ символов на русском (`long-message.png`).
   - Экстремально длинный ник автора (`long-author.png`).
   - Аватар отсутствует (fallback SVG) vs локальный SVG data URL без сетевых запросов (`no-avatar.png`, `local-avatar.png`).
   - Эмодзи и юникод (`unicode-emoji.png`).
3. **Геометрия и позиционирование в OBS:**
   - Все 4 угла привязки (`top-left.png`, `top-right.png`, `bottom-left.png`, `bottom-right.png`) с автоматической проверкой квадрантов.
   - Направление добавления сообщений (`newMessagePosition: top/bottom`).
   - Ограничение максимальной высоты стека (`maxStackHeight`).
   - Узкий Browser Source стримера: `400x700` (`narrow-source.png`).
   - Невысокое окно: `600x300` (`small-height.png`).
   - Полноразмерный эфирный холст: `1920x1080` (`viewport-1920x1080.png`).
   - Пресеты отображения: Compact (`preset-compact.png`) и Large High-Contrast (`preset-large.png`).
4. **Контроль ошибок и отчёты:**
   - Полный запрет на необработанные исключения и `console.error` (`artifacts/overlay/console-errors.json`).
   - Контроль отсутствия несанкционированных внешних сетевых запросов.
   - Итоговый отчёт в `artifacts/overlay/visual-report.json`.

> [!IMPORTANT]
> **Обязательное правило для изменений оверлея:** При любых изменениях файлов `overlay/**/*` агент обязан запустить `npm run test:overlay:visual` и просмотреть созданные скриншоты в папке `artifacts/overlay/` через `view_file`.

---

## 18. Visual Overlay Positioning v1 (Drag & Drop)

Интерактивное позиционирование оверлея чата на холсте стрима во вкладке «Внешний вид» реализовано как прямой визуальный Drag & Drop над существующей моделью привязки.

### Архитектурные принципы:
1. **Единая семантическая модель:** Drag & Drop не создаёт альтернативную систему координат для OBS. Вся работа транслируется в контракт:
   ```javascript
   {
     horizontalAnchor: 'left' | 'right',
     verticalAnchor: 'top' | 'bottom',
     offsetX: number,  // 0..1000 px
     offsetY: number   // 0..800 px
   }
   ```
2. **Чистая координатная математика (`core/layout/positioning.js`):**
   - Каноническое логическое разрешение: `1920×1080`.
   - `positionFromConfig(config, boxSize, scene)`: вычисляет логический `BoundingBox` стека сообщений.
   - `getAnchorFromCenter(box, scene)`: определяет квадрант на основе центра стека (`box.left + box.width / 2 < 960 ? 'left' : 'right'`).
   - `configFromPosition(box, scene)`: вычисляет `offsetX`/`offsetY` с непрерывным переключением привязки без визуального скачка (Zero-Jump Anchor Switching).
   - `clampPosition(box, scene)`: удерживает блок сообщений строго в пределах `0 <= left`, `right <= 1920`, `0 <= top`, `bottom <= 1080`.
   - `snapPosition(box, scene)`: мягкое примагничивание к осям центра (порог 12px) и стандартным углам стрима (16, 20, 24, 32, 40 px, порог 8px).
3. **Двусторонняя синхронизация (Bidirectional Sync):**
   - Перемещение блока по холсту обновляет угловые кнопки и числовые слайдеры в реальном времени.
   - Изменение числовых инпутов или клик по угловым кнопкам немедленно перемещает hitbox на холсте.
   - Кнопка «Сбросить позицию» восстанавливает `left-bottom` и отступы `20, 20` без сброса пресета стиля («Чистый»).
4. **Производительность и плавность:**
   - Во время `pointermove` локальный DOM предпросмотра обновляется напрямую на 60fps.
   - Запись на диск и рассылка по SSE происходят через дебаунс по завершению перетаскивания (`pointerup`).

---

## 19. Профили оформления v1 (`core/config/profiles.js` & `core/config/presets.js`)

Готовые профили под тип стрима (Stream Profiles v1) позволяют одним кликом применить согласованный набор существующих параметров без смешения уровней абстракции.

### Архитектурное разделение `Profile` vs `Appearance Preset`:
1. **`Appearance Preset` (`core/config/presets.js`):**
   - Отвечает **исключительно** за визуальный стиль карточек (`STYLE_KEYS`: типографика, цвета, скругления, отступы, прозрачность, аватары, тени, размытие).
   - Четыре встроенных пресета: `clean` («Чистый»), `compact` («Компактный»), `large` («Крупный»), `glass` («Стекло»).
   - Вызов пресета никогда не перезаписывает координаты и размер стека пользователя.
2. **`Stream Profile` (`core/config/profiles.js`):**
   - Является **bundle-набором**, объединяющим `appearancePreset` + `layout` (`horizontalAnchor`, `verticalAnchor`, `offsetX`, `offsetY`, `newMessagePosition`, `textAlign`, `maxStackHeight`) + `stack` (`maxMessages`, `durationSeconds`).
   - Четыре встроенных профиля (в порядке приоритета отображения в UI):
     - `content` («Просмотр контента», `Рекомендуемый`): основной универсальный профиль для просмотра видео, фильмов, аниме и чужих стримов. Пресет `compact`, `right-bottom` (`20, 20`), `maxMessages: 3`, `durationSeconds: 12`, `newMessagePosition: 'bottom'`, `textAlign: 'left'`, `maxStackHeight: 360`.
     - `gaming` («Игры»): пресет `compact`, `left-bottom` (`24, 24`), `maxMessages: 4`, `durationSeconds: 15`, `maxStackHeight: 500`.
     - `talking` («Разговорный»): пресет `clean`, `right-bottom` (`32, 32`), `maxMessages: 6`, `durationSeconds: 25`, `textAlign: 'right'`, `maxStackHeight: 800`.
     - `minimal` («Минимализм»): пресет `compact`, `left-bottom` (`20, 20`), `maxMessages: 2`, `durationSeconds: 10`, `maxStackHeight: 300`.
3. **Production Source of Truth:**
   - В конфиге сохраняются реальные нормализованные значения полей, которые читает production overlay и OBS. Никаких скрытых переопределений по имени профиля в рантайме оверлея нет.
4. **Независимая детекция (`detectProfile` vs `detectActivePreset`):**
   - `detectProfile(config)` возвращает идентификатор профиля (`content` | `gaming` | `talking` | `minimal`) только при полном совпадении всех параметров bundle-набора, иначе возвращает `null` (в UI отображается бейдж «Пользовательский»). Устаревший идентификатор `podcast` безопасно нормализуется через `normalizeProfileId` в `null`.
   - Если после выбора профиля «Просмотр контента» или «Игры» пользователь перетаскивает чат мышью на холсте 16:9 или меняет пресет стиля на «Стекло», профиль автоматически переходит в «Пользовательский», а пресет стиля остаётся корректно распознанным («Компактный» или «Стекло»).

---

## 20. Анимации сообщений v1 (`animationType` & `animationDurationMs`)

Анимации появления и исчезновения сообщений оверлея реализованы как независимый презентационный слой, не вмешивающийся в контракты пресетов оформления, профилей стрима или сетевой транспорт SSE.

### 1. Архитектурные принципы и конфигурация:
- **Отдельный презентационный слой:** Настройки анимации не принадлежат `Appearance Preset` (`detectActivePreset`) и `Stream Profile` (`detectProfile`). Переключение пресета («Чистый», «Стекло» и др.) или профиля стрима («Игры», «Просмотр контента») сохраняет выбранный пользователем тип и скорость анимации.
- **Схема конфигурации (`core/config/schema.js`, `core/config/defaults.js`):**
  - `animationType`: `'none' | 'fade' | 'slide-up' | 'slide-side'` (по умолчанию: `'fade'`).
  - `animationDurationMs`: `150..1000` мс (по умолчанию: `280` мс).
  - Схема поддерживает как плоские ключи в корне конфига, так и вложенный объект `{ animation: { type, durationMs } }` для обратной совместимости.
- **CSS Custom Properties:** Длительности передаются в оверлей через CSS-переменные:
  ```css
  --message-animation-duration: 280ms;
  --message-exit-duration: 210ms;
  ```

### 2. Типы анимаций появления и исчезновения:
1. **`none` («Без анимации»):** Мгновенное появление карточки (`opacity: 1`), мгновенное удаление узла из DOM при истечении TTL без задержки.
2. **`fade` («Плавное появление»):** Плавное нарастание прозрачности `opacity: 0 -> 1` без `transform`.
3. **`slide-up` («Снизу вверх»):** Деликатное вертикальное смещение `translate3d(0, 16px, 0)` с нарастанием прозрачности `0 -> 1`. При `newMessagePosition: 'top'` сообщение безопасно появляется внутри контейнера без клиппинга верхней границы.
4. **`slide-side` («Сбоку»):** Направление сдвига динамически привязано к `horizontalAnchor`:
   - `left` anchor: выезжает слева `translate3d(-16px, 0, 0) -> 0`.
   - `right` anchor: выезжает справа `translate3d(16px, 0, 0) -> 0`.
   - Смещение `16px` гарантирует отсутствие горизонтального скролла на узких Browser Source `400×700` с дефолтными отступами `20px`.
5. **Исчезновение (Exit):** При истечении TTL карточке присваиваются классы `.message-exit` и `.disappearing`, запускается плавное растворение (`opacity -> 0` с микросмещением, длительность 75% от enter, clamp 120..300ms), и DOM-узел удаляется строго после завершения перехода.

### 3. Производительность и аппаратное ускорение:
- Анимируются **исключительно** свойства композитора: `transform` и `opacity`.
- Запрещено анимировать свойства верстки (`width`, `height`, `top`, `left`, `margin`, `padding`, `filter blur`).
- `will-change: transform, opacity` подключается точечно только во время активных фаз `.message-enter` и `.message-exit` и снимается в состоянии покоя.

### 4. Доступность (a11y) и Reduced Motion:
- В оверлее и десктопном приложении действует директива `@media (prefers-reduced-motion: reduce)`.
- При включении системного режима снижения движения длительность анимации форсируется в `0.01ms`, анимации отключаются на лету, а сохранённая конфигурация пользователя остаётся интактной.

### 5. Подавление каскада при History & Reconnect:
- При первичном открытии оверлея или восстановлении соединения через `Last-Event-ID` исторические сообщения рендерятся сразу в settled-состоянии (без класса `.message-enter`).
- Анимация запускается только для живых входящих сообщений (`performance.now() > sseOpenBatchUntil` и свежий `receivedAt`).

### 6. Детерминированное визуальное тестирование:
- При `BOOSTY_OVERLAY_UI_TEST=1` оверлей переходит в детерминированный режим (`BoostyRenderer.setDeterministicMode(true)`), где длительность сбрасывается в `0` для исключения случайных полукадров на скриншотах.
- Для проверки анимаций в раннере используется специальный хук `preview:replay-animation` и проверка DOM-жизненного цикла (`data-lifecycle: entering -> visible -> exiting -> removed`).

---

## 21. Режим Focus Mode / Основной режим настроек (`desktop/`, `core/config/size-presets.js`)

Focus Mode предоставляет компактный, сфокусированный интерфейс настройки внешнего вида оверлея (~20–30 секунд на полную подготовку к стриму) без перегрузки стримера десятками технических параметров.

### 1. Архитектурный инвариант: единый источник истины (Single Source of Truth)
- Focus Mode является **исключительно альтернативным представлением (UI layer)** над существующим объектом конфигурации `currentConfig`.
- Категорически исключено разделение на `basicConfig` / `advancedConfig`.
- Оба режима (Основное / Расширенное) читают и изменяют одни и те же канонические поля схемы конфигурации.
- Двусторонняя синхронизация выполняется синхронно и без задержек.

### 2. Переключатель режима и сохранение предпочтения:
- Переключатель `[ Основное ] [ Расширенное ]` расположен в верхней части раздела «Внешний вид» (`#appearance-mode-bar`).
- По умолчанию для нового пользователя активен режим `basic` («Основное»).
- Выбранный режим сохраняется в `localStorage['boosty_appearance_ui_mode']` как клиентское UI-предпочтение.
- Предпочтение режима **не попадает** в файл конфигурации оверлея, не передается по SSE и не влияет на распознавание профилей стрима (`detectProfile`).

### 3. Состав Focus Mode (только ключевые параметры):
1. **Профиль стрима:** Выбор существующих встроенных профилей (`content`, `gaming`, `talking`, `minimal`, `custom`). Рекомендованный по умолчанию: «Просмотр контента».
2. **Позиция чата:** Общий визуальный интерактивный холст 16:9 с Drag & Drop, 4 углами быстрой привязки и сбросом позиции.
3. **Размер чата:** Пресеты размера (`[ Компактный ] [ Обычный ] [ Крупный ]`), связанные с существующими полями через чистый модуль `core/config/size-presets.js` (`cardWidth`, `fontSize`, `authorFontSize`, `cardPadding`, `messageGap`, `borderRadius`, `avatarSize`). При ручном изменении любого из параметров в расширенном режиме отображается бейдж «Пользовательский».
4. **Количество сообщений:** Компактный степпер `[ - ] N [ + ]`, привязанный к `maxMessages` (1..20).
5. **Время показа:** Быстрый выбор через pills `[ 10 сек ] [ 12 сек ] [ 15 сек ] [ 25 сек ] [ Всегда ]`, привязанный к `durationSeconds` (0 = всегда).
6. **Анимация сообщений:** Выбор типа (`none`, `fade`, `slide-up`, `slide-side`) и скорости (`fast`, `normal`, `smooth`).
7. **Progressive Disclosure:** Кнопка «Больше настроек →» для перехода в «Расширенное» и «← Вернуться к основным» в расширенном режиме.
