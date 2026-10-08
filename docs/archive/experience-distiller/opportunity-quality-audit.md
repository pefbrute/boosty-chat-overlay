# Аудит качества и очистка реестра возможностей (Experience Distiller v2.1)

## 1. Сводные результаты аудита 80 возможностей

- **Всего проанализировано возможностей:** 80
- **Подтверждено (Confirmed):** 12 (15.0%)
- **Дубликаты (Duplicate):** 9 (11.2%)
- **Слабые доказательства / Ложные срабатывания (Weak Evidence):** 43 (53.8%)
- **Уже решено (Already Solved):** 4 (5.0%)
- **Требует дополнительного анализа (Needs Review):** 12 (15.0%)
- **Устарело (Obsolete):** 0 (0.0%)

## 2. Анализ причин шума в v2

1. **Смешение штатных проверок со сбоями:** Команды `which <bin>`, `grep -q <pattern>`, `test -f <file>` возвращают ненулевой exit code, когда проверяемый объект отсутствует. В v2 парсер воспринимал каждый `exit 1` как ошибку агента, создавая десятки мусорных записей `opp-erro-nonzero_exit_*`.
2. **Дробление одной проблемы на множество симптомов:** Неполадки управления Windows VM сгенерировали 4 отдельные возможности (`virtualbox_guestcontrol_vm_sync`, `winda-sync`, `winda.sh code 33`, `winda.sh code 52`). В v2.1 они объединены в одну корневую возможность.
3. **Отсутствие обратной связи о внедрённых решениях:** Возможности, которые уже были реализованы (например, `verify-preflight.js` и `release-trust-security-audit`), продолжали числиться как `new` с высоким приоритетом.

## 3. Таблица классификации всех возможностей

