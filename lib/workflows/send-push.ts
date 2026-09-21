import {getWorkflowMetadata,sleep} from 'workflow';
import {claimOperation,completeOperation,failOperation} from './steps';
import {pushRecipients,sendPushRecipient} from './push-steps';
import type {OperationInput} from './types';
export async function sendPushWorkflow(input:OperationInput):Promise<void> {
  'use workflow';
  try {
    for(;;) {
      const claim=await claimOperation(input,getWorkflowMetadata().workflowRunId);
      if(claim==='stale')return;
      if(claim==='claimed')break;
      await sleep('2s');
    }
    const recipients=await pushRecipients(input);
    let failed=false;
    for(const subscriptionId of recipients) {
      try {await sendPushRecipient(input,subscriptionId);} catch {failed=true;}
    }
    if(failed)await failOperation(input);else await completeOperation(input);
  } catch {await failOperation(input);}
}
