-- Four authoring formats, prompt revisions and independently tracked publications.
alter table public.publication_drafts drop constraint publication_drafts_kind_check;
alter table public.publication_drafts add constraint publication_drafts_kind_check check(kind in ('image','carousel','text','video'));
alter table public.publication_generation_jobs drop constraint publication_generation_jobs_kind_check;
alter table public.publication_generation_jobs add constraint publication_generation_jobs_kind_check check(kind in ('ideas','post','text','image','outline'));
create or replace function public.publication_authoring_action(w uuid,d uuid,action text,p jsonb,u uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare draft public.publication_drafts; s public.publication_authoring; j public.publication_generation_jobs;
  result_id uuid; next_input jsonb; asset uuid; ids uuid[]; used integer;
begin
  -- Same lock order for every native mutation, including asynchronous completion.
  select * into draft from public.publication_drafts where workspace_id=w and id=d for update;
  if not found or draft.source<>'draft' then raise exception 'draft_not_found'; end if;
  select * into s from public.publication_authoring where workspace_id=w and draft_id=d for update;
  if not found then raise exception 'draft_not_found'; end if;

  if action in ('save','start','apply','edit','retry') and exists(select 1 from public.publication_deliveries where draft_id=d) then raise exception 'publication_locked'; end if;
  if action in ('save','start','apply','edit','retry','discard') then
    if s.revision<>(p->>'revision')::integer then raise exception 'revision_conflict'; end if;
  end if;
  if action in ('save','apply','edit') and s.active_job_id is not null then raise exception 'generation_in_progress'; end if;

  if action='save' then
    next_input:=p->'input';
    if next_input->>'kind' not in ('image','text','carousel','video') then raise exception 'invalid_input'; end if;
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
        jsonb_build_object('input',s.input,'ideas',s.ideas,'variants',s.variants,'assetIds',draft.asset_ids,'title',draft.title,'ideasKey',p->>'ideasKey','revisionRequest',p->'revisionRequest')) returning * into j;
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
      if j.kind='outline' then
        update public.publication_authoring set input=jsonb_set(input,'{slides}',j.result->'slides'),revision=revision+1 where draft_id=d;
      elsif j.kind='ideas' then
        if jsonb_array_length(p->'ideas')<>3 then raise exception 'invalid_ideas'; end if;
        update public.publication_authoring set ideas=ideas||(p->'ideas'),ideas_key=j.snapshot->>'ideasKey' where draft_id=d;
      end if;
      update public.publication_generation_jobs set status='ready',stage='ready',updated_at=now() where id=j.id;
    else
      update public.publication_generation_jobs set status='error',error=p->>'error',updated_at=now() where id=j.id;
    end if;
    update public.publication_authoring set active_job_id=null where draft_id=d;

  elsif action='discard' then
    if s.active_job_id is not null then raise exception 'generation_in_progress'; end if;
    update public.publication_authoring set revision=revision+1,step=case when jsonb_array_length(variants)>0 then 6 else 5 end where draft_id=d;
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


create table public.publication_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  draft_id uuid not null,
  channel_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check(status in ('pending','sending','published','failed','uncertain')),
  snapshot jsonb not null,
  remote_id text,
  published_url text,
  error text,
  media jsonb,
  first_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(draft_id,channel_id),
  foreign key(workspace_id,draft_id) references public.publication_drafts(workspace_id,id) on delete cascade,
  foreign key(workspace_id,channel_id) references public.channel_connections(workspace_id,id) on delete cascade
);
create index publication_deliveries_pending on public.publication_deliveries(status,updated_at);
alter table public.publication_deliveries enable row level security;
revoke all on public.publication_deliveries from anon,authenticated;
grant all on public.publication_deliveries to service_role;
-- No browser grants: snapshots and temporary media URLs are private server data.
create policy publication_deliveries_workspace on public.publication_deliveries for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create function public.queue_publication(w uuid,d uuid,u uuid,channels uuid[],version text)
returns jsonb language plpgsql set search_path='' as $$
declare draft public.publication_drafts; a public.publication_authoring; c public.channel_connections;
  delivery public.publication_deliveries; target uuid; body text; result jsonb:='[]';
