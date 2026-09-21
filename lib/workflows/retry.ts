import 'server-only';
import {createAdminSupabaseClient} from '@/lib/db/admin';
import {assertDb} from './store';
import {requestJob} from './start';
import type {Operation} from './types';

/** Caller must first authenticate the workspace member and load this row in that workspace. */
export async function retryOperation(row:Operation,checked=false) {
  if(!['failed','uncertain'].includes(row.status))throw new Error('operation_not_retryable');
  if(row.status==='uncertain' && !checked)throw new Error('delivery_requires_check');
  const p=row.input,db=createAdminSupabaseClient();
  if(row.kind==='auto-reply' && typeof row.checkpoints['create-reply']==='string') {
    const messageId=row.checkpoints['create-reply'];
    const child=await db.from('workflow_operations').select('*').eq('workspace_id',p.workspaceId)
      .eq('kind','send-message').eq('subject_id',messageId).maybeSingle();assertDb(child.error);
    if(child.data && ['failed','uncertain'].includes(child.data.status))await retryOperation(child.data as Operation,checked);
    else if(!child.data) {
      const reset=await db.from('messages').update({delivery_status:'pending'}).eq('workspace_id',p.workspaceId).eq('id',messageId).eq('delivery_status','failed');assertDb(reset.error);
      await requestJob('send-message',{workspaceId:p.workspaceId,conversationId:p.conversationId,messageId});
    }
    const cleared=await db.from('workflow_operations').update({status:'succeeded',error_code:null})
      .eq('workspace_id',p.workspaceId).eq('id',row.id).eq('attempt_id',row.attempt_id).eq('status','failed');assertDb(cleared.error);
    return;
  }
  if(row.kind==='send-message'||row.kind==='send-comment') {
    const table=row.kind==='send-message'?'messages':'comments',id=p.messageId??p.replyCommentId;
    const current=await db.from(table).select('external_id,delivery_status').eq('workspace_id',p.workspaceId).eq('id',id).maybeSingle();assertDb(current.error);
    if(!current.data || current.data.external_id || ['sent','delivered','read'].includes(current.data.delivery_status))throw new Error('already_sent');
    const {error}=await db.from(table).update({delivery_status:'pending'}).eq('workspace_id',p.workspaceId).eq('id',id).in('delivery_status',['failed','uncertain']);assertDb(error);
  } else if(row.kind==='send-comment-private-reply') {
    const current=await db.from('comment_private_replies').select('external_id,status').eq('workspace_id',p.workspaceId).eq('id',p.privateReplyId).maybeSingle();assertDb(current.error);
    if(!current.data || current.data.external_id || current.data.status==='sent')throw new Error('already_sent');
    const {error}=await db.from('comment_private_replies').update({status:'pending'}).eq('workspace_id',p.workspaceId).eq('id',p.privateReplyId).in('status',['failed','uncertain']);assertDb(error);
  } else if(['publication-generation','publication-import','publication-send'].includes(row.kind)) {
    // Their editor routes validate input revision, ownership and fresh import links.
    throw new Error('retry_in_publication_editor');
  }
  return requestJob(row.kind,p,true,checked);
}
