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

const {
  contactAvatarSyncRequestedEvent,
  draftGenerateCancelledEvent,
  draftGenerateRequestedEvent,
  emitContactAvatarSyncRequested,
  emitDraftGenerateCancelled,
  emitDraftGenerateRequested,
  emitMessageSendRequested,
  emitPostThumbnailSyncRequested,
  emitPushNotifyRequested,
  messageSendRequestedEvent,
  postThumbnailSyncRequestedEvent,
  pushNotifyRequestedEvent,
} = await import("./events");

describe("Inngest event schemas", () => {
  it("accepts ID-only payloads for both event types", () => {
    expect(
      contactAvatarSyncRequestedEvent.create({
        workspaceId: "ws-1",
        contactIdentityId: "identity-1",
        conversationId: "conv-1",
      }),
    ).toMatchObject({
      name: "contact/avatar.sync-requested",
      data: {
        workspaceId: "ws-1",
        contactIdentityId: "identity-1",
        conversationId: "conv-1",
      },
    });

    expect(
      pushNotifyRequestedEvent.create({
        messageId: "msg-1",
        conversationId: "conv-1",
        workspaceId: "ws-1",
      }),
    ).toMatchObject({
      name: "push/notify.requested",
      data: {
        messageId: "msg-1",
        conversationId: "conv-1",
        workspaceId: "ws-1",
      },
    });

    expect(
      postThumbnailSyncRequestedEvent.create({
        workspaceId: "ws-1",
        postId: "post-1",
      }),
    ).toMatchObject({
      name: "post/thumbnail.sync-requested",
      data: { workspaceId: "ws-1", postId: "post-1" },
    });

    expect(
      draftGenerateRequestedEvent.create({
        conversationId: "conv-1",
        workspaceId: "ws-1",
      }),
    ).toMatchObject({
      name: "draft/generate.requested",
      data: { conversationId: "conv-1", workspaceId: "ws-1" },
    });

    expect(
      draftGenerateCancelledEvent.create({
        conversationId: "conv-1",
        workspaceId: "ws-1",
      }),
    ).toMatchObject({
      name: "draft/generate.cancelled",
      data: { conversationId: "conv-1", workspaceId: "ws-1" },
    });
  });

  it("rejects content fields at compile time", () => {
    pushNotifyRequestedEvent.create({
      messageId: "msg-1",
      conversationId: "conv-1",
      workspaceId: "ws-1",
      // @ts-expect-error Rule 7: content must never enter an Inngest payload.
      content: "personal message text",
    });

    draftGenerateRequestedEvent.create({
      conversationId: "conv-1",
      workspaceId: "ws-1",
      // @ts-expect-error Rule 7: names must never enter an Inngest payload.
      contactName: "Personal Name",
    });

    messageSendRequestedEvent.create({
      messageId: "msg-1",
      conversationId: "conv-1",
      workspaceId: "ws-1",
      // @ts-expect-error Rule 7: outgoing text must never enter an Inngest payload.
      text: "reply text",
    });

    contactAvatarSyncRequestedEvent.create({
      workspaceId: "ws-1",
      contactIdentityId: "identity-1",
      conversationId: "conv-1",
      // @ts-expect-error Rule 7: provider URLs must never enter an Inngest payload.
      avatarUrl: "https://cdn.example/avatar.jpg",
    });

    postThumbnailSyncRequestedEvent.create({
      workspaceId: "ws-1",
      postId: "post-1",
      // @ts-expect-error Rule 7: provider URLs must never enter an Inngest payload.
      thumbnailUrl: "https://cdn.example/post.jpg",
    });
  });
});

describe("emitContactAvatarSyncRequested", () => {
  it("sends exactly three IDs and is fail-safe", async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValueOnce(undefined);

    await emitContactAvatarSyncRequested({
      workspaceId: "ws-1",
      contactIdentityId: "identity-1",
      conversationId: "conv-1",
    });

    const sent = sendMock.mock.calls[0][0];
    expect(sent.name).toBe("contact/avatar.sync-requested");
    expect(Object.keys(sent.data).sort()).toEqual([
      "contactIdentityId",
      "conversationId",
      "workspaceId",
    ]);
  });
});

