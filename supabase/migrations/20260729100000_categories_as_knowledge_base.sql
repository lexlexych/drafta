-- Категории и база знаний становятся одной сущностью.
--
-- Было две настройки об одном и том же: `categories` (правило классификации:
-- описание, приоритет, каналы, «действие» для черновика, skip_draft) и
-- `kb_files` (markdown, который уходит в промпт). Категория умела ещё и
-- переопределять набор файлов (`categories.kb_file_ids`) — то есть сущности уже
-- были склеены, а пользователь описывал одно знание в двух местах.
--
-- Теперь категория — это запись `kb_files`: название категории + markdown,
-- который её описывает и одновременно является знанием по ней. Все активные
-- категории уходят в системный промпт, а классификация перестаёт быть отдельным
-- вызовом LLM: модель возвращает список категорий первой строкой ответа
-- (CATEGORIES:, см. lib/ai/prompt.ts) вместе с самим черновиком.
--
-- Отсюда изменения схемы:
--   1. таблица `categories` и все её RPC/триггеры удаляются целиком, вместе с
--      `messages.category_id` и `conversations.category_id`;
--   2. `kb_files` перестаёт требовать расширение `.md` в имени — это больше не
--      имя файла, а название категории;
--   3. появляется `drafts.matched_kb_file_ids` (что назвала модель) и
--      `conversations.matched_kb_file_ids` (копия из последнего черновика — по
--      ней работает фильтр списка бесед);
--   4. `finalize_draft_generation` пишет оба массива в той же транзакции, где
--      уже держит блокировку беседы, поэтому отдельного шага «сохранить
--      категорию» в пайплайне не остаётся;
--   5. `get_dashboard_metrics` считает распределение по категориям черновиков,
--      а не по `messages.category_id`, и больше не отдаёт бакеты токенов
--      классификации.
--
-- Docs: docs/architecture/09-categories.md, docs/architecture/08-ai-subsystem.md,
--       docs/architecture/06-data-model.md, docs/architecture/07-data-flows.md

-- ---------------------------------------------------------------------------
-- 1. Снос старой модели категорий
-- ---------------------------------------------------------------------------

-- Триггер чистки каналов существовал только ради `categories.channel_connection_ids`.
drop trigger if exists channel_connections_strip_from_categories on public.channel_connections;
drop function if exists private.strip_deleted_channel_from_categories();

drop function if exists public.create_category(uuid, text, text, text, uuid[], boolean, uuid[]);
drop function if exists public.update_category(uuid, uuid, text, text, text, uuid[], boolean, uuid[]);
drop function if exists public.delete_category(uuid, uuid);
drop function if exists public.reorder_categories(uuid, uuid[]);

drop function if exists private.validate_category_channels(uuid, uuid[]);
drop function if exists private.validate_category_kb_files(uuid, uuid[]);

-- Constraint-триггер снимается вместе с таблицей, но функция живёт отдельно.
drop trigger if exists categories_default_invariants on public.categories;
drop function if exists private.ensure_category_default_invariants();

-- Композитные FK и индексы уходят вместе с колонками.
alter table public.messages drop column if exists category_id;
alter table public.conversations drop column if exists category_id;

drop table if exists public.categories cascade;

-- ---------------------------------------------------------------------------
-- 2. kb_files — это категории
-- ---------------------------------------------------------------------------

-- Имя больше не имя файла: «Прайс и доставка», а не «02-прайс.md». Остальные
-- ограничения несущие и остаются: уникальность lower(name) в workspace нужна
-- сильнее прежнего — по названию мы разворачиваем ответ модели обратно в id.
alter table public.kb_files
  drop constraint if exists kb_files_markdown_name_check;

comment on table public.kb_files is
  'Категории базы знаний workspace: название категории + markdown, который её описывает. Все активные уходят в системный промпт.';
comment on column public.kb_files.name is
  'Название категории. Уникально в рамках workspace без учёта регистра: по нему резолвится ответ модели.';
comment on column public.kb_files.is_enabled is
  'Активные категории попадают в промпт; выключенная остаётся в списке, но не участвует в генерации.';

-- ---------------------------------------------------------------------------
-- 3. Категории на черновике и на беседе
-- ---------------------------------------------------------------------------

-- Массивы, а не join-таблица, по той же причине, что и `drafts.kb_file_ids`:
-- это снимок намерения, удалённая категория просто выпадает на чтении, и не
-- нужны отдельная таблица, RLS и каскад.
alter table public.drafts
  add column matched_kb_file_ids uuid[] not null default '{}';

comment on column public.drafts.matched_kb_file_ids is
  'Категории, которые модель назвала источником ответа (строка CATEGORIES: в ответе). Отличается от kb_file_ids: там снимок того, что ушло в промпт.';

alter table public.conversations
  add column matched_kb_file_ids uuid[] not null default '{}';

