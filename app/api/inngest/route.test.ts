import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const route = await import("./route");
const {
  generateDraft,
  generateCommentDrafts,
  sendMessage,
  sendComment,
  sendCommentPrivateReply,
  sendPush,
  pushDigest,
  cleanupAiRequestLog,
  contactAvatar,
  postThumbnail,
  inngestFunctions,
} = await import("@/lib/inngest/functions");
const { DRAFT_PIPELINE_CONCURRENCY } = await import(
  "@/lib/inngest/functions/generate-draft"
);
const { SEND_PIPELINE_CONCURRENCY } = await import(
  "@/lib/inngest/functions/send-message"
);
const { COMMENT_DRAFTS_CONCURRENCY } = await import(
  "@/lib/inngest/functions/generate-comment-drafts"
);
const { SEND_COMMENT_CONCURRENCY } = await import(
  "@/lib/inngest/functions/send-comment"
);

describe("Inngest serve route", () => {
  it("registers generation and send functions", () => {
    expect(inngestFunctions).toEqual([
      generateDraft,
      generateCommentDrafts,
      sendMessage,
      sendComment,
      sendCommentPrivateReply,
      sendPush,
      pushDigest,
      cleanupAiRequestLog,
      contactAvatar,
      postThumbnail,
    ]);
    expect(generateDraft.opts.concurrency).toEqual([
      ...DRAFT_PIPELINE_CONCURRENCY,
    ]);
    expect(generateDraft.opts.onFailure).toBeTypeOf("function");
  });

  it("lets «стоп» cancel a run by conversation", () => {
    // Без cancelOn кнопка «стоп» только гасила бы строку черновика, а прогон
    // продолжал бы жечь токены и в конце перезаписал бы поле ввода.
    expect(generateDraft.opts.cancelOn).toEqual([
      {
        event: expect.objectContaining({ name: "draft/generate.cancelled" }),
        if: "async.data.conversationId == event.data.conversationId",
      },
    ]);
  });

  it("serves comment drafts as their own function, one run per post", () => {
    expect(generateCommentDrafts.opts.concurrency).toEqual([
      ...COMMENT_DRAFTS_CONCURRENCY,
    ]);
    expect(generateCommentDrafts.opts.onFailure).toBeTypeOf("function");
  });

  it("serves comment replies with retries, bounded concurrency, and a failure hook", () => {
    expect(sendComment.opts.retries).toBe(4);
    expect(sendComment.opts.concurrency).toEqual([...SEND_COMMENT_CONCURRENCY]);
    expect(sendComment.opts.onFailure).toBeTypeOf("function");
  });

  it("serves outgoing sends with retries, bounded concurrency, and a failure hook", () => {
    expect(sendMessage.opts.retries).toBe(4);
    expect(sendMessage.opts.concurrency).toEqual([...SEND_PIPELINE_CONCURRENCY]);
    expect(sendMessage.opts.onFailure).toBeTypeOf("function");
  });

  it("serves the ai_request_log retention cron", () => {
    // Retention is the only thing keeping a log of prompts and answers
    // defensible (docs/architecture/15-compliance-gdpr.md), so an unregistered
    // or unscheduled cleanup is a compliance bug, not a missing nicety.
    expect(cleanupAiRequestLog.opts.triggers).toEqual([{ cron: "0 3 * * *" }]);
  });

  it("serves on-demand contact-avatar sync", () => {
    expect(contactAvatar.opts.retries).toBe(2);
  });

  it("serves post-thumbnail sync with bounded per-post concurrency", () => {
    expect(postThumbnail.opts.retries).toBe(2);
    expect(postThumbnail.opts.concurrency).toEqual([
      {
        scope: "env",
        key: '"post:" + event.data.postId',
        limit: 1,
      },
    ]);
  });

  it("exports all App Router handlers", () => {
    expect(route.GET).toBeTypeOf("function");
    expect(route.POST).toBeTypeOf("function");
    expect(route.PUT).toBeTypeOf("function");
  });
});
