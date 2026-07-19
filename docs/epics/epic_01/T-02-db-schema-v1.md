---
id: T-02
epic: E-001
title: "Схема БД v1 миграциями: все таблицы §6"
type: dev
status: todo
depends_on: [T-01]
created: 2026-07-19
updated: 2026-07-19
---

# T-02. Схема БД v1 миграциями: все таблицы §6

## Цель

`supabase db reset` на чистом локальном стеке создаёт полную схему v1: все 15 таблиц
из [§6](../../architecture/06-data-model.md) с `workspace_id`, каскадным удалением от
workspace, уникальностями и включённым RLS (политики — в T-03).

## Контекст

Обязательно прочитать перед выполнением:

- [6. Модель данных](../../architecture/06-data-model.md) — **вся глава**, каждая таблица
- [2. Глоссарий](../../architecture/02-glossary.md) — имена таблиц/колонок строго по глоссарию
- [4. Мультитенантность](../../architecture/04-multitenancy.md#изоляция-данных) — `workspace_id` в каждой таблице
- [12. Структура репозитория](../../architecture/12-repo-structure.md) — схема живёт только в `supabase/migrations/`
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — правила 1–3

Существенные факты:

- T-01 создал каркас Next.js; Supabase в репозитории ещё не инициализирован —
  начать с `supabase init`.
- Локальный стек: `supabase start` (требуется Docker — открытый вопрос №3 в `_index.md`).
- Таблицы `kb_files`, `invitations`, `categories` создаются **пустыми** — их
  функциональность приходит в этапах 4/8/6; сейчас только схема.
- Тенант — всегда `workspace`; слово `account` в схеме запрещено.

Полный список таблиц (детали полей — в §6): `workspaces`, `workspace_members`,
`invitations`, `channel_connections`, `categories`, `contacts`, `contact_identities`,
`conversations`, `messages`, `drafts`, `kb_files`, `webhook_events`,
`push_subscriptions`, `notification_settings`, `ai_settings`.

## Шаги реализации

1. `supabase init` — каталог `supabase/` с конфигом; проверить, что локальный стек
   поднимается (`supabase start`).
2. Одна миграция (или несколько логичных) в `supabase/migrations/` со всеми таблицами §6:
   - везде, кроме `workspaces`, — `workspace_id` c `references workspaces on delete cascade`
     (у пользовательских таблиц типа `push_subscriptions` и `notification_settings` —
     по §6: `push_subscriptions` привязана к user, `notification_settings` — к паре
     user+workspace);
   - `workspace_members`: PK (workspace_id, user_id), `role` со значениями `owner` | `member`;
   - уникальности: `channel_connections` (workspace, провайдер, внешний ID);
     `messages` (conversation, внешний ID); `webhook_events` (провайдер, внешний ID события);
     `categories.priority` уникален в workspace; `notification_settings` (user, workspace);
   - `conversations.kind` (`dm` | `comments`), статусы, `last_incoming_at`, счётчик непрочитанного;
   - `drafts`: диапазон входящих (первое/последнее message), статус
     (`generating`…`superseded`), модель, использованные файлы KB;
   - `messages.category_id` — nullable FK на `categories`;
   - enum-подобные поля — `text` + `check`-констрейнты (проще эволюционировать миграциями,
     чем postgres-enum);
   - `created_at`/`updated_at` таймстемпы по всем таблицам.
3. В той же миграции — `alter table … enable row level security` для **каждой** таблицы
   (без политик доступ закрыт по умолчанию — безопасное состояние до T-03).
4. Индексы под очевидные выборки: FK-колонки (`workspace_id`, `conversation_id`,
   `contact_id`), `webhook_events` по отметке обработки.
5. Проверочный SQL-скрипт (можно временный, в отчёте): вставить workspace с дочерними
   строками через `service_role`, удалить workspace, убедиться, что дочерние строки исчезли.

## Критерии приёмки

- [ ] `supabase db reset` проходит без ошибок и создаёт все 15 таблиц §6
- [ ] Во всех тенантных таблицах есть `workspace_id` с `on delete cascade` (проверяемо запросом к `information_schema`)
- [ ] RLS включён на всех созданных таблицах; без политик анонимный/authenticated доступ закрыт
- [ ] Уникальности из §6 существуют (channel_connections, messages, webhook_events, categories.priority, notification_settings)
- [ ] Удаление workspace каскадно стирает дочерние строки (продемонстрировано в отчёте)
- [ ] Схема нигде не использует слово `account`; термины соответствуют глоссарию
- [ ] Никаких изменений схемы вне `supabase/migrations/`

## Definition of Done

```
supabase db reset        # применяет миграции с нуля без ошибок
npm run lint
npm run build
npm test
```

Ревьюер сверяет каждую таблицу с §6 и проверяет каскад и включённый RLS SQL-запросами.

---

## 🔧 Отчёт разработчика

_Заполняется агентом-разработчиком: что сделано (файлы), как проверено
(команды и результат), отклонения, «вне скоупа», вопросы._

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._