comment on column public.conversations.matched_kb_file_ids is
  'Категории последнего черновика беседы; перезаписываются целиком при каждой финализации. По ним фильтруется список бесед.';

-- Фильтр списка бесед — `matched_kb_file_ids && $1`, то есть пересечение
-- массивов: это GIN, а не btree.
create index conversations_matched_kb_files_idx
  on public.conversations using gin (matched_kb_file_ids);

-- У массива нет внешнего ключа, поэтому удалённая категория осталась бы висячим
-- id: чип беседы пропал бы (имя не резолвится), а фильтр по ней всё равно
-- отдавал бы эту беседу. Триггер — тот же приём, что раньше вычищал удалённый
-- канал из категорий.
create or replace function private.strip_deleted_kb_file_from_conversations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set matched_kb_file_ids =
    pg_catalog.array_remove(matched_kb_file_ids, old.id)
  where workspace_id = old.workspace_id
    and old.id = any(matched_kb_file_ids);

  return null;
end;
$$;

revoke all on function private.strip_deleted_kb_file_from_conversations() from public;

create trigger kb_files_strip_from_conversations
after delete on public.kb_files
for each row
execute function private.strip_deleted_kb_file_from_conversations();

-- ---------------------------------------------------------------------------
-- 4. finalize_draft_generation записывает категории
-- ---------------------------------------------------------------------------

-- Единственный разрешённый путь записи в `drafts` (здесь живут частичный
-- уникальный индекс и блокировка беседы), поэтому категории едут через него, а
-- не отдельным update: беседа и черновик получают один и тот же набор атомарно.
drop function if exists public.finalize_draft_generation(uuid, uuid, text, text, boolean, text);

