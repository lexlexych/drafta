import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Личные сообщения авторам комментариев (`public.comment_private_replies`).
 *
 * Одна строка на комментарий — это правило Meta («один private reply на
 * комментарий»), и держит его уникальный ключ таблицы, а не код: две вкладки,
 * нажавшие кнопку одновременно, не должны отправить человеку два сообщения.
 *
 * Строка создаётся пользовательским RLS-клиентом до похода к провайдеру, а
 * статус доводит Inngest-функция под service_role.
 */

export type PrivateReplyStatus = "pending" | "sent" | "failed";

export type CommentPrivateReplyView = {
  commentId: string;
  status: PrivateReplyStatus;
};

type PrivateReplyRow = {
  id: string;
  comment_id: string;
  status: string;
};

function isPrivateReplyStatus(value: string): value is PrivateReplyStatus {
  return value === "pending" || value === "sent" || value === "failed";
}

/**
 * ЛС по загруженной странице комментариев одним запросом — их грузит
 * `getPostThreadView`. `commentIds` ограничивает выборку страницей треда;
 * `null` — весь пост.
 */
export async function listPostPrivateReplies(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
  commentIds: readonly string[] | null = null,
): Promise<Map<string, CommentPrivateReplyView>> {
  const map = new Map<string, CommentPrivateReplyView>();

  if (commentIds !== null && commentIds.length === 0) {
    return map;
  }

  let query = supabase
    .from("comment_private_replies")
    .select("id, comment_id, status")
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId);

  if (commentIds !== null) {
    query = query.in("comment_id", [...commentIds]);
  }

  const { data, error } = await query;

  if (error) {
    // Тред должен открыться и без этого: непоказанная пометка «Отвечено в ЛС»
    // хуже пустого экрана только тем, что кнопку предложат ещё раз — а её
    // повторное нажатие всё равно упрётся в уникальный ключ.
    console.error("[comments] failed to load private replies", error);
    return map;
  }

  for (const row of (data ?? []) as PrivateReplyRow[]) {
    map.set(row.comment_id, {
      commentId: row.comment_id,
      status: isPrivateReplyStatus(row.status) ? row.status : "failed",
    });
  }

  return map;
}

/**
 * Заводит ЛС в статусе `pending` — то, за что дальше держится Inngest-функция.
 *
 * Нарушение уникального ключа здесь не ошибка выполнения, а ровно тот случай,
 * ради которого ключ и стоит: комментарию уже писали. Отвечаем понятным
 * текстом, а не «не удалось».
 */
export async function createCommentPrivateReply(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    postId: string;
    commentId: string;
    text: string;
  },
): Promise<{ ok: true; privateReplyId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("comment_private_replies")
    .insert({
      workspace_id: input.workspaceId,
      post_id: input.postId,
      comment_id: input.commentId,
      text: input.text,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Этому комментарию уже отправляли личное сообщение.",
      };
    }

    console.error("[comments] failed to create a private reply", error);
    return { ok: false, error: "Не удалось подготовить отправку." };
  }

  return { ok: true, privateReplyId: (data as { id: string }).id };
}

/**
 * Компенсация неудачного `inngest.send`: без события строка осталась бы
 * `pending` навсегда, а кнопка — недоступной (правило 8).
 */
export async function markPrivateReplyFailedAfterEmit(
  supabase: SupabaseClient,
  workspaceId: string,
  privateReplyId: string,
): Promise<void> {
  const { error } = await supabase
    .from("comment_private_replies")
    .update({ status: "failed" })
    .eq("workspace_id", workspaceId)
    .eq("id", privateReplyId)
    .eq("status", "pending");

  if (error) {
    console.error("[comments] failed to mark a private reply as failed", error);
  }
}

/** Повторная попытка после `failed` — тот же ряд, снова `pending`. */
export async function retryCommentPrivateReply(
  supabase: SupabaseClient,
  workspaceId: string,
  commentId: string,
): Promise<{ ok: true; privateReplyId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("comment_private_replies")
    .update({ status: "pending" })
    .eq("workspace_id", workspaceId)
    .eq("comment_id", commentId)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[comments] failed to retry a private reply", error);
    return { ok: false, error: "Не удалось повторить отправку." };
  }

  if (!data) {
    return { ok: false, error: "Сообщение уже изменилось — обновите страницу." };
  }

  return { ok: true, privateReplyId: (data as { id: string }).id };
}
