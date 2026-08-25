alter table public.contact_identities
  add column avatar_url text,
  add column avatar_fetched_at timestamptz;

comment on column public.contact_identities.avatar_url is
  'Short-lived provider profile-picture URL. Never exposed directly; served through the authenticated avatar proxy.';

comment on column public.contact_identities.avatar_fetched_at is
  'Last successful provider avatar lookup, including lookups that returned no picture.';
