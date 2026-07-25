-- Comments become their own domain, fully separated from direct messages.
--
-- Until now a comment thread was a `conversations` row with `kind = 'comments'`
-- and its comments were `messages` rows, so every DM code path had to branch on
-- `kind` and every comment code path had to pretend a post was a conversation.
-- This migration gives comments their own three tables and removes the comment
-- half from the message tables:
--
--   * `posts`          — a published post of a connected account. Created when
--                        the post is published (so it shows up in «Комментарии»
--                        with zero comments) or lazily on the first comment of
--                        an older post. Also stores the per-post draft brief the
--                        user fills in the «Черновики» dialog.
--   * `comments`       — incoming comments and our own published replies.
--   * `comment_drafts` — one AI draft per comment. Unlike DM drafts these are
--                        never generated on arrival: the user asks for them.
--
-- Consequences for the message side:
--   * `conversations.kind` / `conversations.post_metadata` disappear —
--     `conversations` is DM-only now;
--   * `categories.incoming_kind` disappears — categories classify messages only
--     (comments have no categories at all);
--   * `ai_settings.auto_generate_comments` disappears — comment drafts are
--     always explicitly requested.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_connection_id uuid not null,
  -- Provider-side post id (Zernio's `platformPostId`) — the idempotency key a
  -- `post.published` webhook and a later `comment.received` webhook agree on.
  external_id text not null check (length(external_id) > 0),
  -- Caption/body of the post, when the provider reports it. Empty is normal:
  -- the comment webhook carries ids only.
  text text not null default '',
  permalink text,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  -- The «Черновики» brief (docs/architecture/10-ui.md#экраны-инбокса): what the
  -- post shows and how replies should sound. `draft_brief_set_at` is what the UI
  -- means by "drafts are already configured for this post" — until it is set,
  -- «Создать черновик» opens the dialog instead of generating straight away.
  draft_description text not null default '',
  draft_instruction text not null default '',
  draft_brief_set_at timestamptz,
  last_comment_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, channel_connection_id)
    references public.channel_connections(workspace_id, id) on delete cascade,
  unique (channel_connection_id, external_id)
);

create index posts_workspace_id_idx on public.posts (workspace_id);
create index posts_channel_connection_id_idx on public.posts (channel_connection_id);
-- The «Комментарии» list orders by recent activity and falls back to the
-- publication time for posts that have no comments yet.
create index posts_list_idx
  on public.posts (workspace_id, last_comment_at desc nulls last, published_at desc nulls last);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  post_id uuid not null,
  -- Author of an incoming comment; null for our own replies.
  contact_identity_id uuid,
  -- Provider-side comment id. Null for an outgoing reply until the provider
  -- accepts it, same discipline as `messages.external_id`.
  external_id text check (external_id is null or length(external_id) > 0),
  -- The comment this one answers: set for a reply-to-a-reply and for every
  -- outgoing reply we publish (a comment reply is always posted against a
  -- specific comment).
  parent_external_id text,
  direction text not null check (direction in ('incoming', 'outgoing')),
  text text not null default '',
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  delivery_status text not null default 'received'
    check (delivery_status in ('received', 'pending', 'sent', 'delivered', 'failed')),
  provider_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_metadata) = 'object'),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (direction = 'outgoing' or external_id is not null),
  unique (workspace_id, id),
  unique (workspace_id, post_id, id),
  foreign key (workspace_id, post_id)
    references public.posts(workspace_id, id) on delete cascade,
  foreign key (workspace_id, contact_identity_id)
    references public.contact_identities(workspace_id, id) on delete set null (contact_identity_id)
);

create index comments_workspace_id_idx on public.comments (workspace_id);
create index comments_post_id_idx on public.comments (post_id);
create index comments_contact_identity_id_idx on public.comments (contact_identity_id);
create index comments_post_created_at_idx on public.comments (post_id, created_at);
create unique index comments_post_external_id_key
  on public.comments (post_id, external_id)
  where external_id is not null;

