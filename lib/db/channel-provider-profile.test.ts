import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// channel-provider-profile.ts imports "server-only" — neutralize it, same as
// lib/db/channel-connections.test.ts.
vi.mock("server-only", () => ({}));

import {
  getProviderProfileId,
  setProviderProfileId,
} from "./channel-provider-profile";

/**
 * Minimal chainable Supabase stub: `.from().select().eq().single()` returns
 * the given settings; `.from().update().eq()` captures the payload.
 */
function makeSupabase(settings: Record<string, unknown>) {
  const captured: { payload?: Record<string, unknown> } = {};
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { settings }, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          captured.payload = payload;
          return { error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;

  return { supabase, captured };
}

describe("lib/db/channel-provider-profile", () => {
  it("reads the stored provider profile id, or null when absent", async () => {
    const { supabase } = makeSupabase({
      foo: "bar",
      providerProfiles: { zernio: "prof_1" },
    });

    expect(await getProviderProfileId(supabase, "ws_1", "zernio")).toBe("prof_1");
    expect(await getProviderProfileId(supabase, "ws_1", "meta")).toBeNull();
  });

  it("returns null when the workspace has no providerProfiles yet", async () => {
    const { supabase } = makeSupabase({ foo: "bar" });
    expect(await getProviderProfileId(supabase, "ws_1", "zernio")).toBeNull();
  });

  it("merges the profile id without clobbering other settings or providers", async () => {
    const { supabase, captured } = makeSupabase({
      foo: "bar",
      providerProfiles: { meta: "m1" },
    });

    await setProviderProfileId(supabase, "ws_1", "zernio", "prof_z");

    expect(captured.payload).toEqual({
      settings: {
        foo: "bar",
        providerProfiles: { meta: "m1", zernio: "prof_z" },
      },
    });
  });
});
