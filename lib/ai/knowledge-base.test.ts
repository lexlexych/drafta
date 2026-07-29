import { describe, expect, it } from "vitest";

import {
  buildKnowledgeBaseContext,
  estimateTokenCount,
  getKnowledgeBaseUsage,
  type KnowledgeFileForPrompt,
} from "./knowledge-base";

const files: KnowledgeFileForPrompt[] = [
  {
    id: "second",
    name: "Прайс",
    content: "Price: 42 EUR",
    sort_order: 2,
    is_enabled: true,
  },
  {
    id: "disabled",
    name: "Выключенная",
    content: "Never include me",
    sort_order: 3,
    is_enabled: false,
  },
  {
    id: "first",
    name: "О мастерской",
    content: "About the studio",
    sort_order: 1,
    is_enabled: true,
  },
];

describe("knowledge-base prompt context", () => {
  it("orders enabled files and returns IDs for drafts.kb_file_ids", () => {
    const result = buildKnowledgeBaseContext(files);

    expect(result.usedFileIds).toEqual(["first", "second"]);
    expect(result.omittedFileIds).toEqual([]);
    expect(result.text.indexOf("О мастерской")).toBeLessThan(
      result.text.indexOf("Прайс"),
    );
    expect(result.text).not.toContain("Выключенная");
  });

  it("keeps whole files and omits the overflowing file and all files after it", () => {
    const firstOnlyBudget = estimateTokenCount(
      buildKnowledgeBaseContext([files[2]]).text,
    );
    const result = buildKnowledgeBaseContext(files, {
      tokenBudget: firstOnlyBudget,
    });

    expect(result.usedFileIds).toEqual(["first"]);
    expect(result.omittedFileIds).toEqual(["second"]);
    expect(result.exceedsBudget).toBe(true);
  });

  it("reports enabled usage independently from the selected prompt fragment", () => {
    const usage = getKnowledgeBaseUsage(files, 1);

    expect(usage.enabledFileCount).toBe(2);
    expect(usage.enabledTokenCount).toBeGreaterThan(1);
    expect(usage.exceedsBudget).toBe(true);
  });

  it("keeps a disabled category out of the prompt entirely", () => {
    // Пер-категорийного выбора файлов больше нет: база знаний и есть список
    // категорий, поэтому в промпт уходят ровно активные.
    const result = buildKnowledgeBaseContext(files);

    expect(result.usedFileIds).not.toContain("disabled");
    expect(result.text).not.toContain("Выключенная");
  });
});
