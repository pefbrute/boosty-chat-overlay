# AI Agent Guidelines for Boosty Chat Overlay

## 1. Mandatory UI Visual QA Rule (Strict Invariant)

> [!IMPORTANT]
> **Любые изменения `desktop/index.html`, `desktop/app.css`, `desktop/app.js` или `desktop/ui/*` считаются завершёнными ТОЛЬКО после запуска `npm run test:ui:visual` и обязательного просмотра всех затронутых скриншотов через `view_file`.**
>
> Агенту категорически запрещено завершать задачу по UI или отчитываться пользователю, опираясь исключительно на то, что «код компилируется» или «тесты прошли». Необходима двухпроходная визуальная инспекция (Two-Pass Visual QA) созданных PNG-скриншотов в `artifacts/ui/`:
> - Проверка отступов (4px/8px сетка);
> - Контроль переноса и читаемости русских строк (Cyrillic localization);
> - Контроль отсутствия горизонтального скролла (`scrollWidth <= innerWidth`);
> - Контроль нулевых или съехавших элементов на всех трёх вьюпортах (`1280x850`, `1000x750`, `800x650`).

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

## 3. Mandatory Pre-Completion Verification Checklist

Перед завершением любой задачи и отправкой отчёта пользователю выполните полный проверочный цикл:

```bash
# 1. Синтаксис всех JS-файлов
npm run check

# 2. Модульные тесты
npm test

# 3. Интеграционные тесты в реальном Electron
npm run test:integration

# 4. Визуальное тестирование UI (если затронут интерфейс)
npm run test:ui:visual

# 5. Проверка форматирования и git diff
git diff --check
```
