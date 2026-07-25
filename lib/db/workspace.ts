import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/db/server";

export type WorkspaceRole = "owner" | "member";

export type CurrentWorkspace = {
  id: string;
  name: string;
  role: WorkspaceRole;
};

/**
 * Какой из workspace'ов пользователя открыт сейчас. Хранится в куке, а не в
 * профиле: переключение — свойство сессии/устройства, а не данных тенанта.
 * Значение куки всегда проверяется по членствам (`getCurrentWorkspace`), так
 * что подменённый id не даёт доступа к чужому workspace — он просто
 * игнорируется, и открывается первый доступный.
 */
export const WORKSPACE_COOKIE_NAME = "drafta-workspace";
export const WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function asWorkspaceRole(role: string): WorkspaceRole {
  if (role === "owner" || role === "member") {
    return role;
  }

  throw new Error("Workspace membership has an invalid role.");
}

export const getAuthenticatedUser = cache(async (): Promise<User | null> => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return user;
});

/**
 * Все workspace'ы пользователя в порядке вступления — первый является
 * значением по умолчанию, пока не выбран другой. Клиент здесь пользовательский
 * (RLS), поэтому запрос физически не может вернуть чужие членства.
 */
export const listUserWorkspaces = cache(
  async (userId: string): Promise<CurrentWorkspace[]> => {
    const supabase = await createServerSupabaseClient();
    const { data: memberships, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (membershipError) {
      throw new Error("Unable to load the workspace memberships.");
    }

    if (!memberships || memberships.length === 0) {
      return [];
    }

    const { data: workspaces, error: workspaceError } = await supabase
      .from("workspaces")
      .select("id, name")
      .in(
        "id",
        memberships.map((membership) => membership.workspace_id),
      );

    if (workspaceError || !workspaces) {
      throw new Error("Unable to load the user's workspaces.");
    }

    const nameById = new Map<string, string>(
      workspaces.map((workspace) => [workspace.id, workspace.name]),
    );

    return memberships.flatMap((membership) => {
      const name = nameById.get(membership.workspace_id);

      return name === undefined
        ? []
        : [
            {
              id: membership.workspace_id,
              name,
              role: asWorkspaceRole(membership.role),
            },
          ];
    });
  },
);

export const getCurrentWorkspace = cache(
  async (userId: string): Promise<CurrentWorkspace | null> => {
    const workspaces = await listUserWorkspaces(userId);

    if (workspaces.length === 0) {
      return null;
    }

    const cookieStore = await cookies();
    const selectedId = cookieStore.get(WORKSPACE_COOKIE_NAME)?.value;

    return (
      workspaces.find((workspace) => workspace.id === selectedId) ??
      workspaces[0]
    );
  },
);
