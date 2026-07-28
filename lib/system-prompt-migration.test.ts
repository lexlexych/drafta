import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMENT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from "./ai/default-prompts";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260728100000_workspace_system_prompts.sql",
  ),
  "utf8",
);

describe("workspace system prompts migration", () => {
  it("keeps the default templates byte-identical to lib/ai/default-prompts.ts", () => {
    // Дефолт колонки — единственный способ, которым новый workspace получает
    // шаблон, а форма настроек предлагает «Вернуть шаблон» из TS-константы.
    // Разъезд этих двух текстов был бы незаметен до первого сброса промпта.
    expect(migration).toContain(DEFAULT_SYSTEM_PROMPT);
    expect(migration).toContain(DEFAULT_COMMENT_SYSTEM_PROMPT);
    expect(migration).toContain(
      "add column system_prompt text not null default $prompt$",
    );
    expect(migration).toContain(
      "add column comment_system_prompt text not null default $prompt$",
    );
  });

  it("keeps the refusal contract inside the shipped template", () => {
    // Промпт редактируемый, поэтому маркер продублирован в неизменяемой секции
    // заземления (lib/ai/prompt.ts). Шаблон обязан объяснять тот же контракт,
    // иначе дефолтное поведение расходится с кодом.
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NEEDS_MANUAL_REVIEW:");
    // У комментариев выхода через маркер нет — там приглашение в личные
    // сообщения, см. groundingRules() без refusalMarker.
    expect(DEFAULT_COMMENT_SYSTEM_PROMPT).not.toContain("NEEDS_MANUAL_REVIEW");
    expect(DEFAULT_COMMENT_SYSTEM_PROMPT).toContain("в личные сообщения");
  });

  it("drops the settings that moved into the prompt text", () => {
    expect(migration).toContain("drop column tone");
    expect(migration).toContain("drop column language");
    expect(migration).toContain("drop column signature");
    expect(migration).toContain("ai_settings_system_prompt_length_check");
    expect(migration).toContain("ai_settings_comment_system_prompt_length_check");
  });

  it("seeds «Личное» before the default category and keeps the RPC service-role only", () => {
    expect(migration).toContain("'Личное'");
    // Дефолтная категория обязана остаться последней: инвариант
    // categories_default_invariants сверяет её priority с максимальным.
    expect(migration.indexOf("'Личное'")).toBeLessThan(
      migration.indexOf("'По умолчанию'"),
    );
    expect(migration).toContain("create or replace function public.create_workspace(");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "grant execute on function public.create_workspace(uuid, uuid, text, jsonb) to service_role",
    );
  });

  it("carries no backfill: the migration ships before the first workspace exists", () => {
    expect(migration).not.toContain("update public.ai_settings");
    expect(migration).not.toContain("insert into public.categories (workspace_id)");
    expect(migration).not.toContain("from public.workspaces as workspace");
  });
});
