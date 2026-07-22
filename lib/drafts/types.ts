import type { DraftStatus } from "@/lib/mock";

export type ActiveDraftStatus = Extract<
  DraftStatus,
  "generating" | "ready" | "edited"
>;

/** Client-safe view of the latest active draft for one conversation (DM or comment thread). */
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
   * The message this draft answers (its `last_message_id`). For a comment
   * thread this is the specific comment the reply targets — the "Комментарии"
   * screen highlights it. Optional: the realtime reducer may not carry it.
   */
  lastMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};
