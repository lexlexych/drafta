import "server-only";
import {start,getRun} from "workflow/api";
import {createAdminSupabaseClient} from "@/lib/db/admin";
import {assertDb,finishOperation} from "./store";
import type {JobInput,JobKind,Operation,OperationInput} from "./types";

const idKeys=new Set(['workspaceId','conversationId','messageId','postId','replyCommentId','privateReplyId','contactIdentityId','jobId','importId','deliveryId']);
export function validateJobInput(input:JobInput) {
  if(!input.workspaceId || Object.entries(input).some(([key,value])=>!idKeys.has(key)||typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) throw new Error('invalid_workflow_ids');
}
export async function requestJob(kind:JobKind,input:JobInput,retry=false,checked=false):Promise<Operation> {
  validateJobInput(input);
  const subject=input.deliveryId??input.jobId??input.importId??input.privateReplyId??input.replyCommentId??input.contactIdentityId??input.messageId??input.postId??input.conversationId;
  if(!subject)throw new Error('missing_workflow_subject');
  const resource=input.conversationId??input.postId??subject;
  const db=createAdminSupabaseClient();
  const {data,error}=await db.rpc('reserve_workflow_operation',{w:input.workspaceId,k:kind,s:subject,r:resource,i:input,retry,checked});
  assertDb(error); const row=data as Operation;
  if(row.status!=='queued'||row.run_id) return row;
  await launchOperation(row);
  return row;
}
export async function launchOperation(row:Operation) {
  const {workflows}=await import('./registry');
  const input:OperationInput={workspaceId:row.workspace_id,operationId:row.id,attemptId:row.attempt_id};
  try {
    const run=await start(workflows[row.kind],[input],{region:'fra1',experimental_retention:0});
    const {error}=await createAdminSupabaseClient().from('workflow_operations').update({run_id:run.runId})
      .eq('id',row.id).eq('attempt_id',row.attempt_id).is('run_id',null);
    // The accepted run can claim and bind itself even if this write fails.
    if(error)console.error('[workflow] run binding pending',{operationId:row.id});
  } catch {
    // Invalidate even a run whose start acknowledgement was lost: it cannot claim this attempt.
    const {data,error}=await createAdminSupabaseClient().from('workflow_operations')
      .update({status:'failed',error_code:'start_failed',updated_at:new Date().toISOString()})
      .eq('workspace_id',input.workspaceId).eq('id',input.operationId).eq('attempt_id',input.attemptId).eq('status','queued').select('id');
    assertDb(error);
    if(!data?.length)return; // A running/finished worker owns the result now.
    throw new Error('workflow_start_failed');
  }
}
export async function dispatchWorkflow(event:{kind:JobKind;data:JobInput}) {
  // Publication retries always reconcile first_sent_at/remote_id before any send.
  return requestJob(event.kind,event.data,true,event.kind==='publication-send');
}
export async function cancelJobs(workspaceId:string,resourceId:string,kind:JobKind) {
  const db=createAdminSupabaseClient();
  const {data,error}=await db.from('workflow_operations').select('*').eq('workspace_id',workspaceId)
    .eq('resource_id',resourceId).eq('kind',kind).in('status',['queued','running']);assertDb(error);
  for(const row of (data??[]) as Operation[]) {
    await finishOperation({workspaceId,operationId:row.id,attemptId:row.attempt_id},'cancelled');
    if(row.run_id) {try {await getRun(row.run_id).cancel();} catch {console.error('[workflow] cancellation pending',{operationId:row.id});}}
  }
}