create function public.finalize_draft_generation(
  target_workspace_id uuid,
  target_draft_id uuid,
  generated_text text,
  generated_model text,
  supersede_edited boolean default false,
  review_reason text default null,
  matched_kb_file_ids uuid[] default '{}'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_conversation_id uuid;
  normalized_reason text := nullif(pg_catalog.btrim(review_reason), '');
  normalized_categories uuid[] := coalesce(matched_kb_file_ids, '{}'::uuid[]);
begin
  select draft.conversation_id
  into target_conversation_id
  from public.drafts as draft
  where draft.workspace_id = target_workspace_id
    and draft.id = target_draft_id
    and draft.status = 'generating';

  if not found then
    return false;
  end if;

  perform 1
  from public.conversations as conversation
  where conversation.workspace_id = target_workspace_id
    and conversation.id = target_conversation_id
  for update;

  if not found then
    return false;
  end if;

  -- Re-check after taking the conversation lock: another transaction may have
  -- finalized or removed this draft while this call was waiting.
  perform 1
  from public.drafts as draft
  where draft.workspace_id = target_workspace_id
    and draft.id = target_draft_id
    and draft.conversation_id = target_conversation_id
    and draft.status = 'generating'
  for update;

  if not found then
    return false;
  end if;

  update public.drafts as draft
  set status = 'superseded',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.conversation_id = target_conversation_id
    and draft.id <> target_draft_id
    and (
      draft.status = 'ready'
      or (supersede_edited and draft.status = 'edited')
    );

  update public.drafts as draft
  set text = generated_text,
      model = generated_model,
      manual_review_reason = normalized_reason,
      matched_kb_file_ids = normalized_categories,
      status = 'ready',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.id = target_draft_id
    and draft.conversation_id = target_conversation_id
    and draft.status = 'generating';

  if not found then
    return false;
  end if;

  -- Категории беседы всегда от последнего черновика: набор перезаписывается
  -- целиком, а не дополняется. Иначе беседа копила бы категории всех прошлых
  -- вопросов и фильтр показывал бы её по давно закрытой теме.
  update public.conversations as conversation
  set matched_kb_file_ids = normalized_categories
  where conversation.workspace_id = target_workspace_id
    and conversation.id = target_conversation_id;

  return true;
end;
$$;

revoke all on function public.finalize_draft_generation(uuid, uuid, text, text, boolean, text, uuid[])
  from public;
grant execute on function public.finalize_draft_generation(uuid, uuid, text, text, boolean, text, uuid[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. create_workspace без засева категорий
-- ---------------------------------------------------------------------------

-- Категории теперь наполняет пользователь в «Настройки → База знаний»: засевать
-- «Личное» и «По умолчанию» больше нечем и незачем — правил классификации нет.
create or replace function public.create_workspace(
  target_workspace_id uuid,
  owner_user_id uuid,
  workspace_name text,
  provider_profiles jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := pg_catalog.btrim(workspace_name);
  zernio_profile_id text := provider_profiles ->> 'zernio';
begin
  if target_workspace_id is null or owner_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'Workspace id and owner user id are required';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception using
      errcode = '22023',
      message = 'Workspace name must not be empty';
  end if;

  if jsonb_typeof(provider_profiles) <> 'object'
     or zernio_profile_id is null
     or pg_catalog.btrim(zernio_profile_id) = '' then
    raise exception using
      errcode = '22023',
      message = 'A Zernio provider profile id is required';
  end if;

  insert into public.workspaces (id, name, settings)
  values (
    target_workspace_id,
    normalized_name,
    pg_catalog.jsonb_build_object('providerProfiles', provider_profiles)
  );

  insert into public.workspace_members (workspace_id, user_id, role)
  values (target_workspace_id, owner_user_id, 'owner');

  insert into public.ai_settings (workspace_id)
  values (target_workspace_id);

  return target_workspace_id;
end;
$$;

revoke all on function public.create_workspace(uuid, uuid, text, jsonb) from public;
grant execute on function public.create_workspace(uuid, uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Метрики дашборда на новых категориях
-- ---------------------------------------------------------------------------

-- Распределение считается по черновикам за период, а не по входящим сообщениям:
-- категорию теперь называет модель в ответе, и живёт она на черновике.
-- Бакеты токенов классификации из ответа уходят — второго вызова LLM больше нет.
-- Сам check `operation in ('classification','draft')` на ai_usage не трогаем:
-- исторические строки должны остаться валидными и попадают в 'total'.
create or replace function public.get_dashboard_metrics(
  target_workspace_id uuid,
  period_start timestamptz,
  period_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using
      errcode = '42501',
      message = 'Dashboard metrics are available to workspace members only';
  end if;

  with
  -- Reply pairing, DMs. Outgoing messages carry no link back to the incoming
  -- ones they answer: accept_reply_for_send() inserts them with
  -- `external_id = null` and no `parent_external_id`. Pairs are therefore
  -- reconstructed from the order inside the conversation, exactly the way the
  -- draft pipeline itself batches ("everything after the last outgoing
  -- message" — selectBatchMessages in lib/inngest/functions/draft-pipeline.ts).
  --
  -- The running count of *preceding* outgoing messages labels each contiguous
  -- run: an incoming streak and the outgoing message that closes it share a
  -- `burst`, while a second consecutive outgoing message starts a burst of its
  -- own and is dropped below for having no incoming side.
  --
  -- Only conversations that were actually replied to during the period are
  -- scanned — otherwise this would read the workspace's entire history to
  -- answer a question about one day.
  dm_bursts as (
    select
      message.conversation_id,
      message.direction,
      message.created_at,
      count(*) filter (where message.direction = 'outgoing') over (
        partition by message.conversation_id
        order by message.created_at, message.id
        rows between unbounded preceding and 1 preceding
      ) as burst
    from public.messages as message
    where message.workspace_id = target_workspace_id
      and message.delivery_status <> 'failed'
      and message.conversation_id in (
        select reply.conversation_id
        from public.messages as reply
        where reply.workspace_id = target_workspace_id
          and reply.direction = 'outgoing'
          and reply.delivery_status <> 'failed'
          and reply.created_at >= period_start
          and reply.created_at < period_end
      )
  ),
  -- `created_at` rather than `sent_at` is the reply moment throughout: it is
  -- when the operator accepted and queued the reply, whereas `sent_at` adds
  -- provider round-trip latency and stays null while a send is pending.
  dm_reply_seconds as (
    select
      extract(epoch from (
        min(created_at) filter (where direction = 'outgoing')
        - min(created_at) filter (where direction = 'incoming')
      )) as seconds,
      min(created_at) filter (where direction = 'outgoing') as replied_at
    from dm_bursts
    group by conversation_id, burst
    having min(created_at) filter (where direction = 'outgoing') is not null
       and min(created_at) filter (where direction = 'incoming') is not null
  ),
  -- Reply pairing, comments. These need no reconstruction: a reply is always
  -- published against one specific comment, and accept_comment_draft_for_send()
  -- records that as `parent_external_id`.
  comment_reply_seconds as (
    select
      extract(epoch from (reply.created_at - source.created_at)) as seconds,
      reply.created_at as replied_at
    from public.comments as reply
    join public.comments as source
      on source.workspace_id = reply.workspace_id
      and source.post_id = reply.post_id
      and source.external_id = reply.parent_external_id
      and source.direction = 'incoming'
    where reply.workspace_id = target_workspace_id
      and reply.direction = 'outgoing'
      and reply.delivery_status <> 'failed'
      and reply.parent_external_id is not null
      and reply.created_at >= period_start
      and reply.created_at < period_end
  ),
  reply_seconds as (
    select seconds, replied_at from dm_reply_seconds
    union all
    select seconds, replied_at from comment_reply_seconds
  ),
  -- One median over both surfaces: the dashboard shows a single "median reply
  -- time" tile, not one per surface.
  median_reply as (
    select percentile_cont(0.5) within group (order by seconds) as seconds
    from reply_seconds
    where seconds is not null
      and seconds >= 0
      and replied_at >= period_start
      and replied_at < period_end
  ),
  period_counts as (
    select
      (
        select count(*)
        from public.messages as message
        where message.workspace_id = target_workspace_id
          and message.direction = 'incoming'
          and message.created_at >= period_start
          and message.created_at < period_end
      ) as incoming_messages,
      (
        select count(*)
        from public.comments as comment
        where comment.workspace_id = target_workspace_id
          and comment.direction = 'incoming'
          and comment.created_at >= period_start
          and comment.created_at < period_end
      ) as incoming_comments,
      (
        select count(*)
        from public.drafts as draft
        where draft.workspace_id = target_workspace_id
          and draft.created_at >= period_start
          and draft.created_at < period_end
      ) as drafts_messages,
      (
        select count(*)
        from public.comment_drafts as comment_draft
        where comment_draft.workspace_id = target_workspace_id
          and comment_draft.created_at >= period_start
          and comment_draft.created_at < period_end
      ) as drafts_comments
  ),
  -- Only ids and totals: names and colours come from the category list the
  -- screen already loads, so the chart matches the inbox chips exactly.
  -- `left join lateral` keeps drafts with an empty array in the result with a
  -- null id — that is the "no category" row, and it also catches a category
  -- deleted after the fact (its id no longer resolves to a name).
  -- A draft that named two categories counts once in each: the chart answers
  -- "what were people asking about", not "how many drafts were there".
  category_totals as (
    select
      matched.category_id,
      count(*) as total
    from public.drafts as draft
    left join lateral unnest(draft.matched_kb_file_ids) as matched(category_id)
      on true
    where draft.workspace_id = target_workspace_id
      and draft.created_at >= period_start
      and draft.created_at < period_end
    group by matched.category_id
  ),
  token_totals as (
    select
      coalesce(sum(prompt_tokens) filter (
        where operation = 'draft' and surface = 'message'), 0) as message_draft_prompt,
      coalesce(sum(completion_tokens) filter (
        where operation = 'draft' and surface = 'message'), 0) as message_draft_completion,
      coalesce(sum(total_tokens) filter (
        where operation = 'draft' and surface = 'message'), 0) as message_draft_total,
      coalesce(sum(prompt_tokens) filter (
        where operation = 'draft' and surface = 'comment'), 0) as comment_draft_prompt,
      coalesce(sum(completion_tokens) filter (
        where operation = 'draft' and surface = 'comment'), 0) as comment_draft_completion,
      coalesce(sum(total_tokens) filter (
        where operation = 'draft' and surface = 'comment'), 0) as comment_draft_total,
      coalesce(sum(prompt_tokens), 0) as all_prompt,
      coalesce(sum(completion_tokens), 0) as all_completion,
      coalesce(sum(total_tokens), 0) as all_total
    from public.ai_usage as usage
    where usage.workspace_id = target_workspace_id
      and usage.created_at >= period_start
      and usage.created_at < period_end
  )
  select jsonb_build_object(
    'incoming_messages', period_counts.incoming_messages,
    'incoming_comments', period_counts.incoming_comments,
    'drafts_messages', period_counts.drafts_messages,
    'drafts_comments', period_counts.drafts_comments,
    'median_reply_seconds', (select seconds from median_reply),
    'categories', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('category_id', category_totals.category_id, 'total', category_totals.total)
          order by category_totals.total desc
        )
        from category_totals
      ),
      '[]'::jsonb
    ),
    'tokens', jsonb_build_object(
      'message_draft', jsonb_build_object(
        'prompt', token_totals.message_draft_prompt,
        'completion', token_totals.message_draft_completion,
        'total', token_totals.message_draft_total
      ),
      'comment_draft', jsonb_build_object(
        'prompt', token_totals.comment_draft_prompt,
        'completion', token_totals.comment_draft_completion,
        'total', token_totals.comment_draft_total
      ),
      -- Суммирует и исторические строки operation = 'classification': вызова
      -- больше нет, но потраченное в прошлом из отчёта исчезать не должно.
      'total', jsonb_build_object(
        'prompt', token_totals.all_prompt,
        'completion', token_totals.all_completion,
        'total', token_totals.all_total
      )
    ),
    -- Lets the screen tell "nothing was spent in this period" apart from
    -- "accounting has never recorded anything yet".
    'tokens_tracked_since', (
      select min(usage.created_at)
      from public.ai_usage as usage
      where usage.workspace_id = target_workspace_id
    )
  )
  into result
  from period_counts, token_totals;

  return result;
end;
$$;

revoke all on function public.get_dashboard_metrics(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_dashboard_metrics(uuid, timestamptz, timestamptz)
  to authenticated, service_role;
