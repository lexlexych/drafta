import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const route = await import("./route");
const { generateDraft, regenerateDraft, inngestFunctions } = await import(
  "@/lib/inngest/functions"
);
const { DRAFT_PIPELINE_CONCURRENCY } = await import(
  "@/lib/inngest/functions/generate-draft"
);

describe("Inngest serve route", () => {
  it("registers generation and regeneration functions", () => {
    expect(inngestFunctions).toEqual([generateDraft, regenerateDraft]);
    expect(generateDraft.opts.concurrency).toEqual([
      ...DRAFT_PIPELINE_CONCURRENCY,
    ]);
    expect(regenerateDraft.opts.concurrency).toEqual([
      ...DRAFT_PIPELINE_CONCURRENCY,
    ]);
    expect(generateDraft.opts.onFailure).toBeTypeOf("function");
    expect(regenerateDraft.opts.onFailure).toBeTypeOf("function");
  });

  it("exports all App Router handlers", () => {
    expect(route.GET).toBeTypeOf("function");
    expect(route.POST).toBeTypeOf("function");
    expect(route.PUT).toBeTypeOf("function");
  });
});
