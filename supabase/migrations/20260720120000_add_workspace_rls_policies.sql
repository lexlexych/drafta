-- Client-side RLS policies for workspace isolation.
-- Server code using SUPABASE_SECRET_KEY bypasses these policies by design.

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members as workspace_member
    where workspace_member.workspace_id = target_workspace_id
      and workspace_member.user_id = auth.uid()
  );
$$;

create or replace function private.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members as workspace_member
    where workspace_member.workspace_id = target_workspace_id
      and workspace_member.user_id = auth.uid()
      and workspace_member.role = 'owner'
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public;
revoke all on function private.is_workspace_owner(uuid) from public;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;

-- Data API grants are separate from RLS. Make the client surface explicit and
-- keep the webhook journal server-only even in projects without default grants.
revoke all on table
  public.workspaces,
  public.workspace_members,
  public.invitations,
  public.channel_connections,
  public.categories,
  public.contacts,
  public.contact_identities,
  public.conversations,
  public.messages,
  public.drafts,
  public.kb_files,
  public.webhook_events,
  public.push_subscriptions,
  public.notification_settings,
  public.ai_settings
from anon;

revoke all on table public.webhook_events from authenticated;

grant select, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table
  public.workspace_members,
  public.invitations,
  public.channel_connections,
  public.categories,
  public.contacts,
  public.contact_identities,
  public.conversations,
  public.messages,
  public.drafts,
  public.kb_files,
  public.push_subscriptions,
  public.notification_settings,
  public.ai_settings
to authenticated;

grant select, insert, update, delete on table
  public.workspaces,
  public.workspace_members,
  public.invitations,
  public.channel_connections,
  public.categories,
  public.contacts,
  public.contact_identities,
  public.conversations,
  public.messages,
  public.drafts,
  public.kb_files,
  public.webhook_events,
  public.push_subscriptions,
  public.notification_settings,
  public.ai_settings
to service_role;

create policy workspaces_select_member
on public.workspaces
for select
to authenticated
using ((select private.is_workspace_member(id)));

create policy workspaces_update_owner
on public.workspaces
for update
to authenticated
using ((select private.is_workspace_owner(id)))
with check ((select private.is_workspace_owner(id)));

create policy workspaces_delete_owner
on public.workspaces
for delete
to authenticated
using ((select private.is_workspace_owner(id)));

create policy workspace_members_select_member
on public.workspace_members
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy workspace_members_insert_owner
on public.workspace_members
for insert
to authenticated
with check ((select private.is_workspace_owner(workspace_id)));

create policy workspace_members_update_owner
on public.workspace_members
for update
to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy workspace_members_delete_owner
on public.workspace_members
for delete
to authenticated
using ((select private.is_workspace_owner(workspace_id)));

create policy invitations_select_owner
on public.invitations
for select
to authenticated
using ((select private.is_workspace_owner(workspace_id)));

create policy invitations_insert_owner
on public.invitations
for insert
to authenticated
with check ((select private.is_workspace_owner(workspace_id)));

create policy invitations_update_owner
on public.invitations
for update
to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

create policy invitations_delete_owner
on public.invitations
for delete
to authenticated
using ((select private.is_workspace_owner(workspace_id)));

create policy channel_connections_member_access
on public.channel_connections
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy categories_member_access
on public.categories
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy contacts_member_access
on public.contacts
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy contact_identities_member_access
on public.contact_identities
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy conversations_member_access
on public.conversations
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy messages_member_access
on public.messages
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy drafts_member_access
on public.drafts
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy kb_files_member_access
on public.kb_files
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy ai_settings_member_access
on public.ai_settings
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy push_subscriptions_owner_access
on public.push_subscriptions
for all
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
);

create policy notification_settings_owner_member_access
on public.notification_settings
for all
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
);
