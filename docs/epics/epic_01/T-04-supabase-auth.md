---
id: T-04
epic: E-001
title: "Supabase Auth: регистрация, вход, сброс пароля"
type: dev
status: todo
depends_on: [T-01, T-02]
created: 2026-07-19
updated: 2026-07-19
---

# T-04. Supabase Auth: регистрация, вход, сброс пароля

## Цель

Против локального Supabase работают регистрация с подтверждением email, вход, выход
и сброс пароля; сессия корректно живёт в SSR (middleware обновляет токены); клиенты
Supabase оформлены в `lib/db` с жёстким разделением publishable/secret.

## Контекст

Обязательно прочитать перед выполнением:

- [3. Стек](../../architecture/03-stack.md) — ключи `sb_publishable_` / `sb_secret_`
- [4. Мультитенантность](../../architecture/04-multitenancy.md) — auth-письма шлёт Supabase, свой код отправки не писать
- [12. Структура репозитория](../../architecture/12-repo-structure.md) — `app/(auth)/`, `lib/db/`
- [13. Окружения, секреты](../../architecture/13-environments-secrets.md) — env-переменные, правило 5 (`SUPABASE_SECRET_KEY` — только сервер)
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — правила 5 и 10

Существенные факты:

- T-01 создал каркас и `.env.example`; T-02 — локальный Supabase (`supabase start`).
- Использовать пакет `@supabase/ssr` (актуальный подход для Next.js App Router) +
  `@supabase/supabase-js`.
- Локально письма Supabase перехватываются встроенным тестовым SMTP-ящиком локального
  стека (Inbucket/Mailpit — открывается из `supabase status`) — реальный Postmark
  настраивается вручную в T-08 и в этом тикете не нужен.
- Создание workspace при регистрации — **не здесь**, это T-05.

## Шаги реализации

1. `lib/db/`: три клиента —
   - browser-клиент (publishable-ключ),
   - server-клиент для Server Components / Route Handlers (cookie-сессия, `@supabase/ssr`),
   - admin-клиент на `SUPABASE_SECRET_KEY` с импортом `server-only`
     (понадобится с T-05; главное — невозможность попадания в клиентский бандл).
2. Middleware обновления сессии (`middleware.ts`) по документации `@supabase/ssr`.
3. Страницы в `app/(auth)/`: вход, регистрация, запрос сброса пароля, установка нового
   пароля; route handler подтверждения email (`/auth/confirm` или callback). Минимальный
   UI без дизайна — формы с ошибками валидации.
4. Выход (server action или route handler) и редиректы: неавторизованный → `/(auth)`,
   авторизованный со страниц auth → `/dashboard`.
5. Локальная проверка полного цикла: регистрация → письмо в локальном ящике →
   подтверждение → вход → выход → сброс пароля.

## Критерии приёмки

- [ ] Регистрация нового пользователя проходит: письмо подтверждения видно в локальном тестовом ящике, ссылка подтверждает email
- [ ] Вход/выход работают; сессия переживает перезагрузку страницы и SSR-навигацию
- [ ] Сброс пароля: запрос → письмо → установка нового пароля → вход с новым паролем
- [ ] `SUPABASE_SECRET_KEY` используется только в серверном коде (модуль с `server-only`); в клиентском бандле его нет
- [ ] Никакого собственного кода отправки писем — только Supabase Auth
- [ ] Структура: страницы в `app/(auth)/`, клиенты в `lib/db/`

## Definition of Done

```
npm run lint
npm run build
npm test
```

Плюс ручной прогон цикла регистрация/вход/сброс на локальном стеке (`supabase start`) —
разработчиком и повторно ревьюером.

---

## 🔧 Отчёт разработчика

### Что сделано

- Добавлены зависимости `@supabase/ssr`, `@supabase/supabase-js` и `server-only`
  в `package.json` / `package-lock.json`.
