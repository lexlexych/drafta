import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCategory,
  deleteCategory,
  reorderCategories,
  updateCategory,
} from "./categories";

describe("lib/db/categories", () => {
  const rpc = vi.fn();
  const supabase = { rpc } as unknown as SupabaseClient;

  beforeEach(() => {
    rpc.mockReset();
  });

  it("validates required rule fields before creating a category", async () => {
    const result = await createCategory(supabase, "wsp_1", {
      name: "  ",
      description: "A useful rule",
      draftInstruction: "",
      channelConnectionIds: [],
      skipDraft: false,
      kbFileIds: null,
    });

    expect(result).toEqual({
      ok: false,
      error: "Введите название категории.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normalizes and delegates creation to the atomic RPC", async () => {
    rpc.mockResolvedValue({ data: "cat_1", error: null });

    const result = await createCategory(supabase, "wsp_1", {
      name: "  Жалоба  ",
      description: "  Клиент сообщает о проблеме.  ",
      draftInstruction: "  предложить замену  ",
      channelConnectionIds: ["ch_1", "ch_1"],
      skipDraft: false,
      kbFileIds: ["kb_1", "kb_1"],
    });

    expect(result).toEqual({ ok: true, data: "cat_1" });
    expect(rpc).toHaveBeenCalledWith("create_category", {
      target_workspace_id: "wsp_1",
      category_name: "Жалоба",
      category_description: "Клиент сообщает о проблеме.",
      category_draft_instruction: "предложить замену",
      category_channel_connection_ids: ["ch_1"],
      category_skip_draft: false,
      category_kb_file_ids: ["kb_1"],
    });
  });

  it("allows editing the configurable fields of the default category", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    const result = await updateCategory(supabase, "wsp_1", {
      id: "cat_default",
      isDefault: true,
      name: "",
      description: "",
      draftInstruction: "  Отвечать кратко  ",
      channelConnectionIds: [],
      skipDraft: true,
      kbFileIds: null,
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(rpc).toHaveBeenCalledWith(
      "update_category",
      expect.objectContaining({
        target_category_id: "cat_default",
        category_draft_instruction: "Отвечать кратко",
        category_skip_draft: true,
        // null сохраняется: «наследовать активные файлы базы знаний» — это
        // не то же самое, что «не брать ни одного файла».
        category_kb_file_ids: null,
      }),
    );
  });

  it("maps protected deletion and rejects duplicate reorder IDs", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23514", message: "protected" },
    });

    await expect(deleteCategory(supabase, "wsp_1", "cat_default")).resolves.toEqual({
      ok: false,
      error: "Категорию «По умолчанию» удалить нельзя.",
    });
    await expect(
      reorderCategories(supabase, "wsp_1", ["cat_1", "cat_1"]),
    ).resolves.toEqual({
      ok: false,
      error: "Порядок категорий содержит повторы.",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
