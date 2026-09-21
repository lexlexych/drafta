import 'server-only';
import {getRun} from 'workflow/api';
import {createAdminSupabaseClient} from '@/lib/db/admin';
import {assertDb} from './store';
import {failOperationJob} from './executor';
import type {JobKind,Operation} from './types';

/** Reconcile before the editor resets a business job for a manual retry. */
export async function reconcileSubject(workspaceId:string,kind:JobKind,subjectId:string) {
  const {data,error}=await createAdminSupabaseClient().from('workflow_operations').select('*')
    .eq('workspace_id',workspaceId).eq('kind',kind).eq('subject_id',subjectId).maybeSingle();
  assertDb(error);
  if(data)await reconcileOperation(data as Operation);
}

export async function reconcileOperation(row:Operation):Promise<void> {
  if(!['queued','running'].includes(row.status))return;
  if(Date.now()-Date.parse(row.updated_at)<60_000)return;
  if(row.run_id) {
    const run=getRun(row.run_id);
    // A provider/API outage is not evidence that an active run has stopped.
    if(await run.exists) {
      const status=await run.status;
      if(!['completed','failed','cancelled'].includes(status))return;
    }
  } else if(Date.now()-Date.parse(row.updated_at)<300_000)return;
  await failOperationJob({workspaceId:row.workspace_id,operationId:row.id,attemptId:row.attempt_id});
}
export async function reconcileBackgroundOperations() {
  const {data,error}=await createAdminSupabaseClient().from('workflow_operations').select('*')
    .in('status',['queued','running']).lt('updated_at',new Date(Date.now()-300_000).toISOString()).limit(100);
  assertDb(error);
  for(const row of (data??[]) as Operation[])await reconcileOperation(row);
}