- В `lib/db/` добавлены три изолированных клиента Supabase:
  - `browser.ts` — singleton browser-клиент только с publishable-ключом;
  - `server.ts` — SSR-клиент для Server Components, Server Actions и Route Handlers
    с адаптером cookie `getAll` / `setAll`;
  - `admin.ts` — admin-клиент с `import "server-only"`, единственное runtime-место
    обращения к `SUPABASE_SECRET_KEY`, с отключёнными session persistence и refresh.
  В `env.ts` вынесена валидация двух публичных env-переменных. Общий barrel-файл не
  создан, чтобы admin-клиент нельзя было случайно импортировать в client bundle.
- Реализован session refresh и маршрутизация в `lib/db/proxy.ts` + корневом `proxy.ts`:
  verified `auth.getClaims()`, перенос обновлённых cookie и cache headers в response,
  редирект неавторизованного пользователя на `/login`, а авторизованного с login/
  registration/reset-request страниц — на `/dashboard`. `/auth/confirm` и
  `/update-password` намеренно оставлены доступными для PKCE callback/recovery flow.
- Добавлены минимальные формы в `app/(auth)/`: `/login`, `/sign-up`,
  `/forgot-password`, `/update-password`; все проверяют обязательные поля, совпадение
  и минимальную длину нового пароля, выводят ошибки Supabase. Формы вызывают только
  Supabase Auth (`signUp`, `signInWithPassword`, `resetPasswordForEmail`, `updateUser`),
  собственного кода отправки email нет.
- Добавлены route handlers: `/auth/confirm` обменивает PKCE code на cookie-сессию с
  защитой от open redirect, `/auth/sign-out` принимает только POST и завершает сессию.
  Корневой маршрут перенаправляет на `/login`.
- В `supabase/config.toml` включён `auth.email.enable_confirmations`, а allow-list
  дополнен локальными callback URL `/auth/confirm` для `127.0.0.1` и `localhost`.
- В `T-08-executive-summary.md` уточнён продовый callback и добавлен ручной шаг 7a:
  полный cloud-цикл registration → confirmation → login → password reset после
  `supabase db push` и настройки Postmark.
- Добавлены проверки `lib/auth/redirects.test.ts`, `lib/db/env.test.ts`,
  `lib/db/auth-boundaries.test.ts`, `lib/db/proxy.test.ts`; Vitest получил alias `@`
  из `tsconfig.json` в `vitest.config.ts`.

### Как проверено

- `npx.cmd tsc --noEmit` — exit code 0.
- `npm.cmd run lint` — exit code 0, замечаний ESLint нет.
- `npm.cmd run build` — exit code 0; Next.js 16.2.10 собрал все auth routes и Proxy.
- `npm.cmd test` — exit code 0: 5 test files, 11 tests passed. В том числе проверены
  безопасные relative redirects, public env, server-only boundary и Proxy: refresh
  cookie/cache headers, redirect protected route и recovery-исключение.
- `rg` по `.next/static` — `SUPABASE_SECRET_KEY` отсутствует в client bundle.
- `git diff --check` — без ошибок whitespace.

### Отклонения от плана

- Вместо буквально указанного `middleware.ts` создан `proxy.ts` с экспортом `proxy`.
  Это актуальная file convention Next.js 16.2.10 (Middleware переименован в Proxy);
  production build подтвердил его как `ƒ Proxy (Middleware)`. Функция выполняет
  требуемое middleware-обновление сессии без использования deprecated convention.

### Вне скоупа и открытые вопросы

- Не создавалась страница `/dashboard`, onboarding и protected zone: ими владеет T-05.
  До T-05 успешный вход/подтверждение корректно ведёт на подготовленный, но ещё не
  реализованный маршрут `/dashboard`.
- Docker, `supabase start` / `stop`, локальный Supabase и любые cloud-проекты, секреты,
  SMTP и Vercel не использовались по ограничению среды. Поэтому реальная отправка
  писем, клик по ссылке и runtime SSR-сессия не проверены; обязательный ручной cloud
  прогон честно добавлен в T-08, шаг 7a.
- `npm install` по-прежнему сообщает о двух moderate vulnerabilities, известных со
  времён T-01; `npm audit fix --force` не запускался, так как это ломающая и вне
  скоупа T-04 операция.

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._
