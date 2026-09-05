import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getCurrentWorkspace: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  markConversationRead: vi.fn(),
  discardConversationDraft: vi.fn(),
  discardGeneratingConversationDraft: vi.fn(),
  canGenerateConversationDraft: vi.fn(),
  startGenerateDraft: vi.fn(),
  cancelDraftGenerationRuns: vi.fn(),
  startSendMessage: vi.fn(),
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
  discardConversationDraft: mocks.discardConversationDraft,
  discardGeneratingConversationDraft: mocks.discardGeneratingConversationDraft,
  canGenerateConversationDraft: mocks.canGenerateConversationDraft,
}));
vi.mock("@/lib/workflows/start", () => ({
  startGenerateDraft: mocks.startGenerateDraft,
  cancelDraftGenerationRuns: mocks.cancelDraftGenerationRuns,
  startSendMessage: mocks.startSendMessage,
}));
vi.mock("@/lib/db/outgoing", () => ({
  createManualOutgoingMessage: mocks.createManualOutgoingMessage,
  retryFailedOutgoingMessage: mocks.retryFailedOutgoingMessage,
  markOutgoingMessageFailedAfterEmit: mocks.markOutgoingMessageFailedAfterEmit,
}));

import {
  cancelDraftGenerationAction,
  discardDraftAction,
  generateDraftAction,
  retrySendMessageAction,
  sendManualMessageAction,
} from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
  mocks.getCurrentWorkspace.mockResolvedValue({ id: "workspace-1" });
  mocks.createServerSupabaseClient.mockResolvedValue({ marker: "rls-client" });
});

describe("draft server actions", () => {
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

  it("emits generation with exactly conversationId and workspaceId", async () => {
    mocks.canGenerateConversationDraft.mockResolvedValue({ ok: true });
    mocks.startGenerateDraft.mockResolvedValue(undefined);

    await expect(generateDraftAction("conversation-1")).resolves.toEqual({
      ok: true,
    });

    const payload = mocks.startGenerateDraft.mock.calls[0][0];
    expect(payload).toEqual({
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
    });
    expect(Object.keys(payload).sort()).toEqual([
      "conversationId",
      "workspaceId",
    ]);
  });

  it("does not emit for a conversation outside the caller's workspace", async () => {
    mocks.canGenerateConversationDraft.mockResolvedValue({
      ok: false,
      error: "Диалог не найден.",
    });

    await expect(generateDraftAction("conversation-other")).resolves.toEqual({
      ok: false,
      error: "Диалог не найден.",
    });
    expect(mocks.startGenerateDraft).not.toHaveBeenCalled();
  });

  it("refuses a conversation with nothing incoming instead of locking the field", async () => {
    mocks.canGenerateConversationDraft.mockResolvedValue({
      ok: false,
      error: "Нет входящих сообщений для ответа.",
    });

    await expect(generateDraftAction("conversation-1")).resolves.toEqual({
      ok: false,
      error: "Нет входящих сообщений для ответа.",
    });
    expect(mocks.startGenerateDraft).not.toHaveBeenCalled();
  });

  it("discards the generating draft first, then cancels its run", async () => {
    mocks.discardGeneratingConversationDraft.mockResolvedValue({
      ok: true,
      runIds: ["wrun_1"],
    });
    mocks.cancelDraftGenerationRuns.mockResolvedValue(undefined);

    await expect(
      cancelDraftGenerationAction("conversation-1"),
    ).resolves.toEqual({ ok: true });

    // Разблокировка поля — это именно UPDATE черновика; отмена прогона лишь
    // экономит остаток работы.
    expect(mocks.discardGeneratingConversationDraft).toHaveBeenCalledWith(
      { marker: "rls-client" },
      "workspace-1",
      "conversation-1",
    );
    // Прогон снимается адресно: id пришёл из погашенной строки черновика.
    expect(mocks.cancelDraftGenerationRuns).toHaveBeenCalledWith(["wrun_1"]);
  });

  it("does not cancel the run when the draft could not be discarded", async () => {
    mocks.discardGeneratingConversationDraft.mockResolvedValue({
      ok: false,
      error: "Не удалось остановить генерацию.",
    });

    await expect(
      cancelDraftGenerationAction("conversation-1"),
    ).resolves.toEqual({
      ok: false,
      error: "Не удалось остановить генерацию.",
    });
    expect(mocks.cancelDraftGenerationRuns).not.toHaveBeenCalled();
  });
});

describe("send server actions", () => {
  it("sends the composer text and emits an ID-only message/send", async () => {
    mocks.createManualOutgoingMessage.mockResolvedValue({
      ok: true,
      messageId: "message-3",
    });
    mocks.startSendMessage.mockResolvedValue(undefined);

    await expect(
      sendManualMessageAction("conversation-1", "Добрый день!"),
    ).resolves.toEqual({ ok: true, messageId: "message-3" });

    expect(mocks.createManualOutgoingMessage).toHaveBeenCalledWith(
      { marker: "rls-client" },
      "workspace-1",
      "conversation-1",
      "Добрый день!",
      null,
    );
    const payload = mocks.startSendMessage.mock.calls[0][0];
    expect(payload).toEqual({
      messageId: "message-3",
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

  it("passes the source draft through so it closes as sent, not superseded", async () => {
    mocks.createManualOutgoingMessage.mockResolvedValue({
      ok: true,
      messageId: "message-4",
    });
    mocks.startSendMessage.mockResolvedValue(undefined);

    await sendManualMessageAction(
      "conversation-1",
      "Отредактированный черновик",
      "draft-1",
    );

    expect(mocks.createManualOutgoingMessage).toHaveBeenCalledWith(
      { marker: "rls-client" },
      "workspace-1",
      "conversation-1",
      "Отредактированный черновик",
      "draft-1",
    );
  });

  it("does not emit when the conversation is gone", async () => {
    mocks.createManualOutgoingMessage.mockResolvedValue({
      ok: false,
      error: "Диалог не найден.",
    });

    await expect(
      sendManualMessageAction("conversation-1", "Добрый день!"),
    ).resolves.toEqual({ ok: false, error: "Диалог не найден." });
    expect(mocks.startSendMessage).not.toHaveBeenCalled();
  });

  it("marks the persisted message failed when the emit itself fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.createManualOutgoingMessage.mockResolvedValue({
      ok: true,
      messageId: "message-9",
    });
    mocks.startSendMessage.mockRejectedValue(new Error("workflow backend down"));
    mocks.markOutgoingMessageFailedAfterEmit.mockResolvedValue(undefined);

    const result = await sendManualMessageAction("conversation-1", "Ответ");

    expect(result.ok).toBe(false);
    expect(mocks.markOutgoingMessageFailedAfterEmit).toHaveBeenCalledWith(
      { marker: "rls-client" },
      "workspace-1",
      "message-9",
    );
    consoleErrorSpy.mockRestore();
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
    expect(mocks.startSendMessage).not.toHaveBeenCalled();
  });

  it("re-emits message/send after a successful failed→pending reset", async () => {
    mocks.retryFailedOutgoingMessage.mockResolvedValue({
      ok: true,
      messageId: "message-5",
    });
    mocks.startSendMessage.mockResolvedValue(undefined);

    await expect(
      retrySendMessageAction("conversation-1", "message-5"),
    ).resolves.toEqual({ ok: true, messageId: "message-5" });

    expect(mocks.startSendMessage).toHaveBeenCalledWith({
      messageId: "message-5",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
    });
  });
});
