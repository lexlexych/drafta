import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

const migrationFileNames = readdirSync(migrationsDirectory)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();

function readMigration(fileName: string): string {
  return readFileSync(join(migrationsDirectory, fileName), "utf8");
}

const UNQUALIFIED_SET_CONSTRAINTS =
  "set constraints categories_workspace_priority_key";
const QUALIFIED_SET_CONSTRAINTS =
  "set constraints public.categories_workspace_priority_key";

function lastMigrationContaining(needle: string): string | undefined {
  return migrationFileNames
    .filter((candidate) => readMigration(candidate).includes(needle))
    .at(-1);
}

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260721120000_categories_crud.sql",
  ),
  "utf8",
);

const constraintResolutionFix = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260721121000_fix_categories_constraint_resolution.sql",
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

  it("resolves the deferred priority constraint with an empty search path", () => {
    expect(constraintResolutionFix).toContain(
      "set constraints public.categories_workspace_priority_key deferred",
    );
    expect(constraintResolutionFix).toContain(
      "public.create_category(uuid,text,text,text,uuid[],text,boolean)",
    );
    expect(constraintResolutionFix).toContain(
      "public.delete_category(uuid,uuid)",
    );
    expect(constraintResolutionFix).toContain(
      "public.reorder_categories(uuid,uuid[])",
    );
  });

  // Пересоздание create_category в поздней миграции однажды уже вернуло
  // неквалифицированное имя ограничения и сломало создание категории (42704),
  // потому что исправление жило только в развёрнутой функции. Ни одна миграция
  // после последнего исправления не имеет права снова писать имя без схемы.
  it("never reintroduces the unqualified constraint after a fix", () => {
    const latestFix = lastMigrationContaining(QUALIFIED_SET_CONSTRAINTS);

    expect(latestFix, "no migration qualifies the deferred constraint").toBeDefined();

    const regressions = migrationFileNames
      .filter((fileName) => fileName > (latestFix as string))
      .filter((fileName) =>
        readMigration(fileName).includes(UNQUALIFIED_SET_CONSTRAINTS),
      );

    expect(regressions).toEqual([]);
  });

  it("re-creates create_category with the qualified constraint", () => {
    const latestDefinition = lastMigrationContaining(
      "function public.create_category(",
    );

    expect(latestDefinition).toBe(
      "20260727100000_requalify_create_category_constraint.sql",
    );
    expect(readMigration(latestDefinition as string)).toContain(
      `${QUALIFIED_SET_CONSTRAINTS} deferred`,
    );
  });
});
