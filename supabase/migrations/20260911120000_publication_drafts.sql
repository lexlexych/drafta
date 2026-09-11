-- Draft authoring is independent of synchronized social-network posts.
create table public.publication_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Новая публикация',
  body text not null default '',
  kind text not null default 'image' check (kind in ('image', 'carousel')),
  context jsonb not null default '{}',
  asset_ids uuid[] not null default '{}',
  status text not null default 'waiting' check (status in ('waiting','importing','ready','error')),
  edited_at timestamptz,
  active_import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, id)
);
create index publication_drafts_workspace_created on public.publication_drafts(workspace_id, created_at desc);

create table public.publication_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  draft_id uuid not null,
  storage_path text not null unique,
  mime_type text not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, draft_id) references public.publication_drafts(workspace_id,id) on delete cascade
);

create table public.gpt_oauth_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kb_ids uuid[] not null default '{}',
  code_hash text unique,
  code_expires_at timestamptz not null,
  redirect_uri text not null,
  code_challenge text,
  access_hash text unique,
  access_expires_at timestamptz,
  refresh_hash text unique,
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.publication_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  draft_id uuid not null,
  request_id uuid not null,
  digest text not null,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending','ready','error')),
  created_at timestamptz not null default now(),
  unique(workspace_id,request_id),
  foreign key (workspace_id,draft_id) references public.publication_drafts(workspace_id,id) on delete cascade
);

