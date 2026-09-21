import {FatalError,RetryableError} from 'workflow';
import type {OperationInput} from './types';
export async function pushRecipients(input:OperationInput):Promise<string[]> {
  'use step';
  try {
  const {assertActive}=await import('./store');await assertActive(input);
  const {listWorkspaceSubscriptions}=await import('@/lib/db/push-subscriptions');
  return (await listWorkspaceSubscriptions(input.workspaceId)).map(s=>s.id);
  } catch {throw new RetryableError('push_recipients_unavailable',{retryAfter:'10s'});}
}
pushRecipients.maxRetries=2;
export async function sendPushRecipient(input:OperationInput,subscriptionId:string):Promise<void> {
  'use step';
  try {
  const {assertActive,checkpoint}=await import('./store');
  const row=await assertActive(input),key=`push:${subscriptionId}`;
  if(row.checkpoints[key])return;
  if(Date.now()-Date.parse(row.created_at ?? row.updated_at)>300_000)return;
  const {sendPushDependencies,buildPushPayload}=await import('@/lib/jobs/send-push-pipeline');
  const p=row.input;
  const loaded=await sendPushDependencies.loadContext({workspaceId:p.workspaceId,conversationId:p.conversationId,messageId:p.messageId});
  if(loaded.status==='skip')return;
  const target=loaded.context.recipients.find(s=>s.id===subscriptionId);if(!target)return;
  // A lost database acknowledgement after delivery must not resend to this recipient.
  await checkpoint(input,key,'sending');
  const result=await sendPushDependencies.send({endpoint:target.endpoint,p256dh:target.p256dh,authKey:target.authKey},buildPushPayload(loaded.context));
  if(result.status==='expired')await sendPushDependencies.prune(subscriptionId);
  if(result.status==='error') {
    if(result.retryable===false)throw new FatalError('push_rejected');
    await checkpoint(input,key,false);
    throw new RetryableError('push_temporarily_unavailable',{retryAfter:'10s'});
  }
  await checkpoint(input,key,true);
  } catch(error) {
    if(error instanceof FatalError || error instanceof RetryableError)throw error;
    throw new RetryableError('push_step_failed',{retryAfter:'10s'});
  }
}
sendPushRecipient.maxRetries=2;
