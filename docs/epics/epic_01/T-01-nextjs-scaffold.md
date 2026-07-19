---
id: T-01
epic: E-001
title: "Каркас Next.js-приложения и структура репозитория"
type: dev
status: todo
depends_on: []
created: 2026-07-19
updated: 2026-07-19
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

_Заполняется агентом-разработчиком: что сделано (файлы), как проверено
(команды и результат), отклонения, «вне скоупа», вопросы._

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._
