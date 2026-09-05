import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const start = vi.fn();
const cancel = vi.fn();
const getRun = vi.fn(() => ({ cancel }));
vi.mock("workflow/api", () => ({
  start: (...a: unknown[]) => start(...a),
  getRun: (...a: unknown[]) => getRun(...a),
}));

const {
  cancelDraftGenerationRuns,
  startContactAvatarSync,
  startCommentDrafts,
  startGenerateDraft,
  startPostThumbnailSync,
  startPushNotify,
  startSendComment,
  startSendMessage,
  startSendPrivateReply,
} = await import("./start");

beforeEach(() => {
  vi.clearAllMocks();
  start.mockResolvedValue({ runId: "wrun_1" });
  cancel.mockResolvedValue(undefined);
  getRun.mockReturnValue({ cancel });
});

/** Всё, что уходит в аргументы прогона, — только идентификаторы (правило 7). */
const ID_ONLY = /^[a-z0-9-]+$/i;

describe("run arguments carry identifiers only", () => {
  it.each([
    [
      "generate-draft",
      () => startGenerateDraft({ conversationId: "c1", workspaceId: "w1" }),
    ],
    [
      "send-message",
      () => startSendMessage({ messageId: "m1", conversationId: "c1", workspaceId: "w1" }),
    ],
    [
      "send-push",
      () => startPushNotify({ messageId: "m1", conversationId: "c1", workspaceId: "w1" }),
    ],
    [
      "contact-avatar",
      () =>
        startContactAvatarSync({
          workspaceId: "w1",
          contactIdentityId: "ci1",
          conversationId: "c1",
        }),
    ],
    ["post-thumbnail", () => startPostThumbnailSync({ workspaceId: "w1", postId: "p1" })],
    ["comment-drafts", () => startCommentDrafts({ workspaceId: "w1", postId: "p1" })],
    [
      "send-comment",
      () => startSendComment({ workspaceId: "w1", postId: "p1", replyCommentId: "rc1" }),
    ],
    [
      "send-private-reply",
      () => startSendPrivateReply({ workspaceId: "w1", postId: "p1", privateReplyId: "pr1" }),
    ],
  ])("%s", async (_name, run) => {
    await run();

    const [, args] = start.mock.calls[0]!;
    for (const value of Object.values((args as [Record<string, string>])[0])) {
      expect(value).toMatch(ID_ONLY);
    }
  });
});

describe("run placement", () => {
  it("pins every run to fra1 rather than inheriting the caller's region", async () => {
    await startGenerateDraft({ conversationId: "c1", workspaceId: "w1" });

    expect(start).toHaveBeenCalledWith(expect.anything(), expect.any(Array), {
      region: "fra1",
    });
  });
});

describe("failure boundaries", () => {
  it.each([
    ["send-push", () => startPushNotify({ messageId: "m1", conversationId: "c1", workspaceId: "w1" })],
    [
      "contact-avatar",
      () =>
        startContactAvatarSync({
          workspaceId: "w1",
          contactIdentityId: "ci1",
          conversationId: "c1",
        }),
    ],
    ["post-thumbnail", () => startPostThumbnailSync({ workspaceId: "w1", postId: "p1" })],
  ])("%s swallows a failed start: the webhook already persisted its work", async (_n, run) => {
    start.mockRejectedValue(new Error("backend down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(run()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each([
    ["generate-draft", () => startGenerateDraft({ conversationId: "c1", workspaceId: "w1" })],
    [
      "send-message",
      () => startSendMessage({ messageId: "m1", conversationId: "c1", workspaceId: "w1" }),
    ],
    ["comment-drafts", () => startCommentDrafts({ workspaceId: "w1", postId: "p1" })],
    [
      "send-comment",
      () => startSendComment({ workspaceId: "w1", postId: "p1", replyCommentId: "rc1" }),
    ],
    [
      "send-private-reply",
      () => startSendPrivateReply({ workspaceId: "w1", postId: "p1", privateReplyId: "pr1" }),
    ],
  ])("%s propagates a failed start so the caller can compensate", async (_n, run) => {
    start.mockRejectedValue(new Error("backend down"));

    await expect(run()).rejects.toThrow("backend down");
  });
});

describe("cancelDraftGenerationRuns", () => {
  it("cancels every discarded draft's run", async () => {
    await cancelDraftGenerationRuns(["wrun_1", "wrun_2"]);

    expect(getRun).toHaveBeenCalledWith("wrun_1");
    expect(getRun).toHaveBeenCalledWith("wrun_2");
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("stays fail-safe: the draft is already discarded, the run may have finished", async () => {
    cancel.mockRejectedValue(new Error("run already completed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(cancelDraftGenerationRuns(["wrun_1"])).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does nothing when no generating draft was holding a run", async () => {
    await cancelDraftGenerationRuns([]);

    expect(getRun).not.toHaveBeenCalled();
  });
});
