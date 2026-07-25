"use server";

import { redirect } from "next/navigation";

import { defaultAuthenticatedPath } from "@/lib/auth/redirects";
import { provisionWorkspace } from "@/lib/db/workspace-bootstrap";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

export type CreateWorkspaceResult =
  { ok: false; error: string };

/**
 * Онбординг: первый workspace пользователя. Провижининг (Zernio-профиль +
 * атомарный bootstrap через service-role RPC) живёт в
 * `lib/db/workspace-bootstrap.ts` — здесь только гейты онбординга.
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

  const result = await provisionWorkspace({
    ownerUserId: user.id,
    name: input.name,
  });

  if (!result.ok) {
    return result;
  }

  // A server-side redirect forces a fresh request after the mutation. A
  // client-router transition can reuse the prefetched/RSC onboarding state
  // and keep showing the form until a manual refresh.
  redirect(defaultAuthenticatedPath);
}
