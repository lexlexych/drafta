"use server";

import { revalidatePath } from "next/cache";

import {
  createChannelConnection,
  renameChannelConnection,
  setChannelConnectionStatus,
  type ChannelConnectionResult,
  type ChannelConnectionRow,
  type CreateChannelConnectionInput,
  type SettableChannelConnectionStatus,
} from "@/lib/db/channel-connections";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

/**
 * Server actions behind Settings → Channels
 * (docs/epics/epic_02/T-04-channels-settings.md). Thin wrappers: resolve the
 * *authenticated caller's own* workspace from the session (never a
 * client-supplied workspace id — a client could ask for anyone's), get the
 * cookie-scoped, RLS-respecting Supabase client (`lib/db/server.ts`, per the
 * ticket's "пользовательские запросы идут через publishable-клиент под
 * RLS"), and delegate the actual work to `lib/db/channel-connections.ts` —
 * which stays a plain, directly testable function of its inputs.
 */

const SETTINGS_PATH = "/settings";

async function requireCurrentWorkspaceId(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: string }
> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { ok: false, error: "Рабочее пространство не найдено." };
  }

  return { ok: true, workspaceId: workspace.id };
}

export async function createChannelConnectionAction(
  input: CreateChannelConnectionInput,
): Promise<ChannelConnectionResult<ChannelConnectionRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await createChannelConnection(supabase, workspace.workspaceId, input);

  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }

  return result;
}

export async function renameChannelConnectionAction(input: {
  id: string;
  name: string;
}): Promise<ChannelConnectionResult<ChannelConnectionRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await renameChannelConnection(
    supabase,
    workspace.workspaceId,
    input.id,
    input.name,
  );

  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }

  return result;
}

export async function setChannelConnectionStatusAction(input: {
  id: string;
  status: SettableChannelConnectionStatus;
}): Promise<ChannelConnectionResult<ChannelConnectionRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await setChannelConnectionStatus(
    supabase,
    workspace.workspaceId,
    input.id,
    input.status,
  );

  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }

  return result;
}
