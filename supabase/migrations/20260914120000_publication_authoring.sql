-- The native authoring flow and OAuth imports have separate mutation paths.
alter table public.publication_drafts add column source text not null default 'chatgpt' check (source in ('chatgpt','draft'));
alter table public.publication_drafts drop constraint publication_drafts_kind_check;
alter table public.publication_drafts add constraint publication_drafts_kind_check check (kind in ('image','carousel','text'));

create table public.publication_authoring (
  draft_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  input jsonb not null,
  revision integer not null default 0,
  step integer not null default 1 check (step between 1 and 6),
  ideas jsonb not null default '[]' check (jsonb_array_length(ideas)<=12),
  ideas_key text not null default '',
  active_job_id uuid,
  variants jsonb not null default '[]',
  foreign key(workspace_id,draft_id) references public.publication_drafts(workspace_id,id) on delete cascade
);
create table public.publication_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  draft_id uuid not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  kind text not null check(kind in ('ideas','post','text','image')),
  input_revision integer not null,
  snapshot jsonb not null,
  status text not null default 'pending' check(status in ('pending','ready','error')),
  stage text not null default 'queued',
  result jsonb,
  usage jsonb not null default '[]',
  error text,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,request_id),
  foreign key(workspace_id,draft_id) references public.publication_drafts(workspace_id,id) on delete cascade
);
create index publication_jobs_pending on public.publication_generation_jobs(status,updated_at);
create index publication_jobs_workspace_created on public.publication_generation_jobs(workspace_id,created_at);
alter table public.publication_authoring enable row level security;
alter table public.publication_generation_jobs enable row level security;
revoke all on public.publication_authoring, public.publication_generation_jobs from anon,authenticated;
grant select on public.publication_authoring to authenticated;
grant all on public.publication_authoring, public.publication_generation_jobs to service_role;
create policy publication_authoring_read on public.publication_authoring for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
-- Snapshots and token accounting are accessible through the scoped application route only.

