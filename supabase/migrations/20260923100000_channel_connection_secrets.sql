-- Direct Telegram Bot API channel: per-connection secrets
-- (docs/architecture/05-channels.md#telegram-напрямую-bot-api).
--
-- A directly connected provider (unlike Zernio, which holds the platform
-- tokens itself) needs drafta to keep the bot token and the webhook secret.
-- `channel_connections.encrypted_credentials` is not used for that: the table
-- is granted to `authenticated` for every workspace member, so the column
-- would be readable through the Data API. Secrets live in their own table that
-- only `service_role` can reach — the same shape as `webhook_events`.
--
-- Values are encrypted by the application (AES-256-GCM,
-- `CREDENTIALS_ENCRYPTION_KEY`, lib/crypto/credentials.ts) before insert; the
-- database never sees plaintext.

create table public.channel_connection_secrets (
  channel_connection_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  encrypted_credentials text not null check (length(encrypted_credentials) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, channel_connection_id)
    references public.channel_connections(workspace_id, id) on delete cascade
);

create index channel_connection_secrets_workspace_id_idx
  on public.channel_connection_secrets (workspace_id);

create trigger channel_connection_secrets_set_updated_at
before update on public.channel_connection_secrets
for each row execute function private.set_updated_at();

alter table public.channel_connection_secrets enable row level security;

-- No policies for `authenticated`: RLS on + no grants = server-only.
revoke all on table public.channel_connection_secrets from anon, authenticated;
grant select, insert, update, delete on table public.channel_connection_secrets to service_role;

-- A Telegram bot has exactly one webhook. Connecting the same bot to a second
-- workspace would silently steal the first one's updates, and the inbound
-- pipeline resolves a connection by (provider, external_id) as a single row.
create unique index channel_connections_telegram_bot_unique
  on public.channel_connections (provider, external_id)
  where provider = 'telegram';
