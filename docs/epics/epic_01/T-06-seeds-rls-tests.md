---
id: T-06
epic: E-001
title: "Сиды локальной разработки и автотесты RLS-изоляции"
type: dev
status: todo
depends_on: [T-05]
created: 2026-07-19
updated: 2026-07-19
---

# T-06. Сиды локальной разработки и автотесты RLS-изоляции

## Цель

`supabase db reset` наполняет локальную БД воспроизводимыми демо-данными (два
пользователя, два workspace с примерами дочерних сущностей), а `npm run test:rls`
автоматически подтверждает изоляцию тенантов — «несущая стена» из правил вайбкодинга.

## Контекст

Обязательно прочитать перед выполнением:

- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md#тесты) — тесты RLS обязательны
- [4. Мультитенантность](../../architecture/04-multitenancy.md#изоляция-данных) — что именно изолируем
- [6. Модель данных](../../architecture/06-data-model.md) — поля сущностей для правдоподобных сидов
- [16. План внедрения, этап 0](../../architecture/16-rollout-plan.md#этап-0--фундамент-1-2-дня) — «сиды» в скоупе этапа

Существенные факты:

- T-02–T-03: схема и политики готовы; T-05: RPC `create_workspace`.
- Сиды — `supabase/seed.sql` (подхватывается `supabase db reset` автоматически).
  Тестовых пользователей локально допустимо создавать прямо в `auth.users`/`auth.identities`
  с фиксированными UUID и паролем (известный локальный паттерн) — либо отдельным
  скриптом через admin-клиент; выбрать и зафиксировать в отчёте.
- Тесты — Vitest (см. T-01), интеграционные: два клиента `supabase-js` на
  publishable-ключе, входят под разными сид-пользователями и делают реальные запросы
  к локальному стеку. Секреты в тестах — только локальные дефолтные ключи стека.

## Шаги реализации

1. `supabase/seed.sql`: два пользователя (`owner-a@example.com`, `owner-b@example.com`,
   известный пароль), два workspace (A и B) с участниками-владельцами, `ai_settings`,
   и по несколько строк в ключевых таблицах каждого workspace: `contacts` +
   `contact_identities`, `conversations` (`dm`), `messages`, `kb_files`,
   `channel_connections` — чтобы изоляцию было на чем проверять, а будущие этапы
   получили демо-данные.
2. Тест-сьют `test:rls` (например, `tests/rls/*.test.ts` + npm-скрипт):
   - пользователь A видит свой workspace и не видит workspace B (и наоборот) —
     по каждой засеянной таблице;
   - INSERT/UPDATE в чужой workspace отклоняется (`with check`);
   - анонимный клиент не видит ни одной строки ни в одной таблице;
   - `webhook_events` недоступна через publishable-ключ даже своему участнику.
3. Прогнать сьют против свежего `supabase db reset`; убедиться, что упавшая политика
   ловится (временно ослабить одну политику → тест красный → вернуть).
4. Короткий раздел «Локальная разработка» в `README.md` (создать при отсутствии):
   `supabase start`, `supabase db reset`, `npm run dev`, тестовые логины сидов.

## Критерии приёмки

- [ ] `supabase db reset` отрабатывает с сидами без ошибок; повторный запуск воспроизводим
- [ ] В сидах: 2 пользователя, 2 workspace, демо-строки в contacts/contact_identities/conversations/messages/kb_files/channel_connections обоих workspace'ов
- [ ] `npm run test:rls` зелёный против локального стека
- [ ] Тесты покрывают: невидимость чужого workspace (по каждой засеянной таблице), запрет записи в чужой workspace, пустоту для anon, недоступность `webhook_events`
- [ ] Продемонстрировано (в отчёте), что намеренно сломанная политика роняет тест
- [ ] README описывает запуск локальной разработки и тестов

## Definition of Done

```
supabase db reset
npm run test:rls
npm run lint
npm run build
npm test
```

Все команды проходят; ревьюер повторяет `supabase db reset` + `npm run test:rls` сам.

---

## 🔧 Отчёт разработчика

### Сделано

- Добавлен [supabase/seed.sql](../../../supabase/seed.sql): два подтверждённых
  login-capable пользователя `owner-a@example.com` и `owner-b@example.com` с
  фиксированными UUID, отдельными workspace и ролью `owner`. Сид создаёт
  `ai_settings`, по две строки в `channel_connections`, `contacts`,
  `contact_identities`, DM-`conversations`, `messages`, `kb_files` и по одному
  `webhook_events` для каждого workspace. Фикстуры используют только
  демонстрационные данные и известный development-only пароль
  `drafta-demo-password`.
- Добавлен отдельный интеграционный сьют
  [tests/rls/isolation.integration.ts](../../../tests/rls/isolation.integration.ts)
  и команда `npm run test:rls`. Она создаёт два аутентифицированных и один anon
  клиента только с publishable-ключом, проверяет изоляцию всех засеянных
  workspace-таблиц, INSERT/UPDATE с чужим `workspace_id`, отсутствие anon-доступа
  ко всем клиентским таблицам и server-only доступ к `webhook_events`.
- Добавлены `lib/rls-test-config.ts`, его unit-тесты, статический контракт сидов
  и `vitest.rls.config.ts`. Сьют fail-fast до первого сетевого запроса без
  обязательных `RLS_TEST_*` переменных; локальная цель ограничена loopback,
  Cloud-цель — явным `cloud-dev` подтверждением, а `sb_secret_` ключ запрещён.
  Обычный `npm test` не выполняет интеграционные запросы.
- Полностью обновлён [README.md](../../../README.md): основной путь — Supabase
  Cloud dev → `supabase db push --include-seed` → явный `npm run test:rls`,
  Vercel в `fra1`; production запускается без сидов. Локальный путь сохранён как
  опциональный и явно помечен требующим Docker.

### Проверено

- `git diff --check` — успешно.
- `npm.cmd test` — успешно: 9 test files, 24 tests; в том числе статический
  контракт сидов и валидация безопасной конфигурации RLS.
- `npm.cmd run lint` — успешно.
- `npm.cmd run build` — успешно (Next.js production build и TypeScript).
- `npm.cmd run test:rls` без `RLS_TEST_*` — ожидаемо завершился до подключения с
  `Missing required RLS test environment variable: RLS_TEST_TARGET`. Это
  подтверждает безопасный fail-fast, **не** является runtime-проверкой RLS.

### Отклонения и ограничение среды

- `supabase db reset` не запускался: пользователь явно запретил Docker и
  локальный Supabase-стек. По той же причине не выполнялся runtime seed/RLS
  сценарий и намеренное временное ослабление политики. Результат работы не
  утверждает, что сиды или RLS-политики уже исполнялись в PostgreSQL.
- Для runtime-проверки нужен только выделенный Supabase Cloud **dev** проект:
  `supabase link --project-ref <dev-ref>` → `supabase db push --include-seed`,
  затем явные `RLS_TEST_*` из README и `npm run test:rls`. Проверку намеренно
  ослабленной политики нужно выполнить и вернуть политику в этом же disposable
  dev-окружении; production для этого не использовать.
- В T-08 уже есть ручный шаг 2a «Подтвердить RLS-изоляцию в Supabase Cloud dev».
  Он покрывает требуемую cloud-проверку, поэтому другой тикет не менялся.

### Вне скоупа

- Docker, `supabase start`, `supabase db reset`, внешние Supabase/Vercel/SMTP
  ресурсы и credentials не создавались и не изменялись.

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._