alter table public.publication_drafts enable row level security;
alter table public.publication_assets enable row level security;
alter table public.gpt_oauth_grants enable row level security;
alter table public.publication_imports enable row level security;
revoke all on public.publication_drafts, public.publication_assets, public.gpt_oauth_grants, public.publication_imports from anon, authenticated;
grant select on public.publication_drafts, public.publication_assets to authenticated;
grant all on public.publication_drafts, public.publication_assets, public.gpt_oauth_grants, public.publication_imports to service_role;
create policy publication_drafts_read on public.publication_drafts for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy publication_assets_read on public.publication_assets for select to authenticated using ((select private.is_workspace_member(workspace_id)));
-- Secret-bearing grants/import URLs intentionally have no browser policies.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('publication-assets','publication-assets',false,10485760,array['image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;
-- Storage is accessed through authenticated application routes only.

create function public.reserve_publication_import(w uuid, d uuid, r uuid, h text, p jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare draft public.publication_drafts; previous public.publication_imports; result uuid;
begin
  select * into draft from public.publication_drafts where workspace_id=w and id=d for update;
  if not found then raise exception 'draft_not_found'; end if;
  select * into previous from public.publication_imports where workspace_id=w and request_id=r;
  if found then
    if previous.digest <> h or previous.draft_id <> d then raise exception 'request_conflict'; end if;
    return previous.id;
  end if;
  if draft.edited_at is not null then raise exception 'draft_edited'; end if;
  if draft.status='importing' then raise exception 'import_in_progress'; end if;
  insert into public.publication_imports(workspace_id,draft_id,request_id,digest,payload)
    values(w,d,r,h,p) returning id into result;
  update public.publication_drafts set status='importing',active_import_id=result,updated_at=now() where id=d;
  return result;
end $$;

create function public.finish_publication_import(w uuid, i uuid, a uuid[], failed boolean default false)
returns void language plpgsql set search_path = '' as $$
declare job public.publication_imports; draft public.publication_drafts;
begin
  select * into job from public.publication_imports where workspace_id=w and id=i;
  if not found then return; end if;
  select * into draft from public.publication_drafts where workspace_id=w and id=job.draft_id for update;
  if not found then return; end if;
  -- A concurrent completion may have committed while we waited for the draft.
  select * into job from public.publication_imports where workspace_id=w and id=i for update;
  if not found or job.status <> 'pending' then return; end if;
  if draft.active_import_id <> i or draft.edited_at is not null then failed := true; end if;
  if not failed then
    if exists(select 1 from unnest(a) asset where not exists (
      select 1 from public.publication_assets where id=asset and workspace_id=w and draft_id=draft.id
    )) then raise exception 'invalid_assets'; end if;
    update public.publication_drafts set body=job.payload->>'text',title=job.payload->>'title',
      kind=job.payload->>'kind',asset_ids=a,status='ready',updated_at=now() where id=draft.id;
  elsif draft.active_import_id=i then
    update public.publication_drafts set status='error',updated_at=now() where id=draft.id;
  end if;
  update public.publication_imports set status=case when failed then 'error' else 'ready' end, payload=null where id=i;
end $$;

create function public.edit_publication_draft(w uuid, d uuid, content jsonb default null)
returns void language plpgsql set search_path = '' as $$
declare draft public.publication_drafts; ids uuid[];
begin
  select * into draft from public.publication_drafts where workspace_id=w and id=d for update;
  if not found then raise exception 'draft_not_found'; end if;
  if draft.status='importing' then raise exception 'import_in_progress'; end if;
  if content is not null then
    select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(content->'asset_ids');
    if exists(select 1 from unnest(ids) asset where not exists (
      select 1 from public.publication_assets where id=asset and workspace_id=w and draft_id=d
    )) then raise exception 'invalid_assets'; end if;
    update public.publication_drafts set title=content->>'title',body=content->>'body',asset_ids=ids,
      kind=content->>'kind',context=coalesce(content->'context',draft.context),status='ready' where id=d;
  end if;
  update public.publication_drafts set edited_at=coalesce(edited_at,now()),updated_at=now() where id=d;
end $$;
revoke all on function public.reserve_publication_import(uuid,uuid,uuid,text,jsonb), public.finish_publication_import(uuid,uuid,uuid[],boolean), public.edit_publication_draft(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_publication_import(uuid,uuid,uuid,text,jsonb), public.finish_publication_import(uuid,uuid,uuid[],boolean), public.edit_publication_draft(uuid,uuid,jsonb) to service_role;

create function public.configure_publication_draft(w uuid,d uuid,t text,k text,c jsonb)
returns void language plpgsql set search_path='' as $$
declare draft public.publication_drafts;
begin
  select * into draft from public.publication_drafts where workspace_id=w and id=d for update;
  if not found then raise exception 'draft_not_found'; end if;
  if draft.status='importing' then raise exception 'import_in_progress'; end if;
  update public.publication_drafts set title=t,kind=k,context=c,updated_at=now(),
    edited_at=case when draft.status='ready' and (draft.title<>t or draft.kind<>k)
      then coalesce(draft.edited_at,now()) else draft.edited_at end
  where id=d;
end $$;
revoke all on function public.configure_publication_draft(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.configure_publication_draft(uuid,uuid,text,text,jsonb) to service_role;
alter publication supabase_realtime add table public.publication_drafts;

alter table public.gpt_oauth_grants add column rate_start timestamptz not null default now();
alter table public.gpt_oauth_grants add column rate_count integer not null default 0;
create function public.limit_gpt_request(g uuid) returns boolean language plpgsql set search_path='' as $$
declare used integer;
begin
  update public.gpt_oauth_grants set
    rate_count=case when rate_start < now()-interval '1 minute' then 1 else rate_count+1 end,
    rate_start=case when rate_start < now()-interval '1 minute' then now() else rate_start end
  where id=g and revoked_at is null returning rate_count into used;
  return coalesce(used <= 60,false);
end $$;
revoke all on function public.limit_gpt_request(uuid) from public,anon,authenticated;
grant execute on function public.limit_gpt_request(uuid) to service_role;

-- Orphan media includes replaced slides and blobs left after workspace cascades.
-- The grace period protects uploads not yet attached by an open editor.
create function public.publication_orphan_paths() returns table(path text)
language sql security definer set search_path='' as $$
  select o.name from storage.objects o
  where o.bucket_id='publication-assets' and o.created_at < now()-interval '1 day'
    and not exists (
      select 1 from public.publication_assets a join public.publication_drafts d
      on d.workspace_id=a.workspace_id and d.id=a.draft_id
      where a.storage_path=o.name
        and (a.id=any(d.asset_ids) or d.context->'brand'->>'logoAssetId'=a.id::text)
    )
  order by o.created_at limit 100;
$$;
revoke all on function public.publication_orphan_paths() from public,anon,authenticated;
grant execute on function public.publication_orphan_paths() to service_role;
