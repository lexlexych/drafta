import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("./translate-text", () => ({ translateText: vi.fn() }));

import { translateText } from "./translate-text";
import { translateMessage } from "./translate-message";
import { translateComment } from "./translate-comment";
import { translateDraft } from "./translate-draft";

const fresh = { ok: true as const, text: "Fresh translation", sourceLanguage: "de", provider: "mistral" as const, model: "test" };

function database(kind: "message" | "comment", available = true) {
  let cache: Record<string, unknown> = { text: "Old translation", source_language: "en" };
  const filters = vi.fn();
  const upsert = vi.fn(async (row: Record<string, unknown>) => {
    cache = row;
    return { error: null };
  });
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((...args: unknown[]) => { filters(...args); return query; }),
      in: vi.fn(() => query),
      is: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: table.endsWith("_translations") ? cache : available ? { id: "item", text: "Original" } : null, error: null })),
      upsert,
    };
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, from, filters, upsert, cache: () => cache, kind };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(translateText).mockResolvedValue(fresh);
});

describe.each([
  { kind: "message" as const, translate: translateMessage, parent: "conversation_id" },
  { kind: "comment" as const, translate: translateComment, parent: "post_id" },
])("$kind translation cache", ({ kind, translate, parent }) => {
  it("uses the cache by default without asking the LLM", async () => {
    const db = database(kind);
    expect(await translate(db.client, "workspace", "parent", "item", "ru")).toEqual({ ok: true, text: "Old translation", sourceLanguage: "en" });
    expect(translateText).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("refreshes from the original and overwrites the same cache entry", async () => {
    const db = database(kind);
    await translate(db.client, "workspace", "parent", "item", "ru", true);
    expect(translateText).toHaveBeenCalledWith("workspace", "Original", "ru", kind);
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "workspace", [parent]: "parent", [`${kind}_id`]: "item", target_language: "ru", text: fresh.text, source_language: "de" }), { onConflict: `workspace_id,${kind}_id,target_language` });
    expect(await translate(db.client, "workspace", "parent", "item", "ru")).toEqual({ ok: true, text: fresh.text, sourceLanguage: "de" });
    expect(translateText).toHaveBeenCalledTimes(1);
  });

  it("preserves the old cache when a refresh fails", async () => {
    const db = database(kind);
    vi.mocked(translateText).mockResolvedValue({ ok: false, error: "Failed" });
    expect(await translate(db.client, "workspace", "parent", "item", "ru", true)).toEqual({ ok: false, error: "Failed" });
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.cache().text).toBe("Old translation");
  });

  it("still validates workspace and parent access when bypassing the cache", async () => {
    const db = database(kind, false);
    expect((await translate(db.client, "workspace", "parent", "item", "ru", true)).ok).toBe(false);
    expect(db.filters).toHaveBeenCalledWith("workspace_id", "workspace");
    expect(db.filters).toHaveBeenCalledWith(parent, "parent");
    expect(translateText).not.toHaveBeenCalled();
  });
});

describe("draft translation", () => {
  it("translates edited text without overwriting the saved original", async () => {
    const db = database("message");
    expect(await translateDraft(db.client, "workspace", "conversation", "draft", "Edited original", "ru")).toEqual({ ok: true, text: fresh.text, sourceLanguage: "de" });
    expect(translateText).toHaveBeenCalledWith("workspace", "Edited original", "ru", "message");
    expect(db.filters).toHaveBeenCalledWith("workspace_id", "workspace");
    expect(db.filters).toHaveBeenCalledWith("conversation_id", "conversation");
    expect(db.filters).toHaveBeenCalledWith("id", "draft");
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("does not translate a missing or inaccessible draft", async () => {
    const db = database("message", false);
    expect((await translateDraft(db.client, "workspace", "conversation", "draft", "Original", "ru")).ok).toBe(false);
    expect(translateText).not.toHaveBeenCalled();
  });

  it.each(["", " ", "x".repeat(8001)])("rejects empty or oversized input (%#)", async (text) => {
    const db = database("message");
    expect((await translateDraft(db.client, "workspace", "conversation", "draft", text, "ru")).ok).toBe(false);
    expect(translateText).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
});
