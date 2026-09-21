import { createAdminSupabaseClient } from "@/lib/db/admin";
import { check } from "@/lib/publications/server";
import { localSteps as step } from "./steps";
export async function cleanupPublicationAssets() {
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
    const { error: generationError } = await db.from("publication_generation_jobs").delete().neq("status", "pending")
      .lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString()); check(generationError);
    return { removed: paths.length };
  });
}
