-- Real category management: provision the locked fallback category and expose
-- atomic, RLS-respecting operations for CRUD and priority changes.

alter table public.categories
  drop constraint categories_workspace_id_priority_key;

alter table public.categories
  add constraint categories_workspace_priority_key
  unique (workspace_id, priority)
  deferrable initially immediate;

alter table public.categories
  add constraint categories_default_scope_check
  check (
    not is_default
    or (
      incoming_kind = 'both'
      and cardinality(channel_connection_ids) = 0
    )
  );

insert into public.categories (
  workspace_id,
  name,
  description,
  priority,
  is_default
)
select
  workspace.id,
  'По умолчанию',
  'Всё, что не подошло под правила выше.',
  coalesce(max(category.priority) + 1, 0),
  true
from public.workspaces as workspace
left join public.categories as category
  on category.workspace_id = workspace.id
where not exists (
  select 1
  from public.categories as existing_default
  where existing_default.workspace_id = workspace.id
    and existing_default.is_default
)
group by workspace.id;

create or replace function private.ensure_category_default_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid := case
    when tg_op = 'DELETE' then old.workspace_id
    else new.workspace_id
  end;
  default_count integer;
  default_priority integer;
  last_priority integer;
begin
  -- A workspace cascade intentionally removes every category. Do not block it.
  if not exists (
    select 1 from public.workspaces where id = target_workspace_id
  ) then
    return null;
  end if;

  select
    count(*) filter (where is_default),
    max(priority) filter (where is_default),
    max(priority)
  into default_count, default_priority, last_priority
  from public.categories
  where workspace_id = target_workspace_id;

  if default_count <> 1 or default_priority is distinct from last_priority then
    raise exception using
      errcode = '23514',
      message = 'A workspace must have exactly one last default category';
  end if;

  perform private.validate_category_channels(
    category.workspace_id,
    category.channel_connection_ids
  )
  from public.categories as category
  where category.workspace_id = target_workspace_id;

  return null;
end;
$$;

create constraint trigger categories_default_invariants
after insert or update or delete on public.categories
deferrable initially deferred
for each row
execute function private.ensure_category_default_invariants();

create or replace function private.validate_category_channels(
  target_workspace_id uuid,
  target_channel_connection_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(coalesce(target_channel_connection_ids, '{}'::uuid[])) as requested(id)
    left join public.channel_connections as channel_connection
      on channel_connection.id = requested.id
      and channel_connection.workspace_id = target_workspace_id
    where channel_connection.id is null
  ) then
    raise exception using
      errcode = '23503',
      message = 'A category channel must belong to the current workspace';
  end if;
end;
$$;

