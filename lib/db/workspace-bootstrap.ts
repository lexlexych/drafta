import "server-only";

import { randomUUID } from "node:crypto";

import {
  createZernioWorkspaceProfile,
  deleteZernioWorkspaceProfile,
} from "@/lib/channels/zernio";
import { createAdminSupabaseClient } from "@/lib/db/admin";

export type ProvisionWorkspaceResult =
  | { ok: true; workspaceId: string }
  | { ok: false; error: string };

/**
 * Creates the provider tenant boundary first, then atomically bootstraps the
 * workspace with that profile id. A failed DB bootstrap compensates by
 * deleting the still-empty provider profile, so no workspace row can exist
 * without its mandatory Zernio profile.
 *
 * Shared by онбординг (`app/(app)/onboarding/actions.ts`, первый workspace) и
 * меню пользователя в оболочке (`app/(app)/(shell)/workspace-actions.ts`,
 * дополнительные workspace'ы) — сами гейты (кто имеет право создавать и куда
 * вести дальше) остаются в вызывающих действиях.
 */
export async function provisionWorkspace(input: {
  ownerUserId: string;
  name: string;
}): Promise<ProvisionWorkspaceResult> {
  const workspaceName = input.name.trim();

  if (!workspaceName) {
    return { ok: false, error: "Введите название рабочего пространства." };
  }

  const workspaceId = randomUUID();
  let profileId: string;

  try {
    profileId = await createZernioWorkspaceProfile({
      workspaceId,
      workspaceName,
    });
  } catch (error) {
    console.error("[workspace] failed to create Zernio workspace profile", error);
    return {
      ok: false,
      error: "Не удалось подготовить каналы. Попробуйте ещё раз.",
    };
  }

  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("create_workspace", {
      target_workspace_id: workspaceId,
      owner_user_id: input.ownerUserId,
      workspace_name: workspaceName,
      provider_profiles: { zernio: profileId },
    });

    if (error || data !== workspaceId) {
      throw error ?? new Error("Workspace bootstrap returned an unexpected id.");
    }
  } catch (error) {
    console.error("[workspace] failed to persist workspace", error);
    try {
      await deleteZernioWorkspaceProfile(profileId);
    } catch (compensationError) {
      console.error(
        `[workspace] failed to delete orphaned Zernio profile "${profileId}"`,
        compensationError,
      );
    }
    return {
      ok: false,
      error: "Не удалось создать рабочее пространство. Попробуйте ещё раз.",
    };
  }

  return { ok: true, workspaceId };
}
