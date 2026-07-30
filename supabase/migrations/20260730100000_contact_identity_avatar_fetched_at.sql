-- When we last asked the provider for this identity's profile picture.
--
-- The picture is not carried by inbound webhooks (Meta omits it from an
-- incoming DM), so it is fetched from the provider's API instead — and that
-- call is worth making rarely: at most once a month, and only after the contact
-- writes. This column is what enforces "rarely".
--
-- Null means we have never asked. The timestamp is set after every attempt,
-- including one that found no picture — otherwise a contact the platform has no
-- photo for would trigger an API call on every single message.
alter table public.contact_identities add column avatar_fetched_at timestamptz;

comment on column public.contact_identities.avatar_fetched_at is
  'Last time the provider was asked for this identity''s avatar (set even when none was found). Gates the monthly refresh in lib/inngest/functions/contact-avatar.ts.';
