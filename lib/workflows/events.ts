import {requestJob,cancelJobs} from './start';
export type ContactAvatarSyncRequestedEvent = {
  workspaceId: string;
  contactIdentityId: string;
  conversationId: string;
};
export type PostThumbnailSyncRequestedEvent = {
  workspaceId: string;
  postId: string;
};
export type DraftGenerateRequestedEvent = {
  conversationId: string;
  workspaceId: string;
};
export type DraftGenerateCancelledEvent = {
  conversationId: string;
  workspaceId: string;
};
export type MessageSendRequestedEvent = {
  messageId: string;
  conversationId: string;
  workspaceId: string;
};
export type CommentSendRequestedEvent = {
  workspaceId: string;
  postId: string;
  /** The outgoing `comments` row to publish. */
  replyCommentId: string;
};
export type CommentPrivateReplySendRequestedEvent = {
  workspaceId: string;
  postId: string;
  /** The `comment_private_replies` row to deliver. */
  privateReplyId: string;
};
export type PushNotifyRequestedEvent = {
  messageId: string;
  conversationId: string;
  workspaceId: string;
};
export type AutoReplyRequestedEvent = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
};
export type AutoReplyCancelledEvent = {
  workspaceId: string;
  conversationId: string;
};
export async function emitContactAvatarSyncRequested(payload:ContactAvatarSyncRequestedEvent):Promise<void> {
 try {await requestJob('contact-avatar',payload,false);} catch { console.error('[workflow] launch failed',{kind:'contact-avatar'}); }
}
export async function emitPostThumbnailSyncRequested(payload:PostThumbnailSyncRequestedEvent):Promise<void> {
 try {await requestJob('post-thumbnail',payload,false);} catch { console.error('[workflow] launch failed',{kind:'post-thumbnail'}); }
}
export async function emitDraftGenerateRequested(payload:DraftGenerateRequestedEvent):Promise<void> {
 await requestJob('generate-draft',payload,true);
}
export async function emitMessageSendRequested(payload:MessageSendRequestedEvent):Promise<void> {
 await requestJob('send-message',payload,true);
}
export async function emitCommentSendRequested(payload:CommentSendRequestedEvent):Promise<void> {
 await requestJob('send-comment',payload,true);
}
export async function emitCommentPrivateReplySendRequested(payload:CommentPrivateReplySendRequestedEvent):Promise<void> {
 await requestJob('send-comment-private-reply',payload,true);
}
export async function emitPushNotifyRequested(payload:PushNotifyRequestedEvent):Promise<void> {
 try {await requestJob('send-push',payload,false);} catch { console.error('[workflow] launch failed',{kind:'send-push'}); }
}
export async function emitAutoReplyRequested(payload:AutoReplyRequestedEvent):Promise<void> {
 try {await requestJob('auto-reply',payload,false);} catch { console.error('[workflow] launch failed',{kind:'auto-reply'}); }
}
export async function emitDraftGenerateCancelled(payload:DraftGenerateCancelledEvent) {await cancelJobs(payload.workspaceId,payload.conversationId,'generate-draft');}
export async function emitAutoReplyCancelled(payload:AutoReplyCancelledEvent) {await cancelJobs(payload.workspaceId,payload.conversationId,'auto-reply');}
