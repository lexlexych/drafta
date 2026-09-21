import { FatalError, RetryableError } from "workflow";
import type { OperationInput } from "./types";

export async function claimOperation(input:OperationInput,runId:string):Promise<string> {
  "use step";
  const { createAdminSupabaseClient }=await import("@/lib/db/admin");
  const {assertDb}=await import("./store");
  const {data,error}=await createAdminSupabaseClient().rpc("claim_workflow_operation",{
    w:input.workspaceId,o:input.operationId,a:input.attemptId,owner:runId,
  }); assertDb(error); return data as string;
}
claimOperation.maxRetries=0;

export async function executeOperation(input:OperationInput,stage:string="all"):Promise<void> {
  "use step";
  const {runOperationJob}=await import("./executor");
  try { await runOperationJob(input,stage); }
  catch { throw new FatalError("workflow_action_failed"); }
}
executeOperation.maxRetries=0;

export async function completeOperation(input:OperationInput):Promise<void> {
  "use step";
  const {finishOperation}=await import("./store");
  await finishOperation(input,"succeeded");
}
completeOperation.maxRetries=2;

export async function failOperation(input:OperationInput):Promise<void> {
  "use step";
  const {failOperationJob}=await import("./executor");
  try {await failOperationJob(input);} catch {throw new RetryableError('workflow_failure_recording_failed');}
}
failOperation.maxRetries=2;

export async function autoReplyDeadline(input:OperationInput):Promise<string|null> {
  "use step";
  const {loadOperation}=await import("./store");
  const {autoReplyDependencies}=await import("@/lib/jobs/auto-reply-pipeline");
  const row=await loadOperation(input);
  if(!row || row.status!=="queued") return null;
  const p=row.input;
  const settings=await autoReplyDependencies.loadSettings(p.workspaceId);
  if(!settings.isEnabled) return null;
  const state=await autoReplyDependencies.loadConversationState({workspaceId:p.workspaceId,conversationId:p.conversationId,messageId:p.messageId});
  if(state.status!=="waiting") return null;
  return new Date(Date.parse(state.latestIncomingAt)+settings.delayMinutes*60_000).toISOString();
}
autoReplyDeadline.maxRetries=0;
