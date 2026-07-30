import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const route = await import("./route");
const {
  generateDraft,
  regenerateDraft,
  generateCommentDrafts,
  sendMessage,
  sendComment,
  sendPush,
  pushDigest,
  contactAvatar,
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
  it("registers generation, regeneration, and send functions", () => {
    expect(inngestFunctions).toEqual([
      generateDraft,
      regenerateDraft,
      generateCommentDrafts,
      sendMessage,
      sendComment,
      sendPush,
      pushDigest,
      contactAvatar,
    ]);
    expect(generateDraft.opts.concurrency).toEqual([
      ...DRAFT_PIPELINE_CONCURRENCY,
    ]);
    expect(regenerateDraft.opts.concurrency).toEqual([
      ...DRAFT_PIPELINE_CONCURRENCY,
    ]);
    expect(generateDraft.opts.onFailure).toBeTypeOf("function");
    expect(regenerateDraft.opts.onFailure).toBeTypeOf("function");
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

  it("serves the avatar lookup with retries and one run per contact identity", () => {
    expect(contactAvatar.opts.retries).toBe(2);
    // Two messages from the same person can't both call the provider; the
    // pipeline's TTL re-check then no-ops the second run.
    expect(contactAvatar.opts.concurrency).toEqual([
      {
        scope: "env",
        key: '"contact-identity:" + event.data.contactIdentityId',
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