create table public.comment_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  post_id uuid not null,
  -- The comment this draft answers. One draft per comment, written under it.
  comment_id uuid not null,
  text text not null default '',
  status text not null default 'generating'
    check (status in ('generating', 'ready', 'edited', 'sent', 'discarded', 'superseded')),
  model text,
  kb_file_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, post_id)
    references public.posts(workspace_id, id) on delete cascade,
  foreign key (workspace_id, post_id, comment_id)
    references public.comments(workspace_id, post_id, id) on delete cascade
);

create index comment_drafts_workspace_id_idx on public.comment_drafts (workspace_id);
create index comment_drafts_post_id_idx on public.comment_drafts (post_id);
create index comment_drafts_comment_id_idx on public.comment_drafts (comment_id);

-- The "one live draft per comment" unique index is created in §3, after the
-- migrated rows have been de-duplicated — the old per-target index only made
-- `ready` unique, so a comment could legitimately carry both a `ready` and an
-- `edited` draft until now.

-- ---------------------------------------------------------------------------
-- 2. RLS and Data API grants (mirrors 20260720120000_add_workspace_rls_policies)
-- ---------------------------------------------------------------------------

alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.comment_drafts enable row level security;

revoke all on table public.posts, public.comments, public.comment_drafts from anon;

grant select, insert, update, delete on table
  public.posts,
  public.comments,
  public.comment_drafts
to authenticated;

grant select, insert, update, delete on table
  public.posts,
  public.comments,
  public.comment_drafts
to service_role;

create policy posts_member_access
on public.posts
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy comments_member_access
on public.comments
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy comment_drafts_member_access
on public.comment_drafts
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- 3. Data migration: comment conversations → posts / comments / comment_drafts
--
-- Primary keys are carried over, so open links, push deep-links and any stored
-- reference keep resolving to the same post/comment after the split.
-- ---------------------------------------------------------------------------

insert into public.posts (
  id,
  workspace_id,
  channel_connection_id,
  external_id,
  text,
  permalink,
  metadata,
  last_comment_at,
  unread_count,
  created_at,
  updated_at
)
select
  conversation.id,
  conversation.workspace_id,
  conversation.channel_connection_id,
  conversation.external_id,
  coalesce(conversation.post_metadata ->> 'text', ''),
  conversation.post_metadata ->> 'permalink',
  coalesce(conversation.post_metadata, '{}'::jsonb),
  conversation.last_incoming_at,
  conversation.unread_count,
  conversation.created_at,
  conversation.updated_at
from public.conversations as conversation
where conversation.kind = 'comments';

insert into public.comments (
  id,
  workspace_id,
  post_id,
  contact_identity_id,
  external_id,
  parent_external_id,
  direction,
  text,
  attachments,
  delivery_status,
  provider_metadata,
  sent_at,
  created_at,
  updated_at
)
select
  message.id,
  message.workspace_id,
  message.conversation_id,
  message.contact_identity_id,
  message.external_id,
  message.parent_external_id,
  message.direction,
  message.text,
  message.attachments,
  -- `messages` also allows 'read' (a DM read receipt); comments never had one,
  -- but map defensively so the check constraint cannot reject a migrated row.
  case when message.delivery_status = 'read' then 'delivered' else message.delivery_status end,
  message.provider_metadata,
  message.sent_at,
  message.created_at,
  message.updated_at
from public.messages as message
join public.posts as post on post.id = message.conversation_id;

insert into public.comment_drafts (
  id,
  workspace_id,
  post_id,
  comment_id,
  text,
  status,
  model,
  kb_file_ids,
  created_at,
  updated_at
)
select
  draft.id,
  draft.workspace_id,
  draft.conversation_id,
  draft.last_message_id,
  draft.text,
  draft.status,
  draft.model,
  draft.kb_file_ids,
  draft.created_at,
  draft.updated_at
from public.drafts as draft
join public.posts as post on post.id = draft.conversation_id;

