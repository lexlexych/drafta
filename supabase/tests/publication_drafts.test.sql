-- Run with `supabase test db` after local migrations and seed.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(15);
insert into public.publication_drafts(id,workspace_id,created_by) values
 ('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111'),
 ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222');
insert into public.publication_assets(id,workspace_id,draft_id,storage_path,mime_type) values
 ('a2000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','test/a','image/png'),
 ('b2000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','test/b','image/png');

set local role authenticated;
set local request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.publication_drafts where id='a1000000-0000-4000-8000-000000000001'),1,'own draft visible');
select is((select count(*)::int from public.publication_drafts where id='b1000000-0000-4000-8000-000000000001'),0,'foreign draft invisible');
select is((select count(*)::int from public.publication_assets where id='b2000000-0000-4000-8000-000000000001'),0,'foreign assets invisible');
select throws_ok('select * from public.gpt_oauth_grants','42501',null,'OAuth secrets inaccessible');
select throws_ok('select * from public.publication_imports','42501',null,'temporary file URLs inaccessible');
select throws_ok($$select public.edit_publication_draft('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001')$$,'42501',null,'browser cannot call service RPC');
reset role;

create temporary table test_job as select public.reserve_publication_import(
 'a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
 'a3000000-0000-4000-8000-000000000001','digest', '{"text":"Imported","title":"Title","kind":"image"}'::jsonb) id;
select is((select status from public.publication_drafts where id='a1000000-0000-4000-8000-000000000001'),'importing','reservation marks importing');
select is(public.reserve_publication_import('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','digest','{}'),(select id from test_job),'same request id is idempotent');
select throws_ok($$select public.reserve_publication_import('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','changed','{}')$$,'P0001','request_conflict','changed content cannot reuse request id');
select throws_ok($$select public.edit_publication_draft('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001')$$,'P0001','import_in_progress','editing cannot race active import');
select throws_ok($$select public.finish_publication_import('a0000000-0000-4000-8000-000000000001',(select id from test_job),array['b2000000-0000-4000-8000-000000000001'::uuid])$$,'P0001','invalid_assets','foreign asset cannot be attached');
select public.finish_publication_import('a0000000-0000-4000-8000-000000000001',(select id from test_job),array['a2000000-0000-4000-8000-000000000001'::uuid]);
select is((select body from public.publication_drafts where id='a1000000-0000-4000-8000-000000000001'),'Imported','import finishes with body');
select ok((select payload is null from public.publication_imports where id=(select id from test_job)),'temporary URLs removed after completion');
select public.edit_publication_draft('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.reserve_publication_import('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002','new','{}')$$,'P0001','draft_edited','GPT cannot overwrite after manual edit starts');
select throws_ok($$select public.reserve_publication_import('b0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003','new','{}')$$,'P0001','draft_not_found','RPC enforces workspace identity');
select * from finish();
rollback;
