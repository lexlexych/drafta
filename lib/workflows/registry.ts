import {generateDraftWorkflow} from './generate-draft';
import {autoReplyWorkflow} from './auto-reply';
import {sendMessageWorkflow} from './send-message';
import {sendCommentWorkflow} from './send-comment';
import {sendCommentPrivateReplyWorkflow} from './send-comment-private-reply';
import {syncContactAvatarWorkflow} from './contact-avatar';
import {syncPostThumbnailWorkflow} from './post-thumbnail';
import {generatePublicationWorkflow} from './publication-generation';
import {importPublicationWorkflow} from './publication-import';
import {publishPublicationWorkflow} from './publication-send';
import {sendPushWorkflow} from './send-push';
import type {JobKind,OperationInput} from './types';
export const workflows:Record<JobKind,(input:OperationInput)=>Promise<void>>={
'generate-draft':generateDraftWorkflow,
'auto-reply':autoReplyWorkflow,
'send-message':sendMessageWorkflow,
'send-comment':sendCommentWorkflow,
'send-comment-private-reply':sendCommentPrivateReplyWorkflow,
'contact-avatar':syncContactAvatarWorkflow,
'post-thumbnail':syncPostThumbnailWorkflow,
'publication-generation':generatePublicationWorkflow,
'publication-import':importPublicationWorkflow,
'publication-send':publishPublicationWorkflow,
'send-push':sendPushWorkflow
};
