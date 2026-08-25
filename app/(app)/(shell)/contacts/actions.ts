"use server";

import { revalidatePath } from "next/cache";

import {
  CONTACT_PAGE_SIZE,
  getContactListView,
  listChannelConnections,
  mergeContacts,
  refreshContactAvatar,
  updateContactNotes,
  type ContactResult,
} from "@/lib/db/contacts";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";
import type { ContactListItemView } from "@/lib/mock";

const CONTACTS_PATH = "/contacts";

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

/**
 * Страница списка контактов под выбранными каналами — и смена фильтра, и
 * дозагрузка при скролле. Почему через действие, а не через адрес — см.
 * `../inbox/actions.ts`.
 */
export type ContactPageResult =
  | { ok: true; items: ContactListItemView[]; total: number; hasMore: boolean }
  | { ok: false; error: string };

export async function loadContactsAction(input: {
  channelIds: string[];
  offset: number;
}): Promise<ContactPageResult> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();

  try {
    const channels = await listChannelConnections(supabase, workspace.workspaceId);
    const page = await getContactListView(
      supabase,
      workspace.workspaceId,
      channels,
      {
        channelIds: input.channelIds,
        offset: input.offset,
        limit: CONTACT_PAGE_SIZE,
      },
    );

    return {
      ok: true,
      items: page.items,
      total: page.total,
      hasMore: page.hasMore,
    };
  } catch (error) {
    console.error("[contacts] failed to load a contact page", error);
    return { ok: false, error: "Не удалось загрузить список контактов." };
  }
}

export async function updateContactNotesAction(input: {
  contactId: string;
  notes: string;
}): Promise<ContactResult<null>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await updateContactNotes(
    supabase,
    workspace.workspaceId,
    input.contactId,
    input.notes,
  );

  if (result.ok) {
    revalidatePath(CONTACTS_PATH);
  }

  return result;
}

export async function refreshContactAvatarAction(
  contactId: string,
): Promise<ContactResult<{ imageUrl: string | null }>> {
  const workspace = await requireCurrentWorkspaceId();
  if (!workspace.ok) return workspace;

  const supabase = await createServerSupabaseClient();
  try {
    const channels = await listChannelConnections(supabase, workspace.workspaceId);
    const result = await refreshContactAvatar(
      supabase,
      workspace.workspaceId,
      channels,
      contactId,
    );
    if (result.ok) {
      revalidatePath(CONTACTS_PATH);
    }
    return result;
  } catch (error) {
    console.error("[contacts] manual avatar refresh failed", error);
    return { ok: false, error: "Не удалось получить аватар из канала." };
  }
}

export async function mergeContactsAction(input: {
  sourceId: string;
  targetId: string;
}): Promise<ContactResult<null>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await mergeContacts(supabase, workspace.workspaceId, input);

  if (result.ok) {
    revalidatePath(CONTACTS_PATH);
  }

  return result;
}
