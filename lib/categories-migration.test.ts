import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260721120000_categories_crud.sql",
  ),
  "utf8",
);

describe("categories migration contract", () => {
  it("provisions and protects the last default category", () => {
    expect(migration).toContain("insert into public.categories (");
    expect(migration).toContain("'По умолчанию'");
    expect(migration).toContain("categories_default_invariants");
    expect(migration).toContain("default_priority is distinct from last_priority");
    expect(migration).toContain("insert into public.ai_settings (workspace_id)");
  });

  it("exposes atomic member-scoped CRUD and reorder functions", () => {
    expect(migration).toContain("create function public.create_category(");
    expect(migration).toContain("create function public.update_category(");
    expect(migration).toContain("create function public.delete_category(");
    expect(migration).toContain("create function public.reorder_categories(");
    expect(migration).toContain("private.is_workspace_member(target_workspace_id)");
    expect(migration).toContain("set constraints categories_workspace_priority_key deferred");
    expect(migration).toContain("to authenticated, service_role");
  });
});
