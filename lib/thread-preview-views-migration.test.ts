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
    "20260828130000_add_thread_preview_views.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");

describe("thread preview views migration contract", () => {
  it("runs both views with the caller's rights, not the owner's", () => {
    // Без `security_invoker` вью исполнялось бы правами своего владельца и
    // показало бы чужой workspace мимо RLS — правило 3.
    expect(migration).toContain(
      "create view public.conversation_message_previews\nwith (security_invoker = on) as",
    );
    expect(migration).toContain(
      "create view public.post_comment_previews\nwith (security_invoker = on) as",
    );
  });

  it("takes exactly one row per conversation and per post", () => {
    expect(migration).toContain("select distinct on (m.conversation_id)");
    expect(migration).toContain("select distinct on (c.post_id)");
  });

  it("breaks a created_at tie by id, same as the thread pagination", () => {
    // Иначе «последняя» запись при совпавших отметках времени выбиралась бы
    // произвольно и превью прыгало бы между запросами.
    expect(migration).toContain(
      "order by m.conversation_id, m.created_at desc, m.id desc;",
    );
    expect(migration).toContain("order by c.post_id, c.created_at desc, c.id desc;");
  });

  it("counts incoming comments per post inside the database", () => {
    // Ради этого счётчика список постов и грузил раньше всю ленту в JS.
    expect(migration).toContain(
      "count(*) filter (where c.direction = 'incoming')\n    over (partition by c.post_id) as incoming_count",
    );
  });

  it("keeps workspace_id in both views for the explicit tenant filter", () => {
    expect(migration).toContain("m.workspace_id");
    expect(migration).toContain("c.workspace_id");
  });

  it("stays closed to anon", () => {
    for (const view of ["conversation_message_previews", "post_comment_previews"]) {
      expect(migration).toContain(`revoke all on table public.${view} from anon;`);
      expect(migration).toContain(
        `grant select on table public.${view} to authenticated;`,
      );
      expect(migration).toContain(
        `grant select on table public.${view} to service_role;`,
      );
    }
  });
});
