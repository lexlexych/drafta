import { autoReply } from "./auto-reply";
import { cleanupAiRequestLog } from "./cleanup-ai-request-log";
import { contactAvatar } from "./contact-avatar";
import { generateCommentDrafts } from "./generate-comment-drafts";
import { generateDraft } from "./generate-draft";
import { postThumbnail } from "./post-thumbnail";
import { sendComment } from "./send-comment";
import { sendCommentPrivateReply } from "./send-comment-private-reply";
import { sendMessage } from "./send-message";
import { sendPush } from "./send-push";

export { autoReply } from "./auto-reply";
export { cleanupAiRequestLog } from "./cleanup-ai-request-log";
export { contactAvatar } from "./contact-avatar";
export { generateCommentDrafts } from "./generate-comment-drafts";
export { generateDraft } from "./generate-draft";
export { postThumbnail } from "./post-thumbnail";
export { sendComment } from "./send-comment";
export { sendCommentPrivateReply } from "./send-comment-private-reply";
export { sendMessage } from "./send-message";
export { sendPush } from "./send-push";

/** All functions served by app/api/inngest/route.ts. */
export const inngestFunctions = [
  generateDraft,
  generateCommentDrafts,
  autoReply,
  sendMessage,
  sendComment,
  sendCommentPrivateReply,
  sendPush,
  cleanupAiRequestLog,
  contactAvatar,
  postThumbnail,
];
