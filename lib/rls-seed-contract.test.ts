import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rlsSeedFixtures, workspaceSeededTables } from "../tests/rls/fixtures";

const seed = readFileSync(
  join(process.cwd(), "supabase", "seed.sql"),
  "utf8",
).toLowerCase();

describe("RLS seed fixture contract", () => {
  it("keeps two login-capable fixture users and their fixed workspaces", () => {
    expect(seed).toContain("insert into auth.users");
    expect(seed).toContain("insert into auth.identities");
    expect(seed).toContain("provider_id");
    expect(seed).toContain("extensions.crypt");

    for (const fixture of [rlsSeedFixtures.ownerA, rlsSeedFixtures.ownerB]) {
      expect(seed).toContain(fixture.email);
      expect(seed).toContain(fixture.id);
      expect(seed).toContain(fixture.workspaceId);
    }
  });

  it("keeps data for every workspace-scoped table queried by the RLS suite", () => {
    for (const table of workspaceSeededTables) {
      expect(seed).toContain(`insert into public.${table.name}`);
    }

    expect(seed).toContain("insert into public.webhook_events");
    // Server-only like webhook_events, so it is seeded but never listed among
    // the workspace-scoped tables a member is expected to read.
    expect(seed).toContain("insert into public.ai_request_log");
  });
});
