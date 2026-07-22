"use server";

import { revalidatePath } from "next/cache";

import {
  markConversationRead,
  type MarkConversationReadResult,
} from "@/lib/db/inbox";
import {
  canRegenerateConversationDraft,
  discardConversationDraft,
  editConversationDraft,
} from "@/lib/db/drafts";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";
import { emitDraftRegenerateRequested } from "@/lib/inngest/events";

/**
 * Server action behind "opening a thread resets its unread counter"
 * (docs/epics/epic_02/T-05-inbox-messages.md, step 3) — same thin-wrapper
 * shape as `settings/channels/actions.ts` (T-04): resolve the *authenticated
 * caller's own* workspace from the session (never a client-supplied
 * workspace id), get the cookie-scoped RLS-respecting client, delegate to
 * `lib/db/inbox.ts`.
 *
 * Deliberately a Server Action invoked from a client-side effect
 * (`./mark-thread-read.tsx`) once the thread has actually mounted in the
 * browser, not a write performed inside the page's Server Component render:
 * that render also runs for `<Link>` prefetches of a conversation the user
 * never opens, and a GET must not have that side effect.
 */
export async function markConversationReadAction(
  conversationId: string,
): Promise<MarkConversationReadResult> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { ok: false, error: "Рабочее пространство не найдено." };
  }

  const supabase = await createServerSupabaseClient();
  const result = await markConversationRead(supabase, workspace.id, conversationId);

  if (result.ok) {
    revalidatePath("/inbox");
  }

  return result;
}

async function getDraftActionContext() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { error: "Сессия истекла — войдите заново." } as const;
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { error: "Рабочее пространство не найдено." } as const;
  }

  return {
    workspace,
    supabase: await createServerSupabaseClient(),
  } as const;
}

export async function editDraftAction(
  conversationId: string,
  draftId: string,
  text: string,
) {
  const context = await getDraftActionContext();

  if ("error" in context) {
    return { ok: false as const, error: context.error };
  }

  const result = await editConversationDraft(
    context.supabase,
    context.workspace.id,
    conversationId,
    draftId,
    text,
  );

  if (result.ok) {
    revalidatePath("/inbox");
  }

  return result;
}

export async function discardDraftAction(
  conversationId: string,
  draftId: string,
) {
  const context = await getDraftActionContext();

  if ("error" in context) {
    return { ok: false as const, error: context.error };
  }

  const result = await discardConversationDraft(
    context.supabase,
    context.workspace.id,
    conversationId,
    draftId,
  );

  if (result.ok) {
    revalidatePath("/inbox");
  }

  return result;
}

export async function regenerateDraftAction(conversationId: string) {
  const context = await getDraftActionContext();

  if ("error" in context) {
    return { ok: false as const, error: context.error };
  }

  if (
    !(await canRegenerateConversationDraft(
      context.supabase,
      context.workspace.id,
      conversationId,
    ))
  ) {
    return { ok: false as const, error: "Диалог не найден." };
  }

  try {
    await emitDraftRegenerateRequested({
      conversationId,
      workspaceId: context.workspace.id,
    });
    return { ok: true as const };
  } catch (error) {
    console.error("[drafts] failed to request regeneration", error);
    return { ok: false as const, error: "Не удалось запустить генерацию заново." };
  }
}
