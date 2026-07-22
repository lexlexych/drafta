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
  emitMessageSendRequested: vi.fn(),
  acceptDraftForSend: vi.fn(),
  createManualOutgoingMessage: vi.fn(),
  retryFailedOutgoingMessage: vi.fn(),
  markOutgoingMessageFailedAfterEmit: vi.fn(),
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
  emitMessageSendRequested: mocks.emitMessageSendRequested,
}));
vi.mock("@/lib/db/outgoing", () => ({
  acceptDraftForSend: mocks.acceptDraftForSend,
  createManualOutgoingMessage: mocks.createManualOutgoingMessage,
  retryFailedOutgoingMessage: mocks.retryFailedOutgoingMessage,
  markOutgoingMessageFailedAfterEmit: mocks.markOutgoingMessageFailedAfterEmit,
}));

import {
  discardDraftAction,
  editDraftAction,
  regenerateDraftAction,
  retrySendMessageAction,
  sendDraftAction,
  sendManualMessageAction,
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

describe("send server actions", () => {
  it("accepts the draft transactionally, then emits an ID-only message/send", async () => {
    mocks.acceptDraftForSend.mockResolvedValue({ ok: true, messageId: "message-9" });
    mocks.emitMessageSendRequested.mockResolvedValue(undefined);

    await expect(sendDraftAction("conversation-1", "draft-1")).resolves.toEqual({
      ok: true,
      messageId: "message-9",
    });

    expect(mocks.acceptDraftForSend).toHaveBeenCalledWith(
      { marker: "rls-client" },
      "workspace-1",
      "conversation-1",
      "draft-1",
    );
    const payload = mocks.emitMessageSendRequested.mock.calls[0][0];
    expect(payload).toEqual({
      messageId: "message-9",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
    });
    expect(Object.keys(payload).sort()).toEqual([
      "conversationId",
      "messageId",
      "workspaceId",
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("does not emit when the draft was already accepted or changed", async () => {
    mocks.acceptDraftForSend.mockResolvedValue({
      ok: false,
      error: "Черновик уже изменился — обновите тред.",
    });

    await expect(sendDraftAction("conversation-1", "draft-1")).resolves.toEqual({
      ok: false,
      error: "Черновик уже изменился — обновите тред.",
    });
    expect(mocks.emitMessageSendRequested).not.toHaveBeenCalled();
  });

  it("marks the persisted message failed when the emit itself fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.acceptDraftForSend.mockResolvedValue({ ok: true, messageId: "message-9" });
    mocks.emitMessageSendRequested.mockRejectedValue(new Error("inngest down"));
    mocks.markOutgoingMessageFailedAfterEmit.mockResolvedValue(undefined);

    const result = await sendDraftAction("conversation-1", "draft-1");

    expect(result.ok).toBe(false);
    expect(mocks.markOutgoingMessageFailedAfterEmit).toHaveBeenCalledWith(
      { marker: "rls-client" },
      "workspace-1",
      "message-9",
    );
    consoleErrorSpy.mockRestore();
  });

  it("sends a manual composer message through the same RPC + emit path", async () => {
    mocks.createManualOutgoingMessage.mockResolvedValue({
      ok: true,
      messageId: "message-3",
    });
    mocks.emitMessageSendRequested.mockResolvedValue(undefined);

    await expect(
      sendManualMessageAction("conversation-1", "Добрый день!"),
    ).resolves.toEqual({ ok: true, messageId: "message-3" });

    expect(mocks.createManualOutgoingMessage).toHaveBeenCalledWith(
      { marker: "rls-client" },
      "workspace-1",
      "conversation-1",
      "Добрый день!",
    );
    expect(mocks.emitMessageSendRequested).toHaveBeenCalledWith({
      messageId: "message-3",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
    });
  });

  it("retries only messages the reset reports as failed", async () => {
    mocks.retryFailedOutgoingMessage.mockResolvedValue({
      ok: false,
      error: "Сообщение уже изменилось — обновите тред.",
    });

    await expect(
      retrySendMessageAction("conversation-1", "message-5"),
    ).resolves.toEqual({
      ok: false,
      error: "Сообщение уже изменилось — обновите тред.",
    });
    expect(mocks.emitMessageSendRequested).not.toHaveBeenCalled();
  });

  it("re-emits message/send after a successful failed→pending reset", async () => {
    mocks.retryFailedOutgoingMessage.mockResolvedValue({
      ok: true,
      messageId: "message-5",
    });
    mocks.emitMessageSendRequested.mockResolvedValue(undefined);

    await expect(
      retrySendMessageAction("conversation-1", "message-5"),
    ).resolves.toEqual({ ok: true, messageId: "message-5" });

    expect(mocks.emitMessageSendRequested).toHaveBeenCalledWith({
      messageId: "message-5",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
    });
  });
});

