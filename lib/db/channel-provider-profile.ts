import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-workspace provider "account group" ids (e.g. a Zernio profile `_id`),
 * kept in `workspaces.settings.providerProfiles.<provider>`.
 *
 * Stored in the existing `settings` jsonb bag rather than a dedicated column
 * so the core schema stays provider-agnostic (no `zernio_*` columns — same
 * spirit as `channel_connections.provider` being a generic string). One
 * profile per workspace, created lazily on the first channel connection
 * (docs/architecture/05-channels.md#подключение-аккаунта-oauth).
 *
 * Callers pass an **admin** client (`lib/db/admin.ts`): this is
 * system-managed infrastructure metadata whose value comes from the provider,
 * not user input, and the workspace is already authorized by the server
 * action (`requireCurrentWorkspaceId`) before we get here — mirroring how the
 * webhook route uses the admin client for system writes. `supabase` is
 * untyped, same as the rest of this repo's DB modules.
 */

type WorkspaceSettings = {
  providerProfiles?: Record<string, string>;
  [key: string]: unknown;
};

async function readSettings(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceSettings> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .single();

  if (error) {
    console.error("[channels/connect] failed to read workspace settings", error);
    throw new Error("Unable to read workspace settings.");
  }

  return (data?.settings ?? {}) as WorkspaceSettings;
}

/** Returns the stored provider profile id for the workspace, or null if none yet. */
export async function getProviderProfileId(
  supabase: SupabaseClient,
  workspaceId: string,
  provider: string,
): Promise<string | null> {
  const settings = await readSettings(supabase, workspaceId);
  return settings.providerProfiles?.[provider] ?? null;
}

/**
 * Persists the provider profile id under
 * `settings.providerProfiles.<provider>`, merging into (never clobbering) the
 * rest of the workspace's settings.
 */
export async function setProviderProfileId(
  supabase: SupabaseClient,
  workspaceId: string,
  provider: string,
  profileId: string,
): Promise<void> {
  const settings = await readSettings(supabase, workspaceId);
  const nextSettings: WorkspaceSettings = {
    ...settings,
    providerProfiles: { ...settings.providerProfiles, [provider]: profileId },
  };

  const { error } = await supabase
    .from("workspaces")
    .update({ settings: nextSettings })
    .eq("id", workspaceId);

  if (error) {
    console.error("[channels/connect] failed to persist provider profile id", error);
    throw new Error("Unable to persist provider profile id.");
  }
}
