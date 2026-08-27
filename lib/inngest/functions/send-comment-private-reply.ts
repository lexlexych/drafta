import type { CommentPrivateReplySendRequestedEvent } from "../events";
import { inngest } from "../client";
import { commentPrivateReplySendRequestedEvent } from "../events";
import {
  markPrivateReplyFailed,
  runSendCommentPrivateReplyPipeline,
  type SendCommentPrivateReplySteps,
} from "./send-comment-private-reply-pipeline";

/**
 * Per-post limit 1 keeps private replies under one post going out one at a
 * time and stops a duplicated event from writing to the same person twice —
 * the pipeline's guards then no-op the loser, and the unique key on
 * `comment_private_replies` is the last line of defence.
 */
export const SEND_COMMENT_PRIVATE_REPLY_CONCURRENCY = [
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

function stepAdapter(step: unknown): SendCommentPrivateReplySteps {
  return step as SendCommentPrivateReplySteps;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * `send-comment-private-reply`: a DM to the author of a comment goes through
 * Inngest with retries, never inside the request (vibecoding rule 8). Retries
 * exhausted — or the platform refusing outright, which arrives as a 400 and is
 * already non-retriable — leaves the row `failed`, which the screen renders as
 * «Не удалось отправить в ЛС».
 */
export const sendCommentPrivateReply = inngest.createFunction(
  {
    id: "send-comment-private-reply",
    triggers: [commentPrivateReplySendRequestedEvent],
    retries: 4,
    concurrency: [...SEND_COMMENT_PRIVATE_REPLY_CONCURRENCY],
    onFailure: async ({ event, step }) => {
      const original = event.data.event
        .data as Partial<CommentPrivateReplySendRequestedEvent>;
      if (!isId(original.workspaceId) || !isId(original.privateReplyId)) {
        return;
      }

      await step.run("mark-private-reply-failed", () =>
        markPrivateReplyFailed({
          workspaceId: original.workspaceId!,
          privateReplyId: original.privateReplyId!,
        }),
      );
    },
  },
  async ({ event, step }) =>
    runSendCommentPrivateReplyPipeline(event.data, stepAdapter(step)),
);
