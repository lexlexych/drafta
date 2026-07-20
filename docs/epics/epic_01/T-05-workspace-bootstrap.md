---
id: T-05
epic: E-001
title: "Создание workspace при онбординге и защищённая зона"
type: dev
status: todo
depends_on: [T-03, T-04]
created: 2026-07-19
updated: 2026-07-19
---

# T-05. Создание workspace при онбординге и защищённая зона

## Цель

Новый подтверждённый пользователь создаёт свой workspace (онбординг-форма с названием),
становится его `owner`, получает строку `ai_settings` с дефолтами — и попадает в
защищённую зону `app/(app)/dashboard`, где виден его workspace. Пользователь без
workspace всегда направляется в онбординг; неавторизованный — на вход.

## Контекст

Обязательно прочитать перед выполнением:

- [2. Глоссарий](../../architecture/02-glossary.md) — workspace, никаких «account»
- [4. Мультитенантность](../../architecture/04-multitenancy.md) — роли owner/member
- [6. Модель данных](../../architecture/06-data-model.md) — `workspaces`, `workspace_members`, `ai_settings` (дефолт `debounce_seconds` ~45–60)
- [12. Структура репозитория](../../architecture/12-repo-structure.md) — `app/(app)/dashboard/`
- [16. План внедрения, этап 0](../../architecture/16-rollout-plan.md#этап-0--фундамент-1-2-дня) — критерий проверки эпика

Существенные факты:

- T-03: INSERT в `workspaces` и первая запись `workspace_members` закрыты политиками —
  создание идёт через **security definer RPC** (например, `create_workspace(name text)`),
  который добавляется новой миграцией в этом тикете.
- T-04: auth-страницы и клиенты `lib/db` готовы.
- Системная категория «по умолчанию» при создании workspace — **этап 6**, здесь не
  создаётся (см. «Вне скоупа» эпика). RPC стоит оформить так, чтобы этап 6 мог её добавить.
- Пользователь может состоять в нескольких workspace'ах (§4); на этапе 0 UI-переключатель
  не нужен — достаточно брать первый/единственный workspace участника.

## Шаги реализации

1. Миграция: RPC `create_workspace(name text)` (`security definer`) — в транзакции
   создаёт `workspaces`, `workspace_members` (текущий `auth.uid()`, роль `owner`),
   `ai_settings` с дефолтами из §6; возвращает id workspace. Права на выполнение —
   только `authenticated`.
2. Онбординг-страница (например, `app/(app)/onboarding/`): форма «название workspace» →
   вызов RPC → редирект на `/dashboard`.
3. Гейт защищённой зоны `app/(app)/`: нет сессии → редирект на вход; есть сессия, но нет
   ни одного workspace → редирект в онбординг.
4. `app/(app)/dashboard/`: минимальная страница — название текущего workspace, email
   пользователя, роль, кнопка выхода. Без виджетов будущих этапов.
5. Ручная проверка изоляции по критерию этапа 0: два пользователя в двух браузерных
   сессиях — каждый видит только свой workspace.

## Критерии приёмки

- [ ] Новый пользователь после подтверждения email проходит онбординг и оказывается в `/dashboard` со своим workspace
- [ ] В БД создаются ровно: `workspaces` (1), `workspace_members` (owner), `ai_settings` (1) — категорий нет
- [ ] Повторный вход ведёт сразу в `/dashboard`, минуя онбординг
- [ ] Неавторизованный запрос любой страницы `(app)` редиректит на вход
- [ ] Два разных пользователя видят каждый только свой workspace (ручная проверка двумя сессиями)
- [ ] RPC вызывается только `authenticated`; прямой INSERT в `workspaces` через publishable-ключ по-прежнему запрещён

## Definition of Done

```
supabase db reset
npm run lint
npm run build
npm test
```

Плюс ручной сквозной прогон: регистрация → онбординг → dashboard, двумя пользователями.

---

## 🔧 Отчёт разработчика

### Что сделано

- Добавлена миграция
  `supabase/migrations/20260720130000_create_workspace_rpc.sql` с
  `public.create_workspace(name text)`. `security definer`-функция с фиксированным
  пустым `search_path` проверяет `auth.uid()` и непустое имя, затем атомарно создаёт
  `workspaces`, первую строку `workspace_members` с ролью `owner` и одну строку
  `ai_settings`. Значения `ai_settings`, включая `debounce_seconds = 60`, берутся из
  дефолтов схемы. Создание `categories` намеренно отсутствует.
- У RPC отозван дефолтный `PUBLIC EXECUTE`, право вызова выдано только роли
  `authenticated`. Прямой INSERT в `workspaces` не открывался: действующие ACL и RLS
  T-03 остаются прежними.
- Добавлены серверные helpers `lib/db/workspace.ts`: проверка пользователя через
  Supabase Auth и получение первого доступного workspace по `created_at` с ролью.
  Модуль помечен `server-only`.
- Создана защищённая зона `app/(app)/`: общий layout отправляет пользователя без
  сессии на `/login`; `/onboarding` отправляет уже состоящего в workspace пользователя
  на `/dashboard`; layout `/dashboard` отправляет пользователя без workspace на
  `/onboarding`.
- Добавлены onboarding-форма и минимальный dashboard. Форма вызывает только
  `createBrowserSupabaseClient().rpc("create_workspace", …)`, после успеха ведёт на
  `/dashboard`. Dashboard показывает название workspace, email, роль и POST-кнопку
  выхода через существующий `/auth/sign-out`.
- Добавлены стили `app/(app)/app.module.css` и статические тесты границ bootstrap в
  `lib/workspace-bootstrap.test.ts`.

### Как проверено

- `npm.cmd run lint` — exit code 0.
- `npx.cmd tsc --noEmit` — exit code 0.
- `npm.cmd test` — exit code 0: 7 test files, 16 tests passed. Новый набор проверяет
  security-definer RPC, ограниченный EXECUTE, отсутствие категории, вызов RPC из
  onboarding и оба redirect-гейта.
- `npm.cmd run build` — exit code 0. Next.js 16.2.10 собрал `/onboarding` и
  `/dashboard` как динамические SSR-маршруты.
- Статическая PowerShell-проверка миграции — PASS: `security definer`, пустой
  `search_path`, проверка `auth.uid()`, три требуемые INSERT и grant только
  `authenticated` присутствуют; `public.categories` отсутствует.
- Статическая PowerShell-проверка миграции T-03 — PASS: у `authenticated` по-прежнему
  нет INSERT ACL на `public.workspaces`, RLS select-политика workspace присутствует.
- `rg` по коду T-05 — PASS: запрещённый термин `account` не найден.
- `git diff --check` — exit code 0; Git вывел только предупреждения CRLF для уже
  изменённых оркестратором файлов статусов.

### Отклонения, вне скоупа и открытые вопросы

- `supabase db reset` не запускался: пользователь явно запретил Docker, а эта команда
  требует локальный Docker-стек. Cloud-проект не создавался и не изменялся.
- Реальный сквозной прогон с подтверждением email и двумя браузерными сессиями не
  выполнялся: для него нужны применённые в Supabase Cloud миграции, SMTP и реальные
  тестовые пользователи. Он уже предусмотрен в T-08: шаг 7a и «Финальная проверка
  эпика», пункты 1–3.
- Не добавлялись переключатель нескольких workspace, категории, виджеты будущих
  этапов, внешние сервисы или секреты — это вне скоупа T-05.

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._
