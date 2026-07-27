"use server";

import { revalidatePath } from "next/cache";

import {
  POST_PAGE_SIZE,
  acceptCommentDraftForSend,
  discardCommentDraft,
  editCommentDraft,
  findPostForGeneration,
  getPostListView,
  listChannelConnections,
  listSendablePostDrafts,
  markCommentSendFailedAfterEmit,
  markPostRead,
  savePostDraftBrief,
  type CommentDraftMutationResult,
  type CommentsMutationResult,
} from "@/lib/db/comments";
import type { PostListItemView } from "@/lib/comments/types";
import { createServerSupabaseClient } from "@/lib/db/server";
import {
  getAuthenticatedUser,
  getCurrentWorkspace,
  type CurrentWorkspace,
} from "@/lib/db/workspace";
import {
  emitCommentDraftsRequested,
  emitCommentSendRequested,
} from "@/lib/inngest/events";

/**
 * Server actions of the «Комментарии» screen. Nothing here is shared with
 * `/inbox`: comments have their own tables, their own generation trigger and
 * their own send path.
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
 * «Черновики» dialog confirmed: store the brief and generate a draft for every
 * comment that still needs one.
 */
export async function configureCommentDraftsAction(input: {
  postId: string;
  description: string;
  instruction: string;
}): Promise<CommentsMutationResult> {
  const context = await getActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const saved = await savePostDraftBrief(
    context.supabase,
    context.workspace.id,
    input.postId,
    { description: input.description, instruction: input.instruction },
  );

  if (!saved.ok) {
    return saved;
  }

  revalidateCommentsView();

  return requestCommentDrafts(context.workspace.id, input.postId);
}

/**
 * «Создать черновик» / regenerate on a single comment. The caller only reaches
 * this once the brief is configured — otherwise the UI opens the dialog, which
 * goes through `configureCommentDraftsAction` instead.
 */
export async function generateCommentDraftAction(input: {
  postId: string;
  commentId: string;
}): Promise<CommentsMutationResult> {
  const context = await getActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const post = await findPostForGeneration(
    context.supabase,
    context.workspace.id,
    input.postId,
  );

  if (!post) {
    return { ok: false, error: "Пост не найден." };
  }

  return requestCommentDrafts(
    context.workspace.id,
    input.postId,
    input.commentId,
  );
}

async function requestCommentDrafts(
  workspaceId: string,
  postId: string,
  commentId?: string,
): Promise<CommentsMutationResult> {
  try {
    await emitCommentDraftsRequested({
      workspaceId,
      postId,
      ...(commentId ? { commentId } : {}),
    });
    return { ok: true };
  } catch (error) {
    console.error("[comments] failed to request comment drafts", error);
    return { ok: false, error: "Не удалось запустить генерацию черновиков." };
  }
}

export async function editCommentDraftAction(
  draftId: string,
  text: string,
): Promise<CommentDraftMutationResult> {
  const context = await getActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const result = await editCommentDraft(
    context.supabase,
    context.workspace.id,
    draftId,
    text,
  );

  if (result.ok) {
    revalidateCommentsView();
  }

  return result;
}

export async function discardCommentDraftAction(
  draftId: string,
): Promise<CommentsMutationResult> {
  const context = await getActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const result = await discardCommentDraft(
    context.supabase,
    context.workspace.id,
    draftId,
  );

  if (result.ok) {
    revalidateCommentsView();
  }

  return result;
}

/** Publishes one accepted draft as a reply to its comment. */
export async function sendCommentDraftAction(input: {
  postId: string;
  commentId: string;
  draftId: string;
}): Promise<CommentsMutationResult> {
  const context = await getActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const result = await sendOneCommentDraft(context, input);
  revalidateCommentsView();

  return result;
}

/**
 * «Отправить все»: every ready/edited draft of the post goes out. Rejected
 * drafts are already `discarded`, so they are simply not in the list. A single
 * failure does not abort the rest — the outcome reports how many made it.
 */
export async function sendAllCommentDraftsAction(input: {
  postId: string;
}): Promise<
  | { ok: true; sent: number; failed: number }
  | { ok: false; error: string }
> {
  const context = await getActionContext();

  if ("error" in context) {
    return { ok: false, error: context.error };
  }

  const drafts = await listSendablePostDrafts(
    context.supabase,
    context.workspace.id,
    input.postId,
  );

  if (drafts.length === 0) {
    return { ok: false, error: "Нет черновиков к отправке." };
  }

  let sent = 0;
  let failed = 0;

  for (const draft of drafts) {
    const result = await sendOneCommentDraft(context, {
      postId: input.postId,
      commentId: draft.commentId,
      draftId: draft.draftId,
    });

    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  revalidateCommentsView();

  return { ok: true, sent, failed };
}

async function sendOneCommentDraft(
  context: Exclude<ActionContext, { error: string }>,
  input: { postId: string; commentId: string; draftId: string },
): Promise<CommentsMutationResult> {
  const accepted = await acceptCommentDraftForSend(
    context.supabase,
    context.workspace.id,
    input.commentId,
    input.draftId,
  );

  if (!accepted.ok) {
    return accepted;
  }

  try {
    await emitCommentSendRequested({
      workspaceId: context.workspace.id,
      postId: input.postId,
      replyCommentId: accepted.replyCommentId,
    });
    return { ok: true };
  } catch (error) {
    // The reply is persisted `pending`; without the event nothing would ever
    // publish it, so compensate to `failed` (vibecoding rule 8).
    console.error("[comments] failed to emit comment/send", error);
    await markCommentSendFailedAfterEmit(
      context.supabase,
      context.workspace.id,
      accepted.replyCommentId,
    );
    return { ok: false, error: "Не удалось отправить ответ — попробуйте ещё раз." };
  }
}
