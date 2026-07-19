---
id: T-03
epic: E-001
title: "RLS-политики изоляции workspace"
type: dev
status: todo
depends_on: [T-02]
created: 2026-07-19
updated: 2026-07-19
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

_Заполняется агентом-разработчиком: что сделано (файлы), как проверено
(команды и результат), отклонения, «вне скоупа», вопросы._

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._
