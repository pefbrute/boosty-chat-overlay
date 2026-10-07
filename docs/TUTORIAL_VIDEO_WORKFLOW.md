# Tutorial Video Pipeline & Workflow Guide (`tutorial-video`)

Руководство по созданию, редактированию, предварительному просмотру и рендерингу обучающих видеороликов (мини-уроков) для онбординга приложения `Boosty Chat Overlay`.

---

## 1. Зачем Remotion

В проекте необходимы сверхкороткие (8–15 секунд), компактные, воспроизводимые обучающие ролики, наглядно объясняющие пользователям неочевидные шаги интерфейса (например, drag-and-drop распакованной папки расширения в страницу управления расширениями браузера).

**Почему именно Remotion, а не традиционный видеомонтаж или запись экрана:**
1. **Воспроизводимость в коде (Video as Code):** Каждый кадр видео — это детерминированный рендеринг React-компонента. При изменении логотипов, цветов, текстов или версий достаточно обновить конфиг или компонент и перерендерить видео одной командой.
2. **Нулевой bloat в production Electron:** Remotion установлен в отдельном изолированном каталоге `tools/tutorial-video/` со своим `package.json`. Ни одна Remotion-зависимость не попадает в production `node_modules` и не раздувает Windows NSIS installer или Linux AppImage.
3. **Компактность ассетов:** Финальное видео собирается в открытый формат WebM (VP8/Vorbis, 1280×720, 30 fps), весит всего **~300 КБ** при длительности 10.5 секунд, воспроизводится встроенным Chromium в Electron без внешних кодеков и работает полностью оффлайн без обращения к CDN или YouTube.

---

## 2. Лицензии и Provenance

- **`sammyteng/remotion-skills`**: Лицензия [MIT](https://github.com/sammyteng/remotion-skills/blob/main/LICENSE).
  - Установлен в каталог Antigravity: `~/.gemini/antigravity/skills/remotion-skills/SKILL.md` (и зеркало в `~/.gemini/config/skills/remotion-skills/SKILL.md`).
  - Repository URL: `https://github.com/sammyteng/remotion-skills.git`
  - Commit SHA: `a166b45a68a99cfe02e2dbd95a8310d282a043fe`
  - Дата установки: 7 октября 2026 г.
- **Remotion Framework**: [Remotion Free License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) — бесплатное использование для индивидуальных разработчиков и организаций/компаний до 3 человек.

---

## 3. Структура каталогов и исходников

```text
tools/tutorial-video/
├── package.json                   # Изолированные dev-зависимости (remotion, @remotion/cli, react)
├── public/
│   └── source/                    # Исходные скриншоты, SVG-иконки, браузерные футажи
└── src/
    ├── config.js                  # Разрешение (1280x720), FPS (30), тайминги сцен в кадрах
    ├── copy/
    │   └── ru.js                  # Централизованные русские строки и лейблы
    ├── components/
    │   ├── BrowserFrame.jsx       # Высокодетализированный макет окна Яндекс Браузера
    │   ├── FolderCard.jsx         # 3D-папка Boosty Chat Overlay для анимации Drag & Drop
    │   ├── Cursor.jsx             # Анимированный курсор мыши (движение, клик, захват)
    │   └── StepBadge.jsx          # Верхний плавающий бейдж шагов и нижний прогресс-бар
    ├── scenes/
    │   ├── Scene1OpenExtensions.jsx  # Сцена 1: "1. Откройте расширения" (browser://extensions)
    │   ├── Scene2DeveloperMode.jsx   # Сцена 2: "2. Включите режим разработчика" (тумблер)
    │   └── Scene3DragFolder.jsx      # Сцена 3: "3. Перетащите папку сюда" (Drag & Drop -> Готово)
    ├── ExtensionInstallYandex.jsx    # Главная композиция ролика (Series из 3 сцен)
    ├── ExtensionInstallPoster.jsx    # Композиция статичного триптиха для постера
    └── index.jsx                     # Регистрация корневых композиций Remotion

desktop/assets/tutorials/
├── yandex-extension-install.webm         # Финальный легковесный WebM ассет (~300 КБ)
├── yandex-extension-install-poster.png   # Постер первого кадра для HTML5 <video poster>
└── yandex-extension-install-diagram.svg  # Векторная статическая схема-триптих (fallback)
```

---

## 4. Команды предварительного просмотра и сборки

Все команды доступны из корня репозитория через `npm run`:

### 4.1. Интерактивный предпросмотр (Remotion Studio)
```bash
npm run tutorial:preview
```
Запускает локальный веб-сервер Remotion Studio с покадровым воспроизведением, зумом, инспектором компонентов и горячими клавишами.

### 4.2. Рендеринг финального видео
```bash
npm run tutorial:render:yandex
```
Собирает композицию `ExtensionInstallYandex` в файл `desktop/assets/tutorials/yandex-extension-install.webm` с параметрами:
- Формат: WebM (VP8 progressive)
- Разрешение: 1280×720 (16:9)
- Частота кадров: 30 fps
- Длительность: 10.5 секунд (315 кадров)
- Размер: ~300 КБ

---

## 5. Использование Playwright MCP для записи исходного браузерного футажа

Playwright MCP настроен в `~/.gemini/config/mcp_config.json` с флагом `--caps=devtools`:
```json
"playwright-brave": {
  "command": "npx",
  "args": [
    "-y",
    "@playwright/mcp@latest",
    "--extension",
    "--caps=devtools"
  ]
}
```

Доступные инструменты записи:
- `browser_start_video`: запуск записи видеопотока из браузера в формате WebM;
- `browser_stop_video`: завершение записи и сохранение файла;
- `browser_video_chapter`: создание полноэкранной плашки главы;
- `browser_video_show_actions`: отображение аннотаций действий и подсветка элементов;
- `browser_video_hide_actions`: скрытие аннотаций;
- `browser_highlight`: акцентная рамка вокруг целевого селектора DOM.

Проверенный артефакт proof-of-concept: `artifacts/tutorial-source/yandex-extensions-demo.webm`.

---

## 6. Как обновить видео после изменения UI

Если в Яндекс Браузере или в интерфейсе онбординга изменились кнопки, адреса или структура:

1. **Обновить строки:** Отредактировать `tools/tutorial-video/src/copy/ru.js` (все тексты хранятся централизованно, максимум 5–7 слов на сцену).
2. **Скорректировать верстку компонентов:** При необходимости обновить `BrowserFrame.jsx` или `FolderCard.jsx`.
3. **Проверить в Remotion Studio:** `npm run tutorial:preview`.
4. **Выполнить рендеринг видео и постера:**
   ```bash
   npm run tutorial:render:yandex
   npx --prefix tools/tutorial-video remotion still src/index.jsx ExtensionInstallYandex --frame=15 ../../desktop/assets/tutorials/yandex-extension-install-poster.png
   ```
5. **Запустить UI Visual QA:**
   ```bash
   npm run test:ui:visual
   ```
   Убедиться, что скриншоты `tutorial-01-video-start.png` ... `tutorial-06-video-fallback.png` в `artifacts/ui/` выглядят безупречно.
