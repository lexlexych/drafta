import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rlsSeedFixtures, workspaceSeededTables } from "../tests/rls/fixtures";

const seedSource = readFileSync(
  join(process.cwd(), "supabase", "seed.sql"),
  "utf8",
);
const seed = seedSource.toLowerCase();

/**
 * Значения строк одного `insert into public.<table> (…) values (…), (…)` —
 * по позиции колонки в списке.
 *
 * Разбор текстом, а не запросом к базе: сьют статический и работает без
 * поднятого Supabase. Комментарии вырезаются до разбора: внутри вставок они
 * содержат запятые, и без этого шага запятая из комментария читалась бы как
 * разделитель значений и сдвигала все колонки строки.
 */
function seededRows(table: string): Record<string, string>[] {
  const source = seedSource.replace(/--[^\n]*/g, "");
  const header = new RegExp(
    `insert into public\\.${table} \\(([^)]*)\\)\\s*values`,
    "i",
  ).exec(source);

  if (!header) {
    return [];
  }

  const columns = header[1]!
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);

  const body = source.slice(header.index + header[0].length);
  const end = body.search(/\non conflict|\n;|\ninsert into/i);
  const tuples = (end === -1 ? body : body.slice(0, end)).match(/\(([^()]*)\)/g);

  return (tuples ?? []).map((tuple) => {
    const values = tuple
      .slice(1, -1)
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""));

    return Object.fromEntries(
      columns.map((column, index) => [column, values[index] ?? ""]),
    );
  });
}

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

  it("keeps at most one channel per platform in a workspace", () => {
    // `channel_connections_workspace_platform_key`
    // (20260721100000_workspace_zernio_profile_and_channel_platform.sql).
    // Сид пережил это правило с двумя Telegram в Workspace A и просто
    // переставал применяться: `supabase db reset --include-seed` падал на
    // уникальном ключе, а увидеть это можно было только запустив локальный
    // Supabase — то есть почти никогда.
    const seen = new Set<string>();

    for (const row of seededRows("channel_connections")) {
      const key = `${row.workspace_id}/${row.platform}`;

      expect(
        seen.has(key),
        `channel_connections: ${row.platform} встречается в одном workspace дважды`,
      ).toBe(false);
      seen.add(key);
    }

    // Разбор молча вернул бы пустой список при смене стиля вставки, и проверка
    // выше стала бы всегда зелёной.
    expect(seen.size).toBeGreaterThan(3);
  });
});