-- One live draft per comment from here on. Until now only `ready` was unique
-- per answered comment, so a comment could carry a `ready` and an `edited` draft
-- at the same time; keep the newest of each such pair and supersede the rest.
update public.comment_drafts as draft
set status = 'superseded',
    updated_at = now()
where draft.status in ('generating', 'ready', 'edited')
  and exists (
    select 1
    from public.comment_drafts as newer
    where newer.comment_id = draft.comment_id
      and newer.status in ('generating', 'ready', 'edited')
      and (newer.created_at, newer.id) > (draft.created_at, draft.id)
  );

create unique index comment_drafts_one_active_per_comment_idx
  on public.comment_drafts (comment_id)
  where status in ('generating', 'ready', 'edited');

-- Removing the conversation cascades its messages and drafts.
delete from public.conversations where kind = 'comments';

-- ---------------------------------------------------------------------------
-- 4. `conversations` becomes DM-only
-- ---------------------------------------------------------------------------

drop index public.conversations_inbox_idx;

alter table public.conversations
  drop column post_metadata,
  drop column kind;

create index conversations_inbox_idx
  on public.conversations (workspace_id, status, last_incoming_at desc);

-- ---------------------------------------------------------------------------
-- 5. Categories classify messages only
-- ---------------------------------------------------------------------------

alter table public.categories
  drop constraint categories_default_scope_check;

alter table public.categories
  drop column incoming_kind;

alter table public.categories
  add constraint categories_default_scope_check
  check (not is_default or cardinality(channel_connection_ids) = 0);

-- The CRUD RPCs lose their `category_incoming_kind` argument. Dropping the old
-- signatures first keeps a six/eight-argument call from becoming ambiguous.
drop function public.create_category(uuid, text, text, text, uuid[], text, boolean);
drop function public.update_category(uuid, uuid, text, text, text, uuid[], text, boolean);

