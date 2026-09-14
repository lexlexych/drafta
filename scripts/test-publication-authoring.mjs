// Isolated PostgreSQL contract test; never connects to a configured Supabase project.
// npm install --prefix <temporary-directory> @electric-sql/pglite
// PUBLICATION_SQL_RUNTIME=<temporary-directory> node scripts/test-publication-authoring.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(path.join(process.env.PUBLICATION_SQL_RUNTIME || process.cwd(), "package.json"));
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite();
const w="a0000000-0000-4000-8000-000000000001", other="b0000000-0000-4000-8000-000000000001";
const u="11111111-1111-4111-8111-111111111111", d="a1000000-0000-4000-8000-000000000001", foreignDraft="b1000000-0000-4000-8000-000000000001";
const channel="a2000000-0000-4000-8000-000000000001", foreignChannel="b2000000-0000-4000-8000-000000000001";
await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create schema private; create schema storage;
 create table auth.users(id uuid primary key);
 create table public.workspaces(id uuid primary key);
 create table public.workspace_members(workspace_id uuid,user_id uuid);
 create table public.channel_connections(id uuid primary key,workspace_id uuid,status text);
 create table public.kb_files(id uuid primary key,workspace_id uuid,is_enabled boolean);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(name text,bucket_id text,created_at timestamptz default now());
 create function private.is_workspace_member(w uuid) returns boolean language sql stable as $$select w=nullif(current_setting('test.workspace',true),'')::uuid$$;
 grant usage on schema public,private to authenticated;
 insert into auth.users values('${u}');
 insert into workspaces values('${w}'),('${other}');
 insert into workspace_members values('${w}','${u}');
 insert into channel_connections values('${channel}','${w}','active'),('${foreignChannel}','${other}','active');
