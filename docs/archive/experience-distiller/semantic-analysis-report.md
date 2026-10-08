# Отчёт Семантического Анализа и Аудита Качества (Experience Distiller v2.1)

## 1. Сводные метрики экосистемы
- **Всего проанализировано сессий:** 50
- **Сформировано возможностей в реестре:** 82
- **Подтверждено качественных возможностей (Confirmed):** 11
- **Выявлено дубликатов (Duplicates):** 9
- **Слабых доказательств / ложных срабатываний (Weak Evidence):** 45
- **Уже решено (Already Solved):** 5

## 2. Топ подтверждённых возможностей высокой ценности

| ID | Название | Категория | Приоритет | Уверенность | Вердикт | Проекты |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `opp-rout-missing_binary_gh` | Устранение отсутствующих зависимостей: Missing executable or CLI dependency: gh | routine | 96/100 | 98% | **confirmed** | boosty-chat-overlay, personal-life-db |
| `opp-erro-test_suite_assertion_failure` | Предотвращение регрессий и сбоев тестов: Test suite assertion failure in "grep | error | 94/100 | 98% | **confirmed** | LifeBoard, boosty-chat-overlay, personal-life-db |
| `opp-rout-virtualbox_guestcontrol_vm_sync` | Устойчивая автоматизация управления Windows VM (Winda) | routine | 94/100 | 98% | **confirmed** | infra, boosty-chat-overlay |
| `opp-erro-nonzero_exit_python3_code_1` | Устранение повторяющегося сбоя: Command failure: "python3 -c \"\nimport sqlite3\ncon = sqlite3.connect('data/ (exit 1) | error | 89/100 | 98% | **confirmed** | LifeBoard, boosty-chat-overlay, personal-life-db |
| `opp-qa-multi-step-test-verification-gate` | Автоматизация многошагового цикла верификации (Preflight Gate) | qa | 88/100 | 98% | **already_solved** | boosty-chat-overlay |
| `opp-erro-nonzero_exit_git_code_1` | Устранение повторяющегося сбоя: Command failure: "git grep -i -E \"playbook|research_queue|research queue|can (exit 1) | error | 86/100 | 98% | **confirmed** | boosty-chat-overlay, personal-life-db |
| `opp-rout-git_diff_whitespace_check_failed` | Автоматическая очистка концевых пробелов и EOF перед git diff | routine | 82/100 | 98% | **confirmed** | boosty-chat-overlay |
| `opp-erro-nonzero_exit_life_code_1` | Устранение повторяющегося сбоя: Command failure: "./life movement validate" (exit 1) | error | 80/100 | 98% | **confirmed** | personal-life-db |
| `opp-erro-nonzero_exit_sqlite3_code_1` | Устранение повторяющегося сбоя: Command failure: "sqlite3 ~/.config/Throne/config/throne.db \"SELECT id, name (exit 1) | error | 80/100 | 98% | **confirmed** | personal-life-db |
| `opp-erro-filesystem_permission_denied` | Устранение повторяющегося сбоя: File or socket permission denied | error | 76/100 | 98% | **confirmed** | boosty-chat-overlay, personal-life-db |
| `opp-erro-nonzero_exit_curl_code_28` | Устранение повторяющегося сбоя: Command failure: "curl -Iv --max-time 5 https://www.google.com && curl -Iv -- (exit 28) | error | 76/100 | 98% | **confirmed** | boosty-chat-overlay, personal-life-db |
| `opp-deci-local-first-release-security-audit` | Стандартизация локального аудита безопасности десктопных релизов | decision | 75/100 | 90% | **already_solved** | boosty-chat-overlay |
| `opp-know-chromium-webui-external-command-block` | Блокировка Chromium WebUI при внешнем вызове командной строки | knowledge | 75/100 | 90% | **already_solved** | boosty-chat-overlay |
| `opp-erro-node_syntax_or_module_type` | Защита от синтаксических ошибок в командной строке (node_syntax_or_module_type) | error | 72/100 | 98% | **confirmed** | boosty-chat-overlay, personal-life-db |
| `opp-know-chromium_webui_external_launch_block` | Инвариант открытия WebUI расширений: исключение внешнего CLI запуска | knowledge | 70/100 | 65% | **already_solved** | boosty-chat-overlay |

