import { generateDraft, regenerateDraft } from "./generate-draft";
import { pushDigest } from "./push-digest";
import { sendMessage } from "./send-message";
import { sendPush } from "./send-push";

export { generateDraft, regenerateDraft } from "./generate-draft";
export { pushDigest } from "./push-digest";
export { sendMessage } from "./send-message";
export { sendPush } from "./send-push";

/** All functions served by app/api/inngest/route.ts. */
export const inngestFunctions = [
  generateDraft,
  regenerateDraft,
  sendMessage,
  sendPush,
  pushDigest,
];