describe("emitPostThumbnailSyncRequested", () => {
  it("sends exactly workspaceId and postId and is fail-safe", async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValueOnce(undefined);

    await emitPostThumbnailSyncRequested({
      workspaceId: "ws-1",
      postId: "post-1",
    });

    const sent = sendMock.mock.calls[0][0];
    expect(sent).toMatchObject({
      name: "post/thumbnail.sync-requested",
      data: { workspaceId: "ws-1", postId: "post-1" },
    });
    expect(Object.keys(sent.data).sort()).toEqual(["postId", "workspaceId"]);
  });
});

describe("emitPushNotifyRequested", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("sends push/notify.requested with exactly messageId, conversationId, workspaceId (rule 7)", async () => {
    sendMock.mockResolvedValueOnce(undefined);

    await emitPushNotifyRequested({
      messageId: "msg-1",
      conversationId: "conv-1",
      workspaceId: "ws-1",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "push/notify.requested",
        data: { messageId: "msg-1", conversationId: "conv-1", workspaceId: "ws-1" },
      }),
    );

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
      emitPushNotifyRequested({
        messageId: "msg-1",
        conversationId: "conv-1",
        workspaceId: "ws-1",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });
});

describe("emitDraftGenerateRequested", () => {
  it("sends exactly the two ID fields", async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValueOnce(undefined);

    await emitDraftGenerateRequested({
      conversationId: "conv-1",
      workspaceId: "ws-1",
    });

    const sent = sendMock.mock.calls[0][0];
    expect(sent).toMatchObject({
      name: "draft/generate.requested",
      data: { conversationId: "conv-1", workspaceId: "ws-1" },
    });
    expect(Object.keys(sent.data).sort()).toEqual([
      "conversationId",
      "workspaceId",
    ]);
  });

  it("throws on a send() rejection so the locked composer learns about it", async () => {
    sendMock.mockReset();
    sendMock.mockRejectedValueOnce(new Error("inngest down"));

    await expect(
      emitDraftGenerateRequested({
        conversationId: "conv-1",
        workspaceId: "ws-1",
      }),
    ).rejects.toThrow("inngest down");
  });
});

describe("emitDraftGenerateCancelled", () => {
  it("sends exactly the two ID fields so cancelOn can match the conversation", async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValueOnce(undefined);

    await emitDraftGenerateCancelled({
      conversationId: "conv-1",
      workspaceId: "ws-1",
    });

    const sent = sendMock.mock.calls[0][0];
    expect(sent).toMatchObject({
      name: "draft/generate.cancelled",
      data: { conversationId: "conv-1", workspaceId: "ws-1" },
    });
    expect(Object.keys(sent.data).sort()).toEqual([
      "conversationId",
      "workspaceId",
    ]);
  });

  it("is fail-safe: the caller already discarded the draft", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMock.mockReset();
    sendMock.mockRejectedValueOnce(new Error("inngest down"));

    await expect(
      emitDraftGenerateCancelled({
        conversationId: "conv-1",
        workspaceId: "ws-1",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });
});

describe("emitMessageSendRequested", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("sends message/send with exactly the three ID fields (rule 7)", async () => {
    sendMock.mockResolvedValueOnce(undefined);

    await emitMessageSendRequested({
      messageId: "msg-1",
      conversationId: "conv-1",
      workspaceId: "ws-1",
    });

    const sent = sendMock.mock.calls[0][0];
    expect(sent).toMatchObject({
      name: "message/send",
      data: { messageId: "msg-1", conversationId: "conv-1", workspaceId: "ws-1" },
    });
    expect(Object.keys(sent.data).sort()).toEqual([
      "conversationId",
      "messageId",
      "workspaceId",
    ]);
  });

  it("throws on a send() rejection so the caller can mark the message failed", async () => {
    sendMock.mockRejectedValueOnce(new Error("network unreachable"));

    await expect(
      emitMessageSendRequested({
        messageId: "msg-1",
        conversationId: "conv-1",
        workspaceId: "ws-1",
      }),
    ).rejects.toThrow("network unreachable");
  });
});