create function public.create_category(
  target_workspace_id uuid,
  category_name text,
  category_description text,
  category_draft_instruction text default null,
  category_channel_connection_ids uuid[] default '{}'::uuid[],
  category_skip_draft boolean default false
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
    priority,
    is_default
  ) values (
    target_workspace_id,
    normalized_name,
    normalized_description,
    normalized_instruction,
    normalized_channel_ids,
    category_skip_draft,
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
  category_skip_draft boolean default false
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
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using errcode = '42501', message = 'Workspace access denied';
  end if;

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

  if existing_category.is_default then
    update public.categories
    set draft_instruction = normalized_instruction,
        skip_draft = category_skip_draft,
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
      updated_at = now()
  where workspace_id = target_workspace_id
    and id = target_category_id;

  return true;
end;
$$;

revoke all on function public.create_category(uuid, text, text, text, uuid[], boolean) from public;
revoke all on function public.update_category(uuid, uuid, text, text, text, uuid[], boolean) from public;

grant execute on function public.create_category(uuid, text, text, text, uuid[], boolean) to authenticated, service_role;
grant execute on function public.update_category(uuid, uuid, text, text, text, uuid[], boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. AI settings: comment drafts are never automatic
-- ---------------------------------------------------------------------------

alter table public.ai_settings
  drop column auto_generate_comments;

-- ---------------------------------------------------------------------------
-- 7. DM draft RPCs lose their comment branches
-- ---------------------------------------------------------------------------

-- One ready draft per DM conversation again: with comments gone there is no
-- per-target variant left to support. The per-target index allowed a
-- conversation to hold several ready drafts (one per answered message), so
-- supersede all but the newest before tightening the rule.
drop index public.drafts_one_ready_per_target_idx;

update public.drafts as draft
set status = 'superseded',
    updated_at = now()
where draft.status = 'ready'
  and exists (
    select 1
    from public.drafts as newer
    where newer.conversation_id = draft.conversation_id
      and newer.status = 'ready'
      and (newer.created_at, newer.id) > (draft.created_at, draft.id)
  );

create unique index drafts_one_ready_per_conversation_idx
  on public.drafts (conversation_id)
  where status = 'ready';

drop function public.finalize_draft_generation(uuid, uuid, text, text, boolean, boolean);

create function public.finalize_draft_generation(
  target_workspace_id uuid,
  target_draft_id uuid,
  generated_text text,
  generated_model text,
  supersede_edited boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_conversation_id uuid;
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
      status = 'ready',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.id = target_draft_id
    and draft.conversation_id = target_conversation_id
    and draft.status = 'generating';

  return found;
end;
$$;

revoke all on function public.finalize_draft_generation(uuid, uuid, text, text, boolean)
  from public;
grant execute on function public.finalize_draft_generation(uuid, uuid, text, text, boolean)
  to service_role;

-- `accept_reply_for_send` goes back to its DM-only stage-3 body: a DM reply has
-- no parent comment, and the whole-conversation supersede has no comment
-- scoping left to do.
create or replace function public.accept_reply_for_send(
  target_workspace_id uuid,
  target_conversation_id uuid,
  reply_text text,
  target_draft_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  outgoing_message_id uuid;
  outgoing_text text := nullif(trim(coalesce(reply_text, '')), '');
begin
  perform 1
  from public.conversations as conversation
  where conversation.workspace_id = target_workspace_id
    and conversation.id = target_conversation_id
  for update;

  if not found then
    return null;
  end if;

  if target_draft_id is not null then
    update public.drafts as draft
    set status = 'sent',
        updated_at = now()
    where draft.workspace_id = target_workspace_id
      and draft.conversation_id = target_conversation_id
      and draft.id = target_draft_id
      and draft.status in ('ready', 'edited')
    returning nullif(trim(draft.text), '') into outgoing_text;

    if not found then
      return null;
    end if;
  end if;

  if outgoing_text is null then
    return null;
  end if;

  update public.drafts as draft
  set status = 'superseded',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.conversation_id = target_conversation_id
    and (target_draft_id is null or draft.id <> target_draft_id)
    and draft.status in ('ready', 'edited');

  insert into public.messages (
    workspace_id,
    conversation_id,
    external_id,
    direction,
    text,
    delivery_status
  )
  values (
    target_workspace_id,
    target_conversation_id,
    null,
    'outgoing',
    outgoing_text,
    'pending'
  )
  returning id into outgoing_message_id;

  return outgoing_message_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Comment-side RPCs
-- ---------------------------------------------------------------------------

-- Atomic counter bump for a newly arrived comment — the same lost-update
-- reasoning as `bump_conversation_unread_count`. Called by the webhook pipeline
-- through the service-role client.
create function public.bump_post_unread_count(target_post_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.posts
  set unread_count = unread_count + 1,
      last_comment_at = now(),
      updated_at = now()
  where id = target_post_id;
$$;

revoke all on function public.bump_post_unread_count(uuid) from public;
grant execute on function public.bump_post_unread_count(uuid) to service_role;

-- Starts one generation run for one comment: any draft still live for that
-- comment is superseded and the new `generating` row is inserted in the same
-- transaction, which is what keeps `comment_drafts_one_active_per_comment_idx`
-- satisfiable while the user regenerates.
create function public.start_comment_draft_generation(
  target_workspace_id uuid,
  target_comment_id uuid,
  draft_kb_file_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_post_id uuid;
  new_draft_id uuid;
begin
  select answered.post_id
  into target_post_id
  from public.comments as answered
  where answered.workspace_id = target_workspace_id
    and answered.id = target_comment_id
    and answered.direction = 'incoming';

  if not found then
    return null;
  end if;

  perform 1
  from public.posts as post
  where post.workspace_id = target_workspace_id
    and post.id = target_post_id
  for update;

  if not found then
    return null;
  end if;

  update public.comment_drafts as draft
  set status = 'superseded',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.comment_id = target_comment_id
    and draft.status in ('generating', 'ready', 'edited');

  insert into public.comment_drafts (
    workspace_id,
    post_id,
    comment_id,
    status,
    kb_file_ids
  ) values (
    target_workspace_id,
    target_post_id,
    target_comment_id,
    'generating',
    coalesce(draft_kb_file_ids, '{}'::uuid[])
  )
  returning id into new_draft_id;

  return new_draft_id;
end;
$$;

revoke all on function public.start_comment_draft_generation(uuid, uuid, uuid[]) from public;
grant execute on function public.start_comment_draft_generation(uuid, uuid, uuid[]) to service_role;

create function public.finalize_comment_draft_generation(
  target_workspace_id uuid,
  target_draft_id uuid,
  generated_text text,
  generated_model text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_post_id uuid;
begin
  select draft.post_id
  into target_post_id
  from public.comment_drafts as draft
  where draft.workspace_id = target_workspace_id
    and draft.id = target_draft_id
    and draft.status = 'generating';

  if not found then
    return false;
  end if;

  perform 1
  from public.posts as post
  where post.workspace_id = target_workspace_id
    and post.id = target_post_id
  for update;

  if not found then
    return false;
  end if;

  update public.comment_drafts as draft
  set text = generated_text,
      model = generated_model,
      status = 'ready',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.id = target_draft_id
    and draft.status = 'generating';

  return found;
end;
$$;

revoke all on function public.finalize_comment_draft_generation(uuid, uuid, text, text) from public;
grant execute on function public.finalize_comment_draft_generation(uuid, uuid, text, text) to service_role;

-- Accepting a comment draft. A comment reply is always published against the
-- comment it answers, so the outgoing row's `parent_external_id` is the answered
-- comment's provider id, set inside the same transaction that marks the draft
-- sent. Only the accepted draft changes state — sibling comments' drafts are
-- untouched, which is what «Отправить все» relies on when it walks the list.
create function public.accept_comment_draft_for_send(
  target_workspace_id uuid,
  target_comment_id uuid,
  target_draft_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_post_id uuid;
  answered_external_id text;
  outgoing_text text;
  outgoing_comment_id uuid;
begin
  select answered.post_id, answered.external_id
  into target_post_id, answered_external_id
  from public.comments as answered
  where answered.workspace_id = target_workspace_id
    and answered.id = target_comment_id
    and answered.direction = 'incoming';

  if not found then
    return null;
  end if;

  perform 1
  from public.posts as post
  where post.workspace_id = target_workspace_id
    and post.id = target_post_id
  for update;

  if not found then
    return null;
  end if;

  -- The blank-text guard is part of the WHERE, not a check on the returned
  -- value: a draft that cannot produce a reply must not be left marked `sent`.
  update public.comment_drafts as draft
  set status = 'sent',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.id = target_draft_id
    and draft.comment_id = target_comment_id
    and draft.status in ('ready', 'edited')
    and nullif(pg_catalog.btrim(draft.text), '') is not null
  returning pg_catalog.btrim(draft.text) into outgoing_text;

  if not found then
    return null;
  end if;

  insert into public.comments (
    workspace_id,
    post_id,
    external_id,
    parent_external_id,
    direction,
    text,
    delivery_status
  )
  values (
    target_workspace_id,
    target_post_id,
    null,
    answered_external_id,
    'outgoing',
    outgoing_text,
    'pending'
  )
  returning id into outgoing_comment_id;

  return outgoing_comment_id;
end;
$$;

revoke all on function public.accept_comment_draft_for_send(uuid, uuid, uuid) from public;
grant execute on function public.accept_comment_draft_for_send(uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Realtime
-- ---------------------------------------------------------------------------

-- The «Комментарии» screen is server-rendered and refreshed on change, exactly
-- like the inbox (lib/realtime/inbox-sync.ts) — the three comment tables join
-- the same publication. RLS keeps delivery scoped to workspace members.
alter publication supabase_realtime
  add table public.posts, public.comments, public.comment_drafts;
