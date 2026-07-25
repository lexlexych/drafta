-- Draft creation workflow with categories:
--   1. per-category knowledge base file selection (categories.kb_file_ids)
--   2. the classified category of a conversation (conversations.category_id),
--      denormalized so the dialog list can filter on it without a subquery
--      over the last incoming message
--   3. the debounce deadline (conversations.draft_debounce_until), the only way
--      the UI can render a countdown and a "run now" button — until now the
--      debounce lived exclusively inside the Inngest run
--   4. the "needs manual review" reason (drafts.manual_review_reason), set when
--      the model refuses to invent facts the knowledge base does not contain
--
-- Docs: docs/architecture/07-data-flows.md#пайплайн-генерации,
--       docs/architecture/09-categories.md, docs/architecture/08-ai-subsystem.md

-- ---------------------------------------------------------------------------
-- 1. Per-category knowledge base selection
-- ---------------------------------------------------------------------------

-- NULL  = inherit `kb_files.is_enabled` (the behaviour before this migration).
-- '{}'  = deliberately no files at all.
-- Files are referenced by a plain array rather than a join table because the
-- selection is a snapshot of intent, exactly like `drafts.kb_file_ids` and
-- `comment_drafts.kb_file_ids`: a file deleted afterwards simply drops out on
-- read, and no extra table/RLS/cascade is needed.
alter table public.categories
  add column kb_file_ids uuid[];

comment on column public.categories.kb_file_ids is
  'Knowledge base files for this category. NULL inherits kb_files.is_enabled; an empty array selects none.';

