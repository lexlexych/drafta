import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getCurrentWorkspace: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  markConversationRead: vi.fn(),
  editConversationDraft: vi.fn(),
  discardConversationDraft: vi.fn(),
  canRegenerateConversationDraft: vi.fn(),
  emitDraftRegenerateRequested: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/workspace", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  getCurrentWorkspace: mocks.getCurrentWorkspace,
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/db/inbox", () => ({
  markConversationRead: mocks.markConversationRead,
}));
vi.mock("@/lib/db/drafts", () => ({
  editConversationDraft: mocks.editConversationDraft,
  discardConversationDraft: mocks.discardConversationDraft,
  canRegenerateConversationDraft: mocks.canRegenerateConversationDraft,
}));
vi.mock("@/lib/inngest/events", () => ({
  emitDraftRegenerateRequested: mocks.emitDraftRegenerateRequested,
}));

import {
  discardDraftAction,
  editDraftAction,
  regenerateDraftAction,
} from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
  mocks.getCurrentWorkspace.mockResolvedValue({ id: "workspace-1" });
  mocks.createServerSupabaseClient.mockResolvedValue({ marker: "rls-client" });
});

describe("draft server actions", () => {
  it("edits the draft through the caller's RLS workspace and saves edited", async () => {
    const draft = { id: "draft-1", status: "edited", text: "Edited answer" };
    mocks.editConversationDraft.mockResolvedValue({ ok: true, draft });

    const result = await editDraftAction(
      "conversation-1",
      "draft-1",
      " Edited answer ",
    );

    expect(result).toEqual({ ok: true, draft });
    expect(mocks.editConversationDraft).toHaveBeenCalledWith(
      { marker: "rls-client" },
      "workspace-1",
      "conversation-1",
      "draft-1",
      " Edited answer ",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("discards the workspace-scoped draft", async () => {
    mocks.discardConversationDraft.mockResolvedValue({ ok: true });

    await expect(
      discardDraftAction("conversation-1", "draft-1"),
    ).resolves.toEqual({ ok: true });
    expect(mocks.discardConversationDraft).toHaveBeenCalledWith(
      { marker: "rls-client" },
      "workspace-1",
      "conversation-1",
      "draft-1",
    );
  });

  it("emits regeneration with exactly conversationId and workspaceId", async () => {
    mocks.canRegenerateConversationDraft.mockResolvedValue(true);
    mocks.emitDraftRegenerateRequested.mockResolvedValue(undefined);

    await expect(regenerateDraftAction("conversation-1")).resolves.toEqual({
      ok: true,
    });

    const payload = mocks.emitDraftRegenerateRequested.mock.calls[0][0];
    expect(payload).toEqual({
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
    });
    expect(Object.keys(payload).sort()).toEqual(["conversationId", "workspaceId"]);
  });

  it("does not emit for a conversation outside the caller's workspace", async () => {
    mocks.canRegenerateConversationDraft.mockResolvedValue(false);

    await expect(regenerateDraftAction("conversation-other")).resolves.toEqual({
      ok: false,
      error: "Диалог не найден.",
    });
    expect(mocks.emitDraftRegenerateRequested).not.toHaveBeenCalled();
  });
});

