"use client";

/**
 * Лента комментариев под открытой публикацией.
 *
 * Клиентский компонент по двум причинам сразу: сервер отдаёт только последнюю
 * страницу, а предыдущие подтягиваются при скролле вверх (`useThreadWindow`), —
 * и ветки собираются здесь же (`buildCommentThread`), потому что родитель
 * ответа может приехать только со следующей страницей вверх.
 */

import { useMemo } from "react";

import { buildCommentThread } from "@/lib/comments/thread";
import type { CommentEntryView } from "@/lib/comments/types";
import type { TemplateLanguage } from "@/lib/i18n/template-languages";

import paneStyles from "../../_components/panes.module.css";
import type { ReplyTemplateOption } from "../../_components/template-picker";
import { useThreadWindow } from "../../_components/use-thread-window";
import {
  loadOlderCommentsAction,
  type OlderCommentsResult,
} from "../actions";
import { CommentCard } from "./comment-card";

export function CommentThread({
  postId,
  comments,
  hasMoreBefore,
  commentTemplates,
  messageTemplates,
  templateLanguage,
}: {
  postId: string;
  /** Последняя страница ленты плоским списком, в хронологии. */
  comments: CommentEntryView[];
  hasMoreBefore: boolean;
  commentTemplates: readonly ReplyTemplateOption[];
  messageTemplates: readonly ReplyTemplateOption[];
  templateLanguage: TemplateLanguage;
}) {
  const { items, isPending, error, containerRef, sentinelRef } =
    useThreadWindow<CommentEntryView>({
      serverItems: comments,
      serverHasMoreBefore: hasMoreBefore,
      resetKey: postId,
      activityLabel: "Загружаем комментарии…",
      loadOlder: async (before): Promise<OlderCommentsResult> =>
        loadOlderCommentsAction({ postId, before }),
    });

  const threads = useMemo(() => buildCommentThread(items), [items]);

  return (
    <div
      className={`${paneStyles.messages} ${paneStyles.commentsList}`}
      ref={containerRef}
    >
      {/* Маячок над первым комментарием: подгрузка идёт вверх, к более старым. */}
      <div aria-hidden="true" ref={sentinelRef} />
      {isPending ? (
        <div className={paneStyles.listMore}>Загружаем ещё…</div>
      ) : null}
      {error ? <div className={paneStyles.listMore}>{error}</div> : null}

      {threads.length === 0 ? (
        <div className={paneStyles.empty}>Пока нет комментариев.</div>
      ) : null}

      {threads.map((comment) => (
        <CommentCard
          key={comment.id}
          postId={postId}
          comment={comment}
          replies={comment.replies}
          commentTemplates={commentTemplates}
          messageTemplates={messageTemplates}
          templateLanguage={templateLanguage}
        />
      ))}
    </div>
  );
}
