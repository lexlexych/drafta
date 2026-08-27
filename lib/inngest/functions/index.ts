import { cleanupAiRequestLog } from "./cleanup-ai-request-log";
import { contactAvatar } from "./contact-avatar";
import { generateCommentDrafts } from "./generate-comment-drafts";
import { generateDraft } from "./generate-draft";
import { postThumbnail } from "./post-thumbnail";
import { pushDigest } from "./push-digest";
import { sendComment } from "./send-comment";
import { sendCommentPrivateReply } from "./send-comment-private-reply";
import { sendMessage } from "./send-message";
import { sendPush } from "./send-push";

export { cleanupAiRequestLog } from "./cleanup-ai-request-log";
export { contactAvatar } from "./contact-avatar";
export { generateCommentDrafts } from "./generate-comment-drafts";
export { generateDraft } from "./generate-draft";
export { postThumbnail } from "./post-thumbnail";
export { pushDigest } from "./push-digest";
export { sendComment } from "./send-comment";
export { sendCommentPrivateReply } from "./send-comment-private-reply";
export { sendMessage } from "./send-message";
export { sendPush } from "./send-push";

/** All functions served by app/api/inngest/route.ts. */
export const inngestFunctions = [
  generateDraft,
  generateCommentDrafts,
  sendMessage,
  sendComment,
  sendCommentPrivateReply,
  sendPush,
  pushDigest,
  cleanupAiRequestLog,
  contactAvatar,
  postThumbnail,
];
