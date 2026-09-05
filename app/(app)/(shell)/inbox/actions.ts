"use server";

import { revalidatePath } from "next/cache";

import { listKnowledgeFiles } from "@/lib/db/knowledge-base";
import {
  CONVERSATION_PAGE_SIZE,
  getConversationListView,
  getOlderThreadMessages,
  listChannelConnections,
  markConversationRead,
  type InboxThreadMessageView,
  type MarkConversationReadResult,
} from "@/lib/db/inbox";
import type { ThreadCursor } from "@/lib/db/thread-page";
import type { ConversationListItemView } from "@/lib/mock";
import {
  canGenerateConversationDraft,
  discardConversationDraft,
  discardGeneratingConversationDraft,
} from "@/lib/db/drafts";
import {
  createManualOutgoingMessage,
  markOutgoingMessageFailedAfterEmit,
  retryFailedOutgoingMessage,
  type OutgoingSendResult,
} from "@/lib/db/outgoing";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getWorkspaceLanguage } from "@/lib/db/workspace-language";
import { translateMessage } from "@/lib/translation/translate-message";
import {
  getAuthenticatedUser,
  getCurrentWorkspace,
  type CurrentWorkspace,
} from "@/lib/db/workspace";
import {
  cancelDraftGenerationRuns,
  startGenerateDraft,
  startSendMessage,
} from "@/lib/workflows/start";

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

/**
 * Предыдущая страница переписки — скролл треда вверх.
 *
 * `before` — самое старое из уже загруженных сообщений: курсор, а не смещение,
 * потому что снизу за время чтения могло приехать новое сообщение (почему так —
 * `lib/db/thread-page.ts`). `revalidatePath` здесь нет: подгруженная история
 * живёт в состоянии треда, а не в кэше страницы.
 */
export type OlderMessagesResult =
  | { ok: true; items: InboxThreadMessageView[]; hasMore: boolean }
  | { ok: false; error: string };

export async function loadOlderMessagesAction(input: {
  conversationId: string;
  before: ThreadCursor;
}): Promise<OlderMessagesResult> {
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
    const language = await getWorkspaceLanguage(supabase, workspace.id);
    const page = await getOlderThreadMessages(
      supabase,
      workspace.id,
      input.conversationId,
      input.before,
      language,
    );

    return { ok: true, items: page.items, hasMore: page.hasMoreBefore };
  } catch (error) {
    console.error("[inbox] failed to load an older thread page", error);
    return { ok: false, error: "Не удалось загрузить сообщения." };
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
 * message is already persisted as `pending` — start the IDs-only
 * `send-message` workflow; the actual provider call happens in that run with
 * retries (vibecoding rule 8), never inside this request. If even the start
 * fails, compensate to `failed` so the thread shows the retry button instead
 * of a forever-pending bubble.
 */
async function requestMessageSend(
  context: Exclude<DraftActionContext, { error: string }>,
  conversationId: string,
  messageId: string,
): Promise<OutgoingSendResult> {
  try {
    await startSendMessage({
      messageId,
      conversationId,
      workspaceId: context.workspace.id,
    });
  } catch (error) {
    console.error("[outgoing] failed to start send-message", error);
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

/**
 * Reply from the thread composer — the single send path.
 *
 * `draftId` is passed when the field still holds the text of a generated
 * draft, edited or not; the draft is then closed as `sent` rather than
 * superseded (see `createManualOutgoingMessage`).
 */
export async function sendManualMessageAction(
  conversationId: string,
  text: string,
  draftId: string | null = null,
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
    draftId,
  );

  if (!created.ok) {
    return created;
  }

  return requestMessageSend(context, conversationId, created.messageId);
}

/** «Повторить» on a failed outgoing bubble: failed → pending → restart. */
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


/**
 * Значок AI в композере — единственный способ создать черновик к диалогу
 * (docs/architecture/07-data-flows.md#62-генерация-черновика). Работа идёт в
 * прогона `generate-draft` с ретраями (правило 8); сюда возвращается
 * только «запустили», а сам черновик приезжает в поле ввода через Realtime.
 */
export async function generateDraftAction(conversationId: string) {
  const context = await getDraftActionContext();

  if ("error" in context) {
    return { ok: false as const, error: context.error };
  }

  const allowed = await canGenerateConversationDraft(
    context.supabase,
    context.workspace.id,
    conversationId,
  );

  if (!allowed.ok) {
    return allowed;
  }

  try {
    await startGenerateDraft({
      conversationId,
      workspaceId: context.workspace.id,
    });
    return { ok: true as const };
  } catch (error) {
    console.error("[drafts] failed to request generation", error);
    return { ok: false as const, error: "Не удалось запустить генерацию." };
  }
}

/**
 * Кнопка «стоп» под спиннером генерации.
 *
 * Черновик гасится здесь и сейчас — именно это разблокирует поле ввода во всех
 * открытых вкладках. Снятие самого прогона идёт следом и только экономит
 * остаток работы, поэтому его неудача не превращается в ошибку.
 */
export async function cancelDraftGenerationAction(conversationId: string) {
  const context = await getDraftActionContext();

  if ("error" in context) {
    return { ok: false as const, error: context.error };
  }

  const discarded = await discardGeneratingConversationDraft(
    context.supabase,
    context.workspace.id,
    conversationId,
  );

  if (!discarded.ok) {
    return discarded;
  }

  await cancelDraftGenerationRuns(discarded.runIds);

  revalidateInboxViews();
  return { ok: true as const };
}

/**
 * Значок перевода в пузыре сообщения: текст переводится на язык из
 * «Настройки → Аккаунт» и кэшируется в `message_translations`.
 *
 * Единственный вызов LLM, который идёт синхронно в запросе, а не событием
 * прогоном: пользователь ждёт результат здесь и сейчас со спиннером на месте
 * значка, и очередь с ретраями сделала бы это ожидание неопределённым. Правило
 * 8 сюда не распространяется — наружу ничего не отправляется, а вебхуки (правило
 * 6) это не затрагивает.
 *
 * `revalidatePath` намеренно нет: перевод живёт в состоянии клиентского
 * компонента пузыря, и перерисовывать ради него весь инбокс незачем.
 */
export async function translateMessageAction(
  conversationId: string,
  messageId: string,
) {
  const context = await getDraftActionContext();

  if ("error" in context) {
    return { ok: false as const, error: context.error };
  }

  const targetLanguage = await getWorkspaceLanguage(
    context.supabase,
    context.workspace.id,
  );

  return translateMessage(
    context.supabase,
    context.workspace.id,
    conversationId,
    messageId,
    targetLanguage,
  );
}
