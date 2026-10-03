# Rule: Mandatory Electron UI Visual QA

## Triggers
This rule applies whenever any files matching `desktop/**/*` or `overlay/**/*` are created, edited, reviewed, or refactored.

## Core Mandate
> **Любые изменения `desktop/index.html`, `desktop/app.css`, `desktop/app.js` или `desktop/ui/*` считаются завершёнными только после `npm run test:ui:visual` и просмотра всех затронутых скриншотов через `view_file`.**

## Two-Pass Visual QA Protocol
1. **Pass 1 — Automated Execution:**
   - Run `npm run test:ui:visual`.
   - Ensure exit code 0, `layoutIssuesCount === 0`, and `consoleErrorsCount === 0` in `artifacts/ui/visual-report.json`.
2. **Pass 2 — Visual Inspection (Agent's Eyes):**
   - Use `view_file` on generated `.png` artifacts in `artifacts/ui/`.
   - Check multi-viewport responsiveness (`dashboard-1280x850.png`, `dashboard-1000x750.png`, `dashboard-800x650.png`).
   - Check Cyrillic typography: Russian words must not break awkwardly or overflow card bounds.
   - Check spacing rhythm (4px/8px grid) and component states.
   - Verify long content stress state (`state-long-content.png`) maintains zero horizontal scroll.
