alter table public.publication_deliveries add column check_only boolean not null default false;
-- Durable operation ownership is independent of a Workflow run/step identifier.
alter table public.messages drop constraint messages_delivery_status_check;
alter table public.messages add constraint messages_delivery_status_check check(delivery_status in ('received','pending','sent','delivered','read','failed','uncertain'));
alter table public.comments drop constraint comments_delivery_status_check;
alter table public.comments add constraint comments_delivery_status_check check(delivery_status in ('received','pending','sent','delivered','failed','uncertain'));
alter table public.comment_private_replies drop constraint comment_private_replies_status_check;
alter table public.comment_private_replies add constraint comment_private_replies_status_check check(status in ('pending','sent','failed','uncertain'));
create table public.workflow_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,
  subject_id uuid not null,
  resource_id uuid not null,
  attempt_id uuid not null default gen_random_uuid(),
  run_id text,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','uncertain','cancelled')),
  input jsonb not null default '{}',
  checkpoints jsonb not null default '{}',
  effect_started boolean not null default false,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lease_until timestamptz,
  unique (workspace_id, kind, subject_id)
);
alter table public.workflow_operations enable row level security;
create policy workflow_operations_read on public.workflow_operations for select to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = workflow_operations.workspace_id and m.user_id = auth.uid()));
grant select on public.workflow_operations to authenticated;
revoke insert, update, delete on public.workflow_operations from authenticated, anon;
create index workflow_operations_active on public.workflow_operations(workspace_id, status, resource_id);

create function public.reserve_workflow_operation(w uuid, k text, s uuid, r uuid, i jsonb, retry boolean default false, checked boolean default false)
returns public.workflow_operations language plpgsql security definer set search_path = public as $$
declare o public.workflow_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended(w::text || k || s::text, 0));
  select * into o from workflow_operations where workspace_id=w and kind=k and subject_id=s for update;
  if found then
    if o.status in ('queued','running') then return o; end if;
    if not retry then return o; end if;
    if o.status='uncertain' and not checked then raise exception 'workflow_result_uncertain'; end if;
    if o.status='succeeded' and k in ('send-message','send-comment','send-comment-private-reply','auto-reply') then return o; end if;
    update workflow_operations set attempt_id=gen_random_uuid(), run_id=null, status='queued', input=i,
      effect_started=false, error_code=null, lease_until=null, updated_at=now(),
      checkpoints=case when k='generate-draft' then '{}'::jsonb else checkpoints - 'rejected' end
    where id=o.id returning * into o;
  else
    insert into workflow_operations(workspace_id,kind,subject_id,resource_id,input) values(w,k,s,r,i) returning * into o;
  end if;
  return o;
end $$;

create function public.claim_workflow_operation(w uuid, o uuid, a uuid, owner text)
returns text language plpgsql security definer set search_path = public as $$
declare row public.workflow_operations; capacity int;
begin
  perform pg_advisory_xact_lock(hashtextextended(w::text, 1));
  select * into row from workflow_operations where id=o and workspace_id=w and attempt_id=a for update;
  if not found or row.status not in ('queued','running') then return 'stale'; end if;
  if row.run_id is not null and row.run_id<>owner then return 'stale'; end if;
  -- A replay cannot repeat a side effect whose response may have been lost.
  if row.status='running' then return 'stale'; end if;
  if row.kind in ('send-message','send-comment','send-comment-private-reply') and exists(
    select 1 from workflow_operations x where x.workspace_id=w and x.resource_id=row.resource_id
      and x.kind in ('send-message','send-comment','send-comment-private-reply') and x.status='queued'
      and (x.created_at,x.id)<(row.created_at,row.id)
  ) then return 'busy'; end if;
  capacity := case when row.kind='send-push' then 4 else 2 end;
  if exists(select 1 from workflow_operations x where x.workspace_id=w and x.id<>o and x.status='running' and x.resource_id=row.resource_id)
    or (select count(*) from workflow_operations x where x.workspace_id=w and x.status='running'
      and (x.kind='send-push')=(row.kind='send-push')) >= capacity then return 'busy'; end if;
  update workflow_operations set status='running',run_id=owner,lease_until=now()+interval '20 minutes',updated_at=now() where id=o;
  return 'claimed';
end $$;

