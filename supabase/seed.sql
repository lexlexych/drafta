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

-- Промпты в сидах короткие и разные: так в локальной разработке сразу видно,
-- какой workspace попал в промпт. Полный шаблон приходит из дефолта колонки.
insert into public.ai_settings (
  workspace_id,
  system_prompt,
  comment_system_prompt,
  model
)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'Пиши от лица Demo A. Отражай тон клиента и не выдумывай фактов.',
    'Отвечай на комментарии Demo A коротко и дружелюбно.',
    'mistral-large-latest'
  ),
  (
    'b0000000-0000-4000-8000-000000000001',
    'Пиши от лица Demo B. Держи деловой стиль и не выдумывай фактов.',
    'Отвечай на комментарии Demo B коротко и в деловом стиле.',
    'mistral-large-latest'
  )
on conflict (workspace_id) do update
set
  system_prompt = excluded.system_prompt,
  comment_system_prompt = excluded.comment_system_prompt,
  model = excluded.model,
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
    '{"responseWindowHours":null,"supportsAttachments":true,"supportsReadReceipts":true,"maxMessageLength":4096,"threadingStyle":"flat","supportsComments":false}'::jsonb,
    'active'
  ),
  (
    'a0000000-0000-4000-8000-000000000102',
    'a0000000-0000-4000-8000-000000000001',
    'Instagram Shop A',
    'zernio',
    'instagram',
    'seed-a-instagram',
    '{"responseWindowHours":24,"supportsAttachments":true,"supportsReadReceipts":true,"maxMessageLength":1000,"threadingStyle":"parent","supportsComments":true}'::jsonb,
    'active'
  ),
  (
    -- Second Telegram connection for Workspace A, different user-given name —
    -- docs/epics/epic_02/T-05-inbox-messages.md step 6: "два канала одной
    -- платформы с разными именами", exercising the inbox's channel badge
    -- (docs/architecture/05-channels.md#несколько-каналов-и-имена).
    'a0000000-0000-4000-8000-000000000103',
    'a0000000-0000-4000-8000-000000000001',
    'Telegram Поддержка A',
    'zernio',
    'telegram',
    'seed-a-telegram-support',
    '{"responseWindowHours":null,"supportsAttachments":true,"supportsReadReceipts":true,"maxMessageLength":4096,"threadingStyle":"flat","supportsComments":false}'::jsonb,
    'active'
  ),
  (
    'b0000000-0000-4000-8000-000000000101',
    'b0000000-0000-4000-8000-000000000001',
    'Telegram Shop B',
    'zernio',
    'telegram',
    'seed-b-telegram',
    '{"responseWindowHours":null,"supportsAttachments":true,"supportsReadReceipts":true,"maxMessageLength":4096,"threadingStyle":"flat","supportsComments":false}'::jsonb,
    'active'
  ),
  (
    'b0000000-0000-4000-8000-000000000102',
    'b0000000-0000-4000-8000-000000000001',
    'Instagram Shop B',
    'zernio',
    'instagram',
    'seed-b-instagram',
    '{"responseWindowHours":24,"supportsAttachments":true,"supportsReadReceipts":true,"maxMessageLength":1000,"threadingStyle":"parent","supportsComments":true}'::jsonb,
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
    -- Contact on the second Telegram connection (Telegram Поддержка A) —
    -- same platform as Anna's, different channel_connection, so the inbox
    -- shows both under their own channel badge/name.
    'a0000000-0000-4000-8000-000000000203',
    'a0000000-0000-4000-8000-000000000001',
    'Clara Support',
    'Third seed contact for Workspace A — second Telegram connection',
    array['support']
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
    'a0000000-0000-4000-8000-000000000303',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000203',
    'telegram',
    'seed-a-clara',
    'Clara Support',
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
    'seed-a-instagram-chat-anton',
    'open',
    now() - interval '25 minutes',
    0
  ),
  (
    -- Two unread messages, most recent last_incoming_at of Workspace A's
    -- conversations — sorts first in the list (T-05 acceptance criteria:
    -- sorted by last_incoming_at desc) and exercises a non-zero unread
    -- counter on the second Telegram channel specifically.
    'a0000000-0000-4000-8000-000000000403',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000103',
    'a0000000-0000-4000-8000-000000000203',
    'seed-a-telegram-chat-clara',
    'open',
    now() - interval '5 minutes',
    2
  ),
  (
    'b0000000-0000-4000-8000-000000000401',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000101',
    'b0000000-0000-4000-8000-000000000201',
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
    'seed-b-instagram-chat-britta',
    'open',
    now() - interval '35 minutes',
    0
  )
on conflict (id) do update
set
  channel_connection_id = excluded.channel_connection_id,
  contact_id = excluded.contact_id,
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
    -- Second Telegram connection (Telegram Поддержка A) — both still
    -- unread, matching the conversation's unread_count = 2 above.
    'a0000000-0000-4000-8000-000000000505',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000403',
    'a0000000-0000-4000-8000-000000000303',
    'seed-a-clara-1',
    'incoming',
    'Hallo! Haben Sie morgen noch freie Termine?',
    'received',
    null
  ),
  (
    'a0000000-0000-4000-8000-000000000506',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000403',
    'a0000000-0000-4000-8000-000000000303',
    'seed-a-clara-2',
    'incoming',
    'Ich möchte meinen Termin auf 15:00 Uhr verschieben.',
    'received',
    null
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

-- ---------------------------------------------------------------------------
-- Reply templates: ready-made answers the operator drops into the reply field.
-- One workspace gets two, the other one, so the RLS suite can prove isolation;
-- each carries two languages — the picker's second step only makes sense with
-- more than one.
-- ---------------------------------------------------------------------------

insert into public.reply_templates (
  id,
  workspace_id,
  name,
  bodies,
  is_enabled_for_messages,
  is_enabled_for_comments,
  sort_order
)
values
  (
    'a0000000-0000-4000-8000-000000000801',
    'a0000000-0000-4000-8000-000000000001',
    'Versandzeiten',
    '{"de":"Der Standardversand dauert zwei Werktage.","en":"Standard shipping takes two business days."}'::jsonb,
    true,
    false,
    0
  ),
  (
    'a0000000-0000-4000-8000-000000000802',
    'a0000000-0000-4000-8000-000000000001',
    'Danke für die Bestellung',
    '{"de":"Vielen Dank für Ihre Bestellung!","en":"Thank you for your order!"}'::jsonb,
    true,
    true,
    1
  ),
  (
    'b0000000-0000-4000-8000-000000000801',
    'b0000000-0000-4000-8000-000000000001',
    'Öffnungszeiten',
    '{"de":"Wir sind Montag bis Freitag von 9 bis 18 Uhr erreichbar.","en":"We are available Monday to Friday, 9am to 6pm."}'::jsonb,
    true,
    false,
    0
  )
on conflict (id) do update
set
  name = excluded.name,
  bodies = excluded.bodies,
  is_enabled_for_messages = excluded.is_enabled_for_messages,
  is_enabled_for_comments = excluded.is_enabled_for_comments,
  sort_order = excluded.sort_order,
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

-- ---------------------------------------------------------------------------
-- Comments: two posts on Workspace A's Instagram channel (capabilities
-- {"comments":true}). Comments live in their own tables — `posts` with
-- `comments` under them — and carry no drafts on arrival: the second post is
-- seeded with no comments at all, exactly as a freshly published one looks.
-- ---------------------------------------------------------------------------

