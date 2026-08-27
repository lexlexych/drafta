"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { CommentEntryView } from "@/lib/comments/types";
import type { CommentTranslationView } from "@/lib/db/comment-translations";
import {
  isTemplateLanguage,
  templateLanguageLabel,
  type TemplateLanguage,
} from "@/lib/i18n/template-languages";

import { LinkActivity, Spinner } from "../../_components/activity";
import { Avatar } from "../../_components/avatar";
import { CheckIcon, TranslateIcon, UndoIcon } from "../../_components/icons";
import { showToast } from "../../_components/stub";
import type { ReplyTemplateOption } from "../../_components/template-picker";
import paneStyles from "../../_components/panes.module.css";
import uiStyles from "../../_components/ui.module.css";
import {
  replyToCommentAction,
  retryCommentPrivateReplyAction,
  sendCommentPrivateReplyAction,
  translateCommentAction,
} from "../actions";
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
  messageTemplates,
  templateLanguage,
  replies = [],
}: {
  postId: string;
  comment: CommentEntryView;
  /** Шаблоны для «Ответить» — публичный ответ под постом. */
  commentTemplates: readonly ReplyTemplateOption[];
  /** Шаблоны для «Написать в ЛС» — это личная переписка, а не комментарий. */
  messageTemplates: readonly ReplyTemplateOption[];
  templateLanguage: TemplateLanguage;
  /** Ветка под комментарием; у самих ответов её нет. */
  replies?: readonly CommentEntryView[];
}) {
  const router = useRouter();
  const [fetched, setFetched] = useState<CommentTranslationView | null>(null);
  const [isTranslated, setIsTranslated] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [openField, setOpenField] = useState<"reply" | "dm" | null>(null);

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

    setOpenField(null);
    // `revalidatePath` в действии обновил серверную разметку; refresh подтягивает
    // её, чтобы ответ появился в треде ещё до realtime.
    router.refresh();
    return true;
  };

  const submitPrivateReply = async (text: string): Promise<boolean> => {
    const result = await sendCommentPrivateReplyAction({
      postId,
      commentId: comment.id,
      text,
    });

    if (!result.ok) {
      showToast(result.error);
      return false;
    }

    setOpenField(null);
    router.refresh();
    return true;
  };

  const retryPrivateReply = async () => {
    const result = await retryCommentPrivateReplyAction({
      postId,
      commentId: comment.id,
    });

    if (!result.ok) {
      showToast(result.error);
      return;
    }

    router.refresh();
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

      {comment.isOurs ? null : openField === "reply" ? (
        <InlineComposer
          placeholder="Ответить на комментарий…"
          templates={commentTemplates}
          workspaceLanguage={templateLanguage}
          onSubmit={submitReply}
          onCancel={() => setOpenField(null)}
        />
      ) : openField === "dm" ? (
        <InlineComposer
          placeholder="Написать в личные сообщения…"
          templates={messageTemplates}
          workspaceLanguage={templateLanguage}
          onSubmit={submitPrivateReply}
          onCancel={() => setOpenField(null)}
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
            onClick={() => setOpenField("reply")}
          >
            Ответить
          </button>
          <PrivateReplyAction
            comment={comment}
            onOpen={() => setOpenField("dm")}
            onRetry={() => void retryPrivateReply()}
          />
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
              messageTemplates={messageTemplates}
              templateLanguage={templateLanguage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Третье действие строки: «Написать в ЛС» — или то, во что оно превратилось
 * после отправки.
 *
 * Кнопки нет вовсе, когда написать нельзя: платформа не поддерживает private
 * reply или прошли отведённые Meta 7 дней. Подсказывать про закрывшееся окно
 * нечем — вернуть его пользователь всё равно не может.
 */
function PrivateReplyAction({
  comment,
  onOpen,
  onRetry,
}: {
  comment: CommentEntryView;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const privateReply = comment.privateReply;

  if (!privateReply) {
    return comment.canPrivateReply ? (
      <button type="button" className={styles.commentAction} onClick={onOpen}>
        Написать в ЛС
      </button>
    ) : null;
  }

  if (privateReply.status === "pending") {
    return <span className={styles.commentActionNote}>Отправляется в ЛС…</span>;
  }

  if (privateReply.status === "failed") {
    return (
      <button type="button" className={styles.commentAction} onClick={onRetry}>
        Не удалось отправить в ЛС — повторить
      </button>
    );
  }

  const label = (
    <>
      <CheckIcon size={13} /> Отвечено в ЛС
    </>
  );

  // Переписка появляется в drafta вебхуком `conversation.started`, который
  // может ещё не доехать, — тогда ведём в карточку контакта.
  return comment.dmHref ? (
    <Link className={styles.commentAction} href={comment.dmHref}>
      {label}
      <LinkActivity label="Открываем переписку…" />
    </Link>
  ) : (
    <span className={styles.commentActionNote}>{label}</span>
  );
}
