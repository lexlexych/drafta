---
id: T-01
epic: E-001
title: "Каркас Next.js-приложения и структура репозитория"
type: dev
status: done
depends_on: []
created: 2026-07-19
updated: 2026-07-20
---

# T-01. Каркас Next.js-приложения и структура репозитория

## Цель

В корне репозитория работает Next.js-приложение (App Router, TypeScript) со структурой
каталогов из архитектуры: `npm run dev` поднимает стартовую страницу, `npm run build`,
`npm run lint` и `npm test` проходят.

## Контекст

Обязательно прочитать перед выполнением:

- [3. Стек](../../architecture/03-stack.md) — Next.js (App Router, TypeScript)
- [12. Структура репозитория](../../architecture/12-repo-structure.md) — целевое дерево каталогов
- [13. Окружения, секреты](../../architecture/13-environments-secrets.md#секреты-vercel-env) — список env-переменных
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — жёсткие правила
- [2. Глоссарий](../../architecture/02-glossary.md) — термины в идентификаторах

Существенные факты:

- Репозиторий сейчас содержит только `docs/`, `.ai/`, `.claude/`, `.codex/`,
  `AGENTS.md`, `CLAUDE.md` — их **нельзя трогать и перезаписывать** при скаффолдинге.
- `CLAUDE.md` уже существует и подключает `AGENTS.md` — заново создавать не нужно.
- Тест-раннер архитектурой не зафиксирован — используем **Vitest** (см. открытый
  вопрос №2 в `_index.md`). Пакетный менеджер — npm.

## Шаги реализации

1. Скаффолдинг Next.js в корень репозитория (`create-next-app`: TypeScript, App Router,
   ESLint, без `src/`-каталога — `app/` в корне, как в §12). Следить, чтобы генератор
   не перезаписал существующие файлы (`CLAUDE.md`, `AGENTS.md`, `.gitignore` — слить вручную).
2. Создать скелет каталогов по §12: `app/(auth)/`, `app/(app)/dashboard/`, `app/api/`,
   `lib/channels/`, `lib/inngest/functions/`, `lib/ai/`, `lib/db/` (пустые каталоги —
   с placeholder-файлами `.gitkeep` или минимальными `index.ts`, без лишнего кода).
3. Подключить Vitest: конфиг, скрипт `npm test`, один тривиальный smoke-тест
   (например, на утилиту или простой рендер), чтобы пайплайн тестов существовал с первого дня.
4. Создать `.env.example` с переменными этапа 0: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (значения — плейсхолдеры).
   Убедиться, что `.env*` в `.gitignore`.
5. Проверить сборку, линт, тесты, запуск dev-сервера.

## Критерии приёмки

- [ ] `npm run dev` поднимает приложение, стартовая страница открывается без ошибок
- [ ] `npm run build`, `npm run lint`, `npm test` проходят
- [ ] Дерево каталогов соответствует §12: `app/(auth)`, `app/(app)/dashboard`, `app/api`, `lib/channels`, `lib/inngest/functions`, `lib/ai`, `lib/db`
- [ ] `.env.example` содержит три переменные Supabase этапа 0; `.env*` игнорируется git
- [ ] `docs/`, `.ai/`, `.claude/`, `.codex/`, `AGENTS.md`, `CLAUDE.md` не изменены и не перезаписаны
- [ ] Никакого «кода на вырост»: нет зависимостей Inngest/LLM/Serwist — они появятся в своих этапах

## Definition of Done

```
npm run lint
npm run build
npm test
```

Все три команды проходят без ошибок; ревьюер дополнительно запускает `npm run dev`
и открывает стартовую страницу.

---

## 🔧 Отчёт разработчика

### Что сделано

- Создан каркас Next.js 16.2.10 с App Router, TypeScript и ESLint в корне
  репозитория: `app/`, `public/`, `package.json`, `package-lock.json`,
  `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.gitignore`, `README.md`.
- Стартовая страница и metadata приведены к минимальному состоянию drafta:
  `app/page.tsx`, `app/layout.tsx`, `lib/app-metadata.ts`. Внешняя загрузка шрифтов
  при сборке не требуется.
- Создан скелет каталогов из §12 с `.gitkeep`: `app/(auth)/`,
  `app/(app)/dashboard/`, `app/api/`, `lib/channels/`,
  `lib/inngest/functions/`, `lib/ai/`, `lib/db/`.
- Подключён Vitest: скрипт `npm test` в `package.json`, конфигурация
  `vitest.config.ts` и smoke-тест `lib/app-metadata.test.ts`.
- Создан `.env.example` с `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. В `.gitignore`
  сохранено правило `.env*` и добавлено исключение только для `.env.example`.

### Как проверено

- `npm run lint` — exit code 0, ESLint завершился без замечаний.
- `npm run build` — exit code 0, production build скомпилирован, TypeScript
  проверен, маршрут `/` статически сгенерирован.
- `npm test` — exit code 0, 1 файл и 1 тест прошли.
- `npm run dev -- --hostname 127.0.0.1 --port 3000` — Next.js сообщил
  `Ready in 1169ms`; долгоживущий процесс после проверки остановлен таймаутом.
  Дополнительный HTTP smoke-запуск вернул `GET /` со статусом 200, HTML содержит
  `drafta`; процесс сервера остановлен.
- `git check-ignore -v --no-index .env .env.local .env.example` — `.env` и
  `.env.local` игнорируются правилом `.env*`, `.env.example` возвращён исключением
  `!.env.example` и доступен для коммита.
- Наличие всех семи обязательных каталогов и placeholder-файлов проверено через
  `Test-Path` — все существуют.

### Отклонения от плана

- `create-next-app` не может безопасно работать прямо в непустом корне. Каркас был
  сгенерирован во временном каталоге внутри репозитория, проверен и перенесён в
  корень без перезаписи существующих `docs/`, `.ai/`, `.claude/`, `.codex/`,
  `AGENTS.md`, `CLAUDE.md`; временный каталог удалён.

### Вне скоупа и открытые вопросы

- `npm install` сообщил о двух уязвимостях уровня moderate и предложил
  потенциально ломающий `npm audit fix --force`. Автоматическое обновление вне
  скоупа T-01 не выполнялось; lint, build и tests проходят на lockfile тикета.
- Ручных шагов для executive summary не обнаружено. Других открытых вопросов нет.

## 🔍 Ревью

**Вердикт: APPROVED**

Критерии приёмки и затронутые правила вайбкодинга перепроверены независимо:

- `npm.cmd run lint` — exit code 0, замечаний ESLint нет;
- `npm.cmd run build` — exit code 0, Next.js 16.2.10 успешно собрал приложение,
  TypeScript-проверка и статическая генерация маршрута `/` прошли;
- `npm.cmd test` — exit code 0, 1 test file / 1 test passed;
- dev-сервер запущен на `127.0.0.1:3101`: `GET /` вернул HTTP 200, HTML содержит
  `drafta`; после проверки процесс остановлен;
- все семь обязательных каталогов и их `.gitkeep` существуют;
- `git check-ignore -v --no-index .env .env.local .env.example` подтвердил, что
  `.env` и `.env.local` игнорируются, а `.env.example` исключён из ignore и содержит
  ровно три требуемые переменные Supabase;
- фактический diff коммита `591b9fb` не меняет `.ai/`, `.claude/`, `.codex/`,
  `AGENTS.md` или `CLAUDE.md`; единственное изменение в `docs/` — отчёт данного тикета;
- в зависимостях нет Inngest, LLM/OpenRouter/Mistral или Serwist; изменений БД,
  провайдер-специфичного кода и использования серверного Supabase-ключа в коде нет.

Примечание среды: прямой вызов `npm` в PowerShell блокируется локальной Execution
Policy для `npm.ps1`, поэтому те же npm-скрипты перепроверены через штатный
Windows launcher `npm.cmd`.
