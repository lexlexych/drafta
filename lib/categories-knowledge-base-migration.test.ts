import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Контракт миграции, сливающей категории с базой знаний.
 *
 * Проверяется текст SQL, а не живая база: тот же приём, что и в соседних
 * `*-migration.test.ts`. Смысл — поймать молчаливую потерю ключевого куска при
 * будущей правке файла (миграция уже применена и повторно не выполнится).
 */
// Переводы строк нормализуем: на Windows рабочая копия приезжает с CRLF
// (core.autocrlf), а ожидания ниже написаны через LF — в шаблонных строках
// TypeScript тоже LF, их спецификация нормализует при разборе.
const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260729100000_categories_as_knowledge_base.sql",
  ),
  "utf8",
).replaceAll("\r\n", "\n");

describe("categories-as-knowledge-base migration contract", () => {
  it("drops the old category model completely", () => {
    expect(migration).toContain("drop table if exists public.categories cascade");
    expect(migration).toContain(
      "alter table public.messages drop column if exists category_id",
    );
    expect(migration).toContain(
      "alter table public.conversations drop column if exists category_id",
    );

    for (const rpc of [
      "public.create_category",
      "public.update_category",
      "public.delete_category",
      "public.reorder_categories",
      "private.validate_category_channels",
      "private.validate_category_kb_files",
      "private.ensure_category_default_invariants",
      "private.strip_deleted_channel_from_categories",
    ]) {
      expect(migration, `${rpc} is still around`).toContain(
        `drop function if exists ${rpc}`,
      );
    }
  });

  it("frees kb_files.name from being a file name", () => {
    expect(migration).toContain(
      "drop constraint if exists kb_files_markdown_name_check",
    );
    // Уникальность имени наоборот становится несущей: по названию мы
    // разворачиваем ответ модели обратно в id.
    expect(migration).not.toContain("drop index kb_files_workspace_lower_name_idx");
  });

  it("adds the matched-category arrays and the filter index", () => {
    expect(migration).toContain(
      "alter table public.drafts\n  add column matched_kb_file_ids uuid[] not null default '{}'",
    );
    expect(migration).toContain(
      "alter table public.conversations\n  add column matched_kb_file_ids uuid[] not null default '{}'",
    );
    // Фильтр списка бесед — пересечение массивов, это GIN, а не btree.
    expect(migration).toContain(
      "create index conversations_matched_kb_files_idx\n  on public.conversations using gin (matched_kb_file_ids)",
    );
  });

  it("keeps a deleted category from lingering on conversations", () => {
    expect(migration).toContain(
      "create or replace function private.strip_deleted_kb_file_from_conversations()",
    );
    expect(migration).toContain("after delete on public.kb_files");
    expect(migration).toContain("pg_catalog.array_remove(matched_kb_file_ids, old.id)");
  });

  it("writes the categories through finalize_draft_generation, service-role only", () => {
    expect(migration).toContain(
      "create function public.finalize_draft_generation(\n  target_workspace_id uuid,",
    );
    expect(migration).toContain("matched_kb_file_ids uuid[] default '{}'");
    // Беседа получает набор последнего черновика целиком, а не в дополнение.
    expect(migration).toContain(
      "set matched_kb_file_ids = normalized_categories\n  where conversation.workspace_id = target_workspace_id",
    );
    expect(migration).toContain(
      "grant execute on function public.finalize_draft_generation(uuid, uuid, text, text, boolean, text, uuid[])\n  to service_role",
    );
  });

  it("stops seeding categories when a workspace is created", () => {
    expect(migration).toContain(
      "create or replace function public.create_workspace(",
    );
    expect(migration).not.toContain("'По умолчанию'");
    expect(migration).not.toContain("'Личное'");
  });

  it("rebuilds the dashboard breakdown on draft categories", () => {
    expect(migration).toContain(
      "left join lateral unnest(draft.matched_kb_file_ids) as matched(category_id)",
    );
    // Второго вызова LLM больше нет — строки классификации из ответа уходят,
    // но исторические токены остаются в 'total'.
    expect(migration).not.toContain("'message_classification'");
    expect(migration).not.toContain("'comment_classification'");
    expect(migration).toContain("coalesce(sum(total_tokens), 0) as all_total");
  });
});
