import type { ActiveDraftView } from "@/lib/drafts/types";

export const DRAFT_REALTIME_EVENT = "drafta:draft-realtime-change";

export type DraftRealtimeRow = {
  id?: string;
  workspace_id?: string | null;
  conversation_id?: string | null;
  status?: string | null;
  text?: string | null;
  model?: string | null;
  kb_file_ids?: unknown;
  manual_review_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DraftRealtimeEvent = {
  eventType: "INSERT" | "UPDATE";
  new: DraftRealtimeRow;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function asActiveDraft(
  row: DraftRealtimeRow,
  current: ActiveDraftView | null,
): ActiveDraftView | null {
  if (
    !row.id ||
    !row.workspace_id ||
    !row.conversation_id ||
    !row.created_at ||
    (row.status !== "generating" &&
      row.status !== "ready" &&
      row.status !== "edited")
  ) {
    return null;
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    status: row.status,
    text: row.text ?? "",
    model: row.model ?? null,
    kbFileIds: isStringArray(row.kb_file_ids) ? row.kb_file_ids : [],
    // postgres_changes contains IDs, not joined kb_files. Preserve resolved
    // names for updates to the same draft; router.refresh resolves new ones.
    kbFileNames: current?.id === row.id ? current.kbFileNames : [],
    manualReviewReason: row.manual_review_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

/** Pure state transition used by the thread composer and its contract tests. */
export function reduceActiveDraft(
  current: ActiveDraftView | null,
  event: DraftRealtimeEvent,
  workspaceId: string,
  conversationId: string,
): ActiveDraftView | null {
  const row = event.new;

  if (
    row.workspace_id !== workspaceId ||
    row.conversation_id !== conversationId
  ) {
    return current;
  }

  if (
    row.status === "discarded" ||
    row.status === "superseded" ||
    row.status === "sent" ||
    row.status === "failed"
  ) {
    return current?.id === row.id ? null : current;
  }

  const next = asActiveDraft(row, current);

  if (!next) {
    return current;
  }

  if (
    current &&
    current.id !== next.id &&
    Date.parse(current.createdAt) > Date.parse(next.createdAt)
  ) {
    return current;
  }

  return next;
}
