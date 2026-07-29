import { describe, expect, it } from "vitest";

import { MAX_KNOWLEDGE_FILE_BYTES, validateCategory } from "./files";

describe("knowledge-base category validation", () => {
  it("keeps the name as typed and normalizes line endings", () => {
    // Категория редактируется в интерфейсе, а не загружается файлом, поэтому
    // расширение `.md` больше не дописывается и не требуется.
    expect(validateCategory("  Прайс и доставка  ", "first\r\nsecond")).toEqual({
      ok: true,
      name: "Прайс и доставка",
      content: "first\nsecond",
    });
  });

  it("rejects an empty name and path-like characters", () => {
    expect(validateCategory("   ", "content")).toMatchObject({ ok: false });
    expect(validateCategory("../price", "content")).toMatchObject({ ok: false });
  });

  it("rejects a comma: it separates names in the CATEGORIES line", () => {
    expect(validateCategory("Прайс, доставка", "content")).toMatchObject({
      ok: false,
    });
  });

  it("enforces the UTF-8 byte limit", () => {
    const content = "я".repeat(MAX_KNOWLEDGE_FILE_BYTES / 2 + 1);
    expect(validateCategory("Большая категория", content)).toMatchObject({
      ok: false,
    });
  });
});
