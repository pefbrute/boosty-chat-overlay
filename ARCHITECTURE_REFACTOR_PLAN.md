# План поэтапного архитектурного рефакторинга `boosty-chat-overlay`

> **Статус документа:** Предложение к согласованию перед началом работ  
> **Дата:** Октябрь 2026  
> **Базовое правило:** Никакого переписывания ради переписывания. Сохранять 100% работоспособность текущего конвейера (Boosty DOM parser, Extension, SSE delivery, OBS WebSocket, WYSIWYG preview).  
> **Текущий статус тестов:** `npm test` (14/14 server assertions, 11/11 parser tests, 5/5 resilience tests — **PASS**), `npm run test:integration` (все сценарии — **PASS**).

---

## 1. Концепция и архитектурные ориентиры

По итогам исследования [FORK_RESEARCH.md](file:///home/fedor/projects/boosty-chat-overlay/FORK_RESEARCH.md) мы отказались от форка чужих репозиториев (AxelChat — проприетарный закрытый код; BetterYTChatHub — недоступен/404; ChallaChat/SocialStream — тяжелый headless Chrome или монолит на 4000+ файлов).

Мы развиваем **свою компактную и надежную кодовую базу (~2500 строк)**, заимствуя лучшие архитектурные приемы:
1. **Из ChallaChat:** нормализованная модель сообщения (`ChatEvent` с `AuthorInfo` и сегментами) и изолированный `SSEHub`.
2. **Из StreamHelper:** модульный сервис OBS WebSocket (`obs.ts`), разделение Electron `main/` на доменные сервисы и четкий контракт состояний.
3. **Наши ключевые преимущества (неприкосновенны):**
   - Неинвазивный DOM-парсер расширения (без передачи паролей/токенов в приложение);
   - Автоматическое создание служебной сцены `Boosty Chat Overlay` и встраивание источника `Boosty Chat` в сцену стримера;
   - Быстрый локальный транспорт без облаков и сторонних серверов.

---

## 2. Анализ необходимости и стратегии TypeScript

### Где TypeScript критически полезен:
1. **Контракты данных (Shared Types):**
   - Модель сообщения `ChatMessage` / `ChatEvent`.
   - Модель конфигурации `OverlayConfig` (числовые диапазоны, якоря, цвета).
   - Модель состояния OBS (`OBSState`) и коннектора (`ConnectorState`).
   - Контракт IPC-каналов между Electron Main и Renderer.
   *Польза:* исключает рассинхронизацию полей между расширением, сервером, десктопом и оверлеем. Предотвращает опечатки в свойствах.

### Где TypeScript сейчас избыточен:
- `extension/content.js` и `extension/background.js` — браузерное расширение загружается браузером напрямую без бандлера. Введение компилятора ради двух скриптов усложнит сборку без практической выгоды.
- Вспомогательные проверочные скрипты (`scripts/`).

### Стратегия внедрения:
- **JSDoc + TypeScript Type Checking (`tsc --noEmit` / `checkJs`):** на первых этапах описываем типы в `types/` или через `.d.ts` / JSDoc-аннотации. Это дает 90% преимуществ автодополнения и валидации типов в IDE/AI без изменения пайплайна сборки.
- **Полная транспиляция (при необходимости):** только для новых модулей `core/` и `desktop/main/obs/`, когда потребуется компилятор (например, переход на `electron-vite` в будущем).

---

## 3. Модель состояния приложения (State Architecture)

Состояние четко разделяется на 4 независимых домена:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              APP STATE                                 │
├─────────────────────┬───────────────────┬──────────────┬───────────────┤
│     OBSState        │  ConnectorState   │ OverlayConfig│  UIAppState   │
├─────────────────────┼───────────────────┼──────────────┼───────────────┤
│ - status            │ - extensionOnline │ - duration   │ - currentView │
│   (disconnected /   │ - boostyOnline    │ - layout     │ - onboarding  │
│    connecting /     │ - extensionVer    │ - typography │ - activeTab   │
│    connected /      │ - isOutdated      │ - colors     │ - saveStatus  │
│    error)           │ - streamUrl       │ - bounds     │ - bannerQueue │
│ - host / port       │ - lastSeenAt      │ - maxStack   │               │
│ - scenes: []        │ - clientCount     │              │               │
│ - currentScene      │                   │              │               │
│ - overlayReady      │                   │              │               │
│ - error: string     │                   │              │               │
└─────────────────────┴───────────────────┴──────────────┴───────────────┘
```

Каждое состояние сериализуемо, передается через IPC/HTTP как обычный JSON и не требует тяжелых библиотек (Redux/Zustand).

---

## 4. Поэтапный план рефакторинга

---

### Фаза 1. Нормализация модели сообщений (`core/messages`)

#### Проблема сейчас:
Парсер в `extension/parser.js` возвращает `{ id, author, text, avatar, publishTime, reply }`. В `server.js` этот объект трансформируется в плоский `{ id, author, text, avatar, timestamp, receivedAt, eventId }`, при этом `reply` и `publishTime` отбрасываются. Оверлей ожидает `message.author` как строку. Если в будущем добавить форматирование ников, бейджи модератора или донаты — текущая схема сломается.

#### Что делаем:
1. Создаем модуль `core/messages/model.js` (и `types/message.d.ts`):
   - Описываем нормализованный формат `NormalizedMessage`:
     ```js
     {
       id: string,               // ID от Boosty или FNV-1a fallback
       platform: 'boosty',       // Идентификатор платформы
       author: {
         name: string,
         avatar: string
       },
       text: string,
       reply: {
         author: string,
         text: string
       } | null,
       publishedAt: string | null,
       receivedAt: number,
       eventId: string           // Серверный порядковый номер для SSE
     }
     ```
   - Добавляем адаптер обратной совместимости (getters / fallback свойства `author` и `avatar` на верхнем уровне), чтобы существующий `overlay/renderer.js` продолжал работать без изменений.
2. В `extension/parser.js` приводим результат к нормализованной структуре.
3. В `server.js` валидируем и нормализуем входящие сообщения через `core/messages/model.js`.
4. Покрываем модульными тестами в `test/message-model.test.js`.

#### Затрагиваемые файлы:
- `core/messages/model.js` (новый)
- `extension/parser.js`
- `server.js`
- `overlay/renderer.js` (добавление поддержки нового формата с сохранением старого)
- `test/message-model.test.js` (новый)
- `test/parser.test.js`

#### Риски и защита:
- *Риск:* старый оверлей не отобразит ник, если `message.author` станет объектом `{ name }`.
- *Защита:* обратная совместимость на уровне нормализатора: поле `author` сохраняет имя строкой, а расширенный объект доступен как `authorInfo` / геттер, либо оверлей поддерживает обе формы: `typeof message.author === 'object' ? message.author.name : message.author`.

#### Примерный размер изменения:
- ~120 строк нового кода, минимальные точечные правки существующих файлов.

---

### Фаза 2. Модульное разделение `server.js` (`core/`)

#### Проблема сейчас:
Файл `server.js` (380 строк) содержит сразу всё: чтение и валидацию конфига оверлея с диска, хранение и дедупликацию истории в памяти, управление подключенными SSE-клиентами, трекинг пульса расширения/стрима и HTTP-роутинг с ручным разбором URL.

#### Что делаем:
Постепенно выделяем функционал в чистые независимые модули `core/`:
```text
core/
  config/
    defaults.js       // Базовые значения настроек
    schema.js         // Валидация и нормализация границ (числа, цвета, якоря)
    storage.js        // Чтение и атомарная запись overlay-settings.json
  messages/
    model.js          // (Создан в Фазе 1)
    history.js        // Кольцевой буфер (MAX_HISTORY = 50), Last-Event-ID replay
    dedup.js          // Окно дедупликации (5000 мс)
  sse/
    hub.js            // Реестр клиентов, ping/heartbeat, рассылка событий и конфига
  health/
    tracker.js        // Учет времени последнего отклика коннектора, расширения, вкладки
```
Сам файл `server.js` превращается в компактный HTTP-диспетчер (до 80-100 строк), который только монтирует эндпоинты (`/health`, `/config`, `/connector`, `/events`, `/message`, `/test`, `/overlay/*`) к соответствующим модулям `core/`.

#### Затрагиваемые файлы:
- `core/config/*` (новые)
- `core/messages/history.js`, `core/messages/dedup.js` (новые)
- `core/sse/hub.js` (новый)
- `core/health/tracker.js` (новый)
- `server.js` (рефакторинг в роутер)
- `scripts/test-server.js` (верификация)

#### Риски и защита:
- *Риск:* регрессия в SSE reconnect или потере заголовка `Last-Event-ID`.
- *Защита:* запуск существующего всестороннего теста `scripts/verify-resilience.js` и `scripts/test-server.js` после каждого шага.

#### Примерный размер изменения:
- ~350 строк, разнесенных по 5 небольшим файлам (каждый файл по 40–80 строк).

---

### Фаза 3. Выделение единого OBS Service (`desktop/obs/`)

#### Проблема сейчас:
Файл `desktop/main.js` (600 строк) перегружен логикой OBS: прямое хранение экземпляра `obs-websocket-js`, ручная очередь мутаций `enqueueUserMutation`, таймеры опроса `scheduleObsRefresh`, авто-включение WebSocket в файле конфигурации OBS, запуск бинарника `obs64.exe` и операции с источниками (`GetSceneItemList`, `CreateInput`, `CreateSceneItem`). Жизненный цикл Electron окна и операции OBS намертво сцеплены.

#### Что делаем:
Создаем отдельный изолированный сервис OBS, вдохновленный реализацией `ObsService` из `StreamHelper`:
```text
desktop/
  obs/
    client.js         // Управление подключением obs-websocket-js v5, реконнекты, события
    config.js         // Обнаружение пути к config.json OBS и exe-файлу, авто-включение
    scenes.js         // Логика служебной сцены: поиск, создание Boosty Chat Overlay, встраивание
    service.js        // Фасад ObsService (единая точка входа для Electron IPC)
```
- GUI и IPC работают **только** с фасадом `ObsService`.
- В `desktop/main.js` исчезают сотни строк низкоуровневых вызовов `obs.call(...)`.

#### Затрагиваемые файлы:
- `desktop/obs/client.js` (новый)
- `desktop/obs/config.js` (новый)
- `desktop/obs/scenes.js` (новый)
- `desktop/obs/service.js` (новый)
- `desktop/main.js` (очистка от OBS-логики)
- `scripts/obs-smoke-test.js`

#### Риски и защита:
- *Риск:* нарушение последовательности создания сцены при смене коллекции сцен OBS.
- *Защита:* сохранение проверенной логики блокировки мутаций (`sceneCollectionChanging`) и автоматического восстановления сцены. Запуск `npm run test:integration`.

#### Примерный размер изменения:
- ~300 строк кода, вынесенных из `main.js` в модульную структуру `desktop/obs/`.

---

### Фаза 4. Структурирование логики браузеров и IPC в Electron (`desktop/main/`)

#### Проблема сейчас:
В `desktop/main.js` после выноса OBS все еще остаются поиск установленных браузеров, распаковка расширения, открытие системных путей и регистрация всех IPC-хендлеров в куче.

#### Что делаем:
1. Выделяем браузерную логику в `desktop/browser/manager.js`:
   - `installedBrowsers()`, `openPreferredBrowser()`, `prepareBrowserExtension()`.
2. Выделяем IPC-хендлеры в `desktop/main/ipc.js`:
   - Регистрация строго типизированных каналов связи с UI (`obs-connect`, `obs-set-scene`, `open-browser`, `save-config`).
3. `desktop/main.js` сокращается до чистого жизненного цикла Electron-приложения (~80-100 строк: запуск сервера, создание окна, трей, завершение работы).

#### Затрагиваемые файлы:
- `desktop/browser/manager.js` (новый)
- `desktop/main/ipc.js` (новый)
- `desktop/main.js` (финальная очистка)

#### Риски и защита:
- Минимальные риски, чисто механическое перемещение вспомогательных функций.

#### Примерный размер изменения:
- ~180 строк.

---

### Фаза 5. Аудит и улучшение статус-панели GUI стримера [Завершена]

*Статус:* Завершена. Создан модуль `desktop/ui/status-hub.js` с чистой функцией `deriveSystemStatus()`. В `desktop/index.html` и `desktop/app.css` внедрен 4-карточный Status Hub (OBS Studio, Расширение Boosty, Стрим Boosty, Оверлей в OBS) с контекстными CTA кнопками. Добавлен набор тестов `test/status-hub.test.js` (7/7 PASS), все регрессионные тесты PASS.

#### Проблема сейчас:
В интерфейсе стримера (`desktop/index.html` и `desktop/app.js`) статусы разбросаны: есть отдельные карточки, шаги онбординга и бейджи. При возникновении проблемы (например, OBS закрыт или вкладка Boosty не открыта) стример видит индикатор, но не всегда получает мгновенную кнопку решения в одном месте.

#### Что делаем:
1. Проектируем единый блок состояния в Дашборде (Status Hub):
   ```text
   ┌─────────────────────────────────────────────────────────────┐
   │ СТАТУС СИСТЕМЫ                                              │
   ├──────────────────┬─────────────────┬────────────────────────┤
   │ OBS Studio       │ ● Подключен     │ [Сцена: "Игровая"]     │
   │ Расширение       │ ● Активно v0.4  │ [Проверить]            │
   │ Стрим Boosty     │ ● Обнаружен     │ [boosty.to/streamer]   │
   │ Оверлей в OBS    │ ● Отображается  │ [Тестовое сообщение]   │
   └──────────────────┴─────────────────┴────────────────────────┘
   ```
2. **Actionable Alerts (Конкретные подсказки при сбое):**
   - Если OBS не запущен: `[Запустить OBS]` прямо в плашке статуса.
   - Если расширение не шлет heartbeat: `[Открыть расширения Brave]` в один клик.
   - Если стрим не открыт: `[Открыть Boosty]`.
   - Если сцена удалена: `[Восстановить в сцене X]`.
3. Сохраняем текущую верстку и стили (`app.css`), дорабатывая только информативность и четкость индикаторов.

#### Затрагиваемые файлы:
- `desktop/index.html`
- `desktop/app.js`
- `desktop/app.css`
- `test/ui-redesign.test.js`

#### Риски и защита:
- Прогон существующих тестов интерфейса `test/ui-redesign.test.js` для предотвращения поломки селекторов и структуры.

#### Примерный размер изменения:
- ~150 строк HTML/CSS/JS.

---

### Фаза 6. Документация для AI и разработчиков (`ARCHITECTURE.md`) [Завершена]

*Статус:* Завершена. Создан актуальный документ [ARCHITECTURE.md](file:///home/fedor/projects/boosty-chat-overlay/ARCHITECTURE.md), полностью отражающий реальную кодовую базу после Phase 1–5: потоки данных, контракты NormalizedMessage, SSE и HTTP API, устройство OBS Service, границы IPC, Status Hub, инварианты безопасности и карту внесения изменений.

---

## 5. Итоги архитектурного рефакторинга

**Architecture refactor Phase 1–6: COMPLETE**

Все 6 запланированных фаз архитектурного рефакторинга полностью реализованы, покрыты автоматическими тестами и задокументированы:
1. **Phase 1 (Модель сообщений):** Выделен контракт `NormalizedMessage`, схема валидации и типы `types/message.d.ts`.
2. **Phase 2 (Сервер):** Монолит `server.js` разделен на независимые модули `core/config/`, `core/health/`, `core/messages/`, `core/sse/`.
3. **Phase 3 (OBS Service):** Вся интеграция с OBS вынесена в `desktop/obs/` с mutex-очередью мутаций и защитой от race conditions.
4. **Phase 4 (Browser Manager & IPC):** Управление браузерами вынесено в `desktop/browser/manager.js`, IPC-адаптеры в `desktop/main/ipc.js`, а `desktop/main.js` сокращен до 84 строк.
5. **Phase 5 (Status Hub):** Создан чистый модуль вычисления статусов `desktop/ui/status-hub.js` и 4-карточный адаптивный Status Hub в GUI стримера.
6. **Phase 6 (Архитектурная документация):** Написан компактный справочник `ARCHITECTURE.md` для AI-агентов и разработчиков.

*Опциональный техдолг (не блокирующий):* Возможная будущая декомпозиция `desktop/app.js` (модальные окна, онбординг) при появлении новых крупных фич.

---

## 6. Сводная таблица фаз

| Фаза | Название | Затрагиваемые области | Статус | Критерий готовности |
|---|---|---|---|---|
| **Phase 1** | **Нормализация модели сообщения** | `core/messages/`, `extension/parser.js`, `server.js`, `overlay/` | **PASS** | Юнит-тесты модели + `npm test` PASS |
| **Phase 2** | **Модульное разделение `server.js`** | `core/config/`, `core/sse/`, `core/health/`, `server.js` | **PASS** | `scripts/test-server.js` и `verify-resilience.js` PASS |
| **Phase 3** | **Выделение OBS Service** | `desktop/obs/`, `desktop/main.js` | **PASS** | `npm run test:integration` PASS |
| **Phase 4** | **Структурирование Electron Main & IPC** | `desktop/browser/`, `desktop/main/`, `desktop/main.js` | **PASS** | Electron запускается и проходит интеграционные тесты |
| **Phase 5** | **Улучшение статус-панели GUI** | `desktop/index.html`, `desktop/app.js`, `desktop/app.css` | **PASS** | `test/status-hub.test.js` и `test/ui-redesign.test.js` PASS |
| **Phase 6** | **Документация `ARCHITECTURE.md`** | `ARCHITECTURE.md` | **PASS** | Файл создан, точен и актуален |

---

## 6. Рекомендуемый первый шаг

Рекомендуется начать строго с **Фазы 1 (Нормализация модели сообщений)**:
1. Она не требует структурных перемещений файлов сервера или десктопа.
2. Она решает фундаментальную задачу отделения данных Boosty от оверлея и сервера.
3. Она легко и надежно верифицируется существующими юнит-тестами парсера и новым тестом `test/message-model.test.js`.
