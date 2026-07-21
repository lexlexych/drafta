-- Every workspace is provisioned with an isolated provider profile before it
-- is persisted. The bootstrap RPC is server-only because it accepts the owner
-- user id and system-managed provider profile ids from the trusted server
-- action, not from a browser session.

revoke all on function public.create_workspace(text) from authenticated;
drop function public.create_workspace(text);

create function public.create_workspace(
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

  return target_workspace_id;
end;
$$;

revoke all on function public.create_workspace(uuid, uuid, text, jsonb) from public;
grant execute on function public.create_workspace(uuid, uuid, text, jsonb) to service_role;

-- Product invariant: one workspace can have at most one channel_connection
-- for a platform, regardless of provider or connection status.
alter table public.channel_connections
  add constraint channel_connections_workspace_platform_key
  unique (workspace_id, platform);
