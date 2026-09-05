import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/workflows/leases", () => ({
  acquireLeases: vi.fn().mockResolvedValue(undefined),
  releaseLeases: vi.fn().mockResolvedValue(undefined),
  workspaceSendLease: (id: string) => ({ key: `workspace-send:${id}` }),
  entityLease: (kind: string, id: string) => ({ key: `${kind}:${id}` }),
}));

const loadCommentSendContext = vi.fn();
const sendCommentViaAdapter = vi.fn();
const markCommentSent = vi.fn();
const markCommentSendFailedStep = vi.fn();
vi.mock("./send-comment.steps", () => ({
  loadCommentSendContext: (...a: unknown[]) => loadCommentSendContext(...a),
  sendCommentViaAdapter: (...a: unknown[]) => sendCommentViaAdapter(...a),
  markCommentSent: (...a: unknown[]) => markCommentSent(...a),
  markCommentSendFailedStep: (...a: unknown[]) => markCommentSendFailedStep(...a),
}));

const { sendCommentWorkflow } = await import("./send-comment.workflow");
const { acquireLeases } = await import("@/lib/workflows/leases");

const input = {
  workspaceId: "ws-1",
  postId: "post-1",
  replyCommentId: "reply-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadCommentSendContext.mockResolvedValue({ status: "ok", context: { text: "ok" } });
  sendCommentViaAdapter.mockResolvedValue("zc_1");
  markCommentSent.mockResolvedValue(undefined);
  markCommentSendFailedStep.mockResolvedValue(undefined);
});

describe("sendCommentWorkflow", () => {
  it("publishes the reply and records the provider id", async () => {
    await expect(sendCommentWorkflow(input)).resolves.toEqual({
      status: "sent",
      providerCommentId: "zc_1",
    });
    expect(markCommentSent).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      replyCommentId: "reply-1",
      providerCommentId: "zc_1",
    });
  });

  it("skips without publishing when the reply is no longer pending", async () => {
    loadCommentSendContext.mockResolvedValue({
      status: "skip",
      reason: "not-pending",
    });

    await expect(sendCommentWorkflow(input)).resolves.toEqual({
      status: "skipped",
      reason: "not-pending",
    });
    expect(sendCommentViaAdapter).not.toHaveBeenCalled();
  });

  it("marks the reply failed when the publish gives up", async () => {
    sendCommentViaAdapter.mockRejectedValue(new Error("nope"));

    await expect(sendCommentWorkflow(input)).rejects.toThrow("nope");
    expect(markCommentSendFailedStep).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      replyCommentId: "reply-1",
    });
  });

  it("serialises replies under one post", async () => {
    await sendCommentWorkflow(input);

    expect(acquireLeases).toHaveBeenCalledWith([
      { key: "workspace-send:ws-1" },
      { key: "post:post-1" },
    ]);
  });
});
