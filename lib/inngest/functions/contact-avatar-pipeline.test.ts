import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runContactAvatarPipeline } = await import("./contact-avatar-pipeline");
import type {
  ContactAvatarDependencies,
  ContactAvatarSteps,
  LoadedAvatarContext,
} from "./contact-avatar-pipeline";

// Same trivial step runner the other pipeline suites use: run the handler,
// return its value — Inngest's durability is not what these tests are about.
const steps: ContactAvatarSteps = {
  run: async (_id, handler) => handler(),
};

const input = {
  workspaceId: "ws_1",
  contactIdentityId: "ci_1",
  channelConnectionId: "cc_1",
};

function context(
  overrides: Partial<LoadedAvatarContext> = {},
): LoadedAvatarContext {
  return {
    provider: "zernio",
    externalAccountId: "acct_ig_1",
    participantExternalId: "ig_user_1",
    currentAvatarUrl: null,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<ContactAvatarDependencies> = {},
): ContactAvatarDependencies {
  return {
    loadContext: vi.fn().mockResolvedValue({ status: "ok", context: context() }),
    fetchAvatar: vi.fn().mockResolvedValue(null),
    saveAvatar: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runContactAvatarPipeline", () => {
  it("stores a found picture and reports it as updated", async () => {
    const deps = dependencies({
      fetchAvatar: vi.fn().mockResolvedValue("https://x/photo.jpg"),
    });

    const result = await runContactAvatarPipeline(input, steps, deps);

    expect(result).toEqual({ status: "updated", avatarUrl: "https://x/photo.jpg" });
    expect(deps.saveAvatar).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        contactIdentityId: "ci_1",
        avatarUrl: "https://x/photo.jpg",
      }),
    );
  });

  it("records the attempt even when the platform has no picture, without clearing the old one", async () => {
    const deps = dependencies({
      loadContext: vi.fn().mockResolvedValue({
        status: "ok",
        context: context({ currentAvatarUrl: "https://x/old.jpg" }),
      }),
      fetchAvatar: vi.fn().mockResolvedValue(null),
    });

    const result = await runContactAvatarPipeline(input, steps, deps);

    // `avatarUrl: null` is the "asked, found nothing" signal — the writer moves
    // only the timestamp, so the next message doesn't ask again for a month.
    expect(result).toEqual({ status: "unchanged" });
    expect(deps.saveAvatar).toHaveBeenCalledWith(
      expect.objectContaining({ avatarUrl: null }),
    );
    const saved = vi.mocked(deps.saveAvatar).mock.calls[0][0];
    expect(saved.fetchedAtIso).toEqual(expect.any(String));
  });

  it("reports an unchanged URL as unchanged", async () => {
    const deps = dependencies({
      loadContext: vi.fn().mockResolvedValue({
        status: "ok",
        context: context({ currentAvatarUrl: "https://x/same.jpg" }),
      }),
      fetchAvatar: vi.fn().mockResolvedValue("https://x/same.jpg"),
    });

    expect(await runContactAvatarPipeline(input, steps, deps)).toEqual({
      status: "unchanged",
    });
  });

  it("never calls the provider when the stored avatar is still fresh", async () => {
    const deps = dependencies({
      loadContext: vi
        .fn()
        .mockResolvedValue({ status: "skip", reason: "still-fresh" }),
    });

    const result = await runContactAvatarPipeline(input, steps, deps);

    expect(result).toEqual({ status: "skipped", reason: "still-fresh" });
    expect(deps.fetchAvatar).not.toHaveBeenCalled();
    expect(deps.saveAvatar).not.toHaveBeenCalled();
  });

  it("skips a disconnected channel without touching the provider", async () => {
    const deps = dependencies({
      loadContext: vi
        .fn()
        .mockResolvedValue({ status: "skip", reason: "connection-inactive" }),
    });

    const result = await runContactAvatarPipeline(input, steps, deps);

    expect(result).toEqual({ status: "skipped", reason: "connection-inactive" });
    expect(deps.fetchAvatar).not.toHaveBeenCalled();
  });

  it("passes the post through for a comment author's lookup", async () => {
    const deps = dependencies({
      loadContext: vi.fn().mockResolvedValue({
        status: "ok",
        context: context({ postExternalId: "ig_post_88401" }),
      }),
      fetchAvatar: vi.fn().mockResolvedValue("https://x/author.jpg"),
    });

    await runContactAvatarPipeline({ ...input, postId: "post_1" }, steps, deps);

    expect(deps.fetchAvatar).toHaveBeenCalledWith(
      expect.objectContaining({ postExternalId: "ig_post_88401" }),
    );
  });
});
