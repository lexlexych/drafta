-- drafta schema v1. RLS policies are added separately in T-03.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  plan text not null default 'free' check (plan in ('free', 'paid')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create unique index workspace_members_one_owner_per_workspace_idx
  on public.workspace_members (workspace_id)
  where role = 'owner';
create index workspace_members_user_id_idx on public.workspace_members (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (length(btrim(email)) > 0),
  token text not null unique check (length(token) > 0),
  role text not null default 'member' check (role in ('owner', 'member')),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invitations_workspace_id_idx on public.invitations (workspace_id);
create unique index invitations_pending_email_idx
  on public.invitations (workspace_id, lower(email))
  where status = 'pending';

create table public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  provider text not null check (length(btrim(provider)) > 0),
  platform text not null check (length(btrim(platform)) > 0),
  external_id text not null check (length(external_id) > 0),
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  encrypted_credentials text,
  status text not null default 'active' check (status in ('active', 'disconnected', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);

create index channel_connections_workspace_id_idx on public.channel_connections (workspace_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text not null default '',
  draft_instruction text,
  channel_connection_ids uuid[] not null default '{}',
  incoming_kind text not null default 'both' check (incoming_kind in ('dm', 'comments', 'both')),
  skip_draft boolean not null default false,
  priority integer not null check (priority >= 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, priority)
);

create index categories_workspace_id_idx on public.categories (workspace_id);
create unique index categories_one_default_per_workspace_idx
  on public.categories (workspace_id)
  where is_default;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) > 0),
  notes text not null default '',
  tags text[] not null default '{}',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_workspace_id_idx on public.contacts (workspace_id);

create table public.contact_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  platform text not null check (length(btrim(platform)) > 0),
  external_id text not null check (length(external_id) > 0),
  display_name text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, external_id)
);

create index contact_identities_workspace_id_idx on public.contact_identities (workspace_id);
create index contact_identities_contact_id_idx on public.contact_identities (contact_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_connection_id uuid not null references public.channel_connections(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  kind text not null check (kind in ('dm', 'comments')),
  external_id text not null check (length(external_id) > 0),
  post_metadata jsonb check (post_metadata is null or jsonb_typeof(post_metadata) = 'object'),
  status text not null default 'open' check (status in ('open', 'snoozed', 'closed')),
  snoozed_until timestamptz,
  last_incoming_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_connection_id, external_id)
);

create index conversations_workspace_id_idx on public.conversations (workspace_id);
create index conversations_channel_connection_id_idx on public.conversations (channel_connection_id);
create index conversations_contact_id_idx on public.conversations (contact_id);
create index conversations_inbox_idx on public.conversations (workspace_id, kind, status, last_incoming_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_identity_id uuid references public.contact_identities(id) on delete set null,
  parent_external_id text,
  external_id text not null check (length(external_id) > 0),
  direction text not null check (direction in ('incoming', 'outgoing')),
  text text not null default '',
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  category_id uuid references public.categories(id) on delete set null,
  delivery_status text not null default 'received'
    check (delivery_status in ('received', 'pending', 'sent', 'delivered', 'failed')),
  provider_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_metadata) = 'object'),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);

create index messages_workspace_id_idx on public.messages (workspace_id);
create index messages_conversation_id_idx on public.messages (conversation_id);
create index messages_contact_identity_id_idx on public.messages (contact_identity_id);
create index messages_category_id_idx on public.messages (category_id);
create index messages_conversation_created_at_idx on public.messages (conversation_id, created_at);

create table public.kb_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  content text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index kb_files_workspace_id_idx on public.kb_files (workspace_id);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  first_message_id uuid not null references public.messages(id) on delete cascade,
  last_message_id uuid not null references public.messages(id) on delete cascade,
  text text not null default '',
  status text not null default 'generating'
    check (status in ('generating', 'ready', 'edited', 'sent', 'discarded', 'superseded')),
  model text,
  kb_file_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index drafts_workspace_id_idx on public.drafts (workspace_id);
create index drafts_conversation_id_idx on public.drafts (conversation_id);
create index drafts_first_message_id_idx on public.drafts (first_message_id);
create index drafts_last_message_id_idx on public.drafts (last_message_id);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (length(btrim(provider)) > 0),
  external_event_id text not null check (length(external_event_id) > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

create index webhook_events_workspace_id_idx on public.webhook_events (workspace_id);
create index webhook_events_processing_idx
  on public.webhook_events (processed_at, created_at)
  where processed_at is null;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (length(endpoint) > 0),
  p256dh text not null check (length(p256dh) > 0),
  auth_key text not null check (length(auth_key) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workspace_id, endpoint)
);

create index push_subscriptions_workspace_id_idx on public.push_subscriptions (workspace_id);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

create table public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'instant' check (mode in ('instant', 'digest')),
  digest_interval_minutes integer not null default 30 check (digest_interval_minutes > 0),
  last_digest_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workspace_id)
);

create index notification_settings_workspace_id_idx on public.notification_settings (workspace_id);
create index notification_settings_user_id_idx on public.notification_settings (user_id);

create table public.ai_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  tone text not null default 'professional',
  language text not null default 'de',
  signature text not null default '',
  debounce_seconds integer not null default 60 check (debounce_seconds between 0 and 600),
  model text not null default 'mistral-large-latest',
  auto_generate_dm boolean not null default true,
  auto_generate_comments boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invitations enable row level security;
alter table public.channel_connections enable row level security;
alter table public.categories enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_identities enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.drafts enable row level security;
alter table public.kb_files enable row level security;
alter table public.webhook_events enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_settings enable row level security;
alter table public.ai_settings enable row level security;
