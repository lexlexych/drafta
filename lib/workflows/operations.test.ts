import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

// Execute the actual migration against PostgreSQL, without a cloud database.
const db=new PGlite();
const w='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const user='20000000-0000-4000-8000-000000000001';
const subject='30000000-0000-4000-8000-000000000001';
type Row={id:string;attempt_id:string;status:string;checkpoints:Record<string,unknown>};
async function reserve(kind='send-message',s=subject,retry=false,checked=false) {
  const {rows}=await db.query<Row>('select * from reserve_workflow_operation($1,$2,$3,$3,$4,$5,$6)',[w,kind,s,{workspaceId:w,messageId:s},retry,checked]);
  return rows[0];
}
async function claim(row:Row,owner='run-one') {
  const {rows}=await db.query<{result:string}>('select claim_workflow_operation($1,$2,$3,$4) result',[w,row.id,row.attempt_id,owner]);return rows[0].result;
}
beforeAll(async()=>{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table workspaces(id uuid primary key);
    create table workspace_members(workspace_id uuid,user_id uuid);
    grant select on workspace_members to authenticated;
    create table messages(id uuid primary key,workspace_id uuid,delivery_status text constraint messages_delivery_status_check check(delivery_status in ('pending','sent')));
    create table comments(delivery_status text constraint comments_delivery_status_check check(delivery_status in ('pending','sent')));
    create table comment_private_replies(status text constraint comment_private_replies_status_check check(status in ('pending','sent')));
    create table publication_deliveries(id uuid);
    create table publication_imports(id uuid,workspace_id uuid,draft_id uuid,status text,payload jsonb,created_at timestamptz default now());
    create table publication_drafts(id uuid,workspace_id uuid,active_import_id uuid,status text,updated_at timestamptz,edited_at timestamptz);
    create table auto_reply_runs(workspace_id uuid,reply_message_id uuid,outcome text constraint auto_reply_runs_outcome_check check(outcome in ('sent','failed')));
    create publication supabase_realtime;
  `);
  await db.exec(readFileSync('supabase/migrations/20260919100000_workflow_operations.sql','utf8'));
  await db.query('insert into workspaces values ($1),($2)',[w,other]);
  await db.query('insert into workspace_members values ($1,$2)',[w,user]);
},60_000);
afterAll(async()=>{await db.close();});

describe('workflow operation ownership in PostgreSQL',()=>{
  it('deduplicates simultaneous reservations and permits only one run owner',async()=>{
    const [a,b]=await Promise.all([reserve(),reserve()]);expect(a.attempt_id).toBe(b.attempt_id);
    expect(await claim(a)).toBe('claimed');expect(await claim(b,'run-two')).toBe('stale');
  });
  it('fences side effects and requires explicit confirmation of uncertain delivery',async()=>{
    const row=await reserve();
    const begin=()=>db.query<{ok:boolean}>('select begin_workflow_effect($1,$2,$3) ok',[w,row.id,row.attempt_id]);
    expect((await begin()).rows[0].ok).toBe(true);expect((await begin()).rows[0].ok).toBe(false);
    await db.query("select finish_workflow_operation($1,$2,$3,'uncertain',null)",[w,row.id,row.attempt_id]);
    await expect(reserve('send-message',subject,true)).rejects.toThrow('workflow_result_uncertain');
    const next=await reserve('send-message',subject,true,true);expect(next.attempt_id).not.toBe(row.attempt_id);
    expect(await claim(row)).toBe('stale');
    const stale=await db.query<{ok:boolean}>("select finish_workflow_operation($1,$2,$3,'failed',null) ok",[w,row.id,row.attempt_id]);expect(stale.rows[0].ok).toBe(false);
  });
  it('serializes a resource and caps workspace concurrency',async()=>{
    const a=await reserve();expect(await claim(a)).toBe('claimed');
    const same=await reserve('generate-draft');expect(await claim(same)).toBe('busy');
    const b=await reserve('generate-draft','30000000-0000-4000-8000-000000000002');expect(await claim(b)).toBe('claimed');
    const c=await reserve('generate-draft','30000000-0000-4000-8000-000000000003');expect(await claim(c)).toBe('busy');
    await db.query("select finish_workflow_operation($1,$2,$3,'succeeded',null)",[w,a.id,a.attempt_id]);
    expect(await claim(c)).toBe('claimed');
    expect((await reserve('send-message',subject,true)).status).toBe('succeeded');
  });
  it('preserves completed delivery checkpoints but resets rejection and draft IDs on retry',async()=>{
    const row=await reserve('generate-draft','30000000-0000-4000-8000-000000000002');
    await db.query("select checkpoint_workflow_operation($1,$2,$3,'create-generating','\"40000000-0000-4000-8000-000000000001\"')",[w,row.id,row.attempt_id]);
    await db.query("select finish_workflow_operation($1,$2,$3,'failed',null)",[w,row.id,row.attempt_id]);
    expect((await reserve('generate-draft','30000000-0000-4000-8000-000000000002',true)).checkpoints).toEqual({});
  });
  it('isolates workspace reads and denies member writes and service RPCs',async()=>{
    await db.query("insert into workflow_operations(workspace_id,kind,subject_id,resource_id) values($1,'send-message',$2,$2)",[other,subject]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
    try {
      const rows=await db.query<{workspace_id:string}>('select workspace_id from workflow_operations');expect(rows.rows.length).toBeGreaterThan(0);expect(rows.rows.every(r=>r.workspace_id===w)).toBe(true);
      await expect(db.exec("update workflow_operations set status='succeeded'")).rejects.toThrow('permission denied');
      await expect(reserve()).rejects.toThrow('permission denied');
    } finally {await db.exec('reset role');}
  });
  it('records auto-reply delivery only after confirmation, in either insertion order',async()=>{
    await db.query("insert into messages values($1,$2,'pending')",[subject,w]);
    await db.query("insert into auto_reply_runs values($1,$2,'queued')",[w,subject]);
    expect((await db.query<{outcome:string}>('select outcome from auto_reply_runs')).rows[0].outcome).toBe('queued');
    await db.query("update messages set delivery_status='sent' where id=$1",[subject]);
    await db.query("insert into auto_reply_runs values($1,$2,'queued')",[w,subject]);
    expect((await db.query<{outcome:string}>('select outcome from auto_reply_runs')).rows.map(r=>r.outcome)).toEqual(['sent','sent']);
  });
  it('cascades operation deletion with a workspace',async()=>{
    await db.query('delete from workspaces where id=$1',[other]);
    expect((await db.query('select * from workflow_operations where workspace_id=$1',[other])).rows).toEqual([]);
  });
  it('preserves fresh import payloads for manual continuation and rejects expired links',async()=>{
    await db.query("insert into publication_drafts(id,workspace_id,active_import_id,status) values($1,$2,$1,'importing')",[subject,w]);
    await db.query("insert into publication_imports(id,workspace_id,draft_id,status,payload) values($1,$2,$1,'pending','{}')",[subject,w]);
    await db.query('select fail_workflow_import($1,$2)',[w,subject]);
    const failed=await db.query<{status:string;payload:unknown}>('select status,payload from publication_imports');expect(failed.rows[0]).toEqual({status:'error',payload:{}});
    expect((await db.query<{ok:boolean}>('select retry_workflow_import($1,$2,$2) ok',[w,subject])).rows[0].ok).toBe(true);
    await db.query('select fail_workflow_import($1,$2)',[w,subject]);
    await db.exec("update publication_imports set created_at=now()-interval '5 minutes'");
    expect((await db.query<{ok:boolean}>('select retry_workflow_import($1,$2,$2) ok',[w,subject])).rows[0].ok).toBe(false);
  });
  it('refuses effects, checkpoints and renewal from an expired owner',async()=>{
    const row=await reserve('post-thumbnail','30000000-0000-4000-8000-000000000099');
    await db.query("update workflow_operations set status='running',lease_until=now()-interval '1 second' where id=$1",[row.id]);
    for(const fn of ['touch_workflow_operation','begin_workflow_effect']) {
      expect((await db.query<{ok:boolean}>(`select ${fn}($1,$2,$3) ok`,[w,row.id,row.attempt_id])).rows[0].ok).toBe(false);
    }
    expect((await db.query<{ok:boolean}>("select checkpoint_workflow_operation($1,$2,$3,'result','true') ok",[w,row.id,row.attempt_id])).rows[0].ok).toBe(false);
  });
});