create function public.publication_authoring_action(w uuid,d uuid,action text,p jsonb,u uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare draft public.publication_drafts; s public.publication_authoring; j public.publication_generation_jobs;
  result_id uuid; next_input jsonb; asset uuid; ids uuid[]; used integer;
begin
  -- Same lock order for every native mutation, including asynchronous completion.
  select * into draft from public.publication_drafts where workspace_id=w and id=d for update;
  if not found or draft.source<>'draft' then raise exception 'draft_not_found'; end if;
  select * into s from public.publication_authoring where workspace_id=w and draft_id=d for update;
  if not found then raise exception 'draft_not_found'; end if;

  if action in ('save','start','apply','edit','retry') then
    if s.revision<>(p->>'revision')::integer then raise exception 'revision_conflict'; end if;
  end if;
  if action in ('save','apply','edit') and s.active_job_id is not null then raise exception 'generation_in_progress'; end if;

  if action='save' then
    next_input:=p->'input';
    if next_input->>'kind' not in ('image','text') then raise exception 'invalid_input'; end if;
    if exists(select 1 from jsonb_array_elements_text(next_input->'channelIds') x where not exists (
      select 1 from public.channel_connections c where c.workspace_id=w and c.id=x::uuid and c.status='active'
    )) then raise exception 'channel_unavailable'; end if;
    if exists(select 1 from jsonb_array_elements_text(next_input->'kbIds') x where not exists (
      select 1 from public.kb_files k where k.workspace_id=w and k.id=x::uuid and k.is_enabled
    )) then raise exception 'knowledge_unavailable'; end if;
    foreach asset in array array[(next_input->'image'->>'assetId')::uuid,(next_input->'image'->>'referenceId')::uuid] loop
      if asset is not null and not exists(select 1 from public.publication_assets a where a.id=asset and a.workspace_id=w and a.draft_id=d)
        then raise exception 'invalid_assets'; end if;
    end loop;
    update public.publication_authoring set input=next_input,step=(p->>'step')::integer,revision=revision+1 where draft_id=d;
    update public.publication_drafts set updated_at=now() where id=d;

  elsif action='start' then
    select * into j from public.publication_generation_jobs where workspace_id=w and request_id=(p->>'requestId')::uuid;
    if found then
      if j.draft_id<>d or j.kind<>p->>'kind' then raise exception 'request_conflict'; end if;
      return to_jsonb(j);
    end if;
    if s.active_job_id is not null then raise exception 'generation_in_progress'; end if;
    if p->>'kind'='ideas' and jsonb_array_length(s.ideas)>=12 then raise exception 'idea_limit'; end if;
    -- Serialize the workspace budget check across different drafts as well.
    perform pg_advisory_xact_lock(hashtextextended(w::text,731));
    select count(*) into used from public.publication_generation_jobs where workspace_id=w and created_at>now()-interval '1 day';
    if used>=100 then raise exception 'daily_limit'; end if;
    if not exists(select 1 from public.workspace_members where workspace_id=w and user_id=u) then raise exception 'member_unavailable'; end if;
    insert into public.publication_generation_jobs(workspace_id,draft_id,created_by,request_id,kind,input_revision,snapshot)
      values(w,d,u,(p->>'requestId')::uuid,p->>'kind',s.revision,
        jsonb_build_object('input',s.input,'ideas',s.ideas,'variants',s.variants,'assetIds',draft.asset_ids,'title',draft.title,'ideasKey',p->>'ideasKey')) returning * into j;
    update public.publication_authoring set active_job_id=j.id where draft_id=d;
    return to_jsonb(j);

  elsif action='retry' then
    if s.active_job_id is not null then raise exception 'generation_in_progress'; end if;
    select * into j from public.publication_generation_jobs where workspace_id=w and draft_id=d and id=(p->>'jobId')::uuid for update;
    if not found or j.status<>'error' or j.input_revision<>s.revision then raise exception 'revision_conflict'; end if;
    if j.attempts>=3 then raise exception 'retry_limit'; end if;
    update public.publication_generation_jobs set status='pending',error=null,attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
    update public.publication_authoring set active_job_id=j.id where draft_id=d;
    return to_jsonb(j);

  elsif action in ('complete','fail') then
    select * into j from public.publication_generation_jobs where workspace_id=w and draft_id=d and id=(p->>'jobId')::uuid for update;
    if not found or j.status<>'pending' or s.active_job_id is distinct from j.id then return '{}'::jsonb; end if;
    if action='complete' then
      if j.kind='ideas' then
        if jsonb_array_length(p->'ideas')<>3 then raise exception 'invalid_ideas'; end if;
        update public.publication_authoring set ideas=ideas||(p->'ideas'),ideas_key=j.snapshot->>'ideasKey' where draft_id=d;
      end if;
      update public.publication_generation_jobs set status='ready',stage='ready',updated_at=now() where id=j.id;
    else
      update public.publication_generation_jobs set status='error',error=p->>'error',updated_at=now() where id=j.id;
    end if;
    update public.publication_authoring set active_job_id=null where draft_id=d;

  elsif action in ('apply','edit') then
    if action='apply' then
      select * into j from public.publication_generation_jobs where workspace_id=w and draft_id=d and id=(p->>'jobId')::uuid;
      if not found or j.status<>'ready' or j.kind='ideas' or j.input_revision<>s.revision then raise exception 'revision_conflict'; end if;
      next_input:=j.result;
    else next_input:=p->'result'; end if;
    select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(next_input->'assetIds');
    if exists(select 1 from unnest(ids) a where not exists(select 1 from public.publication_assets x where x.id=a and x.workspace_id=w and x.draft_id=d)) then raise exception 'invalid_assets'; end if;
    update public.publication_drafts set title=next_input->>'title',body=next_input->'variants'->0->>'body',
      kind=s.input->>'kind',asset_ids=ids,status='ready',edited_at=now(),updated_at=now() where id=d;
    update public.publication_authoring set variants=next_input->'variants',revision=revision+1,step=6 where draft_id=d;
  else raise exception 'invalid_action'; end if;
  select * into s from public.publication_authoring where draft_id=d;
  return to_jsonb(s);
end $$;
revoke all on function public.publication_authoring_action(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.publication_authoring_action(uuid,uuid,text,jsonb,uuid) to service_role;

-- Protect native drafts even if an old client calls the legacy RPC directly.
create function public.protect_native_publication() returns trigger language plpgsql set search_path='' as $$
begin
  if new.source='draft' and new.status='importing' then raise exception 'native_draft'; end if;
  return new;
end $$;
create trigger protect_native_publication before update on public.publication_drafts for each row execute function public.protect_native_publication();

create or replace function public.publication_orphan_paths() returns table(path text)
language sql security definer set search_path='' as $$
  select o.name from storage.objects o
  where o.bucket_id='publication-assets' and o.created_at<now()-interval '1 day'
    and not exists(select 1 from public.publication_assets a join public.publication_drafts d on d.workspace_id=a.workspace_id and d.id=a.draft_id
      where a.storage_path=o.name and (a.id=any(d.asset_ids) or d.context->'brand'->>'logoAssetId'=a.id::text
        or exists(select 1 from public.publication_authoring s where s.draft_id=d.id and
          (s.input->'image'->>'assetId'=a.id::text or s.input->'image'->>'referenceId'=a.id::text))
        or exists(select 1 from public.publication_generation_jobs j where j.draft_id=d.id and
          (j.result->'assetIds' ? a.id::text or j.snapshot->'assetIds' ? a.id::text
           or j.snapshot->'input'->'image'->>'assetId'=a.id::text or j.snapshot->'input'->'image'->>'referenceId'=a.id::text))))
  order by o.created_at limit 100;
$$;
