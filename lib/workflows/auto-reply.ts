import { getWorkflowMetadata, sleep } from "workflow";
import {claimOperation,executeOperation,completeOperation,failOperation,autoReplyDeadline} from "./steps";
import type {OperationInput} from "./types";

export async function autoReplyWorkflow(input:OperationInput):Promise<void> {
  "use workflow";
  try {
    for(let i=0;i<6;i++) { const deadline=await autoReplyDeadline(input); if(!deadline) { await completeOperation(input); return; } if(new Date(deadline).getTime()<=Date.now()) break; await sleep(new Date(deadline)); }
    for(;;) {
      const claim=await claimOperation(input,getWorkflowMetadata().workflowRunId);
      if(claim==='stale') return;
      if(claim==='claimed') break;
      await sleep('2s');
    }
    await executeOperation(input);
    await completeOperation(input);
  } catch { await failOperation(input); }
}
