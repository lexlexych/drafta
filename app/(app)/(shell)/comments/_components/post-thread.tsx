"use client";

import Link from "next/link";

import type { PostThreadView } from "@/lib/comments/types";

import { Avatar } from "../../_components/avatar";
import { BackIcon, ExternalIcon } from "../../_components/icons";
import paneStyles from "../../_components/panes.module.css";
import uiStyles from "../../_components/ui.module.css";
import styles from "../comments.module.css";

/**
 * The open post: its description in the header and the comments underneath.
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
}: {
  post: PostThreadView;
  backHref: string;
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
          <div key={comment.id} className={paneStyles.commentRow}>
            <div
              className={[
                paneStyles.comment,
                comment.isReply ? paneStyles.commentReply : "",
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
                  <span
                    className={`${paneStyles.commentHandle} ${uiStyles.num}`}
                  >
                    {comment.time}
                    {comment.deliveryLabel ? ` · ${comment.deliveryLabel}` : ""}
                  </span>
                </div>
                <div className={paneStyles.commentText}>{comment.text}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
