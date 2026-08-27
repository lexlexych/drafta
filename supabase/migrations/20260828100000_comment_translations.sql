-- Кэш переводов комментариев: текст комментария, переведённый на язык приложения.
--
-- Зеркало `message_translations` (20260827100000) для второго ящика: оператор
-- работает на языке из «Настройки → Аккаунт» (`workspaces.settings.lang`,
-- lib/i18n/languages.ts), а комментарии под постом приходят на языке
-- комментатора. Значок перевода стоит в строке действий под комментарием
-- (app/(app)/(shell)/comments/_components/post-thread.tsx) и работает ровно так
-- же, как в пузыре сообщения.
--
-- Решения схемы:
--
-- 1. Отдельная таблица от `message_translations`, а не общая с полиморфной
--    ссылкой. Комментарии живут в своих таблицах и своим пайплайном (§6.
--    «не conversation»), а полиморфный FK лишил бы обе стороны каскада.
--
-- 2. Ключ кэша — (workspace_id, comment_id, target_language), как у сообщений:
--    смена языка workspace не инвалидирует уже сделанные переводы.
--
-- 3. Ссылка на комментарий — двухколоночным FK, в отличие от тройного у
--    сообщений: у `public.comments` есть `unique (workspace_id, id)`
--    (20260725110000_split_comments_from_conversations.sql), которого нет у
--    `messages`. `post_id` хранится отдельной колонкой не ради FK, а ради
--    индексного пути «все переводы поста одним запросом» — тред грузит их
--    вместе с комментариями, чтобы повторный клик не ходил в LLM.
--
-- 4. Каскад от комментария: перевод — производная от текста и переживать
--    оригинал ему незачем.
--
-- Privacy: строки содержат текст комментариев (§15), но не больше, чем сама
-- `comments`, и удаляются тем же каскадом от workspace.
--
-- Docs: docs/architecture/06-data-model.md#comment_translations,
--       docs/architecture/08-ai-subsystem.md, docs/architecture/10-ui.md

-- ---------------------------------------------------------------------------
-- 1. Таблица
-- ---------------------------------------------------------------------------

create table public.comment_translations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  post_id uuid not null,
  comment_id uuid not null,
  target_language text not null
    check (target_language ~ '^[a-z]{2}(-[a-z]{2})?$'),
  source_language text
    check (source_language ~ '^[a-z]{2}(-[a-z]{2})?$'),
  text text not null,
  provider text not null check (length(btrim(provider)) > 0),
  model text not null check (length(btrim(model)) > 0),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, post_id)
    references public.posts(workspace_id, id) on delete cascade,
  foreign key (workspace_id, comment_id)
    references public.comments(workspace_id, id) on delete cascade,
  unique (workspace_id, comment_id, target_language)
);

comment on table public.comment_translations is
  'Кэш переводов текста комментариев на язык workspace. Пишется участником workspace из server action перевода; ключ кэша — (workspace_id, comment_id, target_language).';

comment on column public.comment_translations.target_language is
  'Код языка, на который переведено, — язык workspace на момент перевода.';

comment on column public.comment_translations.source_language is
  'Код языка оригинала по версии модели; null, если модель его не назвала.';

-- Тред поста читает все свои переводы разом; поиск по одному комментарию
-- закрыт уникальным ключом.
create index comment_translations_post_target_idx
  on public.comment_translations (workspace_id, post_id, target_language);

create index comment_translations_workspace_id_idx
  on public.comment_translations (workspace_id);

-- ---------------------------------------------------------------------------
-- 2. Доступ: Data API + RLS
-- ---------------------------------------------------------------------------

-- Пишет пользовательский клиент, а не service_role: перевод запускает участник
-- workspace синхронным server action, а не Inngest-пайплайн.
alter table public.comment_translations enable row level security;

revoke all on table public.comment_translations from anon;
grant select, insert, update, delete on table public.comment_translations to authenticated;
grant select, insert, update, delete on table public.comment_translations to service_role;

create policy comment_translations_member_access
on public.comment_translations
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

-- Словари операций (`ai_usage_operation_check`, `ai_request_log_operation_check`)
-- уже содержат 'translation' после 20260827100000, а `surface` у обоих журналов
-- с самого начала допускает 'comment' — расширять здесь нечего.
