import { eventType, staticSchema } from "inngest";
export const publicationImportRequested = eventType("publication/import.requested", {
  schema: staticSchema<{ workspaceId: string; importId: string }>(),
});
