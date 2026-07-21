import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const route = await import("./route");
const { generateDraft, inngestFunctions } = await import("@/lib/inngest/functions");

describe("Inngest serve route", () => {
  it("registers the generate-draft function", () => {
    expect(inngestFunctions).toEqual([generateDraft]);
  });

  it("exports all App Router handlers", () => {
    expect(route.GET).toBeTypeOf("function");
    expect(route.POST).toBeTypeOf("function");
    expect(route.PUT).toBeTypeOf("function");
  });
});
