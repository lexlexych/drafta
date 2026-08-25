import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runPostThumbnailPipeline } = await import("./post-thumbnail-pipeline");
import type {
  LoadedPostThumbnailContext,
  PostThumbnailDependencies,
  PostThumbnailSteps,
} from "./post-thumbnail-pipeline";

const steps: PostThumbnailSteps = {
  run: async (_id, handler) => handler(),
};

const input = { workspaceId: "ws_1", postId: "post_1" };
const context: LoadedPostThumbnailContext = {
  provider: "zernio",
  externalAccountId: "acct_ig_1",
  postExternalId: "ig_post_1",
};

function dependencies(
  overrides: Partial<PostThumbnailDependencies> = {},
): PostThumbnailDependencies {
  return {
    loadContext: vi.fn().mockResolvedValue({ status: "ok", context }),
    fetchAndSaveThumbnail: vi.fn().mockResolvedValue("updated"),
    ...overrides,
  };
}

describe("runPostThumbnailPipeline", () => {
  it("fetches and saves a missing post thumbnail", async () => {
    const deps = dependencies();

    await expect(runPostThumbnailPipeline(input, steps, deps)).resolves.toEqual({
      status: "updated",
    });
    expect(deps.fetchAndSaveThumbnail).toHaveBeenCalledWith({
      pipelineInput: input,
      context,
    });
  });

  it("does not call the provider when the thumbnail is already present", async () => {
    const deps = dependencies({
      loadContext: vi.fn().mockResolvedValue({
        status: "skip",
        reason: "already-present",
      }),
    });

    await expect(runPostThumbnailPipeline(input, steps, deps)).resolves.toEqual({
      status: "skipped",
      reason: "already-present",
    });
    expect(deps.fetchAndSaveThumbnail).not.toHaveBeenCalled();
  });

  it("leaves the field empty so a later comment can retry", async () => {
    const deps = dependencies({
      fetchAndSaveThumbnail: vi.fn().mockResolvedValue("unavailable"),
    });

    await expect(runPostThumbnailPipeline(input, steps, deps)).resolves.toEqual({
      status: "unavailable",
    });
  });
});
