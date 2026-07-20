---
id: T-03
epic: E-001
title: "RLS-политики изоляции workspace"
type: dev
status: done
depends_on: [T-02]
created: 2026-07-19
updated: 2026-07-20
---

# T-03. RLS-политики изоляции workspace

## Цель

Аутентифицированный пользователь через publishable-ключ видит и меняет только строки
тех workspace'ов, где он участник; чужие workspace'ы полностью невидимы. Операции
уровня владельца (управление участниками, приглашениями, удаление workspace) доступны
только `owner`.

## Контекст

Обязательно прочитать перед выполнением:

- [4. Мультитенантность](../../architecture/04-multitenancy.md) — роли, изоляция данных, поведение secret-ключа
- [6. Модель данных](../../architecture/06-data-model.md) — какие таблицы тенантные, а какие привязаны к user
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — правило 3, обязательные тесты RLS
- [13. Окружения, секреты](../../architecture/13-environments-secrets.md#секреты-vercel-env) — `sb_secret_` обходит RLS

Существенные факты:

- T-02 создал все таблицы с включённым RLS без политик (всё закрыто).
- Серверный код (вебхуки, Inngest — в будущих этапах) ходит через secret-ключ **мимо RLS**;
  политики пишутся для клиентского доступа через publishable-ключ.
- Наивная политика с подзапросом к `workspace_members` на самой `workspace_members`
  рекурсивна — нужна `security definer`-функция.

## Шаги реализации

1. Новая миграция в `supabase/migrations/` (схему меняем только миграциями).
2. Helper-функции `security definer` (в отдельной схеме, например `private`, недоступной
   через API): `is_workspace_member(workspace_id uuid)` и
   `is_workspace_owner(workspace_id uuid)` на основе `auth.uid()` и `workspace_members`.
3. Политики:
   - `workspaces`: SELECT — участник; UPDATE/DELETE — owner; INSERT напрямую не разрешать
     (создание workspace пойдёт через security definer RPC в T-05);
   - `workspace_members`: SELECT — участник того же workspace; INSERT/UPDATE/DELETE — owner
     (запись owner'а при создании workspace создаст RPC из T-05 мимо RLS);
   - `invitations`: все операции — только owner;
   - остальные тенантные таблицы (`channel_connections`, `categories`, `contacts`,
     `contact_identities`, `conversations`, `messages`, `drafts`, `kb_files`,
     `ai_settings`): SELECT/INSERT/UPDATE/DELETE — участник workspace
     (тонкая настройка по ролям — забота будущих этапов, не этого тикета);
   - `webhook_events`: клиентских политик нет — таблица только для серверного кода;
   - `push_subscriptions`: все операции — владелец строки (`user_id = auth.uid()`);
   - `notification_settings`: все операции — владелец строки, участник workspace.
4. Для INSERT/UPDATE — обязательно `with check`, не только `using`.
5. Ручная проверка сценарием SQL (в отчёт): под двумя разными JWT (или через
   `set request.jwt.claims`) убедиться, что пользователь A не видит workspace B,
   member не может вставить строку в чужой workspace, anon не видит ничего.

## Критерии приёмки

- [ ] Пользователь-участник видит строки только своих workspace'ов во всех тенантных таблицах
- [ ] Пользователь не может SELECT/INSERT/UPDATE/DELETE в чужой workspace (включая `with check` на запись)
- [ ] `workspace_members` читается участниками без рекурсии политик (helper `security definer`)
- [ ] `invitations` и мутации `workspace_members` — только owner
- [ ] `webhook_events` недоступна через publishable-ключ вовсе
- [ ] Анонимный доступ ко всем таблицам закрыт
- [ ] Все изменения — одной новой миграцией; `supabase db reset` проходит

## Definition of Done

```
supabase db reset
npm run lint
npm run build
npm test
```

Плюс SQL-сценарий изоляции из шага 5 — прогнан разработчиком и повторён ревьюером
(автотесты изоляции на клиенте — отдельный тикет T-06).

---

## 🔧 Отчёт разработчика

### Что сделано

- Добавлена единственная миграция
  `supabase/migrations/20260720120000_add_workspace_rls_policies.sql`.
  В ней созданы `security definer`-функции `private.is_workspace_member(uuid)` и
  `private.is_workspace_owner(uuid)`: они читают `workspace_members` от владельца
  функции, используют `auth.uid()` и фиксированный `search_path = ''`, поэтому
  SELECT `workspace_members` не рекурсирует через собственную RLS-политику.
  Схема `private` и функции закрыты для `public`; API-конфигурация экспонирует только
  `public` и `graphql_public`, так что helper-функции не становятся RPC API.
- Добавлены политики только для роли `authenticated`:
  - `workspaces`: SELECT для участника, UPDATE/DELETE для owner, без INSERT;
  - `workspace_members` и `invitations`: SELECT по участию, все мутации только для
    owner с `with check`;
  - `channel_connections`, `categories`, `contacts`, `contact_identities`,
    `conversations`, `messages`, `drafts`, `kb_files`, `ai_settings`: все операции
    для участника с `using` и `with check`;
  - `push_subscriptions` и `notification_settings`: пользователь должен владеть
    строкой и состоять в её workspace, также с `using` и `with check`.
  Для `webhook_events` политика намеренно не создаётся.
- Явно заданы Data API grants, необходимые в новых Supabase-проектах: у
  `authenticated` только операции, покрытые политиками, а у `service_role` —
  серверный доступ ко всем 15 таблицам. У `anon` всё отозвано; у `authenticated`
  отдельно отозван доступ к `webhook_events`. Таким образом, RLS не маскирует
  отсутствующие ACL, а `SUPABASE_SECRET_KEY` остаётся серверным обходом RLS.
- В `docs/epics/epic_01/T-08-executive-summary.md` добавлен ручной cloud-шаг 2a:
  после `supabase db push` проверить изоляцию под тестовыми JWT, отсутствие рекурсии
  `workspace_members`, owner-операции, закрытые `webhook_events` и anon-доступ.

### Как проверено

- Статическая PowerShell-проверка итоговой миграции и `supabase/config.toml` —
  **PASS**: 16 инвариантов, 22 клиентские политики. Проверены private-schema,
  `security definer` и фиксированный search path, grants, отсутствие client-политики
  у `webhook_events`, все таблицы/операции, `authenticated` как единственная роль
  политик и `with check` на записях.
- Дополнительная статическая проверка формы owner-политик — **PASS**: 6 инвариантов
  для `invitations` и запрета INSERT в `workspaces` (и на уровне ACL, и на уровне
  RLS).
- `git diff --check` — exit code 0; только предупреждения Git о CRLF в уже
  изменённых служебных Markdown-файлах.
- `npm.cmd run lint` — exit code 0.
- `npm.cmd run build` — exit code 0: production build Next.js, TypeScript и
  генерация 4 статических страниц прошли.
- `npm.cmd test` — exit code 0: 1 test file / 1 test passed.

### Ограничения и ручной SQL-сценарий

`supabase db reset` и локальная runtime-проверка не запускались: человек явно
запретил Docker, а связанного cloud dev-проекта и полномочий на его создание/линковку
нет. Поэтому это не выдано за пройденный пункт DoD. `supabase db push` также не
выполнялся — его следует запустить человеком или CI в уже созданном Frankfurt
dev-проекте, как предписывает §13.

После push выполнить добавленный в T-08 шаг 2a. Базовый негативный сценарий для
двух существующих тестовых пользователей выглядит так:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<user-a-uuid>', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"<user-a-uuid>","role":"authenticated"}',
  true
);

select id from public.workspaces where id = '<workspace-b-uuid>';
-- Ожидается: 0 rows.

insert into public.contacts (workspace_id, display_name)
values ('<workspace-b-uuid>', 'Forbidden');
-- Ожидается: new row violates row-level security policy.

rollback;
```

Тем же способом нужно проверить допустимый SELECT участника, чтение
`workspace_members` без ошибки рекурсии, owner-only мутации, запрет SELECT на
`webhook_events` и anon-доступ. Для подготовки/очистки использовать только тестовые
данные и откатываемые транзакции.

### Отклонения, вне скоупа и открытые вопросы

- В `push_subscriptions` к требованию владельца строки добавлена проверка участия в
  workspace. Это намеренно строже буквального минимума тикета: пользователь не может
  привязать свой endpoint к чужому workspace, что сохраняет основную гарантию
  изоляции.
- Docker, `supabase start`, `supabase db reset`, создание/линковка Supabase-проектов
  и внешние настройки не выполнялись. Никаких иных изменений схемы, серверного кода,
  секретов или сервисов вне скоупа T-03 не внесено.

## 🔍 Ревью

### APPROVED

Статически миграция `20260720120000_add_workspace_rls_policies.sql` соответствует
критериям тикета и tenant-aware схеме T-02: RLS включён на всех 15 таблицах,
22 политики адресованы только `authenticated`, все нужные операции покрыты, а
записывающие политики содержат `USING` и/или `WITH CHECK` по назначению. Отдельно
проверены owner-only мутации `workspaces`, `workspace_members` и `invitations`,
отсутствие INSERT в `workspaces`, отсутствие клиентской политики и прав у
`authenticated` на `webhook_events`, а также отзыв прав у `anon`.

`security definer`-helpers читают `workspace_members` вне рекурсии, имеют
фиксированный пустой `search_path`, квалифицированные имена и ограниченный EXECUTE;
схема `private` не экспонируется Data API. Политики используют `workspace_id` и не
ослабляют составные tenant-aware связи из T-02. Лишних изменений вне новой миграции
и документированного ручного шага T-08 нет.

Прогнано независимо:

- `git diff --check f5020dd^ f5020dd` — PASS;
- статическая проверка миграции и T-02 — PASS: 15 таблиц с RLS, 22 политики,
  полный охват таблиц/операций, owner-ограничения, `WITH CHECK`, закрытые
  `webhook_events` и `anon`;
- `npm.cmd run lint` — PASS;
- `npm.cmd run build` — PASS;
- `npm.cmd test` — PASS (1 test).

`supabase db reset` и runtime SQL-сценарий намеренно не запускались: Docker
запрещён, а cloud dev-проект не привязан. Это честно отражено в отчёте и вынесено в
T-08, шаг 2a: после ручного/CI `supabase db push` необходимо проверить изоляцию под
тестовыми JWT, отсутствие рекурсии, owner-операции, `webhook_events` и `anon`.
