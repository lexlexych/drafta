import "server-only";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import {assertActive,assertDb,checkpoint,finishOperation,loadOperation} from "./store";
import type { OperationInput } from "./types";
import type { LocalSteps } from "@/lib/jobs/steps";

const durableIds=new Set(["create-generating","asset-id","prepare-asset-ids","send-via-adapter","create-reply"]);
const effects=new Set(["send-via-adapter"]);

/** Local pipeline values remain in this step's memory. Only ID checkpoints enter Supabase. */
function stepsFor(input:OperationInput,stage:string):LocalSteps {
  return {run:async<T>(name:string,callback:()=>Promise<T>|T):Promise<T>=>{
    const row=await assertActive(input);
    const durable=durableIds.has(name)||name.startsWith('import-file-');
    if(durable && Object.hasOwn(row.checkpoints,name)) return row.checkpoints[name] as T;
    if(stage!=="all" && name!==stage && name!=="asset-id") return undefined as T;
    if(effects.has(name)) {
      const {data,error}=await createAdminSupabaseClient().rpc("begin_workflow_effect",{w:input.workspaceId,o:input.operationId,a:input.attemptId});
      assertDb(error); if(!data) throw new Error("workflow_delivery_uncertain");
    }
    try {
      const result=await callback();
      if(durable) await checkpoint(input,name,result);
      return result;
    } catch(error) {
      const status=(error as {status?:number;cause?:{status?:number}})?.status ?? (error as {cause?:{status?:number}})?.cause?.status;
      if(effects.has(name) && status && status>=400 && status<500 && status!==408) {
        // Provider explicitly rejected the request; a user may try again.
        await checkpoint(input,"rejected",true);
      }
      throw error;
    }
  }};
}

export async function runOperationJob(input:OperationInput,stage:string) {
  const row=await assertActive(input), p=row.input, steps=stepsFor(input,stage);
  switch(row.kind) {
    case 'send-message': {
      const {runSendMessagePipeline}=await import("@/lib/jobs/send-pipeline");
      const result=await runSendMessagePipeline({workspaceId:p.workspaceId,conversationId:p.conversationId,messageId:p.messageId},steps);
      if(result.status==='skipped' && result.reason==='connection-inactive')throw new Error('connection_inactive');break;
    }
    case 'send-comment': {
      const {runSendCommentPipeline}=await import("@/lib/jobs/send-comment-pipeline");
      const result=await runSendCommentPipeline({workspaceId:p.workspaceId,postId:p.postId,replyCommentId:p.replyCommentId},steps);
      if(result.status==='skipped' && !['already-sent','not-pending'].includes(result.reason))throw new Error('comment_send_unavailable');break;
    }
    case 'send-comment-private-reply': {
      const {runSendCommentPrivateReplyPipeline}=await import("@/lib/jobs/send-comment-private-reply-pipeline");
      const result=await runSendCommentPrivateReplyPipeline({workspaceId:p.workspaceId,postId:p.postId,privateReplyId:p.privateReplyId},steps);
      if(result.status==='skipped' && !['already-sent','not-pending'].includes(result.reason))throw new Error('private_reply_unavailable');break;
    }
    case 'generate-draft': {
      const {runDraftPipeline}=await import("@/lib/jobs/draft-pipeline");
      await runDraftPipeline({workspaceId:p.workspaceId,conversationId:p.conversationId},steps);break;
    }
    case 'auto-reply': {
      const {runAutoReplyPipeline,autoReplyDependencies}=await import("@/lib/jobs/auto-reply-pipeline");
      await runAutoReplyPipeline({workspaceId:p.workspaceId,conversationId:p.conversationId,messageId:p.messageId},{...steps,sleepUntil:async(_name,until)=>{
        if(Date.parse(until)>Date.now()+1000) throw new Error("auto_reply_input_changed");
      }},autoReplyDependencies);break;
    }
    case 'contact-avatar': {
      const {runContactAvatarPipeline}=await import("@/lib/jobs/contact-avatar-pipeline");
      await runContactAvatarPipeline({workspaceId:p.workspaceId,conversationId:p.conversationId,contactIdentityId:p.contactIdentityId},steps);break;
    }
    case 'post-thumbnail': {
      const {runPostThumbnailPipeline}=await import("@/lib/jobs/post-thumbnail-pipeline");
      await runPostThumbnailPipeline({workspaceId:p.workspaceId,postId:p.postId},steps);break;
    }
    case 'publication-generation': {
      const {runPublicationGeneration}=await import("@/lib/jobs/publication-generation");
      await runPublicationGeneration({workspaceId:p.workspaceId,jobId:p.jobId},steps);break;
    }
    case 'publication-import': {
      const {runPublicationImport}=await import("@/lib/jobs/publication-import");
      await runPublicationImport({workspaceId:p.workspaceId,importId:p.importId},steps);break;
    }
    case 'publication-send': {
      const {runPublicationDelivery}=await import("@/lib/publications/publishing");
      await runPublicationDelivery(p.workspaceId,p.deliveryId,async()=>{
        const {data,error}=await createAdminSupabaseClient().rpc('begin_workflow_effect',{w:input.workspaceId,o:input.operationId,a:input.attemptId});
        assertDb(error);if(!data)throw new Error('workflow_delivery_uncertain');
      });break;
    }
    default: throw new Error("unsupported_workflow");
  }
}

