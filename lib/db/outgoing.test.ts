import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  acceptDraftForSend,
  createManualOutgoingMessage,
  markOutgoingMessageFailedAfterEmit,
  retryFailedOutgoingMessage,
} = await import("./outgoing");
import type { SupabaseClient } from "@supabase/supabase-js";

/** Self-returning query-builder stub; terminal calls resolve `result`. */
function queryClient(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const chain = vi.fn(() => builder);
  for (const method of ["update", "eq", "select"]) {
    builder[method] = chain;
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = undefined;

  const update = builder.update as ReturnType<typeof vi.fn>;
  const eq = builder.eq as ReturnType<typeof vi.fn>;

  // Awaiting the builder directly (no maybeSingle) must also resolve.
  const thenable = Object.assign(builder, {
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  });

  return {
    client: {
      rpc: vi.fn(async () => result),
      from: vi.fn(() => thenable),
    } as unknown as SupabaseClient & {
      rpc: ReturnType<typeof vi.fn>;
      from: ReturnType<typeof vi.fn>;
    },
    update,
    eq,
    maybeSingle: builder.maybeSingle as ReturnType<typeof vi.fn>,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("acceptDraftForSend", () => {
  it("calls the transactional RPC with a null reply_text (draft text wins server-side)", async () => {
    const { client } = queryClient({ data: "message-9", error: null });

    const result = await acceptDraftForSend(
      client,
      "workspace-1",
      "conversation-1",
      "draft-1",
    );

    expect(result).toEqual({ ok: true, messageId: "message-9" });
    expect(client.rpc).toHaveBeenCalledWith("accept_reply_for_send", {
      target_workspace_id: "workspace-1",
      target_conversation_id: "conversation-1",
      reply_text: null,
      target_draft_id: "draft-1",
    });
  });

  it("maps a null RPC result to the stale-draft conflict error", async () => {
    const { client } = queryClient({ data: null, error: null });

    await expect(
      acceptDraftForSend(client, "workspace-1", "conversation-1", "draft-1"),
    ).resolves.toEqual({
      ok: false,
      error: "Черновик уже изменился — обновите тред.",
    });
  });

  it("maps an RPC failure to a generic error", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { client } = queryClient({ data: null, error: { code: "P0001" } });

    await expect(
      acceptDraftForSend(client, "workspace-1", "conversation-1", "draft-1"),
    ).resolves.toEqual({ ok: false, error: "Не удалось подготовить отправку." });
    consoleErrorSpy.mockRestore();
  });
});

describe("createManualOutgoingMessage", () => {
  it("rejects blank text without touching the database", async () => {
    const { client } = queryClient({ data: null, error: null });

    await expect(
      createManualOutgoingMessage(client, "workspace-1", "conversation-1", "   "),
    ).resolves.toEqual({
      ok: false,
      error: "Текст сообщения не может быть пустым.",
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("passes the trimmed text with no draft id", async () => {
    const { client } = queryClient({ data: "message-3", error: null });

    const result = await createManualOutgoingMessage(
      client,
      "workspace-1",
      "conversation-1",
      "  Добрый день!  ",
    );

    expect(result).toEqual({ ok: true, messageId: "message-3" });
    expect(client.rpc).toHaveBeenCalledWith("accept_reply_for_send", {
      target_workspace_id: "workspace-1",
      target_conversation_id: "conversation-1",
      reply_text: "Добрый день!",
      target_draft_id: null,
    });
  });

  it("maps a null RPC result to a conversation-not-found error", async () => {
    const { client } = queryClient({ data: null, error: null });

    await expect(
      createManualOutgoingMessage(client, "workspace-1", "conversation-1", "hi"),
    ).resolves.toEqual({ ok: false, error: "Диалог не найден." });
  });
});

describe("retryFailedOutgoingMessage", () => {
  it("resets only a failed outgoing message of this workspace back to pending", async () => {
    const { client, update, eq } = queryClient({
      data: { id: "message-5" },
      error: null,
    });

    const result = await retryFailedOutgoingMessage(
      client,
      "workspace-1",
      "conversation-1",
      "message-5",
    );

    expect(result).toEqual({ ok: true, messageId: "message-5" });
    expect(client.from).toHaveBeenCalledWith("messages");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_status: "pending" }),
    );
    expect(eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["workspace_id", "workspace-1"],
        ["conversation_id", "conversation-1"],
        ["id", "message-5"],
        ["direction", "outgoing"],
        ["delivery_status", "failed"],
      ]),
    );
  });

  it("reports a conflict when the message is not failed anymore", async () => {
    const { client } = queryClient({ data: null, error: null });

    await expect(
      retryFailedOutgoingMessage(client, "workspace-1", "conversation-1", "m1"),
    ).resolves.toEqual({
      ok: false,
      error: "Сообщение уже изменилось — обновите тред.",
    });
  });
});

describe("markOutgoingMessageFailedAfterEmit", () => {
  it("moves a still-pending message to failed", async () => {
    const { client, update, eq } = queryClient({ data: null, error: null });

    await markOutgoingMessageFailedAfterEmit(client, "workspace-1", "message-5");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_status: "failed" }),
    );
    expect(eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["workspace_id", "workspace-1"],
        ["id", "message-5"],
        ["delivery_status", "pending"],
      ]),
    );
  });

  it("swallows update errors (best-effort compensation)", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { client } = queryClient({ data: null, error: { code: "500" } });

    await expect(
      markOutgoingMessageFailedAfterEmit(client, "workspace-1", "message-5"),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
