-- Reproducible demo fixtures for local development and a dedicated Supabase
-- Cloud dev project. Never load this file into production: it creates two
-- login-capable users with a publicly documented development-only password.
--
-- owner-a@example.com / owner-b@example.com
-- password: drafta-demo-password
--
-- The fixed UUIDs are consumed by tests/rls. Keep the two files in sync when
-- changing the fixture shape.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'owner-a@example.com',
    extensions.crypt('drafta-demo-password', extensions.gen_salt('bf', 10)),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"seed_fixture":"owner-a"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'owner-b@example.com',
    extensions.crypt('drafta-demo-password', extensions.gen_salt('bf', 10)),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"seed_fixture":"owner-b"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
on conflict (id) do update
set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = excluded.updated_at;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '{"sub":"11111111-1111-4111-8111-111111111111","email":"owner-a@example.com"}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    '{"sub":"22222222-2222-4222-8222-222222222222","email":"owner-b@example.com"}'::jsonb,
    'email',
    now(),
    now(),
    now()
  )
on conflict (id) do update
set
  provider_id = excluded.provider_id,
  identity_data = excluded.identity_data,
  updated_at = excluded.updated_at;

insert into public.workspaces (id, name, plan, settings)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'Demo Workspace A',
    'free',
    '{"seed_fixture":"workspace-a"}'::jsonb
  ),
  (
    'b0000000-0000-4000-8000-000000000001',
    'Demo Workspace B',
    'free',
    '{"seed_fixture":"workspace-b"}'::jsonb
  )
on conflict (id) do update
set
  name = excluded.name,
  plan = excluded.plan,
  settings = excluded.settings,
  updated_at = now();

insert into public.workspace_members (workspace_id, user_id, role)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'owner'
  ),
  (
    'b0000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'owner'
  )
on conflict (workspace_id, user_id) do update
set
  role = excluded.role,
  updated_at = now();

insert into public.ai_settings (
  workspace_id,
  tone,
  language,
  signature,
  debounce_seconds,
  model,
  auto_generate_dm,
  auto_generate_comments
)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'friendly',
    'de',
    'Viele Grüße, Demo A',
    45,
    'mistral-large-latest',
    true,
    true
  ),
  (
    'b0000000-0000-4000-8000-000000000001',
    'professional',
    'de',
    'Mit freundlichen Grüßen, Demo B',
    60,
    'mistral-large-latest',
    true,
    false
  )
on conflict (workspace_id) do update
set
  tone = excluded.tone,
  language = excluded.language,
  signature = excluded.signature,
  debounce_seconds = excluded.debounce_seconds,
  model = excluded.model,
  auto_generate_dm = excluded.auto_generate_dm,
  auto_generate_comments = excluded.auto_generate_comments,
  updated_at = now();

insert into public.channel_connections (
  id,
  workspace_id,
  name,
  provider,
  platform,
  external_id,
  capabilities,
  status
)
values
  (
    'a0000000-0000-4000-8000-000000000101',
    'a0000000-0000-4000-8000-000000000001',
    'Telegram Shop A',
    'zernio',
    'telegram',
    'seed-a-telegram',
    '{"dm":true,"comments":false}'::jsonb,
    'active'
  ),
  (
    'a0000000-0000-4000-8000-000000000102',
    'a0000000-0000-4000-8000-000000000001',
    'Instagram Shop A',
    'zernio',
    'instagram',
    'seed-a-instagram',
    '{"dm":true,"comments":true}'::jsonb,
    'active'
  ),
  (
    'b0000000-0000-4000-8000-000000000101',
    'b0000000-0000-4000-8000-000000000001',
    'Telegram Shop B',
    'zernio',
    'telegram',
    'seed-b-telegram',
    '{"dm":true,"comments":false}'::jsonb,
    'active'
  ),
  (
    'b0000000-0000-4000-8000-000000000102',
    'b0000000-0000-4000-8000-000000000001',
    'Instagram Shop B',
    'zernio',
    'instagram',
    'seed-b-instagram',
    '{"dm":true,"comments":true}'::jsonb,
    'active'
  )
