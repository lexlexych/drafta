-- Manual contact merge (docs/architecture/16-rollout-plan.md, этап 7).
-- On the MVP every new channel identity creates its own contact; joining two
-- contacts into one is a manual UI action. This RPC does it atomically: move
-- the source contact's identities and conversations onto the kept contact,
-- merge notes and tags, then delete the now-empty source contact.
--
-- Same conventions as create_category (20260721120000_categories_crud.sql):
-- security definer + empty search_path, an explicit workspace-membership gate,
-- and Data API grants limited to authenticated + service_role.

create function public.merge_contacts(
  target_workspace_id uuid,
  source_contact_id uuid,
  keep_contact_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_contact public.contacts%rowtype;
  keep_contact public.contacts%rowtype;
  merged_notes text;
  merged_tags text[];
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using errcode = '42501', message = 'Workspace access denied';
  end if;

  if source_contact_id is null
    or keep_contact_id is null
    or source_contact_id = keep_contact_id then
    raise exception using errcode = '22023', message = 'Two distinct contacts are required';
  end if;

  select * into keep_contact
  from public.contacts
  where workspace_id = target_workspace_id
    and id = keep_contact_id
  for update;

  select * into source_contact
  from public.contacts
  where workspace_id = target_workspace_id
    and id = source_contact_id
  for update;

  if keep_contact.id is null or source_contact.id is null then
    return false;
  end if;

  -- Re-home the source contact's channel identities and DM threads. The
  -- (workspace_id, platform, external_id) uniqueness on contact_identities is
  -- workspace-global, so two contacts can never share an identity key — the
  -- reassignment cannot collide.
  update public.contact_identities
  set contact_id = keep_contact_id,
      updated_at = now()
  where workspace_id = target_workspace_id
    and contact_id = source_contact_id;

  update public.conversations
  set contact_id = keep_contact_id,
      updated_at = now()
  where workspace_id = target_workspace_id
    and contact_id = source_contact_id;

  merged_notes := pg_catalog.btrim(
    case
      when pg_catalog.btrim(source_contact.notes) = '' then keep_contact.notes
      when pg_catalog.btrim(keep_contact.notes) = '' then source_contact.notes
      else keep_contact.notes || E'\n\n' || source_contact.notes
    end
  );

  -- Union of tags, de-duplicated while preserving first-seen order.
  select coalesce(array_agg(tag order by ord), '{}'::text[])
  into merged_tags
  from (
    select tag, min(ord) as ord
    from unnest(keep_contact.tags || source_contact.tags)
      with ordinality as source(tag, ord)
    group by tag
  ) as deduped;

  update public.contacts
  set notes = merged_notes,
      tags = merged_tags,
      updated_at = now()
  where workspace_id = target_workspace_id
    and id = keep_contact_id;

  delete from public.contacts
  where workspace_id = target_workspace_id
    and id = source_contact_id;

  return true;
end;
$$;

revoke all on function public.merge_contacts(uuid, uuid, uuid) from public;
grant execute on function public.merge_contacts(uuid, uuid, uuid) to authenticated, service_role;
