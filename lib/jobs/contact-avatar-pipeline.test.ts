import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runContactAvatarPipeline } = await import("./contact-avatar-pipeline");
import type {
  ContactAvatarDependencies,
  ContactAvatarSteps,
  LoadedAvatarContext,
} from "./contact-avatar-pipeline";

const steps: ContactAvatarSteps = {
  run: async (_id, handler) => handler(),
};

const input = {
  workspaceId: "ws_1",
  contactIdentityId: "identity_1",
  conversationId: "conversation_1",
};

const context: LoadedAvatarContext = {
  provider: "zernio",
  externalAccountId: "acct_ig_1",
  participantExternalId: "ig_user_1",
  conversationExternalId: "zernio_conversation_1",
  currentAvatarUrl: null,
};

function dependencies(
  overrides: Partial<ContactAvatarDependencies> = {},
): ContactAvatarDependencies {
  return {
    loadContext: vi.fn().mockResolvedValue({ status: "ok", context }),
    fetchAndSaveAvatar: vi.fn().mockResolvedValue({ changed: false }),
    ...overrides,
  };
}

describe("runContactAvatarPipeline", () => {
  it("fetches and saves a stale participant avatar", async () => {
    const deps = dependencies({
      fetchAndSaveAvatar: vi.fn().mockResolvedValue({ changed: true }),
    });

    await expect(runContactAvatarPipeline(input, steps, deps)).resolves.toEqual({
      status: "updated",
    });
    expect(deps.fetchAndSaveAvatar).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineInput: input, context }),
    );
  });

  it("does not call the provider when the identity is still fresh", async () => {
    const deps = dependencies({
      loadContext: vi.fn().mockResolvedValue({
        status: "skip",
        reason: "still-fresh",
      }),
    });

    await expect(runContactAvatarPipeline(input, steps, deps)).resolves.toEqual({
      status: "skipped",
      reason: "still-fresh",
    });
    expect(deps.fetchAndSaveAvatar).not.toHaveBeenCalled();
  });
});
