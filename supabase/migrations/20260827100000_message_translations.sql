-- Кэш переводов сообщений: текст сообщения, переведённый на язык приложения.
--
-- Оператор работает на языке из «Настройки → Аккаунт»
-- (`workspaces.settings.lang`, lib/i18n/languages.ts), а клиенты пишут на своих.
-- Значок перевода в пузыре сообщения (app/(app)/(shell)/_components/message-bubble.tsx)
-- отправляет текст в LLM и показывает результат на месте оригинала.
--
-- Решения схемы:
--
-- 1. Отдельная таблица, а не колонка в `messages`. Переводов у одного сообщения
--    столько, сколько языков workspace успело побывать выбранными, и появляются
--    они по требованию — колонка означала бы UPDATE горячей таблицы ради
--    производного текста.
--
-- 2. Ключ кэша — (workspace_id, message_id, target_language). Смена языка
--    workspace не инвалидирует уже сделанные переводы: они просто перестают
--    совпадать по `target_language` и снова пригодятся, если язык вернут.
--
-- 3. Ссылка на сообщение — тройным FK, как у `drafts`
--    (20260720103000_create_schema_v1.sql): у `messages` есть
--    `unique (workspace_id, conversation_id, id)` и нет `unique (workspace_id, id)`,
--    поэтому двухколоночный FK туда невозможен. `conversation_id` заодно даёт
--    индексный путь «все переводы треда одним запросом» — тред грузит их
--    вместе с сообщениями, чтобы повторный клик не ходил в LLM.
--
-- 4. Каскад от сообщения, в отличие от `ai_usage`/`ai_request_log`: перевод —
--    производная от текста, и переживать оригинал ему незачем.
--
-- Privacy: строки содержат текст переписки (§15), но не больше, чем сама
-- `messages`, и удаляются тем же каскадом от workspace.
--
-- Docs: docs/architecture/06-data-model.md#message_translations,
--       docs/architecture/08-ai-subsystem.md, docs/architecture/10-ui.md

-- ---------------------------------------------------------------------------
-- 1. Таблица
-- ---------------------------------------------------------------------------

create table public.message_translations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  message_id uuid not null,
  -- Язык, НА который переведено, — язык workspace на момент перевода.
  -- Проверяем только форму кода, как `reply_templates.bodies`: добавление языка
  -- интерфейса не должно требовать миграции.
  target_language text not null
    check (target_language ~ '^[a-z]{2}(-[a-z]{2})?$'),
  -- Язык оригинала так, как его назвала модель: нужен только для подписи кнопки
  -- возврата («↩ Deutsch»). Nullable — модель может его не вернуть, и это не
  -- повод выбрасывать готовый перевод.
  source_language text
    check (source_language ~ '^[a-z]{2}(-[a-z]{2})?$'),
  text text not null,
  provider text not null check (length(btrim(provider)) > 0),
  model text not null check (length(btrim(model)) > 0),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, conversation_id, message_id)
    references public.messages(workspace_id, conversation_id, id) on delete cascade,
  unique (workspace_id, message_id, target_language)
);

comment on table public.message_translations is
  'Кэш переводов текста сообщений на язык workspace. Пишется участником workspace из server action перевода; ключ кэша — (workspace_id, message_id, target_language).';

comment on column public.message_translations.target_language is
  'Код языка, на который переведено, — язык workspace на момент перевода.';

comment on column public.message_translations.source_language is
  'Код языка оригинала по версии модели; null, если модель его не назвала.';

-- Тред читает все свои переводы разом; отдельный поиск по одному сообщению
-- закрыт уникальным ключом.
create index message_translations_conversation_target_idx
  on public.message_translations (workspace_id, conversation_id, target_language);

create index message_translations_workspace_id_idx
  on public.message_translations (workspace_id);

-- ---------------------------------------------------------------------------
-- 2. Доступ: Data API + RLS
-- ---------------------------------------------------------------------------

-- Пишет пользовательский клиент, а не service_role: перевод запускает участник
-- workspace синхронным server action, а не Inngest-пайплайн.
alter table public.message_translations enable row level security;

revoke all on table public.message_translations from anon;
grant select, insert, update, delete on table public.message_translations to authenticated;
grant select, insert, update, delete on table public.message_translations to service_role;

create policy message_translations_member_access
on public.message_translations
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- 3. Перевод как отдельная операция в журналах AI
-- ---------------------------------------------------------------------------

-- `ai_usage` (20260726100000) и `ai_request_log` (20260803100000) перечисляют
-- операции явным CHECK-ом, поэтому новый вызов LLM обязан расширить словарь —
-- иначе учёт токенов молча падает в `console.error` и стоимость перевода
-- нигде не видна. RPC дашборда перечисляет ветки по одной и от нового значения
-- не ломается: перевод просто не попадает в его разбивку.
alter table public.ai_usage drop constraint ai_usage_operation_check;
alter table public.ai_usage add constraint ai_usage_operation_check
  check (operation in ('classification', 'draft', 'translation'));

alter table public.ai_request_log drop constraint ai_request_log_operation_check;
alter table public.ai_request_log add constraint ai_request_log_operation_check
  check (operation in ('classification', 'draft', 'translation'));
