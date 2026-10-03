# Rule: Mandatory UI Visual QA (Desktop & Overlay)

## Triggers & Scope Routing
- При изменениях `desktop/index.html`, `desktop/app.css`, `desktop/app.js` или `desktop/ui/*`:
  **Обязателен запуск `npm run test:ui:visual`** + инспекция скриншотов в `artifacts/ui/`.
- При изменениях `overlay/index.html`, `overlay/overlay.js`, `overlay/renderer.js` или `overlay/style.css`:
  **Обязателен запуск `npm run test:overlay:visual`** + инспекция скриншотов в `artifacts/overlay/`.
- Если затронуты обе части: **обязателен запуск обеих команд**.

## Core Mandates
> **Любые изменения `desktop/**/*` считаются завершёнными ТОЛЬКО после `npm run test:ui:visual` и обязательного просмотра всех затронутых скриншотов через `view_file`.**
>
> **Любые изменения `overlay/**/*` считаются завершёнными ТОЛЬКО после `npm run test:overlay:visual` и обязательного просмотра всех затронутых скриншотов через `view_file`.**

## Two-Pass Visual QA Protocol
1. **Pass 1 — Automated Execution:**
   - Для Desktop UI: `npm run test:ui:visual` (`artifacts/ui/visual-report.json`, `consoleErrorsCount === 0`, `layoutIssuesCount === 0`).
   - Для Overlay: `npm run test:overlay:visual` (`artifacts/overlay/visual-report.json`, `consoleErrorsCount === 0`, `layoutIssuesCount === 0`, `failedRequestsCount === 0`).
2. **Pass 2 — Visual Inspection (Agent's Eyes):**
   - Открыть сгенерированные `.png` через `view_file`.
   - Проверить адаптивность вьюпортов, отсутствие наложения карточек, переносы длинных русских строк, отступы и позиционирование в углах (4 anchors).
