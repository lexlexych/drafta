-- T-03 (E-002): schema adjustments required by the webhook inbound pipeline
-- (docs/architecture/07-data-flows.md#61-входящее-dm-или-комментарий).

-- The idempotency write to webhook_events (provider + external_event_id) has
-- to happen before the channel_connection lookup can resolve a workspace —
-- see docs/epics/epic_02/T-03-webhook-inbound.md step 2: an event for an
-- unknown/unrecognized external account id still gets a webhook_events row
-- (marked with processing_error) for audit/replay, even though no workspace
-- can be attributed to it. workspace_id stays required (and indexed) for
-- every row the pipeline *can* attribute to a workspace; it is only left
-- null for this one unresolved case.
alter table public.webhook_events
  alter column workspace_id drop not null;

-- message.read (a real, documented Zernio DM delivery-status event — see
-- lib/channels/zernio/parse.ts DM_EVENT_TYPES) had no matching
-- messages.delivery_status value. Extend the allowed set rather than drop
-- read-receipt handling from the webhook pipeline.
alter table public.messages
  drop constraint messages_delivery_status_check;

alter table public.messages
  add constraint messages_delivery_status_check
  check (delivery_status in ('received', 'pending', 'sent', 'delivered', 'read', 'failed'));