| ID | Исходный приоритет | Сессий | Вердикт | Обоснование | Дубликат |
| :--- | :---: | :---: | :---: | :--- | :--- |
| `opp-rout-missing_binary_gh` | 96/100 | 8 | **confirmed** | Отсутствие GitHub CLI (gh) в PATH приводит к срыву релизных проверок | — |
| `opp-erro-test_suite_assertion_failure` | 94/100 | 37 | **confirmed** | Падения тестов из-за разделяемых временных файлов и конфликтов портов | — |
| `opp-rout-virtualbox_guestcontrol_vm_sync` | 94/100 | 4 | **confirmed** | Критическая проблема синхронизации и готовности гостевых дополнений Windows VM при релизном тестировании | — |
| `opp-erro-nonzero_exit_python3_code_1` | 89/100 | 25 | **confirmed** | Подтверждено в 25 независимых сессиях | — |
| `opp-erro-nonzero_exit_git_code_1` | 86/100 | 9 | **confirmed** | Подтверждено в 9 независимых сессиях | — |
| `opp-rout-git_diff_whitespace_check_failed` | 82/100 | 4 | **confirmed** | Регулярный блокер коммитов и preflight проверок из-за концевых пробелов (4 сессии, 9 повторов) | — |
| `opp-erro-nonzero_exit_life_code_1` | 80/100 | 9 | **confirmed** | Систематический сбой валидации в проекте personal-life-db (9 сессий) | — |
| `opp-erro-nonzero_exit_sqlite3_code_1` | 80/100 | 8 | **confirmed** | Подтверждено в 8 независимых сессиях | — |
| `opp-erro-filesystem_permission_denied` | 76/100 | 3 | **confirmed** | Подтверждено в 3 независимых сессиях | — |
| `opp-erro-nonzero_exit_curl_code_28` | 76/100 | 3 | **confirmed** | Подтверждено в 3 независимых сессиях | — |
| `opp-erro-node_syntax_or_module_type` | 72/100 | 3 | **confirmed** | Подтверждено в 3 независимых сессиях | — |
| `opp-erro-nonzero_exit_node_code_1` | 60/100 | 3 | **confirmed** | Подтверждено в 3 независимых сессиях | — |
| `opp-qa-multi-step-test-verification-gate` | 88/100 | 8 | **already_solved** | Реализован и верифицирован scripts/verify-preflight.js | — |
| `opp-deci-local-first-release-security-audit` | 75/100 | 1 | **already_solved** | Глобальный скилл release-trust-security-audit уже создан и активен | — |
| `opp-know-chromium-webui-external-command-block` | 75/100 | 3 | **already_solved** | Инвариант ручного ввода browser://extensions зафиксирован в SKILL.md и онбординге | — |
| `opp-know-chromium_webui_external_launch_block` | 70/100 | 1 | **already_solved** | Инвариант ручного ввода browser://extensions зафиксирован в SKILL.md и онбординге | — |
| `opp-erro-nonzero_exit_which_code_1` | 89/100 | 4 | **needs_review** | Частые диагностические промахи требуют анализа контекста вызова | — |
| `opp-erro-nonzero_exit_grep_code_1` | 86/100 | 16 | **needs_review** | Частые диагностические промахи требуют анализа контекста вызова | — |
| `opp-erro-nonzero_exit_python3_code_2` | 66/100 | 2 | **needs_review** | Требуется проверка на дополнительных сессиях (подтверждено только в 2 сессиях) | — |
| `opp-erro-nonzero_exit_npx_code_1` | 65/100 | 2 | **needs_review** | Требуется проверка на дополнительных сессиях (подтверждено только в 2 сессиях) | — |
| `opp-erro-nonzero_exit_curl_code_1` | 64/100 | 2 | **needs_review** | Требуется проверка на дополнительных сессиях (подтверждено только в 2 сессиях) | — |
| `opp-erro-nonzero_exit_scriptslocalwindash_code_1` | 62/100 | 2 | **needs_review** | Требуется проверка на дополнительных сессиях (подтверждено только в 2 сессиях) | — |
| `opp-erro-git_vcs_conflict_or_state` | 55/100 | 2 | **needs_review** | Требуется проверка на дополнительных сессиях (подтверждено только в 2 сессиях) | — |
| `opp-erro-nonzero_exit_find_code_1` | 53/100 | 2 | **needs_review** | Требуется проверка на дополнительных сессиях (подтверждено только в 2 сессиях) | — |
| `opp-erro-nonzero_exit_life_code_2` | 52/100 | 2 | **needs_review** | Сбой скрипта life требует проверки актуальности схемы БД | — |
| `opp-erro-nonzero_exit_pgrep_code_1` | 49/100 | 2 | **needs_review** | Требуется проверка на дополнительных сессиях (подтверждено только в 2 сессиях) | — |
| `opp-erro-nonzero_exit_cp_code_2` | 49/100 | 2 | **needs_review** | Требуется проверка на дополнительных сессиях (подтверждено только в 2 сессиях) | — |
| `opp-erro-nonzero_exit_lifeboard_code_1` | 43/100 | 1 | **needs_review** | Сбой скрипта life требует проверки актуальности схемы БД | — |
| `opp-rout-missing_binary_binary` | 96/100 | 7 | **duplicate** | Обобщённый шаблон missing_binary дублирует конкретные отсутствующие утилиты | `opp-rout-missing_binary_gh` |
| `opp-rout-windows-vm-qa-deploy-sync` | 90/100 | 4 | **duplicate** | Пересекается с возможностью устойчивой автоматизации управления Windows VM | `opp-rout-virtualbox_guestcontrol_vm_sync` |
| `opp-erro-nonzero_exit_scriptslocalwindash_code_33` | 86/100 | 6 | **duplicate** | Сбои winda.sh дублируют общую проблему автоматизации управления Windows VM | `opp-rout-virtualbox_guestcontrol_vm_sync` |
| `opp-erro-nonzero_exit_scriptslocalwindash_code_52` | 83/100 | 4 | **duplicate** | Сбои winda.sh дублируют общую проблему автоматизации управления Windows VM | `opp-rout-virtualbox_guestcontrol_vm_sync` |
| `opp-rout-git-diff-eof-blank-line` | 75/100 | 3 | **duplicate** | Дубликат возможности автоматической очистки концевых пробелов перед git diff | `opp-rout-git_diff_whitespace_check_failed` |
| `opp-rout-missing_binary_view_file` | 65/100 | 1 | **duplicate** | Обобщённый шаблон missing_binary дублирует конкретные отсутствующие утилиты | `opp-rout-missing_binary_gh` |
| `opp-rout-missing_binary_objective` | 57/100 | 1 | **duplicate** | Обобщённый шаблон missing_binary дублирует конкретные отсутствующие утилиты | `opp-rout-missing_binary_gh` |
| `opp-rout-missing_binary_decision` | 54/100 | 1 | **duplicate** | Обобщённый шаблон missing_binary дублирует конкретные отсутствующие утилиты | `opp-rout-missing_binary_gh` |
| `opp-rout-missing_binary_xvfb-run` | 51/100 | 1 | **duplicate** | Обобщённый шаблон missing_binary дублирует конкретные отсутствующие утилиты | `opp-rout-missing_binary_gh` |
| `opp-erro-python-fstring-syntax-error` | 75/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_sudo_code_1` | 74/100 | 3 | **weak_evidence** | Интерактивный запрос sudo без tty — разовая попытка окружения | — |
| `opp-know-boosty-chat-overlay-domain-architecture` | 72/100 | 1 | **weak_evidence** | Недостаточно доказательств для признания системной возможностью | — |
| `opp-know-personal-life-db-domain-architecture` | 72/100 | 1 | **weak_evidence** | Недостаточно доказательств для признания системной возможностью | — |
| `opp-know-lifeboard-domain-architecture-nav` | 72/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-know-infra-domain-architecture-nav` | 72/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_pythonpath_code_1` | 65/100 | 1 | **weak_evidence** | Недостаточно доказательств для признания системной возможностью | — |
| `opp-erro-nonzero_exit_sqlite3_code_2` | 58/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_npm_code_1` | 57/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-syntax_error_generic` | 56/100 | 1 | **weak_evidence** | Недостаточно доказательств для признания системной возможностью | — |
| `opp-erro-nonzero_exit_cd_code_1` | 55/100 | 2 | **weak_evidence** | Попытка перехода в несуществующую директорию без повторных цепочек | — |
| `opp-erro-nonzero_exit_modinfo_code_1` | 55/100 | 1 | **weak_evidence** | Недостаточно доказательств для признания системной возможностью | — |
| `opp-erro-nonzero_exit_scriptslocalwindash_code_125` | 55/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_ls_code_2` | 54/100 | 2 | **weak_evidence** | Ненулевой exit code для диагностических команд (which, grep, ls, cat) является штатным результатом поиска, а не сбоем | — |
| `opp-erro-nonzero_exit_osslsigncode_code_255` | 53/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_grep_code_2` | 53/100 | 1 | **weak_evidence** | Ненулевой exit code для диагностических команд (which, grep, ls, cat) является штатным результатом поиска, а не сбоем | — |
| `opp-rout-missing_node_module_-playwright-mcp-package-json` | 51/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_git_code_128` | 50/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_diff_code_1` | 45/100 | 1 | **weak_evidence** | Недостаточно доказательств для признания системной возможностью | — |
| `opp-erro-nonzero_exit_bwrap_code_2` | 44/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_pkill_code_143` | 44/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_ps_code_1` | 43/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_cd_code_100` | 41/100 | 1 | **weak_evidence** | Попытка перехода в несуществующую директорию без повторных цепочек | — |
| `opp-erro-nonzero_exit_mkdir_code_127` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_cat_code_2` | 41/100 | 1 | **weak_evidence** | Ненулевой exit code для диагностических команд (which, grep, ls, cat) является штатным результатом поиска, а не сбоем | — |
| `opp-erro-nonzero_exit_mkdir_code_1` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_echo_code_1` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_curl_code_6` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_bluetoothctl_code_1` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_which_code_2` | 41/100 | 1 | **weak_evidence** | Ненулевой exit code для диагностических команд (which, grep, ls, cat) является штатным результатом поиска, а не сбоем | — |
| `opp-erro-nonzero_exit_sqlite3_code_5` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_gsettings_code_1` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_gnome-extensions_code_2` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_cd_code_2` | 41/100 | 1 | **weak_evidence** | Попытка перехода в несуществующую директорию без повторных цепочек | — |
| `opp-erro-nonzero_exit_git_code_10` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_digital-footprint-auditsocial-analyzervenvbinpython3_code_1` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_journalctl_code_1` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_echo_code_128` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_ls_code_1` | 41/100 | 1 | **weak_evidence** | Ненулевой exit code для диагностических команд (which, grep, ls, cat) является штатным результатом поиска, а не сбоем | — |
| `opp-erro-nonzero_exit_chmod_code_1` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_cat_code_1` | 41/100 | 1 | **weak_evidence** | Ненулевой exit code для диагностических команд (which, grep, ls, cat) является штатным результатом поиска, а не сбоем | — |
| `opp-erro-nonzero_exit_notion-fast_code_1` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |
| `opp-erro-nonzero_exit_chmod_code_33` | 41/100 | 1 | **weak_evidence** | Слабая доказательная база: зафиксировано всего в 1 сессии без повторных попыток | — |

## 4. Группы выявленных дубликатов

### Корневая возможность: `opp-rout-virtualbox_guestcontrol_vm_sync`
Объединённые симптоматические записи (3):
- `opp-rout-windows-vm-qa-deploy-sync` (CLI-утилита синхронизации артефактов и статуса с Windows VM Winda)
- `opp-erro-nonzero_exit_scriptslocalwindash_code_33` (Устранение повторяющегося сбоя: Command failure: "./scripts/local/winda.sh powershell '$files = @(\"\\\\VBOXS (exit 33))
- `opp-erro-nonzero_exit_scriptslocalwindash_code_52` (Устранение повторяющегося сбоя: Command failure: "./scripts/local/winda.sh gui launch_app '{\"path\":\"C:\\\\ (exit 52))

### Корневая возможность: `opp-rout-git_diff_whitespace_check_failed`
Объединённые симптоматические записи (1):
- `opp-rout-git-diff-eof-blank-line` (Автоматическая нормализация EOF и концевых пробелов перед проверкой)

### Корневая возможность: `opp-rout-missing_binary_gh`
Объединённые симптоматические записи (5):
- `opp-rout-missing_binary_binary` (Устранение отсутствующих зависимостей: Missing executable or CLI dependency: binary)
- `opp-rout-missing_binary_view_file` (Устранение отсутствующих зависимостей: Missing executable or CLI dependency: view_file)
- `opp-rout-missing_binary_objective` (Устранение отсутствующих зависимостей: Missing executable or CLI dependency: Objective)
- `opp-rout-missing_binary_decision` (Устранение отсутствующих зависимостей: Missing executable or CLI dependency: Decision)
- `opp-rout-missing_binary_xvfb-run` (Устранение отсутствующих зависимостей: Missing executable or CLI dependency: xvfb-run)

## 5. Дорожная карта первоочередных улучшений (Confirmed Actionable)

Из 80 записей только **подтверждённые системные возможности** отобраны для внедрения:
1. `opp-rout-git_diff_whitespace_check_failed` — Автоматический autofix концевых пробелов и EOF перед `git diff --check` (Кандидат для полной демонстрации цикла).
2. `opp-rout-missing_binary_gh` — Preflight проверка наличия GitHub CLI перед вызовом релизных команд.
3. `opp-rout-virtualbox_guestcontrol_vm_sync` — Устойчивый единый runner для Windows VM с проверкой готовности гостевых дополнений.
4. `opp-erro-test_suite_assertion_failure` — Изоляция временных файлов и lock-файлов в тестах для исключения взаимных помех.