`);
// Replication is infrastructure, not part of these transaction/RLS contracts.
const old = (await readFile("supabase/migrations/20260911120000_publication_drafts.sql","utf8")).replace("alter publication supabase_realtime add table public.publication_drafts;","");
await db.exec(old);
await db.exec(await readFile("supabase/migrations/20260914120000_publication_authoring.sql","utf8"));
const input={channelIds:[channel],kbIds:[],kind:"text",language:"Русский",brief:{topic:"Тема",goal:"Цель",cta:"",audience:"",tone:"",description:""},aspectRatio:"4:5",image:{source:"generate",description:"",style:"",colors:"",caption:"",assetId:null,referenceId:null}};
await db.query("insert into publication_drafts(id,workspace_id,created_by,source) values($1,$2,$3,'draft'),($4,$5,$3,'draft')",[d,w,u,foreignDraft,other]);
await db.query("insert into publication_authoring(draft_id,workspace_id,input) values($1,$2,$3),($4,$5,$3)",[d,w,JSON.stringify(input),foreignDraft,other]);
async function rpc(action,p,workspace=w,draft=d){return (await db.query("select publication_authoring_action($1,$2,$3,$4,$5) result",[workspace,draft,action,JSON.stringify(p),u])).rows[0].result;}
let count=0;
async function test(name,fn){await fn();count++;console.log(`PASS ${name}`);}
await test("RLS exposes only own state; jobs and mutation RPC are server-only",async()=>{
 await db.exec(`set test.workspace='${w}'; set role authenticated;`);
 assert.equal((await db.query("select count(*)::int n from publication_authoring")).rows[0].n,1);
 await assert.rejects(()=>db.query("select * from publication_generation_jobs"),/permission denied/);
 await assert.rejects(()=>rpc("save",{revision:0,input,step:1}),/permission denied/);
 await db.exec("reset role");
});
await test("scoped RPC rejects another workspace's draft",()=>assert.rejects(()=>rpc("save",{revision:0,input,step:1},other,d),/draft_not_found/));
await test("foreign and disconnected channels rejected",async()=>{
 await assert.rejects(()=>rpc("save",{revision:0,input:{...input,channelIds:[foreignChannel]},step:1}),/channel_unavailable/);
 await db.query("update channel_connections set status='disconnected' where id=$1",[channel]);
 await assert.rejects(()=>rpc("save",{revision:0,input,step:1}),/channel_unavailable/);
 await db.query("update channel_connections set status='active' where id=$1",[channel]);
});
await test("autosave checks optimistic revision",async()=>{
 assert.equal((await rpc("save",{revision:0,input,step:3})).revision,1);
 await assert.rejects(()=>rpc("save",{revision:0,input,step:1}),/revision_conflict/);
});
let j;
await test("reservation is idempotent and locks edits until completion",async()=>{
 const p={revision:1,kind:"post",requestId:crypto.randomUUID()};j=await rpc("start",p);
 assert.equal((await rpc("start",p)).id,j.id);
 await assert.rejects(()=>rpc("save",{revision:1,input,step:5}),/generation_in_progress/);
});
await test("a failed job retries with persisted text, bounded to three attempts",async()=>{
 const result={title:"Post",variants:[{channelId:channel,body:"Generated"}],assetIds:[]};
 await db.query("update publication_generation_jobs set result=$1 where id=$2",[JSON.stringify(result),j.id]);
 await rpc("fail",{jobId:j.id,error:"Image failed"});
 assert.deepEqual((await rpc("retry",{revision:1,jobId:j.id})).result,result);
 await rpc("fail",{jobId:j.id,error:"Again"});await rpc("retry",{revision:1,jobId:j.id});await rpc("fail",{jobId:j.id,error:"Again"});
 await assert.rejects(()=>rpc("retry",{revision:1,jobId:j.id}),/retry_limit/);
});
await test("generation produces a proposal; acceptance saves it atomically",async()=>{
 j=await rpc("start",{revision:1,kind:"post",requestId:crypto.randomUUID()});
 await db.query("update publication_generation_jobs set result=$1 where id=$2",[JSON.stringify({title:"Post",variants:[{channelId:channel,body:"Generated"}],assetIds:[]}),j.id]);
 await rpc("complete",{jobId:j.id});
 assert.equal((await db.query("select body from publication_drafts where id=$1",[d])).rows[0].body,"");
 await rpc("apply",{revision:1,jobId:j.id});
 assert.equal((await db.query("select body from publication_drafts where id=$1",[d])).rows[0].body,"Generated");
 await assert.rejects(()=>rpc("apply",{revision:2,jobId:j.id}),/revision_conflict/);
});
await test("late duplicate completion cannot overwrite a manual edit",async()=>{
 await rpc("edit",{revision:2,result:{title:"Post",variants:[{channelId:channel,body:"Manual"}],assetIds:[]}});
 await rpc("complete",{jobId:j.id});assert.equal((await db.query("select body from publication_drafts where id=$1",[d])).rows[0].body,"Manual");
});
await test("server limits ideas to twelve across repeated batches",async()=>{
 for(let i=0;i<4;i++){const job=await rpc("start",{revision:3,kind:"ideas",ideasKey:"key",requestId:crypto.randomUUID()});await rpc("complete",{jobId:job.id,ideas:[{topic:"A"},{topic:"B"},{topic:"C"}]});}
 await assert.rejects(()=>rpc("start",{revision:3,kind:"ideas",requestId:crypto.randomUUID()}),/idea_limit/);
 assert.equal((await db.query("select jsonb_array_length(ideas) n from publication_authoring where draft_id=$1",[d])).rows[0].n,12);
});
await test("OAuth import cannot reserve a native draft",async()=>{
 await db.query("update publication_drafts set edited_at=null where id=$1",[d]);
 await assert.rejects(()=>db.query("select reserve_publication_import($1,$2,$3,'digest','{}')",[w,d,crypto.randomUUID()]),/native_draft/);
});
await test("workspace deletion cascades authoring state and generation jobs",async()=>{
 await db.query("delete from workspaces where id=$1",[w]);
 assert.equal((await db.query("select count(*)::int n from publication_authoring where workspace_id=$1",[w])).rows[0].n,0);
 assert.equal((await db.query("select count(*)::int n from publication_generation_jobs where workspace_id=$1",[w])).rows[0].n,0);
});
await db.close();console.log(`${count} PostgreSQL authoring contracts passed.`);