on conflict (id) do update
set
  name = excluded.name,
  provider = excluded.provider,
  platform = excluded.platform,
  external_id = excluded.external_id,
  capabilities = excluded.capabilities,
  status = excluded.status,
  updated_at = now();

insert into public.contacts (id, workspace_id, display_name, notes, tags)
values
  (
    'a0000000-0000-4000-8000-000000000201',
    'a0000000-0000-4000-8000-000000000001',
    'Anna Beispiel',
    'Seed contact for Workspace A',
    array['vip', 'telegram']
  ),
  (
    'a0000000-0000-4000-8000-000000000202',
    'a0000000-0000-4000-8000-000000000001',
    'Anton Kunde',
    'Second seed contact for Workspace A',
    array['instagram']
  ),
  (
    'b0000000-0000-4000-8000-000000000201',
    'b0000000-0000-4000-8000-000000000001',
    'Bernd Beispiel',
    'Seed contact for Workspace B',
    array['vip', 'telegram']
  ),
  (
    'b0000000-0000-4000-8000-000000000202',
    'b0000000-0000-4000-8000-000000000001',
    'Britta Kunde',
    'Second seed contact for Workspace B',
    array['instagram']
  )
on conflict (id) do update
set
  display_name = excluded.display_name,
  notes = excluded.notes,
  tags = excluded.tags,
  updated_at = now();

insert into public.contact_identities (
  id,
  workspace_id,
  contact_id,
  platform,
  external_id,
  display_name,
  metadata
)
values
  (
    'a0000000-0000-4000-8000-000000000301',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000201',
    'telegram',
    'seed-a-anna',
    'Anna Beispiel',
    '{"seed":true}'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000302',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000202',
    'instagram',
    'seed-a-anton',
    'Anton Kunde',
    '{"seed":true}'::jsonb
  ),
  (
    'b0000000-0000-4000-8000-000000000301',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000201',
    'telegram',
    'seed-b-bernd',
    'Bernd Beispiel',
    '{"seed":true}'::jsonb
  ),
  (
    'b0000000-0000-4000-8000-000000000302',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000202',
    'instagram',
    'seed-b-britta',
    'Britta Kunde',
    '{"seed":true}'::jsonb
  )
on conflict (id) do update
set
  contact_id = excluded.contact_id,
  platform = excluded.platform,
  external_id = excluded.external_id,
  display_name = excluded.display_name,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.conversations (
  id,
  workspace_id,
  channel_connection_id,
  contact_id,
  kind,
  external_id,
  status,
  last_incoming_at,
  unread_count
)
values
  (
    'a0000000-0000-4000-8000-000000000401',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000101',
    'a0000000-0000-4000-8000-000000000201',
    'dm',
    'seed-a-telegram-chat-anna',
    'open',
    now() - interval '10 minutes',
    1
  ),
  (
    'a0000000-0000-4000-8000-000000000402',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000102',
    'a0000000-0000-4000-8000-000000000202',
    'dm',
    'seed-a-instagram-chat-anton',
    'open',
    now() - interval '25 minutes',
    0
  ),
  (
    'b0000000-0000-4000-8000-000000000401',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000101',
    'b0000000-0000-4000-8000-000000000201',
    'dm',
    'seed-b-telegram-chat-bernd',
    'open',
    now() - interval '15 minutes',
    1
  ),
  (
    'b0000000-0000-4000-8000-000000000402',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000102',
    'b0000000-0000-4000-8000-000000000202',
    'dm',
    'seed-b-instagram-chat-britta',
    'open',
    now() - interval '35 minutes',
    0
  )
on conflict (id) do update
set
  channel_connection_id = excluded.channel_connection_id,
  contact_id = excluded.contact_id,
  kind = excluded.kind,
  external_id = excluded.external_id,
  status = excluded.status,
  last_incoming_at = excluded.last_incoming_at,
  unread_count = excluded.unread_count,
  updated_at = now();

