import { afterEach, describe, expect, it, vi } from "vitest";

import { getSupabasePublicConfig } from "./env";

describe("getSupabasePublicConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the two public Supabase values", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");

    expect(getSupabasePublicConfig()).toEqual({
      publishableKey: "sb_publishable_example",
      url: "https://example.supabase.co",
    });
  });

  it("rejects missing or malformed public configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a URL");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");

    expect(() => getSupabasePublicConfig()).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid URL",
    );

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    expect(() => getSupabasePublicConfig()).toThrow(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });
});