## 3. Глубокий разбор корневых причин (Root Cause & Evidence)

### 1. Устранение отсутствующих зависимостей: Missing executable or CLI dependency: gh (`opp-rout-missing_binary_gh`)
- **Первопричина (Root Cause):** Релизные чеклисты предполагают наличие GitHub CLI, однако агент не проверяет факт его наличия в PATH перед запуском составных скриптов.
- **Обоснование аудита:** Отсутствие GitHub CLI (gh) в PATH приводит к срыву релизных проверок
- **Рекомендуемое решение:** Встроить в preflight-скрипты быструю проверку внешних зависимостей (node, git, gh) с выводом рекомендаций или плавным переходом на локальные альтернативы (git tag).
- **Ожидаемая польза:** Мгновенное предупреждение об отсутствии утилиты вместо сбоя релизного контура посреди процесса.
- **Фактический статус:** new

### 2. Предотвращение регрессий и сбоев тестов: Test suite assertion failure in "grep (`opp-erro-test_suite_assertion_failure`)
- **Первопричина (Root Cause):** Тесты resilience и server используют фиксированные имена файлов в корне репозитория (chat-history.json, overlay-settings.json) вместо изолированных os.tmpdir() путей.
- **Обоснование аудита:** Падения тестов из-за разделяемых временных файлов и конфликтов портов
- **Рекомендуемое решение:** Использовать уникальные временные каталоги для каждого тестового прогона (process.env.BOOSTY_OVERLAY_HISTORY = tempPath) и динамический выбор свободных портов.
- **Ожидаемая польза:** 100% стабильность запусков тестов, нулевой риск случайных падений из-за мусора от прошлых запусков.
- **Фактический статус:** new

### 3. Устойчивая автоматизация управления Windows VM (Winda) (`opp-rout-virtualbox_guestcontrol_vm_sync`)
- **Первопричина (Root Cause):** Агент вызывает команды внутри ВМ до того, как сессия пользователя и служба VBoxGuestAdditions вышли в активное состояние, либо использует разные форматы передачи путей к файлам.
- **Обоснование аудита:** Критическая проблема синхронизации и готовности гостевых дополнений Windows VM при релизном тестировании
- **Рекомендуемое решение:** Реализовать единый специализированный runner scripts/qa/winda-sync.js с предварительным пингом статуса ВМ (showvminfo), проверкой доступности Shared Folders и автоматическим повтором при таймаутах.
- **Ожидаемая польза:** Сокращение времени деплоя билда в ВМ с 2 минут до 10 секунд и исключение ручного набора 50-символьных команд VBoxManage.
- **Фактический статус:** new

### 4. Устранение повторяющегося сбоя: Command failure: "python3 -c \"\nimport sqlite3\ncon = sqlite3.connect('data/ (exit 1) (`opp-erro-nonzero_exit_python3_code_1`)
- **Первопричина (Root Cause):** Process python3 terminated abnormally with exit code 1
- **Обоснование аудита:** Подтверждено в 25 независимых сессиях
- **Рекомендуемое решение:** Автоматизировать обработку и предотвращение ошибки 'nonzero_exit_python3_code_1'.
- **Ожидаемая польза:** Предотвращение 94 холостых повторов и сокращение времени отладки.
- **Фактический статус:** new

### 5. Автоматизация многошагового цикла верификации (Preflight Gate) (`opp-qa-multi-step-test-verification-gate`)
- **Первопричина (Root Cause):** В сессиях регулярно запускается ручная цепочка из 4-5 команд тестирования и синтаксиса.
- **Обоснование аудита:** Реализован и верифицирован scripts/verify-preflight.js
- **Рекомендуемое решение:** Создать единый CLI-раннер (verify-preflight.js) с флагами --fast и --full.
- **Ожидаемая польза:** Экономия 3–5 ручных шагов на каждый коммит/релиз, предотвращение случайных пропусков проверок.
- **Фактический статус:** implemented
- **Фактическая измеренная польза:** Снизило время полного префлайта с 45 сек до 12 сек и исключило ручные пропуски