create function public.finish_workflow_operation(w uuid, o uuid, a uuid, state text, code text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update workflow_operations set status=state,error_code=code,lease_until=null,updated_at=now()
  where workspace_id=w and id=o and attempt_id=a and status in ('queued','running');
  return found;
end $$;

create function public.checkpoint_workflow_operation(w uuid,o uuid,a uuid,step_key text,result jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update workflow_operations set checkpoints=jsonb_set(checkpoints,array[step_key],result),updated_at=now()
  where workspace_id=w and id=o and attempt_id=a and status='running' and lease_until>now();
  return found;
end $$;

create function public.begin_workflow_effect(w uuid,o uuid,a uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update workflow_operations set effect_started=true,updated_at=now()
  where workspace_id=w and id=o and attempt_id=a and status='running' and not effect_started and lease_until>now();
  return found;
end $$;

revoke all on function public.reserve_workflow_operation(uuid,text,uuid,uuid,jsonb,boolean,boolean) from public,anon,authenticated;
revoke all on function public.claim_workflow_operation(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finish_workflow_operation(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.checkpoint_workflow_operation(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.begin_workflow_effect(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_workflow_operation(uuid,text,uuid,uuid,jsonb,boolean,boolean) to service_role;
grant execute on function public.claim_workflow_operation(uuid,uuid,uuid,text) to service_role;
grant execute on function public.finish_workflow_operation(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.checkpoint_workflow_operation(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.begin_workflow_effect(uuid,uuid,uuid) to service_role;
alter publication supabase_realtime add table public.workflow_operations;

-- The decision journal distinguishes queue acceptance from actual delivery.
alter table public.auto_reply_runs drop constraint auto_reply_runs_outcome_check;
alter table public.auto_reply_runs add constraint auto_reply_runs_outcome_check check (outcome in
 ('sent','queued','disabled','no_text','below_threshold','no_template','template_missing','no_template_language','cancelled_by_operator','repeat_scenario','superseded','failed'));
create function public.workflow_auto_reply_delivery() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='auto_reply_runs' then
   if new.outcome='queued' and exists(select 1 from messages where id=new.reply_message_id and workspace_id=new.workspace_id and delivery_status in ('sent','delivered','read')) then new.outcome:='sent'; end if;
 else
   if new.delivery_status in ('sent','delivered','read') then
     update auto_reply_runs set outcome='sent' where workspace_id=new.workspace_id and reply_message_id=new.id and outcome='queued';
   end if;
 end if;
 return new;
end $$;
revoke all on function public.workflow_auto_reply_delivery() from public,anon,authenticated;
create trigger workflow_auto_reply_insert before insert on public.auto_reply_runs for each row execute function public.workflow_auto_reply_delivery();
create trigger workflow_auto_reply_sent after update of delivery_status on public.messages for each row execute function public.workflow_auto_reply_delivery();
grant all on public.workflow_operations to service_role;

create function public.touch_workflow_operation(w uuid,o uuid,a uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update workflow_operations set lease_until=now()+interval '20 minutes'
 where workspace_id=w and id=o and attempt_id=a and status='running' and lease_until>now();
 return found;
end $$;
revoke all on function public.touch_workflow_operation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.touch_workflow_operation(uuid,uuid,uuid) to service_role;

create function public.fail_workflow_import(w uuid,i uuid) returns void language plpgsql security definer set search_path=public as $$
declare j public.publication_imports;
begin
 select * into j from publication_imports where workspace_id=w and id=i for update;
 if not found or j.status<>'pending' then return; end if;
 update publication_imports set status='error' where id=i;
 update publication_drafts set status='error',updated_at=now() where workspace_id=w and id=j.draft_id and active_import_id=i and edited_at is null;
end $$;
create function public.retry_workflow_import(w uuid,d uuid,i uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare j public.publication_imports;
begin
 perform 1 from publication_drafts where workspace_id=w and id=d and active_import_id=i and edited_at is null for update;
 if not found then return false; end if;
 select * into j from publication_imports where workspace_id=w and id=i and draft_id=d for update;
 if not found or j.status<>'error' or j.payload is null or j.created_at<now()-interval '270 seconds' then return false; end if;
 update publication_imports set status='pending' where id=i;
 update publication_drafts set status='importing',updated_at=now() where id=d and workspace_id=w;
 return true;
end $$;
revoke all on function public.fail_workflow_import(uuid,uuid),public.retry_workflow_import(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_workflow_import(uuid,uuid),public.retry_workflow_import(uuid,uuid,uuid) to service_role;
