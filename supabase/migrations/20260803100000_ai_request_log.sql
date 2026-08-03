-- public.ai_request_log — the verbatim provider exchange behind every LLM call.
--
-- public.ai_usage (20260726100000) already records what a call cost, but not
-- what was said. When a draft comes back wrong the only way to tell a bad
-- prompt from a bad model is to read the exact bodies that crossed the wire,
-- and the existing debug aid — `AI_LOG_PROMPTS=true` in lib/ai/prompt.ts —
-- prints the *assembled* prompt to the server console, not the request the SDK
-- serialized, and keeps nothing.
--
-- `request` and `response` are captured by a fetch interceptor in
-- lib/ai/exchange.ts, so they are the literal JSON bodies, including provider
-- error bodies on a failed call. Headers are deliberately never captured: they
-- carry the provider API key (same reasoning as `providerError` in
-- lib/ai/client.ts).
--
-- Privacy: unlike ai_usage, this table is NOT free of personal data. What it
-- holds is exactly what the provider was already given — masked text, with
-- phone numbers, e-mails, IBANs and card numbers replaced by placeholders
-- (lib/ai/masking.ts) — but conversation content remains. Hence the narrow
-- grants below (service role only, no `authenticated` path at all) and the
-- 30-day retention enforced by the `cleanup-ai-request-log` cron
-- (lib/inngest/functions/cleanup-ai-request-log.ts). This mirrors how
-- webhook_events is treated.
--
-- Docs: docs/architecture/06-data-model.md, docs/architecture/08-ai-subsystem.md,
--       docs/architecture/15-compliance-gdpr.md

create table public.ai_request_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Same vocabulary as ai_usage, so a log row and its cost row describe the
  -- call in the same terms.
  operation text not null check (operation in ('classification', 'draft')),
  surface text not null check (surface in ('message', 'comment')),
  provider text not null check (length(btrim(provider)) > 0),
  model text not null check (length(btrim(model)) > 0),
  -- No foreign key on purpose, like ai_usage: the log outlives the draft it was
  -- generated for, and deleting a conversation must not erase the record of
  -- what the provider was asked.
  draft_id uuid,
  request jsonb not null,
  -- Null when no body came back at all (timeout, connection failure).
  response jsonb,
  status_code integer,
  -- AiProviderError.code on a failed call; null on success.
  error_code text,
  duration_ms integer check (duration_ms >= 0),
  -- Nullable rather than `default 0`: a failed call and a provider that sent no
  -- `usage` object are missing readings, not calls that cost nothing. Same
  -- distinction the AiUsage docstring draws in lib/ai/client.ts.
  prompt_tokens integer check (prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens >= 0),
  total_tokens integer check (total_tokens >= 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

comment on table public.ai_request_log is
  'Verbatim LLM request/response bodies per call. Written by the Inngest pipelines under the service role; not readable through the Data API. Retention: 30 days via the cleanup-ai-request-log cron.';

comment on column public.ai_request_log.request is
  'The JSON body sent to the provider, 1:1 and without headers. Text is already masked (lib/ai/masking.ts) — this is what the provider actually received.';

comment on column public.ai_request_log.response is
  'The JSON body returned by the provider, 1:1, including error bodies. `{ "raw": "..." }` when the body was not JSON.';

-- Reading the log means "what happened in this workspace lately", never a
-- lookup by id.
create index ai_request_log_workspace_created_at_idx
  on public.ai_request_log (workspace_id, created_at desc);

-- The retention cron deletes across all workspaces by age alone.
create index ai_request_log_created_at_idx
  on public.ai_request_log (created_at);

alter table public.ai_request_log enable row level security;

-- Narrower than ai_usage, which grants members a read: these rows contain the
-- workspace system prompt and conversation content, and nothing in the product
-- reads them — they are an operator's debugging tool, reached through SQL. No
-- policies are defined because no role other than service_role (which bypasses
-- RLS) has a grant at all. Same shape as webhook_events.
revoke all on table public.ai_request_log from anon;
revoke all on table public.ai_request_log from authenticated;

grant select, insert, delete on table public.ai_request_log to service_role;