insert into public.messages (
  id,
  workspace_id,
  conversation_id,
  contact_identity_id,
  external_id,
  direction,
  text,
  delivery_status,
  sent_at
)
values
  (
    'a0000000-0000-4000-8000-000000000501',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000401',
    'a0000000-0000-4000-8000-000000000301',
    'seed-a-anna-1',
    'incoming',
    'Hallo, ist der Artikel noch verfügbar?',
    'received',
    null
  ),
  (
    'a0000000-0000-4000-8000-000000000502',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000401',
    null,
    'seed-a-anna-2',
    'outgoing',
    'Ja, der Artikel ist verfügbar.',
    'sent',
    now() - interval '9 minutes'
  ),
  (
    'a0000000-0000-4000-8000-000000000503',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000402',
    'a0000000-0000-4000-8000-000000000302',
    'seed-a-anton-1',
    'incoming',
    'Wie lange dauert der Versand?',
    'received',
    null
  ),
  (
    'a0000000-0000-4000-8000-000000000504',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000402',
    null,
    'seed-a-anton-2',
    'outgoing',
    'Der Versand dauert in der Regel zwei Werktage.',
    'sent',
    now() - interval '24 minutes'
  ),
  (
    'b0000000-0000-4000-8000-000000000501',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000401',
    'b0000000-0000-4000-8000-000000000301',
    'seed-b-bernd-1',
    'incoming',
    'Kann ich per Rechnung bezahlen?',
    'received',
    null
  ),
  (
    'b0000000-0000-4000-8000-000000000502',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000401',
    null,
    'seed-b-bernd-2',
    'outgoing',
    'Bitte wählen Sie Rechnung beim Checkout aus.',
    'sent',
    now() - interval '14 minutes'
  ),
  (
    'b0000000-0000-4000-8000-000000000503',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000402',
    'b0000000-0000-4000-8000-000000000302',
    'seed-b-britta-1',
    'incoming',
    'Gibt es den Artikel auch in Blau?',
    'received',
    null
  ),
  (
    'b0000000-0000-4000-8000-000000000504',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000402',
    null,
    'seed-b-britta-2',
    'outgoing',
    'Ja, Blau ist aktuell verfügbar.',
    'sent',
    now() - interval '34 minutes'
  )
on conflict (id) do update
set
  contact_identity_id = excluded.contact_identity_id,
  external_id = excluded.external_id,
  direction = excluded.direction,
  text = excluded.text,
  delivery_status = excluded.delivery_status,
  sent_at = excluded.sent_at,
  updated_at = now();

insert into public.kb_files (
  id,
  workspace_id,
  name,
  content,
  sort_order,
  is_enabled
)
values
  (
    'a0000000-0000-4000-8000-000000000601',
    'a0000000-0000-4000-8000-000000000001',
    'Versand A.md',
    '# Versand\nStandardversand dauert zwei Werktage.',
    0,
    true
  ),
  (
    'a0000000-0000-4000-8000-000000000602',
    'a0000000-0000-4000-8000-000000000001',
    'Zahlung A.md',
    '# Zahlung\nRechnung ist im Checkout verfügbar.',
    1,
    true
  ),
  (
    'b0000000-0000-4000-8000-000000000601',
    'b0000000-0000-4000-8000-000000000001',
    'Versand B.md',
    '# Versand\nExpressversand ist für Demo B verfügbar.',
    0,
    true
  ),
  (
    'b0000000-0000-4000-8000-000000000602',
    'b0000000-0000-4000-8000-000000000001',
    'Farben B.md',
    '# Farben\nBlau und Schwarz sind verfügbar.',
    1,
    true
  )
on conflict (id) do update
set
  name = excluded.name,
  content = excluded.content,
  sort_order = excluded.sort_order,
  is_enabled = excluded.is_enabled,
  updated_at = now();

insert into public.webhook_events (
  id,
  workspace_id,
  provider,
  external_event_id,
  payload
)
values
  (
    'a0000000-0000-4000-8000-000000000701',
    'a0000000-0000-4000-8000-000000000001',
    'zernio',
    'seed-a-webhook-event',
    '{"seed":true,"workspace":"A"}'::jsonb
  ),
  (
    'b0000000-0000-4000-8000-000000000701',
    'b0000000-0000-4000-8000-000000000001',
    'zernio',
    'seed-b-webhook-event',
    '{"seed":true,"workspace":"B"}'::jsonb
  )
on conflict (id) do update
set
  provider = excluded.provider,
  external_event_id = excluded.external_event_id,
  payload = excluded.payload,
  updated_at = now();
