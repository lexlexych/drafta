import { randomUUID } from "node:crypto";
import { inngest } from "../client";
import { publicationImportRequested } from "@/lib/publications/events";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { downloadImage, storeImage } from "@/lib/publications/assets";
import { check } from "@/lib/publications/server";
import type { ImportPayload } from "@/lib/publications/import";

async function finish(workspaceId: string, importId: string, assets: string[], failed = false) {
  const { error } = await createAdminSupabaseClient().rpc("finish_publication_import", { w: workspaceId, i: importId, a: assets, failed });
  check(error);
}
export const publicationImport = inngest.createFunction({
  id: "publication-import", triggers: [publicationImportRequested], retries: 2,
  concurrency: { limit: 1, key: "event.data.importId" },
  onFailure: async ({ event }) => {
    const { workspaceId, importId } = event.data.event.data;
    await finish(workspaceId, importId, [], true);
  },
}, async ({ event, step }) => {
  const { workspaceId, importId } = event.data;
  // No knowledge, captions, image bytes or signed URLs are returned from steps.
  const ids = await step.run("prepare-asset-ids", () => Array.from({ length: 10 }, () => randomUUID()));
  const imported = await step.run("download-and-store", async () => {
    const db = createAdminSupabaseClient();
    const { data: job, error } = await db.from("publication_imports").select("draft_id,payload,status,created_at")
      .eq("workspace_id", workspaceId).eq("id", importId).maybeSingle();
    check(error);
    if (!job || job.status !== "pending") return null;
    if (Date.now() - Date.parse(job.created_at) > 270_000) { await finish(workspaceId, importId, [], true); return null; }
    const payload = job.payload as ImportPayload;
    // Bounded concurrency keeps ten files inside the five-minute link lifetime.
    const results: string[] = [];
    for (let offset = 0; offset < payload.file_order.length; offset += 3) {
      const batch = await Promise.all(payload.file_order.slice(offset, offset + 3).map(async (id, index) => {
        const file = payload.openaiFileIdRefs.find(f => f.id === id)!;
        const bytes = await downloadImage(file.download_link);
        return storeImage(workspaceId, job.draft_id, ids[offset + index], bytes);
      }));
      results.push(...batch);
    }
    return results;
  });
  if (imported) await step.run("finish", () => finish(workspaceId, importId, imported));
  return { importId };
});

export const recoverPublicationImports = inngest.createFunction({
  id: "recover-publication-imports", triggers: [{ cron: "* * * * *" }], retries: 1,
}, async ({ step }) => {
  const jobs = await step.run("pending-ids", async () => {
    const { data, error } = await createAdminSupabaseClient().from("publication_imports").select("id,workspace_id")
      .eq("status", "pending").lt("created_at", new Date(Date.now() - 30000).toISOString()).limit(100);
    check(error); return data ?? [];
  });
  if (jobs.length) await step.sendEvent("recover", jobs.map(job => publicationImportRequested.create({ workspaceId: job.workspace_id, importId: job.id })));
});

export const cleanupPublicationAssets = inngest.createFunction({
  id: "cleanup-publication-assets", triggers: [{ cron: "17 * * * *" }], retries: 2,
}, async ({ step }) => {
  await step.run("remove-orphans", async () => {
    const db = createAdminSupabaseClient();
    const { data, error } = await db.rpc("publication_orphan_paths"); check(error);
    const paths = (data ?? []).map((row: { path: string }) => row.path);
    if (paths.length) {
      const { error: removeError } = await db.storage.from("publication-assets").remove(paths); check(removeError);
      const { error: metadataError } = await db.from("publication_assets").delete().in("storage_path", paths); check(metadataError);
    }
    const { error: grantError } = await db.from("gpt_oauth_grants").delete().lt("expires_at", new Date().toISOString()); check(grantError);
    const { error: importError } = await db.from("publication_imports").delete().neq("status", "pending")
      .lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString()); check(importError);
    return { removed: paths.length };
  });
});
