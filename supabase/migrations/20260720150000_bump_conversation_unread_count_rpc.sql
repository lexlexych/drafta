-- T-03 (E-002) rework: atomic increment for conversations.unread_count.
--
-- Review finding (docs/epics/epic_02/T-03-webhook-inbound.md, "🔍 Ревью" §1):
-- the previous implementation did `select unread_count` then
-- `update ... unread_count: value + 1` as two separate PostgREST round
-- trips — not atomic, not in a single transaction/`SELECT ... FOR UPDATE`.
-- Under concurrent webhook delivery for the same conversation (several
-- messages from one contact arriving close together — realistic, and
-- reproduced empirically by the reviewer: 20 concurrent messages left
-- unread_count at 9), this is a classic lost update.
--
-- A single atomic `UPDATE ... SET unread_count = unread_count + 1` — issued
-- as one SQL statement inside this function rather than as a client-side
-- select+update pair — closes the race: Postgres serializes concurrent
-- updates of the same row at the storage layer.
--
-- Called by the webhook pipeline (lib/webhooks/process-event.ts) via the
-- service-role admin client (SUPABASE_SECRET_KEY — bypasses RLS by design,
-- same as every other write in that pipeline), so this function only needs
-- to be reachable by `service_role`, not by `authenticated` end users.
create or replace function public.bump_conversation_unread_count(target_conversation_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.conversations
  set unread_count = unread_count + 1,
      last_incoming_at = now()
  where id = target_conversation_id;
$$;

revoke all on function public.bump_conversation_unread_count(uuid) from public;
grant execute on function public.bump_conversation_unread_count(uuid) to service_role;
