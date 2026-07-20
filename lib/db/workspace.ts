import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/db/server";

export type WorkspaceRole = "owner" | "member";

export type CurrentWorkspace = {
  id: string;
  name: string;
  role: WorkspaceRole;
};

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

export const getCurrentWorkspace = cache(
  async (userId: string): Promise<CurrentWorkspace | null> => {
    const supabase = await createServerSupabaseClient();
    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw new Error("Unable to load the current workspace membership.");
    }

    if (!membership) {
      return null;
    }

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("id", membership.workspace_id)
      .single();

    if (workspaceError || !workspace) {
      throw new Error("Unable to load the current workspace.");
    }

    return {
      id: workspace.id,
      name: workspace.name,
      role: asWorkspaceRole(membership.role),
    };
  },
);
