import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Лизы — про конкурентность, а не про поведение прогона: у них свои тесты
// (lib/workflows/leases.test.ts), а здесь они только мешали бы, требуя
// workflow-контекста ради getWorkflowMetadata().
vi.mock("@/lib/workflows/leases", () => ({
  acquireLeases: vi.fn().mockResolvedValue(undefined),
  releaseLeases: vi.fn().mockResolvedValue(undefined),
  entityLease: (kind: string, id: string) => ({ key: `${kind}:${id}` }),
}));

const loadPostThumbnailContext = vi.fn();
const fetchAndSavePostThumbnail = vi.fn();
vi.mock("./post-thumbnail.steps", () => ({
  loadPostThumbnailContext: (...args: unknown[]) =>
    loadPostThumbnailContext(...args),
  fetchAndSavePostThumbnail: (...args: unknown[]) =>
    fetchAndSavePostThumbnail(...args),
}));

const { postThumbnailWorkflow } = await import("./post-thumbnail.workflow");
const { acquireLeases, releaseLeases } = await import("@/lib/workflows/leases");

const input = { workspaceId: "ws_1", postId: "post_1" };
const context = {
  provider: "zernio",
  externalAccountId: "acct_ig_1",
  postExternalId: "ig_post_1",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadPostThumbnailContext.mockResolvedValue({ status: "ok", context });
  fetchAndSavePostThumbnail.mockResolvedValue("updated");
});

describe("postThumbnailWorkflow", () => {
  it("fetches and saves a missing post thumbnail", async () => {
    await expect(postThumbnailWorkflow(input)).resolves.toEqual({
      status: "updated",
    });
    expect(fetchAndSavePostThumbnail).toHaveBeenCalledWith({
      workflowInput: input,
      context,
    });
  });

  it("does not call the provider when the thumbnail is already present", async () => {
    loadPostThumbnailContext.mockResolvedValue({
      status: "skip",
      reason: "already-present",
    });

    await expect(postThumbnailWorkflow(input)).resolves.toEqual({
      status: "skipped",
      reason: "already-present",
    });
    expect(fetchAndSavePostThumbnail).not.toHaveBeenCalled();
  });

  it("leaves the field empty so a later comment can retry", async () => {
    fetchAndSavePostThumbnail.mockResolvedValue("unavailable");

    await expect(postThumbnailWorkflow(input)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("holds a per-post lease and releases it even when a step throws", async () => {
    loadPostThumbnailContext.mockRejectedValue(new Error("boom"));

    await expect(postThumbnailWorkflow(input)).rejects.toThrow("boom");

    expect(acquireLeases).toHaveBeenCalledWith([{ key: "post:post_1" }]);
    expect(releaseLeases).toHaveBeenCalledWith([{ key: "post:post_1" }]);
  });
});
