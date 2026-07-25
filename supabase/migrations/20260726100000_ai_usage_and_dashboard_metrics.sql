-- Dashboard analytics:
--   1. public.ai_usage — per-call LLM token accounting. Until now the provider
--      response's `usage` object was read and dropped on the floor in
--      lib/ai/client.ts, so there is no historical data to backfill: the table
--      starts empty and fills from the first generation after deploy.
--   2. public.get_dashboard_metrics() — one round trip behind the dashboard
--      screen: message/comment/draft counts, the median reply time, the
--      per-category message breakdown and the token totals for a period.
--
-- Why an RPC rather than a handful of PostgREST selects: the category
-- breakdown is a `group by` (PostgREST has none), the median needs a window
-- function, and — most importantly — PostgREST caps the rows a select
-- returns, so aggregating raw rows in JS would silently under-count on an
-- active workspace.
--
-- Docs: docs/architecture/06-data-model.md, docs/architecture/08-ai-subsystem.md,
--       docs/architecture/10-ui.md

-- ---------------------------------------------------------------------------
-- 1. Token accounting
-- ---------------------------------------------------------------------------

-- Deliberately free of personal data: counters, a model name and a provider
-- name only. Nothing here is a subject-access or erasure concern beyond the
-- workspace cascade (§15), and the row survives the message it was generated
-- for on purpose — deleting a conversation must not rewrite past cost.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Which LLM call this was. Both operations bill separately and the dashboard
  -- shows them apart: classification is a handful of tokens on a cheap model,
  -- generation is the expensive one.
  operation text not null check (operation in ('classification', 'draft')),
  -- Which surface it served. Comments are never classified today, so
  -- ('classification', 'comment') simply never occurs — the column keeps the
  -- shape honest rather than encoding today's pipeline into the schema.
  surface text not null check (surface in ('message', 'comment')),
  provider text not null check (length(btrim(provider)) > 0),
  model text not null check (length(btrim(model)) > 0),
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

comment on table public.ai_usage is
  'Per-call LLM token accounting. Written by the Inngest pipelines under the service role; read-only for workspace members.';

-- The dashboard always filters by workspace and a period, and never reads a
-- single row by id.
create index ai_usage_workspace_created_at_idx
  on public.ai_usage (workspace_id, created_at desc);

alter table public.ai_usage enable row level security;

revoke all on table public.ai_usage from anon;

-- Asymmetric on purpose, unlike the uniform `<table>_member_access for all`
-- policies elsewhere: rows are only ever written by the draft pipelines under
-- the service role (which bypasses RLS), so `authenticated` needs no write
-- path at all. A narrower grant means a compromised session cannot forge or
-- erase cost records.
grant select on table public.ai_usage to authenticated;
grant select, insert on table public.ai_usage to service_role;

create policy ai_usage_member_read
on public.ai_usage
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- 2. Dashboard metrics
-- ---------------------------------------------------------------------------

-- `period_start` is inclusive, `period_end` exclusive. The caller passes a
-- rolling window (24h / 7d / 30d) rather than calendar boundaries, which is
-- why this function takes plain timestamps and knows nothing about time zones.
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
  -- Messages of a deleted category fall back to `category_id is null` via the
  -- `on delete set null` FK and land in the "no category" row.
  category_totals as (
    select
      message.category_id,
      count(*) as total
    from public.messages as message
    where message.workspace_id = target_workspace_id
      and message.direction = 'incoming'
      and message.created_at >= period_start
      and message.created_at < period_end
    group by message.category_id
  ),
  token_totals as (
    select
      coalesce(sum(prompt_tokens) filter (
        where operation = 'classification' and surface = 'message'), 0) as message_classification_prompt,
      coalesce(sum(completion_tokens) filter (
        where operation = 'classification' and surface = 'message'), 0) as message_classification_completion,
      coalesce(sum(total_tokens) filter (
        where operation = 'classification' and surface = 'message'), 0) as message_classification_total,
      coalesce(sum(prompt_tokens) filter (
        where operation = 'draft' and surface = 'message'), 0) as message_draft_prompt,
      coalesce(sum(completion_tokens) filter (
        where operation = 'draft' and surface = 'message'), 0) as message_draft_completion,
      coalesce(sum(total_tokens) filter (
        where operation = 'draft' and surface = 'message'), 0) as message_draft_total,
      coalesce(sum(prompt_tokens) filter (
        where operation = 'classification' and surface = 'comment'), 0) as comment_classification_prompt,
      coalesce(sum(completion_tokens) filter (
        where operation = 'classification' and surface = 'comment'), 0) as comment_classification_completion,
      coalesce(sum(total_tokens) filter (
        where operation = 'classification' and surface = 'comment'), 0) as comment_classification_total,
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
      'message_classification', jsonb_build_object(
        'prompt', token_totals.message_classification_prompt,
        'completion', token_totals.message_classification_completion,
        'total', token_totals.message_classification_total
      ),
      'message_draft', jsonb_build_object(
        'prompt', token_totals.message_draft_prompt,
        'completion', token_totals.message_draft_completion,
        'total', token_totals.message_draft_total
      ),
      'comment_classification', jsonb_build_object(
        'prompt', token_totals.comment_classification_prompt,
        'completion', token_totals.comment_classification_completion,
        'total', token_totals.comment_classification_total
      ),
      'comment_draft', jsonb_build_object(
        'prompt', token_totals.comment_draft_prompt,
        'completion', token_totals.comment_draft_completion,
        'total', token_totals.comment_draft_total
      ),
      'total', jsonb_build_object(
        'prompt', token_totals.all_prompt,
        'completion', token_totals.all_completion,
        'total', token_totals.all_total
      )
    ),
    -- Lets the screen tell "nothing was spent in this period" apart from
    -- "accounting has never recorded anything yet", which is the expected
    -- state right after this migration ships.
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
