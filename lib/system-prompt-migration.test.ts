import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AI_SYSTEM_PROMPT_MAX_LENGTH,
  DEFAULT_COMMENT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from "./ai/default-prompts";

function migrationSql(name: string): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", name),
    "utf8",
  );
}

const migration = migrationSql("20260728100000_workspace_system_prompts.sql");
/**
 * Шаблоны правятся новой миграцией, а не правкой уже применённой: та не
 * выполняется повторно, и дефолт колонки в базе остался бы старым.
 */
const templates = migrationSql("20260729120000_default_prompt_address_form.sql");

describe("workspace system prompts migration", () => {
  it("keeps the default templates byte-identical to lib/ai/default-prompts.ts", () => {
    // Дефолт колонки — единственный способ, которым новый workspace получает
    // шаблон, а форма настроек предлагает «Вернуть шаблон» из TS-константы.
    // Разъезд этих двух текстов был бы незаметен до первого сброса промпта.
    expect(templates).toContain(DEFAULT_SYSTEM_PROMPT);
    expect(templates).toContain(DEFAULT_COMMENT_SYSTEM_PROMPT);
    expect(templates).toContain(
      "alter column system_prompt set default $prompt$",
    );
    expect(templates).toContain(
      "alter column comment_system_prompt set default $prompt$",
    );
    // Бэкфилла быть не должно: system_prompt редактируемый, и перезапись
    // стёрла бы текст, который workspace уже настроил под себя.
    expect(templates).not.toContain("update public.ai_settings");
  });

  it("ships templates the settings form would accept", () => {
    // Шаблон длиннее лимита прошёл бы тесты, но упал бы на сохранении формы и
    // на check-констрейнте колонки.
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeLessThanOrEqual(
      AI_SYSTEM_PROMPT_MAX_LENGTH,
    );
    expect(DEFAULT_COMMENT_SYSTEM_PROMPT.length).toBeLessThanOrEqual(
      AI_SYSTEM_PROMPT_MAX_LENGTH,
    );
  });

  it("creates the columns with a template default in the original migration", () => {
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

  it("puts the language rule ahead of tone in both templates", () => {
    // Правило языка стояло последней строкой блока про тон, и приветствие,
    // скопированное у клиента, уезжало в язык базы знаний:
    // «Привет! Für die Teilnahme…».
    for (const template of [
      DEFAULT_SYSTEM_PROMPT,
      DEFAULT_COMMENT_SYSTEM_PROMPT,
    ]) {
      const language = template.indexOf("## Язык ответа");
      expect(language).toBeGreaterThan(-1);
      expect(language).toBeLessThan(template.indexOf("## Тон и приветствие"));
      expect(template).toContain("не смешивай языки в одном");
    }
  });

  it("gives the form of address its own block in both templates", () => {
    // Обращение было одной строкой внутри блока про тон и держалось на
    // приветствии: у вопроса «Вы продаете что-то кроме одежды?» приветствия нет,
    // и немецкая база знаний на du перетягивала черновик на «ты».
    for (const template of [
      DEFAULT_SYSTEM_PROMPT,
      DEFAULT_COMMENT_SYSTEM_PROMPT,
    ]) {
      const address = template.indexOf("## Обращение: на «вы» или на «ты»");
      expect(address).toBeGreaterThan(-1);
      expect(address).toBeGreaterThan(template.indexOf("## Язык ответа"));
      expect(address).toBeLessThan(template.indexOf("## Тон и приветствие"));
      // Форма выбирается по местоимениям клиента и переносится в язык ответа.
      expect(template).toContain("сначала");
      expect(template).toContain("написавшему «Вы» отвечай Sie");
      // Источники — не сигнал: ни для языка, ни для обращения.
      expect(template).toContain("а не разрешение обращаться");
    }
    // Правило приветствия осталось, но обращение больше на нём не висит.
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(
      "Неформальное приветствие клиента — обращайся на «ты»",
    );
  });

  it("keeps the template from redirecting a customer into the channel they used", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("## Клиент уже написал вам");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("schreiben Sie uns per Direct");
    // Источник, отвечающий только «напишите нам — пришлём условия», не
    // отвечает на вопрос об условиях: это работа оператора.
    expect(DEFAULT_SYSTEM_PROMPT).toContain("только обещанием связаться");
  });

  it("drops the settings that moved into the prompt text", () => {
    expect(migration).toContain("drop column tone");
    expect(migration).toContain("drop column language");
    expect(migration).toContain("drop column signature");
    expect(migration).toContain("ai_settings_system_prompt_length_check");
    expect(migration).toContain("ai_settings_comment_system_prompt_length_check");
  });

  it("explains the CATEGORIES contract and drops the category action from grounding", () => {
    // Классификация больше не отдельный вызов: категории приходят первой
    // строкой того же ответа (CATEGORIES_MARKER в lib/ai/prompt.ts). Шаблон
    // редактируемый, поэтому контракт продублирован в неизменяемой секции 7,
    // но объяснить его шаблон обязан.
    expect(DEFAULT_SYSTEM_PROMPT).toContain("CATEGORIES:");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("действия присвоенной категории");
    // У комментариев категорий нет — там тот же промпт, что и был.
    expect(DEFAULT_COMMENT_SYSTEM_PROMPT).not.toContain("CATEGORIES:");
  });

  it("carries no backfill: the migration ships before the first workspace exists", () => {
    expect(migration).not.toContain("update public.ai_settings");
    expect(migration).not.toContain("from public.workspaces as workspace");
  });
});