export async function failOperationJob(input:OperationInput) {
  const row=await loadOperation(input);
  if(!row || !['running','queued'].includes(row.status)) return;
  const db=createAdminSupabaseClient(), p=row.input;
  const uncertain=row.effect_started && !row.checkpoints.rejected && !row.checkpoints['send-via-adapter'];
  let result: {error:unknown}|undefined;
  if(row.kind==='send-message'||row.kind==='send-comment') {
    result=await db.from(row.kind==='send-message'?'messages':'comments')
      .update({delivery_status:uncertain?'uncertain':'failed'})
      .eq('workspace_id',p.workspaceId).eq('id',p.messageId??p.replyCommentId).eq('delivery_status','pending');
  } else if(row.kind==='send-comment-private-reply') {
    result=await db.from('comment_private_replies').update({status:uncertain?'uncertain':'failed'})
      .eq('workspace_id',p.workspaceId).eq('id',p.privateReplyId).eq('status','pending');
  } else if(row.kind==='generate-draft' && row.checkpoints['create-generating']) {
    result=await db.from('drafts').update({status:'failed'}).eq('workspace_id',p.workspaceId)
      .eq('id',row.checkpoints['create-generating']).eq('status','generating');
  } else if(row.kind==='auto-reply') {
    if(row.checkpoints['create-reply']) {
      result=await db.from('messages').update({delivery_status:'failed'}).eq('workspace_id',p.workspaceId)
        .eq('id',row.checkpoints['create-reply']).eq('delivery_status','pending');
    }
    const {journalFailedAutoReply}=await import('@/lib/jobs/auto-reply-pipeline');
    await journalFailedAutoReply({workspaceId:p.workspaceId,conversationId:p.conversationId,messageId:p.messageId});
  } else if(row.kind==='publication-generation') {
    const job=await db.from('publication_generation_jobs').select('draft_id').eq('workspace_id',p.workspaceId).eq('id',p.jobId).maybeSingle();assertDb(job.error);
    if(job.data) {
      const {authoringAction}=await import('@/lib/publications/authoring-server');
      await authoringAction(p.workspaceId,job.data.draft_id,'fail',{jobId:p.jobId,error:'Не удалось завершить генерацию. Повторите незавершённые этапы.'});
    }
  } else if(row.kind==='publication-import') {
    result=await db.rpc('fail_workflow_import',{w:p.workspaceId,i:p.importId});
  } else if(row.kind==='publication-send') {
    const delivery=await db.from('publication_deliveries').select('first_sent_at').eq('workspace_id',p.workspaceId).eq('id',p.deliveryId).maybeSingle();assertDb(delivery.error);
    result=await db.from('publication_deliveries').update({status:delivery.data?.first_sent_at?'uncertain':'failed',error:'Не удалось подтвердить отправку. Проверьте статус публикации.'})
      .eq('workspace_id',p.workspaceId).eq('id',p.deliveryId).in('status',['pending','sending']);
  }
  if(result) assertDb(result.error);
  await finishOperation(input,uncertain?'uncertain':'failed',uncertain?'delivery_uncertain':'action_failed');
}
