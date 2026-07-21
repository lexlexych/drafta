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
    "[knowledge-base.test.ts] skipping DB-backed tests — start local Supabase " +
      "and provide its three Supabase env values to run them.",
  );
}

describe.skipIf(!hasLocalSupabaseConfig)("lib/db/knowledge-base", () => {
  let supabase: SupabaseClient;
  let createKnowledgeFile: typeof import("./knowledge-base").createKnowledgeFile;
  let deleteKnowledgeFile: typeof import("./knowledge-base").deleteKnowledgeFile;
  let listKnowledgeFiles: typeof import("./knowledge-base").listKnowledgeFiles;
  let setKnowledgeFileEnabled: typeof import("./knowledge-base").setKnowledgeFileEnabled;
  let updateKnowledgeFile: typeof import("./knowledge-base").updateKnowledgeFile;
  const workspaceIdsToClean: string[] = [];

  beforeAll(async () => {
    ({
      createKnowledgeFile,
      deleteKnowledgeFile,
      listKnowledgeFiles,
      setKnowledgeFileEnabled,
      updateKnowledgeFile,
    } = await import("./knowledge-base"));
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
      .insert({ name: `KB test ${randomUUID()}` })
      .select("id")
      .single();

    if (error) throw error;
    workspaceIdsToClean.push(data.id);
    return data.id;
  }

  it("creates files in order and supports edit, deactivate and delete", async () => {
    const workspaceId = await createWorkspace();
    const first = await createKnowledgeFile(supabase, workspaceId, {
      name: "about",
      content: "# About",
    });
    const second = await createKnowledgeFile(supabase, workspaceId, {
      name: "price.md",
      content: "# Price",
    });

    expect(first.ok && first.data.name).toBe("about.md");
    expect(second.ok && second.data.sort_order).toBe(1);
    if (!first.ok) throw new Error(first.error);

    const updated = await updateKnowledgeFile(supabase, workspaceId, {
      id: first.data.id,
      name: "01-about.md",
      content: "# Updated",
    });
    expect(updated.ok && updated.data.content).toBe("# Updated");

    const disabled = await setKnowledgeFileEnabled(supabase, workspaceId, {
      id: first.data.id,
      isEnabled: false,
    });
    expect(disabled.ok && disabled.data.is_enabled).toBe(false);

    const removed = await deleteKnowledgeFile(
      supabase,
      workspaceId,
      first.data.id,
    );
    expect(removed.ok).toBe(true);
    expect((await listKnowledgeFiles(supabase, workspaceId)).map((file) => file.name)).toEqual([
      "price.md",
    ]);
  });

  it("rejects duplicate names and scopes mutations to the workspace", async () => {
    const workspaceId = await createWorkspace();
    const foreignWorkspaceId = await createWorkspace();
    const created = await createKnowledgeFile(supabase, workspaceId, {
      name: "FAQ.md",
      content: "FAQ",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const duplicate = await createKnowledgeFile(supabase, workspaceId, {
      name: "faq.md",
      content: "duplicate",
    });
    expect(duplicate).toMatchObject({ ok: false });

    const foreignDelete = await deleteKnowledgeFile(
      supabase,
      foreignWorkspaceId,
      created.data.id,
    );
    expect(foreignDelete).toMatchObject({ ok: false, error: "Файл не найден." });
    expect(await listKnowledgeFiles(supabase, workspaceId)).toHaveLength(1);
  });
});