create function public.create_category(
  target_workspace_id uuid,
  category_name text,
  category_description text,
  category_draft_instruction text default null,
  category_channel_connection_ids uuid[] default '{}'::uuid[],
  category_incoming_kind text default 'both',
  category_skip_draft boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := pg_catalog.btrim(category_name);
  normalized_description text := pg_catalog.btrim(category_description);
  normalized_instruction text := nullif(pg_catalog.btrim(category_draft_instruction), '');
  normalized_channel_ids uuid[];
  default_priority integer;
  new_category_id uuid;
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using errcode = '42501', message = 'Workspace access denied';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception using errcode = '22023', message = 'Category name is required';
  end if;
  if normalized_description is null or normalized_description = '' then
    raise exception using errcode = '22023', message = 'Category description is required';
  end if;
  if category_incoming_kind not in ('dm', 'comments', 'both') then
    raise exception using errcode = '22023', message = 'Invalid incoming kind';
  end if;

  select coalesce(array_agg(distinct channel_id), '{}'::uuid[])
  into normalized_channel_ids
  from unnest(coalesce(category_channel_connection_ids, '{}'::uuid[]))
    as requested(channel_id);

  perform private.validate_category_channels(
    target_workspace_id,
    normalized_channel_ids
  );

  perform 1
  from public.categories
  where workspace_id = target_workspace_id
  order by priority
  for update;

  select priority
  into default_priority
  from public.categories
  where workspace_id = target_workspace_id
    and is_default
  for update;

  if default_priority is null then
    raise exception using errcode = '23514', message = 'Default category is missing';
  end if;

  set constraints categories_workspace_priority_key deferred;

  update public.categories
  set priority = priority + 1,
      updated_at = now()
  where workspace_id = target_workspace_id
    and is_default;

  insert into public.categories (
    workspace_id,
    name,
    description,
    draft_instruction,
    channel_connection_ids,
    incoming_kind,
    skip_draft,
    priority,
    is_default
  ) values (
    target_workspace_id,
    normalized_name,
    normalized_description,
    normalized_instruction,
    normalized_channel_ids,
    category_incoming_kind,
    category_skip_draft,
    default_priority,
    false
  )
  returning id into new_category_id;

  return new_category_id;
end;
$$;

create function public.update_category(
  target_workspace_id uuid,
  target_category_id uuid,
  category_name text,
  category_description text,
  category_draft_instruction text default null,
  category_channel_connection_ids uuid[] default '{}'::uuid[],
  category_incoming_kind text default 'both',
  category_skip_draft boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_category public.categories%rowtype;
  normalized_name text := pg_catalog.btrim(category_name);
  normalized_description text := pg_catalog.btrim(category_description);
  normalized_instruction text := nullif(pg_catalog.btrim(category_draft_instruction), '');
  normalized_channel_ids uuid[];
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using errcode = '42501', message = 'Workspace access denied';
  end if;

  perform 1
  from public.categories
  where workspace_id = target_workspace_id
  order by priority
  for update;

  select *
  into existing_category
  from public.categories
  where workspace_id = target_workspace_id
    and id = target_category_id
  for update;

  if not found then
    return false;
  end if;

  if existing_category.is_default then
    update public.categories
    set draft_instruction = normalized_instruction,
        skip_draft = category_skip_draft,
        updated_at = now()
    where workspace_id = target_workspace_id
      and id = target_category_id;

    return true;
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception using errcode = '22023', message = 'Category name is required';
  end if;
  if normalized_description is null or normalized_description = '' then
    raise exception using errcode = '22023', message = 'Category description is required';
  end if;
  if category_incoming_kind not in ('dm', 'comments', 'both') then
    raise exception using errcode = '22023', message = 'Invalid incoming kind';
  end if;

  select coalesce(array_agg(distinct channel_id), '{}'::uuid[])
  into normalized_channel_ids
  from unnest(coalesce(category_channel_connection_ids, '{}'::uuid[]))
    as requested(channel_id);

  perform private.validate_category_channels(
    target_workspace_id,
    normalized_channel_ids
  );

  update public.categories
  set name = normalized_name,
      description = normalized_description,
      draft_instruction = normalized_instruction,
      channel_connection_ids = normalized_channel_ids,
      incoming_kind = category_incoming_kind,
      skip_draft = category_skip_draft,
      updated_at = now()
  where workspace_id = target_workspace_id
    and id = target_category_id;

  return true;
end;
$$;

create function public.delete_category(
  target_workspace_id uuid,
  target_category_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_priority integer;
  target_is_default boolean;
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using errcode = '42501', message = 'Workspace access denied';
  end if;

  perform 1
  from public.categories
  where workspace_id = target_workspace_id
  order by priority
  for update;

  select priority, is_default
  into deleted_priority, target_is_default
  from public.categories
  where workspace_id = target_workspace_id
    and id = target_category_id
  for update;

  if not found then
    return false;
  end if;
  if target_is_default then
    raise exception using errcode = '23514', message = 'Default category cannot be deleted';
  end if;

  set constraints categories_workspace_priority_key deferred;

  delete from public.categories
  where workspace_id = target_workspace_id
    and id = target_category_id;

  update public.categories
  set priority = priority - 1,
      updated_at = now()
  where workspace_id = target_workspace_id
    and priority > deleted_priority;

  return true;
end;
$$;

create function public.reorder_categories(
  target_workspace_id uuid,
  ordered_category_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  regular_category_count integer;
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using errcode = '42501', message = 'Workspace access denied';
  end if;

  perform 1
  from public.categories
  where workspace_id = target_workspace_id
  order by priority
  for update;

  select count(*)
  into regular_category_count
  from public.categories
  where workspace_id = target_workspace_id
    and not is_default;

  if coalesce(cardinality(ordered_category_ids), 0) <> regular_category_count
     or (
       select count(distinct category_id)
       from unnest(coalesce(ordered_category_ids, '{}'::uuid[]))
         as requested(category_id)
     ) <> regular_category_count
     or exists (
       select 1
       from unnest(coalesce(ordered_category_ids, '{}'::uuid[])) as requested(id)
       left join public.categories as category
         on category.id = requested.id
         and category.workspace_id = target_workspace_id
         and not category.is_default
       where category.id is null
     ) then
    raise exception using errcode = '22023', message = 'Invalid category order';
  end if;

  set constraints categories_workspace_priority_key deferred;

  update public.categories as category
  set priority = requested.ordinality::integer - 1,
      updated_at = now()
  from unnest(coalesce(ordered_category_ids, '{}'::uuid[]))
    with ordinality as requested(id, ordinality)
  where category.workspace_id = target_workspace_id
    and category.id = requested.id;

  update public.categories
  set priority = regular_category_count,
      updated_at = now()
  where workspace_id = target_workspace_id
    and is_default;

  return true;
end;
$$;

revoke all on function public.create_category(uuid, text, text, text, uuid[], text, boolean) from public;
revoke all on function public.update_category(uuid, uuid, text, text, text, uuid[], text, boolean) from public;
revoke all on function public.delete_category(uuid, uuid) from public;
revoke all on function public.reorder_categories(uuid, uuid[]) from public;

grant execute on function public.create_category(uuid, text, text, text, uuid[], text, boolean) to authenticated, service_role;
grant execute on function public.update_category(uuid, uuid, text, text, text, uuid[], text, boolean) to authenticated, service_role;
grant execute on function public.delete_category(uuid, uuid) to authenticated, service_role;
grant execute on function public.reorder_categories(uuid, uuid[]) to authenticated, service_role;

create or replace function public.create_workspace(
  target_workspace_id uuid,
  owner_user_id uuid,
  workspace_name text,
  provider_profiles jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := pg_catalog.btrim(workspace_name);
  zernio_profile_id text := provider_profiles ->> 'zernio';
begin
  if target_workspace_id is null or owner_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'Workspace id and owner user id are required';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception using
      errcode = '22023',
      message = 'Workspace name must not be empty';
  end if;

  if jsonb_typeof(provider_profiles) <> 'object'
     or zernio_profile_id is null
     or pg_catalog.btrim(zernio_profile_id) = '' then
    raise exception using
      errcode = '22023',
      message = 'A Zernio provider profile id is required';
  end if;

  insert into public.workspaces (id, name, settings)
  values (
    target_workspace_id,
    normalized_name,
    pg_catalog.jsonb_build_object('providerProfiles', provider_profiles)
  );

  insert into public.workspace_members (workspace_id, user_id, role)
  values (target_workspace_id, owner_user_id, 'owner');

  insert into public.ai_settings (workspace_id)
  values (target_workspace_id);

  insert into public.categories (
    workspace_id,
    name,
    description,
    priority,
    is_default
  ) values (
    target_workspace_id,
    'По умолчанию',
    'Всё, что не подошло под правила выше.',
    0,
    true
  );

  return target_workspace_id;
end;
$$;

revoke all on function public.create_workspace(uuid, uuid, text, jsonb) from public;
grant execute on function public.create_workspace(uuid, uuid, text, jsonb) to service_role;
