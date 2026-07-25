"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { defaultAuthenticatedPath } from "@/lib/auth/redirects";
import { provisionWorkspace } from "@/lib/db/workspace-bootstrap";
import {
  WORKSPACE_COOKIE_MAX_AGE,
  WORKSPACE_COOKIE_NAME,
  getAuthenticatedUser,
  listUserWorkspaces,
} from "@/lib/db/workspace";

/**
 * Меню пользователя в оболочке: переключение между workspace'ами и создание
 * нового. Успех всегда заканчивается серверным редиректом на дашборд — иначе
 * клиентский роутер переиспользует RSC-кэш прежнего workspace.
 */
export type WorkspaceActionResult = { ok: false; error: string };

async function selectWorkspace(workspaceId: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(WORKSPACE_COOKIE_NAME, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WORKSPACE_COOKIE_MAX_AGE,
  });
}

export async function switchWorkspaceAction(
  workspaceId: string,
): Promise<WorkspaceActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  // Кука — это лишь выбор пользователя, а не право доступа: членство
  // проверяется до записи (и ещё раз при чтении, в `getCurrentWorkspace`).
  const workspaces = await listUserWorkspaces(user.id);
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
    return { ok: false, error: "Рабочее пространство недоступно." };
  }

  await selectWorkspace(workspaceId);

  redirect(defaultAuthenticatedPath);
}

export async function createWorkspaceFromShellAction(input: {
  name: string;
}): Promise<WorkspaceActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  const result = await provisionWorkspace({
    ownerUserId: user.id,
    name: input.name,
  });

  if (!result.ok) {
    return result;
  }

  await selectWorkspace(result.workspaceId);

  redirect(defaultAuthenticatedPath);
}
