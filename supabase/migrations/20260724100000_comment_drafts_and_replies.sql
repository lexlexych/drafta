-- Stage 5 (docs/architecture/16-rollout-plan.md#этап-5--комментарии) — per-comment
-- drafts and publishing a reply to a specific comment.
--
-- Unlike a DM (one draft per conversation, answering the debounced batch), every
-- incoming comment gets its own draft answering exactly that comment
-- (docs/architecture/07-data-flows.md#правила-поверх-дебаунса — no debounce; each
-- comment is self-contained). A draft targets a comment through its
-- `last_message_id`, so the "one ready draft" invariant moves from
-- per-conversation to per-target-message: a post can hold many ready drafts, one
-- per comment.

drop index if exists public.drafts_one_ready_per_conversation_idx;

-- One ready draft per answered message. For a DM this still means one per
-- conversation in practice (each new batch supersedes the previous ready draft);
-- for a comment thread it allows one ready draft per comment.
create unique index drafts_one_ready_per_target_idx
  on public.drafts (conversation_id, last_message_id)
  where status = 'ready';

-- Finalizing a generated draft. `comment_scoped` (true for comment threads)
-- narrows the supersede step to drafts answering the *same* comment, so
-- finalizing one comment's draft never touches sibling comments' drafts. For a
-- DM (`comment_scoped = false`) the whole-conversation supersede is unchanged.
--
-- Drop the stage-2 five-argument version first: adding a parameter with a
-- default via `create or replace` would otherwise leave two overloads and make
-- a five-argument call ambiguous.
drop function if exists public.finalize_draft_generation(uuid, uuid, text, text, boolean);

create or replace function public.finalize_draft_generation(
  target_workspace_id uuid,
  target_draft_id uuid,
  generated_text text,
  generated_model text,
  supersede_edited boolean default false,
  comment_scoped boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_conversation_id uuid;
  target_last_message_id uuid;
begin
  select draft.conversation_id, draft.last_message_id
  into target_conversation_id, target_last_message_id
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
    and (not comment_scoped or draft.last_message_id = target_last_message_id)
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

revoke all on function public.finalize_draft_generation(uuid, uuid, text, text, boolean, boolean)
  from public;
grant execute on function public.finalize_draft_generation(uuid, uuid, text, text, boolean, boolean)
  to service_role;

-- Accepting a reply. A comment reply must be posted against the exact comment it
-- answers (docs/architecture/07-data-flows.md#63-отправка-ответа), so the outgoing
-- message gets its `parent_external_id` set inside the same transaction:
--   * draft send — the provider id of the comment the draft targets
--     (`drafts.last_message_id` → that message's `external_id`);
--   * manual send — the latest incoming comment in the thread.
-- For a comment thread the supersede step is scoped to the same target comment, so
-- accepting one comment's reply leaves sibling comments' drafts untouched. DM keeps
-- whole-conversation supersede and a null parent. Same signature as stage 3.
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
  conversation_kind text;
  reply_parent_external_id text;
  draft_last_message_id uuid;
begin
  select conversation.kind into conversation_kind
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
    returning nullif(trim(draft.text), ''), draft.last_message_id
      into outgoing_text, draft_last_message_id;

    if not found then
      return null;
    end if;
  end if;

  if outgoing_text is null then
    return null;
  end if;

  -- A comment reply targets a specific comment; a DM reply has no parent.
  if conversation_kind = 'comments' then
    if target_draft_id is not null then
      select message.external_id into reply_parent_external_id
      from public.messages as message
      where message.workspace_id = target_workspace_id
        and message.conversation_id = target_conversation_id
        and message.id = draft_last_message_id;
    else
      select message.external_id into reply_parent_external_id
      from public.messages as message
      where message.workspace_id = target_workspace_id
        and message.conversation_id = target_conversation_id
        and message.direction = 'incoming'
      order by message.created_at desc, message.id desc
      limit 1;
    end if;
  end if;

  update public.drafts as draft
  set status = 'superseded',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.conversation_id = target_conversation_id
    and (target_draft_id is null or draft.id <> target_draft_id)
    and draft.status in ('ready', 'edited')
    -- For comments, only supersede other drafts answering the same comment; for
    -- a manual comment send (no target draft) there is no comment to scope to, so
    -- leave every comment's draft in place. DM supersedes the whole conversation.
    and (
      conversation_kind <> 'comments'
      or (target_draft_id is not null and draft.last_message_id = draft_last_message_id)
    );

  insert into public.messages (
    workspace_id,
    conversation_id,
    external_id,
    parent_external_id,
    direction,
    text,
    delivery_status
  )
  values (
    target_workspace_id,
    target_conversation_id,
    null,
    reply_parent_external_id,
    'outgoing',
    outgoing_text,
    'pending'
  )
  returning id into outgoing_message_id;

  return outgoing_message_id;
end;
$$;

revoke all on function public.accept_reply_for_send(uuid, uuid, text, uuid)
  from public;
grant execute on function public.accept_reply_for_send(uuid, uuid, text, uuid)
  to authenticated, service_role;
