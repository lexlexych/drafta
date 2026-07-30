-- Profile picture of a contact's channel identity, as reported by the provider
-- (Zernio sends it on `message.received`/`comment.received` as `picture`).
--
-- It lives on `contact_identities`, not on `contacts`, because the picture
-- belongs to the channel persona: the same person can have a different photo on
-- Telegram and on Instagram (docs/architecture/06-data-model.md, «Люди»). It
-- also means `merge_contacts` needs no change — identities carry their avatars
-- along when two contacts are merged.
--
-- Only the URL is stored, never the bytes. Platform CDN links expire, so a stale
-- link simply degrades back to the initials placeholder in the UI.
-- `contacts.avatar_url` stays reserved for a manually uploaded avatar.
alter table public.contact_identities add column avatar_url text;

comment on column public.contact_identities.avatar_url is
  'Provider-reported profile picture URL for this channel identity. Null when the platform reports none. Served to the browser only through /api/avatars/[identityId].';
