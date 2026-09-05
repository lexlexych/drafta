import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/workflows/leases", () => ({
  acquireLeases: vi.fn().mockResolvedValue(undefined),
  releaseLeases: vi.fn().mockResolvedValue(undefined),
  workspaceLlmLease: (id: string) => ({ key: `workspace:${id}` }),
  entityLease: (kind: string, id: string) => ({ key: `${kind}:${id}` }),
}));

const loadCommentDraftsContext = vi.fn();
const startCommentDraft = vi.fn();
const generateCommentDraft = vi.fn();
const finalizeCommentDraft = vi.fn();
const cleanupGeneratingCommentDraftsStep = vi.fn();
const resolveGenerationModel = vi.fn();
vi.mock("./comment-drafts.steps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./comment-drafts.steps")>()),
  loadCommentDraftsContext: (...a: unknown[]) => loadCommentDraftsContext(...a),
  startCommentDraft: (...a: unknown[]) => startCommentDraft(...a),
  generateCommentDraft: (...a: unknown[]) => generateCommentDraft(...a),
  finalizeCommentDraft: (...a: unknown[]) => finalizeCommentDraft(...a),
  cleanupGeneratingCommentDraftsStep: (...a: unknown[]) =>
    cleanupGeneratingCommentDraftsStep(...a),
  resolveGenerationModel: (...a: unknown[]) => resolveGenerationModel(...a),
}));

const { commentDraftsWorkflow } = await import("./comment-drafts.workflow");
const { acquireLeases } = await import("@/lib/workflows/leases");

const input = { workspaceId: "ws-1", postId: "post-1" };

function context(targets: { commentId: string }[]) {
  return {
    workspaceId: "ws-1",
    postId: "post-1",
    targets,
    existingDraftTexts: ["Уже сочинённый ответ"],
    knowledgeBase: { usedFileIds: ["kb-1"] },
    aiSettings: { model: "mistral-large-latest" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadCommentDraftsContext.mockResolvedValue(
    context([{ commentId: "c-1" }, { commentId: "c-2" }]),
  );
  startCommentDraft.mockImplementation(async ({ commentId }) => `draft-${commentId}`);
  generateCommentDraft.mockImplementation(async ({ target }) => `ответ на ${target.commentId}`);
  finalizeCommentDraft.mockResolvedValue(undefined);
  cleanupGeneratingCommentDraftsStep.mockResolvedValue(undefined);
  resolveGenerationModel.mockImplementation((requested: string) => requested);
});

describe("commentDraftsWorkflow", () => {
  it("drafts a reply for every target comment", async () => {
    await expect(commentDraftsWorkflow(input)).resolves.toEqual({
      status: "done",
      generated: 2,
    });
    expect(finalizeCommentDraft).toHaveBeenCalledTimes(2);
  });

  it("lets each prompt see the replies drafted before it", async () => {
    await commentDraftsWorkflow(input);

    const [first, second] = generateCommentDraft.mock.calls.map(([a]) => a);
    expect(first.siblingDraftTexts).toEqual(["Уже сочинённый ответ"]);
    expect(second.siblingDraftTexts).toEqual([
      "Уже сочинённый ответ",
      "ответ на c-1",
    ]);
  });

  it("skips a comment that vanished, keeping the rest of the run", async () => {
    startCommentDraft.mockImplementation(async ({ commentId }) =>
      commentId === "c-1" ? null : `draft-${commentId}`,
    );

    await expect(commentDraftsWorkflow(input)).resolves.toEqual({
      status: "done",
      generated: 1,
    });
    expect(generateCommentDraft).toHaveBeenCalledTimes(1);
  });

  it("returns the skip reason without drafting anything", async () => {
    loadCommentDraftsContext.mockResolvedValue({
      skip: { status: "skipped", reason: "no-target-comments" },
    });

    await expect(commentDraftsWorkflow(input)).resolves.toEqual({
      status: "skipped",
      reason: "no-target-comments",
    });
    expect(startCommentDraft).not.toHaveBeenCalled();
  });

  it("clears half-written drafts when the run gives up", async () => {
    generateCommentDraft.mockRejectedValue(new Error("provider down"));

    await expect(commentDraftsWorkflow(input)).rejects.toThrow("provider down");
    expect(cleanupGeneratingCommentDraftsStep).toHaveBeenCalledWith(input);
  });

  it("holds the workspace LLM budget and the post lease", async () => {
    await commentDraftsWorkflow(input);

    expect(acquireLeases).toHaveBeenCalledWith([
      { key: "workspace:ws-1" },
      { key: "post:post-1" },
    ]);
  });
});
