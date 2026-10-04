# AI Agent Guidelines for Boosty Chat Overlay

## 1. Mandatory UI Visual QA Rules (Strict Invariants)

> [!IMPORTANT]
> **Разделение задач по интерфейсу:**
>
> 1. **Desktop UI (`desktop/**/*`):**
>    Любые изменения `desktop/index.html`, `desktop/app.css`, `desktop/app.js` или `desktop/ui/*` считаются завершёнными **ТОЛЬКО** после запуска `npm run test:ui:visual` и обязательного просмотра всех затронутых скриншотов в `artifacts/ui/` через `view_file`.
>
> 2. **OBS Overlay (`overlay/**/*`):**
>    Любые изменения `overlay/index.html`, `overlay/overlay.js`, `overlay/renderer.js` или `overlay/style.css` считаются завершёнными **ТОЛЬКО** после запуска `npm run test:overlay:visual` и обязательного просмотра всех затронутых скриншотов в `artifacts/overlay/` через `view_file`.
>
> 3. **Desktop + Overlay:** Если задача затронула обе части — **обязательны обе команды** и просмотр скриншотов обеих папок.
>
> Агенту категорически запрещено завершать задачу по UI или отчитываться пользователю, опираясь исключительно на то, что «код компилируется» или «тесты прошли». Необходима двухпроходная визуальная инспекция (Two-Pass Visual QA) созданных PNG-скриншотов.

---

## 2. Project Architecture Invariants

Перед внесением изменений всегда сверяйтесь с [`ARCHITECTURE.md`](./ARCHITECTURE.md) и проективным скиллом [`.agents/skills/boosty-overlay-dev/SKILL.md`](./.agents/skills/boosty-overlay-dev/SKILL.md):

1. **Изоляция `core/`:** Пакет `core/` не зависит от Electron, DOM или OBS. Это чистый Node.js.
2. **OBS в `desktop/obs/`:** Вся логика взаимодействия с OBS WebSocket v5 живёт строго в `desktop/obs/`. Не переносить OBS-логику в `desktop/main.js` или `core/`.
3. **Очередь мутаций OBS (`createMutationQueue`):** Любые операции добавления/удаления источников в OBS обязаны проходить через очередь мутаций и блокироваться во время смены коллекций сцен (`CurrentSceneCollectionChanging`).
4. **Тонкий IPC-слой (`desktop/main/ipc.js`):** Хендлеры `ipcMain.handle` являются только клеем (валидация аргументов и делегирование в сервисы). Бизнес-логика в IPC запрещена.
5. **Контракт сообщений `NormalizedMessage`:** Поля `publishedAt` (время чата для отображения) и `receivedAt` (серверное время для TTL) строго разделены. Хеш fallback ID строится детерминированно по FNV-1a.
6. **Безопасность продакшена:** Тестовые хуки (`window.__BOOSTY_UI_TEST__`, `window.boostyAudit`) подключаются ТОЛЬКО при `BOOSTY_OVERLAY_UI_TEST=1` и обязаны быть `undefined` в обычном режиме.

---

## 3. Task-Specific Verification Guidelines

### 3.1. Изменения только overlay CSS/UI (`overlay/**/*`)
```bash
npm run test:overlay:visual
```
Обязательный двухпроходный визуальный аудит всех затронутых скриншотов в `artifacts/overlay/` через `view_file`.

### 3.2. Изменения Desktop UI (`desktop/**/*`)
```bash
npm run test:ui:visual
```
Обязательный двухпроходный визуальный аудит скриншотов в `artifacts/ui/` через `view_file`.

### 3.3. Изменения parser / extension / Boosty DOM integration (`extension/**/*`, `core/messages/*`)
```bash
# Базовый цикл
npm run check
npm test
npm run test:integration
npm run test:overlay:visual

# Боевой E2E-контур
npm run test:live
```

> [!NOTE]
> `npm run test:live` может быть `SKIP` **только** если:
> 1. Нет настроенного `BOOSTY_LIVE_QA_URL` и в браузере нет активного стрим-чата Boosty;
> 2. Браузерная сессия не авторизована на Boosty.
> В таком случае агент **обязан явно уведомить пользователя**, что live coverage пропущен, и указать точную причину.

### 3.4. Автономный полный боевой E2E-контур (`npm run test:live:full`)

> [!CAUTION]
> `npm run test:live:full` **НИКОГДА** не запускается автоматически при обычном изменении файлов, в базовом цикле проверок или в CI.
> Он запускается **ТОЛЬКО** когда:
> 1. Пользователь явно запросил полный деструктивный Live E2E тест;
> 2. Задан обязательный флаг окружения: `BOOSTY_LIVE_QA_DESTRUCTIVE=1`;
> 3. Требуется реальная проверка полного жизненного цикла стрима (создание через UI, запуск, StreamChat, сценарии сообщений, OBS композитинг, остановка через UI/API).

---

## 4. Mandatory Pre-Completion Verification Checklist

Перед завершением любой задачи и отправкой отчёта пользователю выполните полный проверочный цикл:

```bash
# 1. Синтаксис всех JS-файлов
npm run check

# 2. Модульные тесты
npm test

# 3. Интеграционные тесты в реальном Electron
npm run test:integration

# 4. Визуальное тестирование Desktop UI (если затронут desktop/)
npm run test:ui:visual

# 5. Визуальное тестирование OBS Overlay (если затронут overlay/)
npm run test:overlay:visual

# 6. Проверка форматирования и git diff
git diff --check
```
