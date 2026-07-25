import type { CommentDraftsRequestedEvent } from "../events";
import { inngest } from "../client";
import { commentDraftsRequestedEvent } from "../events";
import {
  cleanupGeneratingCommentDrafts,
  runCommentDraftsPipeline,
  type CommentDraftsSteps,
} from "./comment-draft-pipeline";

/**
 * One run per post at a time: a whole-post run and a single-comment regenerate
 * both write `comment_drafts` rows of the same post, and the "one live draft per
 * comment" index would otherwise be a race between them. The workspace pool
 * bounds LLM pressure per tenant, mirroring the DM draft pipeline.
 */
export const COMMENT_DRAFTS_CONCURRENCY = [
  {
    scope: "env" as const,
    key: '"workspace:" + event.data.workspaceId',
    limit: 2,
  },
  {
    scope: "env" as const,
    key: '"post:" + event.data.postId',
    limit: 1,
  },
] as const;

function stepAdapter(step: unknown): CommentDraftsSteps {
  // Same boundary cast as generate-draft.ts: Inngest types step.run as
  // Promise<Jsonify<T>> while every pipeline value is JSON-serializable.
  return step as CommentDraftsSteps;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * `generate-comment-drafts` — the only way a comment draft ever comes into
 * existence. Triggered by the «Черновики» dialog (whole post) or by a single
 * comment's «Создать черновик» / regenerate button, never by an incoming
 * comment.
 */
export const generateCommentDrafts = inngest.createFunction(
  {
    id: "generate-comment-drafts",
    triggers: [commentDraftsRequestedEvent],
    concurrency: [...COMMENT_DRAFTS_CONCURRENCY],
    onFailure: async ({ event, step }) => {
      const original = event.data.event.data as Partial<CommentDraftsRequestedEvent>;
      if (!isId(original.workspaceId) || !isId(original.postId)) {
        return;
      }

      await step.run("cleanup-generating-comment-drafts", () =>
        cleanupGeneratingCommentDrafts({
          workspaceId: original.workspaceId!,
          postId: original.postId!,
          ...(isId(original.commentId) ? { commentId: original.commentId } : {}),
        }),
      );
    },
  },
  async ({ event, step, logger }) =>
    runCommentDraftsPipeline(event.data, stepAdapter(step), undefined, {
      info: (message) => logger.info(message),
    }),
);
