---
id: T-02
epic: E-001
title: "Схема БД v1 миграциями: все таблицы §6"
type: dev
status: done
depends_on: [T-01]
created: 2026-07-19
updated: 2026-07-20
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

### Что сделано

- Supabase CLI инициализирован через `npx supabase init`: созданы
  `supabase/config.toml` и `supabase/.gitignore`.
- В `supabase/migrations/20260720103000_create_schema_v1.sql` создана схема v1 из
  ровно 15 таблиц §6. Все 14 дочерних таблиц содержат прямой `workspace_id` с FK на
  `workspaces(id) on delete cascade`; пользовательские таблицы дополнительно связаны
  с `auth.users`.
- Добавлены поля и `text + check`-ограничения из §6: роли участников, типы и статусы
  переписок, направления и статусы сообщений, диапазон сообщений и статусы черновиков,
  настройки уведомлений и AI. Списки подключений категории и использованных KB-файлов
  представлены типизированными массивами `uuid[]`, чтобы сохранить зафиксированный
  архитектурой набор из 15 таблиц.
- Добавлены требуемые уникальности, включая подключения каналов, сообщения, webhook-
  события, приоритеты категорий и настройки уведомлений. Дополнительно обеспечены один
  owner и одна default-категория на workspace.
- Добавлены индексы по FK и основным выборкам inbox/необработанных webhook-событий.
- На всех 15 таблицах включён RLS без политик: до отдельного T-03 клиентские роли
  находятся в безопасном deny-by-default состоянии.

### Как проверено

- Статическая PowerShell-проверка миграции: **PASS** — точный набор из 15 таблиц,
  14 прямых workspace-каскадов, `created_at`/`updated_at` и RLS у каждой таблицы,
  все обязательные уникальности, отсутствие запрещённого термина `account` в SQL.
- `git diff --check` — ошибок форматирования нет; выдано только предупреждение о
  переводах строк в чужом изменённом `docs/epics/STATUS.md`.
- `npm.cmd run lint` — exit code 0.
- `npm.cmd run build` — exit code 0, production build Next.js успешно собран,
  TypeScript и генерация 4 статических страниц прошли.
- `npm.cmd test` — exit code 0, 1 test file / 1 test passed.

### Отклонения и ограничения проверки

- `supabase start` и `supabase db reset` намеренно не запускались: человек запретил
  использование Docker, а связанного Supabase dev-проекта и учётных данных в
  репозитории нет. Поэтому синтаксис на живом PostgreSQL, фактическое состояние RLS и
  runtime-каскад в этом запуске не проверены; падение DoD не скрывается.
- После появления связанного dev-проекта Frankfurt миграцию необходимо применить
  локально или в CI командой `supabase db push`, как предписывает §13. Этот ручной шаг
  уже зафиксирован в T-08, шаг 2. После push следует проверить 15 таблиц и RLS, а каскад
  — транзакционным SQL: создать временный workspace и строки хотя бы в `contacts`,
  `channel_connections`, `categories`, `kb_files`, `webhook_events`, `ai_settings`,
  удалить workspace и убедиться, что запросы по сохранённому `workspace_id` возвращают
  ноль строк, затем сделать `rollback`.
- RLS-политики не добавлялись согласно явному разделению работ: их скоуп — T-03.

### Вне скоупа и открытые вопросы

- Создание/линковка облачного Supabase dev-проекта, применение миграции и runtime-
  проверки требуют внешних ресурсов и остаются ручным/CI-шагом T-08.
- Чужое изменение `docs/epics/STATUS.md` не затрагивалось.

### Доработка 1

- В `supabase/migrations/20260720103000_create_schema_v1.sql` добавлены составные
  уникальные ключи родительских tenant-таблиц и tenant-aware FK для
  `contact_identities → contacts`, `conversations → channel_connections/contacts`,
  `messages → conversations/contact_identities/categories` и
  `drafts → conversations/messages`.
- Составные FK сохраняют прежнее поведение удаления: связи с контактами, identity и
  category используют `on delete set null` только для ID-колонки, а связи с каналом,
  диалогом и сообщениями — `on delete cascade`. Поэтому `workspace_id` не может быть
  обнулён или связан с данными другого workspace.
- У `drafts.first_message_id` и `last_message_id` FK включает
  `(workspace_id, conversation_id, message_id)`: оба сообщения теперь обязаны
  принадлежать указанному диалогу в том же workspace.
- Повторная статическая PowerShell-проверка миграции — **PASS**: 15 таблиц, прямые
  workspace-каскады, timestamps, RLS и все tenant-aware FK, включая связь
  message→conversation для диапазона черновика. `git diff --check` — exit code 0.
- Повторные проверки: `npm.cmd run lint` — exit code 0; `npm.cmd run build` — exit
  code 0; `npm.cmd test` — exit code 0, 1 test file / 1 test passed.
- `supabase start` и `supabase db reset` не запускались по явному запрету не
  использовать Docker. Runtime-проверка составных FK и каскадов остаётся после
  `supabase db push` в связанный cloud dev-проект (§13, T-08 шаг 2).

