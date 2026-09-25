import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real migration in PostgreSQL (PGlite): the secrets table must stay
// unreachable for end users and disappear together with its connection.
const db = new PGlite();
const workspace = "10000000-0000-4000-8000-000000000001";
const otherWorkspace = "10000000-0000-4000-8000-000000000002";
const connection = "40000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema private;
    create function private.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at = now(); return new; end $$;
    create table public.workspaces (id uuid primary key);
    create table public.channel_connections (
      id uuid primary key,
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      provider text not null,
      platform text not null,
      external_id text not null,
      unique (workspace_id, id),
      unique (workspace_id, provider, external_id)
    );
    grant select, insert, update, delete on public.channel_connections to authenticated;
  `);
  await db.exec(
    readFileSync(
      "supabase/migrations/20260923100000_channel_connection_secrets.sql",
      "utf8",
    ).replaceAll("\r\n", "\n"),
  );
  await db.query("insert into public.workspaces values ($1), ($2)", [
    workspace,
    otherWorkspace,
  ]);
  await db.query(
    "insert into public.channel_connections values ($1, $2, 'telegram', 'telegram', '7012345678')",
    [connection, workspace],
  );
  await db.query(
    "insert into public.channel_connection_secrets (channel_connection_id, workspace_id, encrypted_credentials) values ($1, $2, 'v1.a.b.c')",
    [connection, workspace],
  );
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("channel_connection_secrets migration", () => {
  it("enables RLS and grants nothing to anon or authenticated", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'channel_connection_secrets'",
    );
    expect(rows[0].relrowsecurity).toBe(true);

    for (const role of ["anon", "authenticated"]) {
      const privileges = await db.query<{ allowed: boolean }>(
        "select has_table_privilege($1, 'public.channel_connection_secrets', 'select') as allowed",
        [role],
      );
      expect(privileges.rows[0].allowed).toBe(false);
    }

    const service = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('service_role', 'public.channel_connection_secrets', 'select') as allowed",
    );
    expect(service.rows[0].allowed).toBe(true);
  });

  it("rejects secrets pointing at another workspace's connection", async () => {
    await expect(
      db.query(
        "insert into public.channel_connection_secrets (channel_connection_id, workspace_id, encrypted_credentials) values ($1, $2, 'v1.a.b.c')",
        [connection, otherWorkspace],
      ),
    ).rejects.toThrow();
  });

  it("allows one Telegram bot in only one workspace", async () => {
    await expect(
      db.query(
        "insert into public.channel_connections values ('40000000-0000-4000-8000-000000000002', $1, 'telegram', 'telegram', '7012345678')",
        [otherWorkspace],
      ),
    ).rejects.toThrow(/channel_connections_telegram_bot_unique/);

    // Other providers keep their per-workspace uniqueness only.
    await db.query(
      "insert into public.channel_connections values ('40000000-0000-4000-8000-000000000003', $1, 'zernio', 'instagram', 'acc_1'), ('40000000-0000-4000-8000-000000000004', $2, 'zernio', 'instagram', 'acc_1')",
      [workspace, otherWorkspace],
    );
  });

  it("deletes secrets together with the connection", async () => {
    await db.query("delete from public.channel_connections where id = $1", [connection]);

    const { rows } = await db.query(
      "select 1 from public.channel_connection_secrets where channel_connection_id = $1",
      [connection],
    );
    expect(rows).toEqual([]);
  });
});
