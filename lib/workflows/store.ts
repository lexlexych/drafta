import "server-only";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import type { Operation, OperationInput } from "./types";

export function assertDb(error: unknown): void {
  if (error) throw new Error("workflow_storage_failed");
}
export async function loadOperation(input: OperationInput): Promise<Operation | null> {
  const { data, error } = await createAdminSupabaseClient().from("workflow_operations").select("*")
    .eq("workspace_id",input.workspaceId).eq("id",input.operationId).eq("attempt_id",input.attemptId).maybeSingle();
  assertDb(error); return data as Operation | null;
}
export async function assertActive(input: OperationInput): Promise<Operation> {
  const {data,error}=await createAdminSupabaseClient().rpc('touch_workflow_operation',{
    w:input.workspaceId,o:input.operationId,a:input.attemptId,
  });
  assertDb(error);if(!data)throw new Error('workflow_attempt_stale');
  const row = await loadOperation(input);
  if (!row || row.status !== "running") throw new Error("workflow_attempt_stale");
  return row;
}
export async function checkpoint(input: OperationInput, key:string, result:unknown): Promise<void> {
  const { data,error }=await createAdminSupabaseClient().rpc("checkpoint_workflow_operation",{
    w:input.workspaceId,o:input.operationId,a:input.attemptId,step_key:key,result:result ?? null,
  }); assertDb(error); if(!data) throw new Error("workflow_attempt_stale");
}
export async function finishOperation(input:OperationInput,status:Operation['status'],code:string|null=null) {
  const {error}=await createAdminSupabaseClient().rpc("finish_workflow_operation",{
    w:input.workspaceId,o:input.operationId,a:input.attemptId,state:status,code,
  }); assertDb(error);
}