create or replace function private.validate_category_kb_files(
  target_workspace_id uuid,
  target_kb_file_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_kb_file_ids is null then
    return;
  end if;

  if exists (
    select 1
    from unnest(target_kb_file_ids) as requested(id)
    left join public.kb_files as kb_file
      on kb_file.id = requested.id
      and kb_file.workspace_id = target_workspace_id
    where kb_file.id is null
  ) then
    raise exception using
      errcode = '23503',
      message = 'A category knowledge base file must belong to the current workspace';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Conversation category and debounce deadline
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column category_id uuid,
  add column draft_debounce_until timestamptz;

-- Composite FK keeps the tenant in the reference (vibecoding rule 3): a
-- conversation can only point at a category of its own workspace.
alter table public.conversations
  add constraint conversations_category_fk
  foreign key (workspace_id, category_id)
  references public.categories (workspace_id, id)
  on delete set null;

create index conversations_category_idx
  on public.conversations (workspace_id, category_id);

comment on column public.conversations.category_id is
  'Category assigned by the classification step; denormalized from the batch messages for the dialog list filter.';
comment on column public.conversations.draft_debounce_until is
  'When the debounce window of the pending draft run expires. NULL when no run is waiting.';

-- ---------------------------------------------------------------------------
-- 3. Draft manual-review reason
-- ---------------------------------------------------------------------------

alter table public.drafts
  add column manual_review_reason text;

comment on column public.drafts.manual_review_reason is
  'Set when the model could not ground an answer in the knowledge base and asked for manual handling. NULL for an ordinary draft.';

-- ---------------------------------------------------------------------------
-- 4. Category CRUD RPCs learn kb_file_ids
-- ---------------------------------------------------------------------------

-- Dropping the old signatures first keeps a six/seven-argument call from
-- becoming ambiguous (same reasoning as 20260725110000).
drop function public.create_category(uuid, text, text, text, uuid[], boolean);
drop function public.update_category(uuid, uuid, text, text, text, uuid[], boolean);

create function public.create_category(
  target_workspace_id uuid,
  category_name text,
  category_description text,
  category_draft_instruction text default null,
  category_channel_connection_ids uuid[] default '{}'::uuid[],
  category_skip_draft boolean default false,
  category_kb_file_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := pg_catalog.btrim(category_name);
  normalized_description text := pg_catalog.btrim(category_description);
  normalized_instruction text := nullif(pg_catalog.btrim(category_draft_instruction), '');
  normalized_channel_ids uuid[];
  normalized_kb_file_ids uuid[];
  default_priority integer;
  new_category_id uuid;
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using errcode = '42501', message = 'Workspace access denied';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception using errcode = '22023', message = 'Category name is required';
  end if;
  if normalized_description is null or normalized_description = '' then
    raise exception using errcode = '22023', message = 'Category description is required';
  end if;

  select coalesce(array_agg(distinct channel_id), '{}'::uuid[])
  into normalized_channel_ids
  from unnest(coalesce(category_channel_connection_ids, '{}'::uuid[]))
    as requested(channel_id);

  perform private.validate_category_channels(
    target_workspace_id,
    normalized_channel_ids
  );

  -- NULL must survive normalization: it means "inherit kb_files.is_enabled",
  -- which is a different instruction from the empty array.
  if category_kb_file_ids is null then
    normalized_kb_file_ids := null;
  else
    select coalesce(array_agg(distinct kb_file_id), '{}'::uuid[])
    into normalized_kb_file_ids
    from unnest(category_kb_file_ids) as requested(kb_file_id);
  end if;

  perform private.validate_category_kb_files(
    target_workspace_id,
    normalized_kb_file_ids
  );

  perform 1
  from public.categories
  where workspace_id = target_workspace_id
  order by priority
  for update;

  select priority
  into default_priority
  from public.categories
  where workspace_id = target_workspace_id
    and is_default
  for update;

  if default_priority is null then
    raise exception using errcode = '23514', message = 'Default category is missing';
  end if;

  set constraints categories_workspace_priority_key deferred;

  update public.categories
  set priority = priority + 1,
      updated_at = now()
  where workspace_id = target_workspace_id
    and is_default;

  insert into public.categories (
    workspace_id,
    name,
    description,
    draft_instruction,
    channel_connection_ids,
    skip_draft,
    kb_file_ids,
    priority,
    is_default
  ) values (
    target_workspace_id,
    normalized_name,
    normalized_description,
    normalized_instruction,
    normalized_channel_ids,
    category_skip_draft,
    normalized_kb_file_ids,
    default_priority,
    false
  )
  returning id into new_category_id;

  return new_category_id;
end;
$$;

create function public.update_category(
  target_workspace_id uuid,
  target_category_id uuid,
  category_name text,
  category_description text,
  category_draft_instruction text default null,
  category_channel_connection_ids uuid[] default '{}'::uuid[],
  category_skip_draft boolean default false,
  category_kb_file_ids uuid[] default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_category public.categories%rowtype;
  normalized_name text := pg_catalog.btrim(category_name);
  normalized_description text := pg_catalog.btrim(category_description);
  normalized_instruction text := nullif(pg_catalog.btrim(category_draft_instruction), '');
  normalized_channel_ids uuid[];
  normalized_kb_file_ids uuid[];
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using errcode = '42501', message = 'Workspace access denied';
  end if;

  if category_kb_file_ids is null then
    normalized_kb_file_ids := null;
  else
    select coalesce(array_agg(distinct kb_file_id), '{}'::uuid[])
    into normalized_kb_file_ids
    from unnest(category_kb_file_ids) as requested(kb_file_id);
  end if;

  perform private.validate_category_kb_files(
    target_workspace_id,
    normalized_kb_file_ids
  );

  perform 1
  from public.categories
  where workspace_id = target_workspace_id
  order by priority
  for update;

  select *
  into existing_category
  from public.categories
  where workspace_id = target_workspace_id
    and id = target_category_id
  for update;

  if not found then
    return false;
  end if;

  -- The default category keeps its name, description and channels locked;
  -- knowledge base selection joins the fields it may configure.
  if existing_category.is_default then
    update public.categories
    set draft_instruction = normalized_instruction,
        skip_draft = category_skip_draft,
        kb_file_ids = normalized_kb_file_ids,
        updated_at = now()
    where workspace_id = target_workspace_id
      and id = target_category_id;

    return true;
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception using errcode = '22023', message = 'Category name is required';
  end if;
  if normalized_description is null or normalized_description = '' then
    raise exception using errcode = '22023', message = 'Category description is required';
  end if;

  select coalesce(array_agg(distinct channel_id), '{}'::uuid[])
  into normalized_channel_ids
  from unnest(coalesce(category_channel_connection_ids, '{}'::uuid[]))
    as requested(channel_id);

  perform private.validate_category_channels(
    target_workspace_id,
    normalized_channel_ids
  );

  update public.categories
  set name = normalized_name,
      description = normalized_description,
      draft_instruction = normalized_instruction,
      channel_connection_ids = normalized_channel_ids,
      skip_draft = category_skip_draft,
      kb_file_ids = normalized_kb_file_ids,
      updated_at = now()
  where workspace_id = target_workspace_id
    and id = target_category_id;

  return true;
end;
$$;

revoke all on function public.create_category(uuid, text, text, text, uuid[], boolean, uuid[]) from public;
revoke all on function public.update_category(uuid, uuid, text, text, text, uuid[], boolean, uuid[]) from public;

grant execute on function public.create_category(uuid, text, text, text, uuid[], boolean, uuid[]) to authenticated, service_role;
grant execute on function public.update_category(uuid, uuid, text, text, text, uuid[], boolean, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. finalize_draft_generation carries the manual-review reason
-- ---------------------------------------------------------------------------

-- This RPC is the only permitted write path into `drafts` (the partial unique
-- index plus the conversation lock live here), so the reason has to travel
-- through it rather than through a separate update.
drop function public.finalize_draft_generation(uuid, uuid, text, text, boolean);

create function public.finalize_draft_generation(
  target_workspace_id uuid,
  target_draft_id uuid,
  generated_text text,
  generated_model text,
  supersede_edited boolean default false,
  review_reason text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_conversation_id uuid;
  normalized_reason text := nullif(pg_catalog.btrim(review_reason), '');
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
      status = 'ready',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.id = target_draft_id
    and draft.conversation_id = target_conversation_id
    and draft.status = 'generating';

  return found;
end;
$$;

revoke all on function public.finalize_draft_generation(uuid, uuid, text, text, boolean, text)
  from public;
grant execute on function public.finalize_draft_generation(uuid, uuid, text, text, boolean, text)
  to service_role;
