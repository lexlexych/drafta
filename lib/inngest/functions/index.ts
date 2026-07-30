import { contactAvatar } from "./contact-avatar";
import { generateCommentDrafts } from "./generate-comment-drafts";
import { generateDraft, regenerateDraft } from "./generate-draft";
import { pushDigest } from "./push-digest";
import { sendComment } from "./send-comment";
import { sendMessage } from "./send-message";
import { sendPush } from "./send-push";

export { contactAvatar } from "./contact-avatar";
export { generateCommentDrafts } from "./generate-comment-drafts";
export { generateDraft, regenerateDraft } from "./generate-draft";
export { pushDigest } from "./push-digest";
export { sendComment } from "./send-comment";
export { sendMessage } from "./send-message";
export { sendPush } from "./send-push";

/** All functions served by app/api/inngest/route.ts. */
export const inngestFunctions = [
  generateDraft,
  regenerateDraft,
  generateCommentDrafts,
  sendMessage,
  sendComment,
  sendPush,
  pushDigest,
  contactAvatar,
];
