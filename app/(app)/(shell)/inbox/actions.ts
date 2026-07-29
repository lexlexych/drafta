"use server";

import { revalidatePath } from "next/cache";

import { listKnowledgeFiles } from "@/lib/db/knowledge-base";
import {
  CONVERSATION_PAGE_SIZE,
  getConversationListView,
  listChannelConnections,
  markConversationRead,
  type MarkConversationReadResult,
} from "@/lib/db/inbox";
import type { ConversationListItemView } from "@/lib/mock";
import {
  canRegenerateConversationDraft,
  discardConversationDraft,
  editConversationDraft,
} from "@/lib/db/drafts";
import {
  acceptDraftForSend,
  createManualOutgoingMessage,
  markOutgoingMessageFailedAfterEmit,
  retryFailedOutgoingMessage,
  type OutgoingSendResult,
} from "@/lib/db/outgoing";
import { createServerSupabaseClient } from "@/lib/db/server";
import {
  getAuthenticatedUser,
  getCurrentWorkspace,
  type CurrentWorkspace,
} from "@/lib/db/workspace";
import {
  emitDraftRegenerateRequested,
  emitDraftRunNowRequested,
  emitMessageSendRequested,
} from "@/lib/inngest/events";

/** These actions belong to "/inbox" only — comments have their own actions. */
function revalidateInboxViews() {
  revalidatePath("/inbox");
}

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
    revalidateInboxViews();
  }

  return result;
}

/**
 * Страница списка диалогов под выбранным фильтром — источник данных и для
 * смены фильтра, и для дозагрузки при скролле.
 *
 * Фильтр ходит через действие, а не через адрес: значение фильтра — состояние
 * экрана, а не переход, и в истории браузера ему делать нечего (иначе «Назад»
 * возвращает к прошлому фильтру вместо предыдущего экрана). Workspace, как и
 * везде, берётся из сессии, а не из аргументов.
 */
export type ConversationPageResult =
  | {
      ok: true;
      items: ConversationListItemView[];
      total: number;
      hasMore: boolean;
    }
  | { ok: false; error: string };

export async function loadConversationsAction(input: {
  channelIds: string[];
  categoryIds: string[];
  offset: number;
}): Promise<ConversationPageResult> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { ok: false, error: "Рабочее пространство не найдено." };
  }

  const supabase = await createServerSupabaseClient();

  try {
    const [channels, categories] = await Promise.all([
      listChannelConnections(supabase, workspace.id),
      listKnowledgeFiles(supabase, workspace.id),
    ]);
    const page = await getConversationListView(
      supabase,
      workspace.id,
      channels,
      {
        channelIds: input.channelIds,
        categoryIds: input.categoryIds,
        offset: input.offset,
        limit: CONVERSATION_PAGE_SIZE,
      },
      categories,
    );

    return {
      ok: true,
      items: page.items,
      total: page.total,
      hasMore: page.hasMore,
    };
  } catch (error) {
    console.error("[inbox] failed to load a conversation page", error);
    return { ok: false, error: "Не удалось загрузить список диалогов." };
  }
}

type DraftActionContext =
  | { error: string }
  | {
      workspace: CurrentWorkspace;
      supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
    };

async function getDraftActionContext(): Promise<DraftActionContext> {
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
    revalidateInboxViews();
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
    revalidateInboxViews();
  }

  return result;
}

/**
 * Shared tail of every send action (stage 3,
 * docs/architecture/07-data-flows.md#63-отправка-ответа): the outgoing
 * message is already persisted as `pending` — emit the ID-only
 * `message/send` event; the actual provider call happens in the
 * `send-message` Inngest function with retries (vibecoding rule 8), never
 * inside this request. If even the emit fails, compensate to `failed` so
 * the thread shows the retry button instead of a forever-pending bubble.
 */
async function requestMessageSend(
  context: Exclude<DraftActionContext, { error: string }>,
  conversationId: string,
  messageId: string,
): Promise<OutgoingSendResult> {
  try {
    await emitMessageSendRequested({
      messageId,
      conversationId,
      workspaceId: context.workspace.id,
    });
  } catch (error) {
    console.error("[outgoing] failed to emit message/send", error);
    await markOutgoingMessageFailedAfterEmit(
      context.supabase,
      context.workspace.id,
      messageId,
    );
    revalidateInboxViews();
    return {
      ok: false,
      error: "Не удалось запустить отправку — нажмите «Повторить» у сообщения.",
    };
  }

  revalidateInboxViews();
  return { ok: true, messageId };
}

/** «Принять и отправить» in the draft panel. */
export async function sendDraftAction(
  conversationId: string,
  draftId: string,
): Promise<OutgoingSendResult> {
  const context = await getDraftActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const accepted = await acceptDraftForSend(
    context.supabase,
    context.workspace.id,
    conversationId,
    draftId,
  );

  if (!accepted.ok) {
    return accepted;
  }

  return requestMessageSend(context, conversationId, accepted.messageId);
}

/** Manual reply from the thread composer. */
export async function sendManualMessageAction(
  conversationId: string,
  text: string,
): Promise<OutgoingSendResult> {
  const context = await getDraftActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const created = await createManualOutgoingMessage(
    context.supabase,
    context.workspace.id,
    conversationId,
    text,
  );

  if (!created.ok) {
    return created;
  }

  return requestMessageSend(context, conversationId, created.messageId);
}

/** «Повторить» on a failed outgoing bubble: failed → pending → re-emit. */
export async function retrySendMessageAction(
  conversationId: string,
  messageId: string,
): Promise<OutgoingSendResult> {
  const context = await getDraftActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const reset = await retryFailedOutgoingMessage(
    context.supabase,
    context.workspace.id,
    conversationId,
    messageId,
  );

  if (!reset.ok) {
    return reset;
  }

  return requestMessageSend(context, conversationId, messageId);
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

/**
 * «Запустить сейчас» под таймером дебаунса: заканчивает окно ожидания, не
 * дожидаясь таймаута. Событие ловит `waitForEvent` уже запущенного прогона —
 * второй прогон не стартует, поэтому логика supersede не меняется.
 */
export async function runDraftNowAction(conversationId: string) {
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
    await emitDraftRunNowRequested({
      conversationId,
      workspaceId: context.workspace.id,
    });
  } catch (error) {
    console.error("[drafts] failed to request an immediate draft run", error);
    return { ok: false as const, error: "Не удалось запустить генерацию." };
  }

  // Гасим счётчик сразу, не дожидаясь, пока это сделает сам пайплайн: кнопку
  // уже нажали, и таймер, который ещё тикает, читается как «не сработало».
  const { error } = await context.supabase
    .from("conversations")
    .update({ draft_debounce_until: null })
    .eq("workspace_id", context.workspace.id)
    .eq("id", conversationId);

  if (error) {
    console.error("[drafts] failed to clear the debounce deadline", error);
  }

  return { ok: true as const };
}