begin
  select * into draft from public.publication_drafts where workspace_id=w and id=d for update;
  if not found then raise exception 'draft_not_found'; end if;
  if not exists(select 1 from public.workspace_members where workspace_id=w and user_id=u) then raise exception 'member_unavailable'; end if;
  if draft.kind='video' or draft.status<>'ready' then raise exception 'not_publishable'; end if;
  if coalesce(cardinality(channels),0) not between 1 and 2 or cardinality(channels)<>(select count(distinct x) from unnest(channels) x) then raise exception 'invalid_channels'; end if;
  select * into a from public.publication_authoring where draft_id=d and workspace_id=w for update;
  if draft.source='draft' then
    if a.active_job_id is not null then raise exception 'generation_in_progress'; end if;
    if a.revision::text<>version then raise exception 'revision_conflict'; end if;
  elsif draft.updated_at <> version::timestamptz then raise exception 'revision_conflict'; end if;
  if draft.status='importing' then raise exception 'import_in_progress'; end if;
  if (draft.kind='image' and cardinality(draft.asset_ids)<>1) or (draft.kind='carousel' and cardinality(draft.asset_ids) not between 2 and 10) or (draft.kind='text' and cardinality(draft.asset_ids)<>0) then raise exception 'invalid_assets'; end if;
  foreach target in array channels loop
    select * into c from public.channel_connections where id=target and workspace_id=w and status='active';
    if not found or c.platform not in ('instagram','linkedin') then raise exception 'channel_unavailable'; end if;
    if draft.kind='text' and c.platform='instagram' then raise exception 'instagram_requires_image'; end if;
    if draft.source='draft' then
      select v->>'body' into body from jsonb_array_elements(a.variants) v where v->>'channelId'=target::text;
    else body:=draft.body; end if;
    if body is null or length(trim(body))=0 or length(body)>(case when c.platform='instagram' then 2200 else 3000 end) then raise exception 'invalid_body'; end if;
    select * into delivery from public.publication_deliveries where draft_id=d and channel_id=target for update;
    if found then
      if delivery.status='failed' then
        update public.publication_deliveries set status='pending',error=null,updated_at=now(),created_by=u where id=delivery.id returning * into delivery;
      elsif delivery.status='uncertain' then
        update public.publication_deliveries set status='sending',error=null,updated_at=now(),created_by=u where id=delivery.id returning * into delivery;
      end if;
    else
      insert into public.publication_deliveries(workspace_id,draft_id,channel_id,created_by,snapshot)
      values(w,d,target,u,jsonb_build_object('title',draft.title,'body',body,'kind',draft.kind,'assetIds',draft.asset_ids)) returning * into delivery;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('id',delivery.id,'status',delivery.status));
  end loop;
  update public.publication_drafts set edited_at=coalesce(edited_at,now()) where id=d;
  return result;
end $$;
revoke all on function public.queue_publication(uuid,uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.queue_publication(uuid,uuid,uuid,uuid[],text) to service_role;

create function public.delete_publication_draft(w uuid,d uuid) returns void language plpgsql set search_path='' as $$
declare draft public.publication_drafts;
begin
  select * into draft from public.publication_drafts where workspace_id=w and id=d for update;
  if not found then raise exception 'draft_not_found'; end if;
  if draft.status='importing' or exists(select 1 from public.publication_authoring where draft_id=d and active_job_id is not null)
    or exists(select 1 from public.publication_deliveries where draft_id=d and status in ('pending','sending','uncertain')) then raise exception 'operation_in_progress'; end if;
  delete from public.publication_drafts where workspace_id=w and id=d;
end $$;
revoke all on function public.delete_publication_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_publication_draft(uuid,uuid) to service_role;

-- Once dispatched, the saved content is the immutable source of that publication.
create function public.protect_publishing_draft() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.publication_deliveries where draft_id=old.id)
    and (new.title,new.body,new.kind,new.asset_ids,new.context) is distinct from (old.title,old.body,old.kind,old.asset_ids,old.context)
    then raise exception 'publication_locked'; end if;
  return new;
end $$;
create trigger protect_publishing_draft before update on public.publication_drafts for each row execute function public.protect_publishing_draft();

update storage.buckets set allowed_mime_types=array['image/png','image/jpeg','image/webp','application/pdf'] where id='publication-assets';
create or replace function public.publication_orphan_paths() returns table(path text)
language sql security definer set search_path='' as $$
  select o.name from storage.objects o
  where o.bucket_id='publication-assets' and o.created_at<now()-interval '1 day'
    and not exists(select 1 from public.publication_assets a join public.publication_drafts d on d.workspace_id=a.workspace_id and d.id=a.draft_id
      where a.storage_path=o.name and (exists(select 1 from public.publication_deliveries pd, jsonb_array_elements(pd.media) m where pd.draft_id=d.id and m->>'path'=a.storage_path) or a.id=any(d.asset_ids) or d.context->'brand'->>'logoAssetId'=a.id::text
        or exists(select 1 from public.publication_authoring s where s.draft_id=d.id and
          (s.input->'image'->>'assetId'=a.id::text or s.input->'image'->>'referenceId'=a.id::text))
        or exists(select 1 from public.publication_generation_jobs j where j.draft_id=d.id and
          (j.result->'assetIds' ? a.id::text or j.snapshot->'assetIds' ? a.id::text
           or j.snapshot->'input'->'image'->>'assetId'=a.id::text or j.snapshot->'input'->'image'->>'referenceId'=a.id::text))))
  order by o.created_at limit 100;
$$;
