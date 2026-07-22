"use server";

import { revalidatePath } from "next/cache";

import {
  mergeContacts,
  updateContactNotes,
  type ContactResult,
} from "@/lib/db/contacts";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

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
