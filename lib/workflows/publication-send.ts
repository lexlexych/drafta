import { getWorkflowMetadata, sleep } from "workflow";
import {claimOperation,executeOperation,completeOperation,failOperation} from "./steps";
import type {OperationInput} from "./types";

export async function publishPublicationWorkflow(input:OperationInput):Promise<void> {
  "use workflow";
  try {

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
