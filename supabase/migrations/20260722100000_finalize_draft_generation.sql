-- A conversation must never expose two competing ready drafts. Clean up any
-- legacy duplicates deterministically before installing the invariant.
with ranked_ready_drafts as (
  select
    id,
    row_number() over (
      partition by conversation_id
      order by updated_at desc, created_at desc, id desc
    ) as ready_rank
  from public.drafts
  where status = 'ready'
)
update public.drafts as draft
set status = 'superseded',
    updated_at = now()
from ranked_ready_drafts as ranked
where draft.id = ranked.id
  and ranked.ready_rank > 1;

create unique index drafts_one_ready_per_conversation_idx
  on public.drafts (conversation_id)
  where status = 'ready';

-- Superseding the old draft and publishing the new one is one Postgres
-- transaction. Locking the parent conversation serializes normal generation
-- and explicit regeneration without relying only on application timing.
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
