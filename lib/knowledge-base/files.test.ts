import { describe, expect, it } from "vitest";

import {
  MAX_KNOWLEDGE_FILE_BYTES,
  normalizeMarkdownFileName,
  validateMarkdownFile,
} from "./files";

describe("knowledge-base file validation", () => {
  it("adds the markdown extension and normalizes line endings", () => {
    expect(normalizeMarkdownFileName("  FAQ  ")).toBe("FAQ.md");
    expect(validateMarkdownFile("FAQ", "first\r\nsecond")).toEqual({
      ok: true,
      name: "FAQ.md",
      content: "first\nsecond",
    });
  });

  it("rejects other extensions and path-like names", () => {
    expect(validateMarkdownFile("price.txt", "content")).toMatchObject({
      ok: false,
    });
    expect(validateMarkdownFile("../price.md", "content")).toMatchObject({
      ok: false,
    });
  });

  it("enforces the UTF-8 byte limit", () => {
    const content = "я".repeat(MAX_KNOWLEDGE_FILE_BYTES / 2 + 1);
    expect(validateMarkdownFile("large.md", content)).toMatchObject({
      ok: false,
    });
  });
});