insert into public.contacts (id, workspace_id, display_name, notes, tags)
values
  (
    'a0000000-0000-4000-8000-000000000210',
    'a0000000-0000-4000-8000-000000000001',
    'Lena Fischer',
    '',
    array['instagram']
  ),
  (
    'a0000000-0000-4000-8000-000000000211',
    'a0000000-0000-4000-8000-000000000001',
    'Marco Ziegler',
    '',
    array['instagram']
  )
on conflict (id) do update
set display_name = excluded.display_name, updated_at = now();

insert into public.contact_identities (
  id,
  workspace_id,
  contact_id,
  platform,
  external_id,
  display_name
)
values
  (
    'a0000000-0000-4000-8000-000000000310',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000210',
    'instagram',
    'ig_user_lena_fischer',
    'Lena Fischer'
  ),
  (
    'a0000000-0000-4000-8000-000000000311',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000211',
    'instagram',
    'ig_user_marco_ziegler',
    'Marco Ziegler'
  )
on conflict (id) do update
set platform = excluded.platform,
    external_id = excluded.external_id,
    display_name = excluded.display_name,
    updated_at = now();

insert into public.posts (
  id,
  workspace_id,
  channel_connection_id,
  external_id,
  text,
  permalink,
  published_at,
  metadata,
  last_comment_at,
  unread_count
)
values
  (
    'a0000000-0000-4000-8000-000000000410',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000102',
    'ig_post_autumn',
    'Осенняя коллекция уже в продаже — заходите за новинками!',
    'https://instagram.com/p/ig_post_autumn',
    now() - interval '2 days',
    '{"platformPostId":"ig_post_autumn","postId":null,"platform":"instagram"}'::jsonb,
    now() - interval '8 minutes',
    2
  ),
  (
    -- Только что опубликованный пост: в списке «Комментарии» он есть,
    -- комментариев под ним ещё нет.
    'a0000000-0000-4000-8000-000000000411',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000102',
    'ig_post_workshop',
    'Собрали новый стеллаж в мастерской — показываем на видео.',
    'https://instagram.com/p/ig_post_workshop',
    now() - interval '20 minutes',
    '{"platformPostId":"ig_post_workshop","postId":null,"platform":"instagram"}'::jsonb,
    null,
    0
  )
