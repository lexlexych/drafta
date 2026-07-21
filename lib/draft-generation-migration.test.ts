import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260722100000_finalize_draft_generation.sql",
  ),
  "utf8",
);

describe("draft generation migration contract", () => {
  it("enforces one ready draft per conversation", () => {
    expect(migration).toContain(
      "create unique index drafts_one_ready_per_conversation_idx",
    );
    expect(migration).toContain("where status = 'ready'");
  });

  it("atomically scopes finalize and supersede to one workspace conversation", () => {
    expect(migration).toContain(
      "create function public.finalize_draft_generation(",
    );
    expect(migration).toContain("draft.workspace_id = target_workspace_id");
    expect(migration).toContain("for update");
    expect(migration).toContain("draft.status = 'ready'");
    expect(migration).toContain(
      "supersede_edited and draft.status = 'edited'",
    );
    expect(migration).toContain("to service_role");
  });
});
