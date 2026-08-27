import Link from "next/link";

import type { PostThreadView } from "@/lib/comments/types";
import type { TemplateLanguage } from "@/lib/i18n/template-languages";

import { BackIcon, ExternalIcon } from "../../_components/icons";
import type { ReplyTemplateOption } from "../../_components/template-picker";
import paneStyles from "../../_components/panes.module.css";
import styles from "../comments.module.css";
import { CommentThread } from "./comment-thread";

/**
 * The open post: its description in the header and the comments underneath.
 *
 * Шапка серверная, лента комментариев — клиентская (`CommentThread`): сервер
 * отдаёт только последнюю страницу, остальное она подтягивает при скролле
 * вверх. Состояние отдельного комментария (перевод, открытое поле ответа) живёт
 * в `CommentCard`, поэтому `router.refresh()` от Realtime его не сбрасывает.
 *
 * AI drafts used to live here — a card under every comment plus the «Черновики»
 * brief dialog and an «Отправить все» bar. That whole surface is gone while the
 * draft flow is redesigned; the generation pipeline itself (`comment_drafts`,
 * `generate-comment-drafts`) is untouched and simply has no entry point on this
 * screen for now.
 */
export function PostThread({
  post,
  backHref,
  commentTemplates,
  messageTemplates,
  templateLanguage,
}: {
  post: PostThreadView;
  backHref: string;
  commentTemplates: readonly ReplyTemplateOption[];
  messageTemplates: readonly ReplyTemplateOption[];
  templateLanguage: TemplateLanguage;
}) {
  return (
    <>
      <div className={paneStyles.threadHead}>
        <Link
          className={paneStyles.backButton}
          href={backHref}
          aria-label="Назад"
        >
          <BackIcon />
        </Link>
        <div className={paneStyles.threadWho}>
          {/* Описание публикации вместо прежнего «Комментарии к посту»:
              две строки, дальше многоточие — места в шапке больше, чем в списке. */}
          <b className={paneStyles.postDescription}>
            {post.postText || "Пост без описания"}
          </b>
          <div className={paneStyles.postMeta}>{post.postMeta}</div>
        </div>
        {post.postUrl ? (
          <div className={styles.headActions}>
            <a
              className={paneStyles.postLink}
              href={post.postUrl}
              target="_blank"
              rel="noreferrer"
            >
              Открыть пост <ExternalIcon />
            </a>
          </div>
        ) : null}
      </div>

      <CommentThread
        postId={post.postId}
        comments={post.comments}
        hasMoreBefore={post.hasMoreBefore}
        commentTemplates={commentTemplates}
        messageTemplates={messageTemplates}
        templateLanguage={templateLanguage}
      />
    </>
  );
}
