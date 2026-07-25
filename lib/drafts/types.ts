import type { DraftStatus } from "@/lib/mock";

export type ActiveDraftStatus = Extract<
  DraftStatus,
  "generating" | "ready" | "edited"
>;

/** Client-safe view of the latest active draft of one DM conversation. */
export type ActiveDraftView = {
  id: string;
  workspaceId: string;
  conversationId: string;
  status: ActiveDraftStatus;
  text: string;
  model: string | null;
  kbFileIds: string[];
  kbFileNames: string[];
  /**
   * Set when the model refused to invent facts the knowledge base does not
   * contain and asked for a human instead (`lib/ai/prompt.ts`). Non-null means
   * `text` is empty and there is nothing to send.
   */
  manualReviewReason: string | null;
  createdAt: string;
  updatedAt: string;
};
