import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/workflows/leases", () => ({
  acquireLeases: vi.fn().mockResolvedValue(undefined),
  releaseLeases: vi.fn().mockResolvedValue(undefined),
  workspaceSendLease: (id: string) => ({ key: `workspace-send:${id}` }),
  entityLease: (kind: string, id: string) => ({ key: `${kind}:${id}` }),
}));

const loadSendContext = vi.fn();
const sendMessageViaAdapter = vi.fn();
const markMessageSent = vi.fn();
const markMessageSendFailedStep = vi.fn();
vi.mock("./send-message.steps", () => ({
  loadSendContext: (...a: unknown[]) => loadSendContext(...a),
  sendMessageViaAdapter: (...a: unknown[]) => sendMessageViaAdapter(...a),
  markMessageSent: (...a: unknown[]) => markMessageSent(...a),
  markMessageSendFailedStep: (...a: unknown[]) => markMessageSendFailedStep(...a),
}));

const { sendMessageWorkflow } = await import("./send-message.workflow");
const { acquireLeases, releaseLeases } = await import("@/lib/workflows/leases");

const context = {
  workspaceId: "workspace-1",
  messageId: "message-1",
  text: "Добрый день! Отвечаем на ваш вопрос.",
  provider: "zernio",
  channelConnectionId: "connection-1",
  externalAccountId: "acct_tg_98213",
  conversationExternalId: "chat_42",
};

const input = {
  workspaceId: "workspace-1",
  conversationId: "conversation-1",
  messageId: "message-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadSendContext.mockResolvedValue({ status: "ok", context });
  sendMessageViaAdapter.mockResolvedValue("zmsg_991");
  markMessageSent.mockResolvedValue(undefined);
  markMessageSendFailedStep.mockResolvedValue(undefined);
});

describe("sendMessageWorkflow", () => {
  it("loads context, sends via the adapter, and records the provider id", async () => {
    await expect(sendMessageWorkflow(input)).resolves.toEqual({
      status: "sent",
      providerMessageId: "zmsg_991",
    });

    expect(sendMessageViaAdapter).toHaveBeenCalledWith(context);
    expect(markMessageSent).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      messageId: "message-1",
      providerMessageId: "zmsg_991",
    });
    expect(markMessageSendFailedStep).not.toHaveBeenCalled();
  });

  it.each([
    "message-not-found",
    "not-outgoing",
    "already-sent",
    "not-pending",
    "connection-inactive",
  ] as const)("skips without sending when load-context reports %s", async (reason) => {
    loadSendContext.mockResolvedValue({ status: "skip", reason });

    await expect(sendMessageWorkflow(input)).resolves.toEqual({
      status: "skipped",
      reason,
    });
    expect(sendMessageViaAdapter).not.toHaveBeenCalled();
    expect(markMessageSent).not.toHaveBeenCalled();
    expect(markMessageSendFailedStep).not.toHaveBeenCalled();
  });

  it("compensates to failed when the send gives up, then rethrows", async () => {
    const providerError = Object.assign(new Error("window closed"), {
      status: 422,
    });
    sendMessageViaAdapter.mockRejectedValue(providerError);

    await expect(sendMessageWorkflow(input)).rejects.toBe(providerError);

    // Бывший onFailure: без этого в треде остался бы вечный `pending`
    // вместо кнопки «Повторить».
    expect(markMessageSendFailedStep).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      messageId: "message-1",
    });
  });

  it("holds the workspace and conversation leases, and always releases them", async () => {
    await sendMessageWorkflow(input);

    const expected = [
      { key: "workspace-send:workspace-1" },
      { key: "conversation:conversation-1" },
    ];
    expect(acquireLeases).toHaveBeenCalledWith(expected);
    expect(releaseLeases).toHaveBeenCalledWith(expected);
  });

  it("releases the leases even when the compensation itself throws", async () => {
    sendMessageViaAdapter.mockRejectedValue(new Error("boom"));
    markMessageSendFailedStep.mockRejectedValue(new Error("compensation failed"));

    await expect(sendMessageWorkflow(input)).rejects.toThrow("compensation failed");
    expect(releaseLeases).toHaveBeenCalled();
  });
});
