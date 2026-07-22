import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("drafts Realtime migration", () => {
  it("adds drafts to the Supabase publication through a migration", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260722110000_enable_drafts_realtime.sql",
      ),
      "utf8",
    );

    expect(sql).toMatch(
      /alter publication supabase_realtime add table public\.drafts/i,
    );
  });
});