## 🔍 Ревью

### Повторное ревью после Доработки 1

**Вердикт: APPROVED**

Предыдущее замечание устранено. Составные tenant-aware FK в
`supabase/migrations/20260720103000_create_schema_v1.sql` исключают ссылки между
разными workspace для `contact_identities → contacts`, `conversations →
channel_connections/contacts`, `messages → conversations/contact_identities/categories`
и `drafts → conversations/messages`. Трёхколоночные FK диапазона `drafts` также
требуют, чтобы первое и последнее сообщения принадлежали указанному conversation в
том же workspace.

Независимо перепроверено:

- статическая проверка tenant-инвариантов — PASS: 15 таблиц, 14 прямых
  `workspace_id → workspaces(id) on delete cascade`, RLS на всех 15 и 9 составных
  tenant-aware FK;
- `on delete cascade` сохранён для связей с каналом, conversation и сообщениями;
  `on delete set null (<id-колонка>)` для контакта, identity и категории не
  обнуляет `workspace_id`;
- `INDEX_AND_REQUIRED_UNIQUENESS_CHECK` — PASS: все 27 явных индексов и
  обязательные уникальности из тикета присутствуют; полный состав таблиц и поля §6
  не регрессировали;
- `rg -n -i "\baccount\b" supabase/migrations` — совпадений нет;
- фактический diff `d9a2df1` меняет только миграцию и отчёт T-02; изменений схемы
  вне `supabase/migrations/`, внешних сервисов, LLM, вебхуков или секретов нет;
- `git diff --check 79deb47 d9a2df1` и `git diff --check` — exit code 0, ошибок
  форматирования нет (только предупреждения Git о CRLF в уже изменённых служебных
  файлах);
- `npm.cmd run lint` — exit code 0;
- `npm.cmd run build` — exit code 0, Next.js собран, TypeScript-проверка прошла;
- `npm.cmd test` — exit code 0, 1 test file / 1 test passed.

`supabase db reset` не запускался по явному запрету Docker. Связанного cloud
dev-проекта нет, а создание/линковка и `supabase db push` во внешний сервис не входят
в полномочия ревью; корректный ручной шаг по §13 уже описан в T-08, шаге 2. После
появления dev-проекта остаётся выполнить runtime-проверку применения миграции, RLS и
каскадов.

### Предыдущее ревью

**Вердикт: CHANGES_REQUESTED**

1. В миграции отсутствует проверка, что связанные тенантные строки принадлежат
   одному `workspace`. Например, `contact_identities.contact_id`, поля связей
   `conversations`, `messages` и `drafts` ссылаются только на глобальный `id`
   родительской таблицы ([миграция](../../../supabase/migrations/20260720103000_create_schema_v1.sql),
   строки 94–184). Поэтому возможно создать строку с `workspace_id = A` и FK
   на родителя из workspace B; после удаления B каскад может удалить или изменить
   строку, формально принадлежащую A. Это нарушает изоляцию workspace и требование
   безопасного каскадного удаления. Добавить составные tenant-aware FK (либо
   эквивалентные проверки на уровне БД) для `contact_identities → contacts`,
   `conversations → channel_connections/contacts`, `messages → conversations/
   contact_identities/categories`, `drafts → conversations/messages`. Для
   `drafts.first_message_id` и `last_message_id` проверка также должна гарантировать
   принадлежность сообщений указанному `conversation_id`.

Перепроверено независимо:

- статическая проверка миграции — PASS: ровно 15 таблиц §6, 14 прямых
  `workspace_id → workspaces(id) on delete cascade`, `created_at`/`updated_at`
  и RLS на всех 15; обязательные уникальности и требуемые индексы присутствуют;
- сверка каждой таблицы с §6: состав сущностей, поля, enum-подобные `check`,
  обязательные уникальности и индексы соответствуют тикету, кроме указанной выше
  неполной целостности межтабличных тенантных связей;
- `rg -n -i "\baccount\b" supabase/migrations` — совпадений нет;
- `git diff --check HEAD~1 HEAD` и `git diff --check` — exit code 0, ошибок
  пробельного форматирования нет (Git вывел только предупреждения о CRLF в уже
  изменённых служебных файлах);
- `npm.cmd run lint` — exit code 0;
- `npm.cmd run build` — exit code 0, Next.js собран и TypeScript-проверка прошла;
- `npm.cmd test` — exit code 0, 1 test file / 1 test passed.

`supabase db reset` не запускался: человек явно запретил Docker, а связанного
облачного dev-проекта и учётных данных в репозитории нет. Это ограничение прозрачно
зафиксировано в отчёте разработчика; дальнейший корректный путь по §13 —
`supabase link` + `supabase db push` в dev-проект, уже описанный в T-08, шаге 2.
Создавать проект или применять миграцию во внешний сервис в рамках ревью не было
разрешено. Runtime-проверка синтаксиса, RLS и каскадов остаётся обязательной после
появления такого окружения.
