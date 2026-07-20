import { beforeEach, describe, expect, it, vi } from "vitest";

// `lib/inngest/client.ts` has `import "server-only"`, which throws outside a
// Next.js build (see lib/channels/zernio/index.ts's precedent) — neutralize
// the guard so this file can dynamically import the real module tree, same
// technique used across this suite for `server-only`-guarded modules.
vi.mock("server-only", () => ({}));

const sendMock = vi.fn();
vi.mock("./client", () => ({
  inngest: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}));

const { emitInteractionReceived } = await import("./events");

describe("emitInteractionReceived", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("sends interaction/received with exactly messageId, conversationId, workspaceId (rule 7)", async () => {
    sendMock.mockResolvedValueOnce(undefined);

    await emitInteractionReceived({
      messageId: "msg-1",
      conversationId: "conv-1",
      workspaceId: "ws-1",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      name: "interaction/received",
      data: { messageId: "msg-1", conversationId: "conv-1", workspaceId: "ws-1" },
    });

    // Explicit key-set guard: catches a future edit that quietly widens the
    // payload (e.g. adding message text or a contact name) beyond the typed
    // contract — the TypeScript type alone wouldn't catch that at a call
    // site using an object literal with an extra property removed by hand.
    const sentData = sendMock.mock.calls[0][0].data as Record<string, unknown>;
    expect(Object.keys(sentData).sort()).toEqual([
      "conversationId",
      "messageId",
      "workspaceId",
    ]);
  });

  it("is fail-safe: swallows a send() rejection instead of throwing", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMock.mockRejectedValueOnce(new Error("network unreachable"));

    await expect(
      emitInteractionReceived({
        messageId: "msg-1",
        conversationId: "conv-1",
        workspaceId: "ws-1",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });
});
