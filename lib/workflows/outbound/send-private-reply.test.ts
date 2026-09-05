import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/workflows/leases", () => ({
  acquireLeases: vi.fn().mockResolvedValue(undefined),
  releaseLeases: vi.fn().mockResolvedValue(undefined),
  workspaceSendLease: (id: string) => ({ key: `workspace-send:${id}` }),
  entityLease: (kind: string, id: string) => ({ key: `${kind}:${id}` }),
}));

const loadPrivateReplyContext = vi.fn();
const sendPrivateReplyViaAdapter = vi.fn();
const markPrivateReplySent = vi.fn();
const markPrivateReplyFailedStep = vi.fn();
vi.mock("./send-private-reply.steps", () => ({
  loadPrivateReplyContext: (...a: unknown[]) => loadPrivateReplyContext(...a),
  sendPrivateReplyViaAdapter: (...a: unknown[]) => sendPrivateReplyViaAdapter(...a),
  markPrivateReplySent: (...a: unknown[]) => markPrivateReplySent(...a),
  markPrivateReplyFailedStep: (...a: unknown[]) => markPrivateReplyFailedStep(...a),
}));

const { sendPrivateReplyWorkflow } = await import("./send-private-reply.workflow");
const { acquireLeases } = await import("@/lib/workflows/leases");

const input = {
  workspaceId: "ws-1",
  postId: "post-1",
  privateReplyId: "pr-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadPrivateReplyContext.mockResolvedValue({ status: "ok", context: { text: "ok" } });
  sendPrivateReplyViaAdapter.mockResolvedValue("zm_1");
  markPrivateReplySent.mockResolvedValue(undefined);
  markPrivateReplyFailedStep.mockResolvedValue(undefined);
});

describe("sendPrivateReplyWorkflow", () => {
  it("delivers the private reply and records the provider id", async () => {
    await expect(sendPrivateReplyWorkflow(input)).resolves.toEqual({
      status: "sent",
      providerMessageId: "zm_1",
    });
    expect(markPrivateReplySent).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      privateReplyId: "pr-1",
      providerMessageId: "zm_1",
    });
  });

  it("skips without delivering when the row is no longer pending", async () => {
    loadPrivateReplyContext.mockResolvedValue({
      status: "skip",
      reason: "not-pending",
    });

    await expect(sendPrivateReplyWorkflow(input)).resolves.toEqual({
      status: "skipped",
      reason: "not-pending",
    });
    expect(sendPrivateReplyViaAdapter).not.toHaveBeenCalled();
  });

  it("marks the row failed when the delivery gives up", async () => {
    sendPrivateReplyViaAdapter.mockRejectedValue(new Error("nope"));

    await expect(sendPrivateReplyWorkflow(input)).rejects.toThrow("nope");
    expect(markPrivateReplyFailedStep).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      privateReplyId: "pr-1",
    });
  });

  it("serialises private replies under one post", async () => {
    await sendPrivateReplyWorkflow(input);

    expect(acquireLeases).toHaveBeenCalledWith([
      { key: "workspace-send:ws-1" },
      { key: "post:post-1" },
    ]);
  });
});
