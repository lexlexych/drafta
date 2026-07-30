-- Rolls the avatar columns back off `contact_identities`.
--
-- Two attempts at showing a contact's real photo were reverted (the provider
-- never returned one for Instagram DMs), so the columns they added have no
-- reader left in the code. Contacts are back to initials.
--
-- The two migrations that added these columns are kept in history rather than
-- deleted: they were already applied, and removing the files would leave a
-- local `db reset` describing a different schema than production. This is the
-- forward migration that undoes them.
--
-- `if exists` on both, so this applies cleanly whether or not a given
-- environment ever got as far as the second column.
--
-- `contacts.avatar_url` is deliberately untouched: it predates all of this
-- (schema v1) and is reserved for a manually set avatar.
alter table public.contact_identities drop column if exists avatar_url;
alter table public.contact_identities drop column if exists avatar_fetched_at;
