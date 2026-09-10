import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Переводы строк нормализуем: на Windows рабочая копия приезжает с CRLF
// (core.autocrlf), а ожидания ниже написаны через LF.
function readMigration(name: string): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", name),
    "utf8",
  ).replaceAll("\r\n", "\n");
}

const migration = readMigration("20260910100000_ignored_senders.sql");

describe("ignored senders migration contract", () => {
  it("держит таблицу в границах workspace, за каскадом и за RLS", () => {
    // Правило 3 (docs/architecture/14-vibecoding-rules.md).
    expect(migration).toContain("create table public.ignored_senders (");
    expect(migration).toContain(
      "workspace_id uuid not null references public.workspaces(id) on delete cascade,",
    );
    expect(migration).toContain(
      "alter table public.ignored_senders enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.ignored_senders from anon;",
    );
    expect(migration).toContain("create policy ignored_senders_member_access");
    expect(migration).toContain("private.is_workspace_member(workspace_id)");
  });

  it("ключует список платформой, а не подключением — он переживает переподключение канала", () => {
    expect(migration).toContain("unique (workspace_id, platform, identifier)");
    // Внешнего ключа на channel_connections быть не должно: её каскад унёс бы
    // список при первом же «отключить → включить».
    expect(migration).not.toContain("references public.channel_connections");
  });

  it("не даёт записать ненормализованный адрес в обход формы", () => {
    // Гейт вебхука ищет по нормализованному значению: если бы в таблицу попал
    // «+49 151…», список молча перестал бы срабатывать.
    expect(migration).toContain("identifier = btrim(lower(identifier))");
  });
});
