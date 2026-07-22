import type { DraftStatus } from "@/lib/mock";

export type ActiveDraftStatus = Extract<
  DraftStatus,
  "generating" | "ready" | "edited"
>;

/** Client-safe view of the latest active draft for one DM conversation. */
export type ActiveDraftView = {
  id: string;
  workspaceId: string;
  conversationId: string;
  status: ActiveDraftStatus;
  text: string;
  model: string | null;
  kbFileIds: string[];
  kbFileNames: string[];
  createdAt: string;
  updatedAt: string;
};
