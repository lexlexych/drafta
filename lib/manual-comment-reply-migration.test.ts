import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Переводы строк нормализуем: на Windows рабочая копия приезжает с CRLF
// (core.autocrlf), а многострочные ожидания ниже написаны через LF.
const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260828110000_manual_comment_reply.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");

describe("accept_manual_comment_reply migration contract", () => {
  it("takes the reply text instead of a draft id", () => {
    // Весь смысл функции: текст приходит из поля под комментарием, а не из
    // строки `comment_drafts`, как у accept_comment_draft_for_send.
    expect(migration).toContain("target_comment_id uuid,\n  reply_text text");
    expect(migration).not.toContain("comment_drafts");
  });

  it("answers the specific comment, which is what the provider needs", () => {
    // `parent_external_id` исходящей строки — external_id отвечаемого
    // комментария: его ждёт и send-comment, и POST /v1/inbox/comments/{postId}.
    expect(migration).toContain("select answered.post_id, answered.external_id");
    expect(migration).toContain("and answered.direction = 'incoming'");
    expect(migration).toContain("parent_external_id,");
  });

  it("inserts the reply pending and unsent, for Inngest to publish", () => {
    expect(migration).toContain("'outgoing',");
    expect(migration).toContain("'pending'");
  });

  it("refuses a blank reply before touching anything", () => {
    expect(migration).toContain(
      "outgoing_text text := nullif(pg_catalog.btrim(coalesce(reply_text, '')), '')",
    );
  });

  it("serialises replies under one post the same way the draft path does", () => {
    expect(migration).toContain("from public.posts as post");
    expect(migration).toContain("for update");
  });

  it("runs as the caller, so RLS is the tenant boundary", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "revoke all on function public.accept_manual_comment_reply(uuid, uuid, text)\n  from public",
    );
    expect(migration).toContain(
      "grant execute on function public.accept_manual_comment_reply(uuid, uuid, text)\n  to authenticated, service_role",
    );
  });
});
