import type { CommentSendRequestedEvent } from "../events";
import { inngest } from "../client";
import { commentSendRequestedEvent } from "../events";
import {
  markCommentSendFailed,
  runSendCommentPipeline,
  type SendCommentSteps,
} from "./send-comment-pipeline";

/**
 * Per-post limit 1 orders «Отправить все» — replies under one post go out one
 * at a time — and prevents a duplicated event from publishing the same reply
 * twice (the pipeline's guards then no-op the loser).
 */
export const SEND_COMMENT_CONCURRENCY = [
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

function stepAdapter(step: unknown): SendCommentSteps {
  return step as SendCommentSteps;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * `send-comment`: publishing a reply runs through Inngest with retries, never
 * inside the request (vibecoding rule 8). Retries exhausted (or a provider
 * rejection) → onFailure marks the reply `failed`, which is what the thread
 * renders as «Не доставлено».
 */
export const sendComment = inngest.createFunction(
  {
    id: "send-comment",
    triggers: [commentSendRequestedEvent],
    retries: 4,
    concurrency: [...SEND_COMMENT_CONCURRENCY],
    onFailure: async ({ event, step }) => {
      const original = event.data.event.data as Partial<CommentSendRequestedEvent>;
      if (!isId(original.workspaceId) || !isId(original.replyCommentId)) {
        return;
      }

      await step.run("mark-comment-send-failed", () =>
        markCommentSendFailed({
          workspaceId: original.workspaceId!,
          replyCommentId: original.replyCommentId!,
        }),
      );
    },
  },
  async ({ event, step }) =>
    runSendCommentPipeline(event.data, stepAdapter(step)),
);
