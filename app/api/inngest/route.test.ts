import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const route = await import("./route");
const { generateDraft, regenerateDraft, sendMessage, inngestFunctions } =
  await import("@/lib/inngest/functions");
const { DRAFT_PIPELINE_CONCURRENCY } = await import(
  "@/lib/inngest/functions/generate-draft"
);
const { SEND_PIPELINE_CONCURRENCY } = await import(
  "@/lib/inngest/functions/send-message"
);

describe("Inngest serve route", () => {
  it("registers generation, regeneration, and send functions", () => {
    expect(inngestFunctions).toEqual([generateDraft, regenerateDraft, sendMessage]);
    expect(generateDraft.opts.concurrency).toEqual([
      ...DRAFT_PIPELINE_CONCURRENCY,
    ]);
    expect(regenerateDraft.opts.concurrency).toEqual([
      ...DRAFT_PIPELINE_CONCURRENCY,
    ]);
    expect(generateDraft.opts.onFailure).toBeTypeOf("function");
    expect(regenerateDraft.opts.onFailure).toBeTypeOf("function");
  });

  it("serves outgoing sends with retries, bounded concurrency, and a failure hook", () => {
    expect(sendMessage.opts.retries).toBe(4);
    expect(sendMessage.opts.concurrency).toEqual([...SEND_PIPELINE_CONCURRENCY]);
    expect(sendMessage.opts.onFailure).toBeTypeOf("function");
  });

  it("exports all App Router handlers", () => {
    expect(route.GET).toBeTypeOf("function");
    expect(route.POST).toBeTypeOf("function");
    expect(route.PUT).toBeTypeOf("function");
  });
});
