import { generateDraft, regenerateDraft } from "./generate-draft";

export { generateDraft, regenerateDraft } from "./generate-draft";

/** All functions served by app/api/inngest/route.ts. */
export const inngestFunctions = [generateDraft, regenerateDraft];
