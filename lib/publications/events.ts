import { eventType, staticSchema } from "inngest";
export const publicationImportRequested = eventType("publication/import.requested", {
  schema: staticSchema<{ workspaceId: string; importId: string }>(),
});
export const publicationGenerationRequested = eventType("publication/generation.requested", {
  schema: staticSchema<{ workspaceId: string; jobId: string }>(),
});

export const publicationSendRequested = eventType("publication/send.requested", { schema: staticSchema<{workspaceId: string; deliveryId: string}>() });
