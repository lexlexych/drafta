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
    name: "02-price.md",
    content: "Price: 42 EUR",
    sort_order: 2,
    is_enabled: true,
  },
  {
    id: "disabled",
    name: "03-hidden.md",
    content: "Never include me",
    sort_order: 3,
    is_enabled: false,
  },
  {
    id: "first",
    name: "01-about.md",
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
    expect(result.text.indexOf("01-about.md")).toBeLessThan(
      result.text.indexOf("02-price.md"),
    );
    expect(result.text).not.toContain("03-hidden.md");
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

  it("uses the category's own file selection, including files disabled in the KB", () => {
    // Именно id, а не имя файла: `categories.kb_file_ids` — массив uuid.
    const result = buildKnowledgeBaseContext(files, { fileIds: ["disabled"] });

    expect(result.usedFileIds).toEqual(["disabled"]);
    expect(result.text).toContain("03-hidden.md");
    expect(result.text).not.toContain("01-about.md");
  });

  it("treats a null selection as inheriting the is_enabled flags", () => {
    expect(buildKnowledgeBaseContext(files, { fileIds: null })).toEqual(
      buildKnowledgeBaseContext(files),
    );
  });

  it("selects nothing for an empty selection and drops ids of deleted files", () => {
    expect(buildKnowledgeBaseContext(files, { fileIds: [] }).text).toBe("");
    expect(
      buildKnowledgeBaseContext(files, { fileIds: ["gone", "first"] })
        .usedFileIds,
    ).toEqual(["first"]);
  });
});
