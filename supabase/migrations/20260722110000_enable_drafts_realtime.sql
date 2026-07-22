-- Stage 2 publishes workspace-scoped draft state to authenticated inbox users.
-- RLS policy drafts_member_access remains the delivery boundary; browser
-- subscriptions additionally filter workspace_id as defense in depth.
alter publication supabase_realtime add table public.drafts;

-- The panel consumes payload.new for INSERT/UPDATE. Postgres logical
-- replication already includes the complete new tuple for those operations,
-- so REPLICA IDENTITY FULL (which only expands old/delete tuples) is not needed.

