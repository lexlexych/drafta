"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { CommentEntryView } from "@/lib/comments/types";
import type { CommentTranslationView } from "@/lib/db/comment-translations";
import {
  isTemplateLanguage,
  templateLanguageLabel,
  type TemplateLanguage,
} from "@/lib/i18n/template-languages";

import { Spinner } from "../../_components/activity";
import { Avatar } from "../../_components/avatar";
import { TranslateIcon, UndoIcon } from "../../_components/icons";
import { showToast } from "../../_components/stub";
import type { ReplyTemplateOption } from "../../_components/template-picker";
import paneStyles from "../../_components/panes.module.css";
import uiStyles from "../../_components/ui.module.css";
import { replyToCommentAction, translateCommentAction } from "../actions";
import styles from "../comments.module.css";
import { InlineComposer } from "./inline-composer";

/**
 * Один комментарий, строка действий под ним и его ветка ответов.
 *
 * Клиентский, потому что и перевод, и поле ответа — локальное состояние одного
 * комментария: `router.refresh()` от realtime-подписки не должен его сбрасывать.
 * Ровно та же причина, по которой клиентский `MessageBubble`.
 */
export function CommentCard({
  postId,
  comment,
  commentTemplates,
  templateLanguage,
  replies = [],
}: {
  postId: string;
  comment: CommentEntryView;
  commentTemplates: readonly ReplyTemplateOption[];
  templateLanguage: TemplateLanguage;
  /** Ветка под комментарием; у самих ответов её нет. */
  replies?: readonly CommentEntryView[];
}) {
  const router = useRouter();
  const [fetched, setFetched] = useState<CommentTranslationView | null>(null);
  const [isTranslated, setIsTranslated] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isReplyOpen, setIsReplyOpen] = useState(false);

  // Свежий перевод перекрывает предзагруженный из кэша.
  const translation = fetched ?? comment.translation;
  const canTranslate = comment.text.trim().length > 0;

  const originLabel =
    translation?.sourceLanguage && isTemplateLanguage(translation.sourceLanguage)
      ? templateLanguageLabel(translation.sourceLanguage)
      : "Оригинал";

  const translateLabel = isTranslating
    ? "Переводим…"
    : isTranslated
      ? `Показать оригинал — ${originLabel}`
      : "Перевести";

  const toggleTranslation = async () => {
    if (isTranslated) {
      setIsTranslated(false);
      return;
    }

    // Уже переведённый комментарий переключается без сети и без спиннера.
    if (translation) {
      setIsTranslated(true);
      return;
    }

    setIsTranslating(true);
    const result = await translateCommentAction(postId, comment.id);
    setIsTranslating(false);

    if (!result.ok) {
      showToast(result.error);
      return;
    }

    setFetched({ text: result.text, sourceLanguage: result.sourceLanguage });
    setIsTranslated(true);
  };

  const submitReply = async (text: string): Promise<boolean> => {
    const result = await replyToCommentAction({
      postId,
      commentId: comment.id,
      text,
    });

    if (!result.ok) {
      showToast(result.error);
      return false;
    }

    setIsReplyOpen(false);
    // `revalidatePath` в действии обновил серверную разметку; refresh подтягивает
    // её, чтобы ответ появился в треде ещё до realtime.
    router.refresh();
    return true;
  };

  return (
    <div className={paneStyles.commentRow}>
      <div
        className={[
          paneStyles.comment,
          comment.isOurs ? paneStyles.commentOurs : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {comment.isOurs ? (
          <span
            className={`${uiStyles.avatar} ${uiStyles.avatarSm} ${paneStyles.ourAvatar}`}
            aria-hidden="true"
          >
            {comment.authorName.slice(0, 1)}
          </span>
        ) : comment.avatar ? (
          <Avatar avatar={comment.avatar} size="sm" />
        ) : null}
        <div className={paneStyles.commentBody}>
          <div className={paneStyles.commentHead}>
            <b>{comment.authorName}</b>
            <span className={`${paneStyles.commentHandle} ${uiStyles.num}`}>
              {comment.time}
              {comment.deliveryLabel ? ` · ${comment.deliveryLabel}` : ""}
            </span>
          </div>
          <div className={paneStyles.commentText}>
            {isTranslated && translation ? translation.text : comment.text}
          </div>
        </div>
      </div>

      {comment.isOurs ? null : isReplyOpen ? (
        <InlineComposer
          placeholder="Ответить на комментарий…"
          templates={commentTemplates}
          workspaceLanguage={templateLanguage}
          onSubmit={submitReply}
          onCancel={() => setIsReplyOpen(false)}
        />
      ) : (
        <div className={styles.commentActions}>
          {canTranslate ? (
            <button
              type="button"
              className={styles.commentAction}
              onClick={() => void toggleTranslation()}
              disabled={isTranslating}
              aria-busy={isTranslating}
              aria-label={translateLabel}
              title={translateLabel}
            >
              {isTranslating ? (
                <Spinner size={12} />
              ) : isTranslated ? (
                <UndoIcon />
              ) : (
                <TranslateIcon />
              )}
              {isTranslated ? <span>{originLabel}</span> : null}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.commentAction}
            onClick={() => setIsReplyOpen(true)}
          >
            Ответить
          </button>
        </div>
      )}

      {replies.length > 0 ? (
        <div className={styles.commentReplies}>
          {replies.map((reply) => (
            <CommentCard
              key={reply.id}
              postId={postId}
              comment={reply}
              commentTemplates={commentTemplates}
              templateLanguage={templateLanguage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
