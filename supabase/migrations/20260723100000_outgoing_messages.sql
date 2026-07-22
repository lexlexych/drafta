-- Stage 3 (docs/architecture/16-rollout-plan.md) — outgoing messages.
--
-- An outgoing message has no provider ID until the provider accepts the send
-- (docs/architecture/07-data-flows.md#63-отправка-ответа): external_id becomes
-- nullable, the delivery-status webhook matching key moves to a partial unique
-- index, and inbound rows keep the NOT NULL discipline via a direction check.
alter table public.messages
  alter column external_id drop not null;

alter table public.messages
  drop constraint messages_external_id_check;

alter table public.messages
  add constraint messages_external_id_check
  check (external_id is null or length(external_id) > 0);

alter table public.messages
  add constraint messages_external_id_incoming_check
  check (direction = 'outgoing' or external_id is not null);

alter table public.messages
  drop constraint messages_conversation_id_external_id_key;

create unique index messages_conversation_external_id_key
  on public.messages (conversation_id, external_id)
  where external_id is not null;

-- Accepting a reply — from the draft panel or the manual composer — is one
-- Postgres transaction, mirroring finalize_draft_generation: lock the parent
-- conversation, transition the accepted draft to 'sent' (when one is given),
-- supersede every other ready/edited draft (the reply closes the incoming
-- batch those drafts were answering), and insert the outgoing message in
-- 'pending' until the send-message Inngest function reports the provider ID.
--
-- TODO(stage 3+): a draft still 'generating' at accept time is finalized to
-- 'ready' later and will target an already-answered batch — pre-existing race,
-- out of scope here (same window exists between generation and manual sends).
create function public.accept_reply_for_send(
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
begin
  if reply_text is null or length(trim(reply_text)) = 0 then
    return null;
  end if;

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
      and draft.status in ('ready', 'edited');

    if not found then
      return null;
    end if;
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
    trim(reply_text),
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
