import { generateDraft, regenerateDraft } from "./generate-draft";
import { sendMessage } from "./send-message";

export { generateDraft, regenerateDraft } from "./generate-draft";
export { sendMessage } from "./send-message";

/** All functions served by app/api/inngest/route.ts. */
export const inngestFunctions = [generateDraft, regenerateDraft, sendMessage];
