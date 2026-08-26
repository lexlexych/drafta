import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const hasLocalSupabaseConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY,
);

if (!hasLocalSupabaseConfig) {
  console.warn(
    "[reply-templates.test.ts] skipping DB-backed tests — start local Supabase " +
      "and provide its three Supabase env values to run them.",
  );
}

describe.skipIf(!hasLocalSupabaseConfig)("lib/db/reply-templates", () => {
  let supabase: SupabaseClient;
  let createReplyTemplate: typeof import("./reply-templates").createReplyTemplate;
  let deleteReplyTemplate: typeof import("./reply-templates").deleteReplyTemplate;
  let listActiveReplyTemplates: typeof import("./reply-templates").listActiveReplyTemplates;
  let listReplyTemplates: typeof import("./reply-templates").listReplyTemplates;
  let updateReplyTemplate: typeof import("./reply-templates").updateReplyTemplate;
  const workspaceIdsToClean: string[] = [];

  beforeAll(async () => {
    ({
      createReplyTemplate,
      deleteReplyTemplate,
      listActiveReplyTemplates,
      listReplyTemplates,
      updateReplyTemplate,
    } = await import("./reply-templates"));
    const { createAdminSupabaseClient } = await import("./admin");
    supabase = createAdminSupabaseClient();
  });

  afterEach(async () => {
    while (workspaceIdsToClean.length > 0) {
      const workspaceId = workspaceIdsToClean.pop();
      await supabase.from("workspaces").delete().eq("id", workspaceId);
    }
  });

  async function createWorkspace(): Promise<string> {
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ name: `Templates test ${randomUUID()}` })
      .select("id")
      .single();

    if (error) throw error;
    workspaceIdsToClean.push(data.id);
    return data.id;
  }

  const input = {
    name: "Доставка",
    bodies: { de: "Zwei Werktage.", en: "Two business days." },
    isEnabledForMessages: true,
    isEnabledForComments: false,
  };

  it("creates templates in order and supports edit and delete", async () => {
    const workspaceId = await createWorkspace();
    const first = await createReplyTemplate(supabase, workspaceId, input);
    const second = await createReplyTemplate(supabase, workspaceId, {
      ...input,
      name: "Оплата",
    });

    expect(first.ok && first.data.sort_order).toBe(0);
    expect(second.ok && second.data.sort_order).toBe(1);
    if (!first.ok) throw new Error(first.error);

    const updated = await updateReplyTemplate(supabase, workspaceId, {
      ...input,
      id: first.data.id,
      bodies: { de: "Drei Werktage.", en: "   " },
      isEnabledForComments: true,
    });

    // Пустой язык не сохраняется — он бы ничего не дал поповеру.
    expect(updated.ok && updated.data.bodies).toEqual({ de: "Drei Werktage." });
    expect(updated.ok && updated.data.is_enabled_for_comments).toBe(true);

    const removed = await deleteReplyTemplate(supabase, workspaceId, first.data.id);
    expect(removed.ok).toBe(true);
    expect(
      (await listReplyTemplates(supabase, workspaceId)).map((row) => row.name),
    ).toEqual(["Оплата"]);
  });

  it("filters the picker list by surface", async () => {
    const workspaceId = await createWorkspace();
    await createReplyTemplate(supabase, workspaceId, input);
    await createReplyTemplate(supabase, workspaceId, {
      ...input,
      name: "Только комментарии",
      isEnabledForMessages: false,
      isEnabledForComments: true,
    });

    expect(
      (await listActiveReplyTemplates(supabase, workspaceId, "message")).map(
        (row) => row.name,
      ),
    ).toEqual(["Доставка"]);
    expect(
      (await listActiveReplyTemplates(supabase, workspaceId, "comment")).map(
        (row) => row.name,
      ),
    ).toEqual(["Только комментарии"]);
  });

  it("rejects duplicate names and scopes mutations to the workspace", async () => {
    const workspaceId = await createWorkspace();
    const foreignWorkspaceId = await createWorkspace();
    const created = await createReplyTemplate(supabase, workspaceId, input);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const duplicate = await createReplyTemplate(supabase, workspaceId, {
      ...input,
      name: "доставка",
    });
    expect(duplicate).toMatchObject({ ok: false });

    const foreignDelete = await deleteReplyTemplate(
      supabase,
      foreignWorkspaceId,
      created.data.id,
    );
    expect(foreignDelete).toMatchObject({ ok: false, error: "Шаблон не найден." });
    expect(await listReplyTemplates(supabase, workspaceId)).toHaveLength(1);
  });
});
