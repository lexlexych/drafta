"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { defaultAuthenticatedPath } from "@/lib/auth/redirects";
import {
  createZernioWorkspaceProfile,
  deleteZernioWorkspaceProfile,
} from "@/lib/channels/zernio";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

export type CreateWorkspaceResult =
  { ok: false; error: string };

/**
 * Creates the provider tenant boundary first, then atomically bootstraps the
 * workspace with that profile id. A failed DB bootstrap compensates by
 * deleting the still-empty provider profile, so no workspace row can exist
 * without its mandatory Zernio profile.
 */
export async function createWorkspaceAction(input: {
  name: string;
}): Promise<CreateWorkspaceResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  const existingWorkspace = await getCurrentWorkspace(user.id);
  if (existingWorkspace) {
    return { ok: false, error: "Рабочее пространство уже создано." };
  }

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
    console.error("[onboarding] failed to create Zernio workspace profile", error);
    return {
      ok: false,
      error: "Не удалось подготовить каналы. Попробуйте ещё раз.",
    };
  }

  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("create_workspace", {
      target_workspace_id: workspaceId,
      owner_user_id: user.id,
      workspace_name: workspaceName,
      provider_profiles: { zernio: profileId },
    });

    if (error || data !== workspaceId) {
      throw error ?? new Error("Workspace bootstrap returned an unexpected id.");
    }
  } catch (error) {
    console.error("[onboarding] failed to persist workspace", error);
    try {
      await deleteZernioWorkspaceProfile(profileId);
    } catch (compensationError) {
      console.error(
        `[onboarding] failed to delete orphaned Zernio profile "${profileId}"`,
        compensationError,
      );
    }
    return {
      ok: false,
      error: "Не удалось создать рабочее пространство. Попробуйте ещё раз.",
    };
  }

  // A server-side redirect forces a fresh request after the mutation. A
  // client-router transition can reuse the prefetched/RSC onboarding state
  // and keep showing the form until a manual refresh.
  redirect(defaultAuthenticatedPath);
}
