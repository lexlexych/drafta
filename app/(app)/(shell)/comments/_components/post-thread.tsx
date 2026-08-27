import Link from "next/link";

import type { PostThreadView } from "@/lib/comments/types";
import type { TemplateLanguage } from "@/lib/i18n/template-languages";

import { BackIcon, ExternalIcon } from "../../_components/icons";
import type { ReplyTemplateOption } from "../../_components/template-picker";
import paneStyles from "../../_components/panes.module.css";
import styles from "../comments.module.css";
import { CommentCard } from "./comment-card";

/**
 * The open post: its description in the header and the comments underneath.
 * Server-rendered: per-comment state (translation, the open reply field) lives
 * in `CommentCard`, so a `router.refresh()` from realtime never resets it.
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
  templateLanguage,
}: {
  post: PostThreadView;
  backHref: string;
  commentTemplates: readonly ReplyTemplateOption[];
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

      <div className={`${paneStyles.messages} ${paneStyles.commentsList}`}>
        {post.comments.length === 0 ? (
          <div className={paneStyles.empty}>Пока нет комментариев.</div>
        ) : null}
        {post.comments.map((comment) => (
          <CommentCard
            key={comment.id}
            postId={post.postId}
            comment={comment}
            replies={comment.replies}
            commentTemplates={commentTemplates}
            templateLanguage={templateLanguage}
          />
        ))}
      </div>
    </>
  );
}
