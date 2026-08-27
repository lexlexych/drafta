"use server";

import { revalidatePath } from "next/cache";

import {
  POST_PAGE_SIZE,
  acceptManualCommentReply,
  getPostListView,
  listChannelConnections,
  markCommentSendFailedAfterEmit,
  markPostRead,
  type CommentsMutationResult,
} from "@/lib/db/comments";
import type { PostListItemView } from "@/lib/comments/types";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getWorkspaceLanguage } from "@/lib/db/workspace-language";
import {
  translateComment,
  type TranslateCommentResult,
} from "@/lib/translation/translate-comment";
import {
  getAuthenticatedUser,
  getCurrentWorkspace,
  type CurrentWorkspace,
} from "@/lib/db/workspace";
import { emitCommentSendRequested } from "@/lib/inngest/events";
/**
 * Server actions of the «Публикации» screen. Nothing here is shared with
 * `/inbox`: comments have their own tables and their own send path.
 *
 * Same thin-wrapper shape as the inbox actions: resolve the *authenticated
 * caller's own* workspace from the session (never a client-supplied workspace
 * id), get the cookie-scoped RLS-respecting client, delegate to `lib/db`.
 */

function revalidateCommentsView() {
  revalidatePath("/comments");
}

/**
 * Страница списка постов под выбранными каналами — и смена фильтра, и
 * дозагрузка при скролле. Почему через действие, а не через адрес — см.
 * `../inbox/actions.ts`.
 */
export type PostPageResult =
  | { ok: true; items: PostListItemView[]; total: number; hasMore: boolean }
  | { ok: false; error: string };

export async function loadPostsAction(input: {
  channelIds: string[];
  offset: number;
}): Promise<PostPageResult> {
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
    const channels = await listChannelConnections(supabase, workspace.id);
    const page = await getPostListView(supabase, workspace.id, channels, {
      channelIds: input.channelIds,
      offset: input.offset,
      limit: POST_PAGE_SIZE,
    });

    return {
      ok: true,
      items: page.items,
      total: page.total,
      hasMore: page.hasMore,
    };
  } catch (error) {
    console.error("[comments] failed to load a post page", error);
    return { ok: false, error: "Не удалось загрузить список постов." };
  }
}

type ActionContext =
  | { error: string }
  | {
      workspace: CurrentWorkspace;
      supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
    };

async function getActionContext(): Promise<ActionContext> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { error: "Сессия истекла — войдите заново." } as const;
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { error: "Рабочее пространство не найдено." } as const;
  }

  return { workspace, supabase: await createServerSupabaseClient() } as const;
}

/** Opening a post resets its unread counter — see `../inbox/actions.ts`. */
export async function markPostReadAction(
  postId: string,
): Promise<CommentsMutationResult> {
  const context = await getActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const result = await markPostRead(
    context.supabase,
    context.workspace.id,
    postId,
  );

  if (result.ok) {
    revalidateCommentsView();
  }

  return result;
}

/**
 * Перевод одного комментария на язык workspace — зеркало
 * `translateMessageAction` из `../inbox/actions.ts`.
 *
 * `revalidatePath` намеренно нет: перевод живёт в состоянии клиентского
 * компонента, а не в серверной разметке треда, и рефреш только сбросил бы его.
 */
export async function translateCommentAction(
  postId: string,
  commentId: string,
): Promise<TranslateCommentResult> {
  const context = await getActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const targetLanguage = await getWorkspaceLanguage(
    context.supabase,
    context.workspace.id,
  );

  return translateComment(
    context.supabase,
    context.workspace.id,
    postId,
    commentId,
    targetLanguage,
  );
}

/**
 * «Ответить»: публичный ответ на конкретный комментарий, набранный оператором
 * или подставленный шаблоном.
 *
 * Строка `comments` появляется сразу в статусе `pending` — она и есть то, что
 * пользователь видит в треде как «Отправляется…». Наружу ответ уходит
 * Inngest-функцией `send-comment` с ретраями (правило 8), а не из этого
 * запроса; если событие не удалось отправить, ответ помечается `failed`, иначе
 * он остался бы «отправляющимся» навсегда.
 */
export async function replyToCommentAction(input: {
  postId: string;
  commentId: string;
  text: string;
}): Promise<CommentsMutationResult> {
  const context = await getActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const accepted = await acceptManualCommentReply(
    context.supabase,
    context.workspace.id,
    input.commentId,
    input.text,
  );

  if (!accepted.ok) {
    return accepted;
  }

  revalidateCommentsView();

  try {
    await emitCommentSendRequested({
      workspaceId: context.workspace.id,
      postId: input.postId,
      replyCommentId: accepted.replyCommentId,
    });
    return { ok: true };
  } catch (error) {
    console.error("[comments] failed to emit comment/send", error);
    await markCommentSendFailedAfterEmit(
      context.supabase,
      context.workspace.id,
      accepted.replyCommentId,
    );
    revalidateCommentsView();
    return { ok: false, error: "Не удалось отправить ответ — попробуйте ещё раз." };
  }
}
