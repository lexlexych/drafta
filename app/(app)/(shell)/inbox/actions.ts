"use server";

import { revalidatePath } from "next/cache";

import {
  markConversationRead,
  type MarkConversationReadResult,
} from "@/lib/db/inbox";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

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
