-- Run after local migrations and seed with supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(4);
insert into workspaces(id,name) values ('c0000000-0000-4000-8000-000000000001','Publication tests');
insert into workspace_members(workspace_id,user_id,role) values ('c0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','owner');
insert into channel_connections(id,workspace_id,name,provider,platform,external_id,status) values ('c1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','Instagram','zernio','instagram','ig','active'),('c1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001','LinkedIn','zernio','linkedin','li','active');
insert into publication_drafts(id,workspace_id,created_by,source,kind,status,title,body) values ('c2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','draft','text','ready','Test','Hello');
insert into publication_authoring(draft_id,workspace_id,input,variants) values ('c2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','{"kind":"text","channelIds":["c1000000-0000-4000-8000-000000000002"],"kbIds":[],"image":{"assetId":null,"referenceId":null}}','[{"channelId":"c1000000-0000-4000-8000-000000000002","body":"Hello"}]');
do $$ begin
 begin perform queue_publication('c0000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',array['c1000000-0000-4000-8000-000000000001'::uuid],'0');raise exception 'Expected Instagram rejection';exception when others then if sqlerrm <> 'instagram_requires_image' then raise;end if;end;
 begin perform queue_publication('b0000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',array['c1000000-0000-4000-8000-000000000002'::uuid],'0');raise exception 'Expected isolation rejection';exception when others then if sqlerrm <> 'draft_not_found' then raise;end if;end;
 begin perform queue_publication('c0000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',array['c1000000-0000-4000-8000-000000000002'::uuid],'7');raise exception 'Expected stale revision rejection';exception when others then if sqlerrm <> 'revision_conflict' then raise;end if;end;
end $$;
select queue_publication('c0000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',array['c1000000-0000-4000-8000-000000000002'::uuid],'0');
select queue_publication('c0000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',array['c1000000-0000-4000-8000-000000000002'::uuid],'0');
do $$ begin
 if (select count(*) from publication_deliveries)<>1 then raise exception 'Duplicate delivery';end if;
 begin perform delete_publication_draft('c0000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001');raise exception 'Expected active delete rejection';exception when others then if sqlerrm <> 'operation_in_progress' then raise;end if;end;
 begin update publication_drafts set body='changed';raise exception 'Expected immutable snapshot rejection';exception when others then if sqlerrm <> 'publication_locked' then raise;end if;end;
end $$;
update publication_deliveries set status='published';
select queue_publication('c0000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',array['c1000000-0000-4000-8000-000000000002'::uuid],'0');
do $$ begin if (select status from publication_deliveries)<>'published' then raise exception 'Published target requeued';end if;end $$;
select delete_publication_draft('c0000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001');
do $$ begin if exists(select 1 from publication_deliveries) then raise exception 'Cascade failed';end if;end $$;
select pass('platform validation, workspace isolation, revision checking, idempotency, immutable content, deletion locks and cascades');
set local role authenticated;
select throws_ok('select * from public.publication_deliveries','42501',null,'browser cannot read delivery snapshots or signed URLs');
select throws_ok($$select queue_publication(null,null,null,null,null)$$,'42501',null,'browser cannot call the dispatch RPC');
select throws_ok($$select delete_publication_draft(null,null)$$,'42501',null,'browser cannot bypass deletion checks');
reset role;
select * from finish();
rollback;