on conflict (id) do update
set
  channel_connection_id = excluded.channel_connection_id,
  external_id = excluded.external_id,
  text = excluded.text,
  permalink = excluded.permalink,
  published_at = excluded.published_at,
  metadata = excluded.metadata,
  last_comment_at = excluded.last_comment_at,
  unread_count = excluded.unread_count,
  updated_at = now();

insert into public.comments (
  id,
  workspace_id,
  post_id,
  contact_identity_id,
  external_id,
  parent_external_id,
  direction,
  text,
  delivery_status,
  sent_at
)
values
  (
    'a0000000-0000-4000-8000-000000000510',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000410',
    'a0000000-0000-4000-8000-000000000310',
    'ig_comment_lena_1',
    null,
    'incoming',
    'Сколько стоит доставка по Берлину?',
    'received',
    null
  ),
  (
    'a0000000-0000-4000-8000-000000000511',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000410',
    'a0000000-0000-4000-8000-000000000311',
    'ig_comment_marco_1',
    null,
    'incoming',
    'Красивая коллекция! А есть в наличии синий свитер?',
    'received',
    null
  )
on conflict (id) do update
set
  contact_identity_id = excluded.contact_identity_id,
  external_id = excluded.external_id,
  parent_external_id = excluded.parent_external_id,
  direction = excluded.direction,
  text = excluded.text,
  delivery_status = excluded.delivery_status,
  updated_at = now();

-- Token accounting (public.ai_usage). Two workspaces so the RLS tests can prove
-- a member of one never sees the other's spend. Written here rather than by the
-- pipelines because seeding must not call an LLM provider.
insert into public.ai_usage (
  id,
  workspace_id,
  operation,
  surface,
  provider,
  model,
  prompt_tokens,
  completion_tokens,
  total_tokens
)
values
  (
    'a0000000-0000-4000-8000-000000000601',
    'a0000000-0000-4000-8000-000000000001',
    'classification',
    'message',
    'mistral',
    'mistral-small-latest',
    480,
    12,
    492
  ),
  (
    'a0000000-0000-4000-8000-000000000602',
    'a0000000-0000-4000-8000-000000000001',
    'draft',
    'message',
    'mistral',
    'mistral-large-latest',
    1320,
    280,
    1600
  ),
  (
    'b0000000-0000-4000-8000-000000000601',
    'b0000000-0000-4000-8000-000000000001',
    'draft',
    'comment',
    'mistral',
    'mistral-large-latest',
    760,
    190,
    950
  )
on conflict (id) do update
set
  operation = excluded.operation,
  surface = excluded.surface,
  provider = excluded.provider,
  model = excluded.model,
  prompt_tokens = excluded.prompt_tokens,
  completion_tokens = excluded.completion_tokens,
  total_tokens = excluded.total_tokens;

-- Provider exchanges (public.ai_request_log). One row is enough: the RLS suite
-- only has to prove that a logged-in member of the workspace still cannot read
-- it, the way it does for webhook_events. The bodies here mimic a real call,
-- placeholders included — masked text is exactly what the provider receives.
insert into public.ai_request_log (
  id,
  workspace_id,
  operation,
  surface,
  provider,
  model,
  request,
  response,
  status_code,
  duration_ms,
  prompt_tokens,
  completion_tokens,
  total_tokens
)
values
  (
    'a0000000-0000-4000-8000-000000000701',
    'a0000000-0000-4000-8000-000000000001',
    'draft',
    'message',
    'mistral',
    'mistral-large-latest',
    '{"model":"mistral-large-latest","messages":[{"role":"user","content":"Свяжитесь со мной: {{PHONE_1}}"}],"temperature":0.3,"max_tokens":800}'::jsonb,
    '{"id":"cmpl-seed","choices":[{"message":{"role":"assistant","content":"Спасибо! Мы позвоним на {{PHONE_1}}."},"finish_reason":"stop"}],"usage":{"prompt_tokens":1320,"completion_tokens":280,"total_tokens":1600}}'::jsonb,
    200,
    1240,
    1320,
    280,
    1600
  )
on conflict (id) do update
set
  request = excluded.request,
  response = excluded.response,
  status_code = excluded.status_code,
  duration_ms = excluded.duration_ms;
