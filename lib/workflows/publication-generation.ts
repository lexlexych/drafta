import { getWorkflowMetadata, sleep } from "workflow";
import {claimOperation,executeOperation,completeOperation,failOperation} from "./steps";
import type {OperationInput} from "./types";

export async function generatePublicationWorkflow(input:OperationInput):Promise<void> {
  "use workflow";
  try {

    for(;;) {
      const claim=await claimOperation(input,getWorkflowMetadata().workflowRunId);
      if(claim==='stale') return;
      if(claim==='claimed') break;
      await sleep('2s');
    }
    await executeOperation(input,"text-or-ideas");
    for(let index=0;index<10;index++) await executeOperation(input,`image-${index}`);
    await executeOperation(input,"finish");
    await completeOperation(input);
  } catch { await failOperation(input); }
}
