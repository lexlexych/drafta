import { describe, expect, it } from "vitest";

import type { ActiveDraftView } from "@/lib/drafts/types";

import { reduceActiveDraft, type DraftRealtimeEvent } from "./draft-panel";

function event(
  status: string,
  overrides: Record<string, unknown> = {},
): DraftRealtimeEvent {
  return {
    eventType: "UPDATE",
    new: {
      id: "draft-1",
      workspace_id: "workspace-1",
      conversation_id: "conversation-1",
      status,
      text: "Ready answer",
      model: "mistral-small-latest",
      kb_file_ids: ["kb-1"],
      created_at: "2026-07-22T10:00:00.000Z",
      ...overrides,
    },
  };
}

const active: ActiveDraftView = {
  id: "draft-1",
  workspaceId: "workspace-1",
  conversationId: "conversation-1",
  status: "ready",
  text: "Ready answer",
  model: "mistral-small-latest",
  kbFileIds: ["kb-1"],
  kbFileNames: ["FAQ.md"],
  manualReviewReason: null,
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
};

describe("reduceActiveDraft", () => {
  it("shows a newly ready draft in the open conversation", () => {
    expect(
      reduceActiveDraft(null, event("ready"), "workspace-1", "conversation-1"),
    ).toEqual({ ...active, kbFileNames: [] });
  });

  it("hides the active draft when it becomes superseded", () => {
    expect(
      reduceActiveDraft(
        active,
        event("superseded"),
        "workspace-1",
        "conversation-1",
      ),
    ).toBeNull();
  });

  it("hides the active draft when it becomes discarded", () => {
    expect(
      reduceActiveDraft(
        active,
        event("discarded"),
        "workspace-1",
        "conversation-1",
      ),
    ).toBeNull();
  });

  it("ignores events from another workspace or conversation", () => {
    expect(
      reduceActiveDraft(
        active,
        event("superseded", { workspace_id: "workspace-2" }),
        "workspace-1",
        "conversation-1",
      ),
    ).toBe(active);
    expect(
      reduceActiveDraft(
        active,
        event("superseded", { conversation_id: "conversation-2" }),
        "workspace-1",
        "conversation-1",
      ),
    ).toBe(active);
  });
});
