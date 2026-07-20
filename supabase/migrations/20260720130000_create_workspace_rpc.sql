-- Bootstrap a workspace for an authenticated user without opening direct INSERT
-- access to the tenant tables.

create or replace function public.create_workspace(name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  workspace_name text := pg_catalog.btrim(name);
  new_workspace_id uuid;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to create a workspace';
  end if;

  if workspace_name is null or workspace_name = '' then
    raise exception using
      errcode = '22023',
      message = 'Workspace name must not be empty';
  end if;

  insert into public.workspaces (name)
  values (workspace_name)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, current_user_id, 'owner');

  insert into public.ai_settings (workspace_id)
  values (new_workspace_id);

  return new_workspace_id;
end;
$$;

revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;
