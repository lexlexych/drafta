"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { PostThreadView } from "@/lib/comments/types";

import { Avatar } from "../../_components/avatar";
import { ChannelChip } from "../../_components/chips";
import { BackIcon, ExternalIcon } from "../../_components/icons";
import { showToast } from "../../_components/stub";
import paneStyles from "../../_components/panes.module.css";
import uiStyles from "../../_components/ui.module.css";
import {
  configureCommentDraftsAction,
  discardCommentDraftAction,
  editCommentDraftAction,
  generateCommentDraftAction,
  sendAllCommentDraftsAction,
  sendCommentDraftAction,
} from "../actions";
import styles from "../comments.module.css";
import { CommentDraftCard } from "./comment-draft-card";
import { DraftBriefDialog } from "./draft-brief-dialog";

/**
 * The open post: its comments and, under each of them, its own draft reply.
 *
 * Drafts are never here on arrival — the user starts them from «Черновики» in
 * the header (whole post) or «Создать черновик» on a single comment. When the
 * brief has not been filled in yet, the single-comment button opens the same
 * dialog instead of generating blindly.
 *
 * Generation is asynchronous (an Inngest run per post); this component just
 * kicks it off and refreshes — the `comment_drafts` realtime subscription
 * (lib/realtime/inbox-sync.ts) brings each finished draft onto the screen.
 */
export function PostThread({
  post,
  backHref,
}: {
  post: PostThreadView;
  backHref: string;
}) {
  const router = useRouter();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const openDialog = () => setIsDialogOpen(true);

  function confirmBrief(input: { description: string; instruction: string }) {
    startTransition(async () => {
      const result = await configureCommentDraftsAction({
        postId: post.postId,
        ...input,
      });

      if (!result.ok) {
        showToast(result.error);
        return;
      }

      setIsDialogOpen(false);
      showToast("Черновики генерируются…");
      router.refresh();
    });
  }

  function createDraft(commentId: string) {
    // Without a brief there is nothing to generate from — ask for it first.
    if (!post.draftBrief.isConfigured) {
      openDialog();
      return;
    }

    setPendingCommentId(commentId);
    startTransition(async () => {
      const result = await generateCommentDraftAction({
        postId: post.postId,
        commentId,
      });
      setPendingCommentId(null);

      showToast(result.ok ? "Черновик генерируется…" : result.error);

      if (result.ok) {
        router.refresh();
      }
    });
  }

  function sendAll() {
    startTransition(async () => {
      const result = await sendAllCommentDraftsAction({ postId: post.postId });

      if (!result.ok) {
        showToast(result.error);
        return;
      }

      showToast(
        result.failed > 0
          ? `Отправлено ${result.sent}, не удалось — ${result.failed}.`
          : `Отправляется ответов: ${result.sent}.`,
      );
      router.refresh();
    });
  }

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
          <b>Комментарии к посту</b>
          <div className={paneStyles.threadChips}>
            <ChannelChip channel={post.channel} />
          </div>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={`${uiStyles.button} ${uiStyles.buttonSecondary} ${uiStyles.buttonSmall}`}
            onClick={openDialog}
            disabled={isPending}
          >
            Черновики
          </button>
        </div>
      </div>

      <div className={paneStyles.postCard}>
        <div className={paneStyles.postCardTop}>
          <ChannelChip channel={post.channel} />
          {post.postUrl ? (
            <a
              className={paneStyles.postLink}
              href={post.postUrl}
              target="_blank"
              rel="noreferrer"
            >
              пост <ExternalIcon />
            </a>
          ) : null}
        </div>
        <div className={paneStyles.postText}>
          {post.postText || "У поста нет текста."}
        </div>
        <div className={paneStyles.postMeta}>{post.postMeta}</div>
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
                comment.draft ? paneStyles.commentTarget : "",
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
                  {comment.authorHandle ? (
                    <span className={paneStyles.commentHandle}>
                      {comment.authorHandle}
                    </span>
                  ) : null}
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

            {comment.draft ? (
              <div className={paneStyles.commentDraft}>
                <CommentDraftCard
                  draft={comment.draft}
                  disabled={isPending}
                  onSend={async () => {
                    const result = await sendCommentDraftAction({
                      postId: post.postId,
                      commentId: comment.id,
                      draftId: comment.draft!.id,
                    });
                    showToast(
                      result.ok ? "Ответ отправляется…" : result.error,
                    );
                    router.refresh();
                  }}
                  onEdit={async (text) => {
                    const result = await editCommentDraftAction(
                      comment.draft!.id,
                      text,
                    );
                    if (!result.ok) {
                      showToast(result.error);
                      return false;
                    }
                    router.refresh();
                    return true;
                  }}
                  onDiscard={async () => {
                    const result = await discardCommentDraftAction(
                      comment.draft!.id,
                    );
                    if (!result.ok) {
                      showToast(result.error);
                      return;
                    }
                    router.refresh();
                  }}
                  onRegenerate={async () => {
                    const result = await generateCommentDraftAction({
                      postId: post.postId,
                      commentId: comment.id,
                    });
                    showToast(
                      result.ok ? "Черновик генерируется…" : result.error,
                    );
                    if (result.ok) {
                      router.refresh();
                    }
                  }}
                />
              </div>
            ) : comment.isOurs ? null : comment.isAnswered ? (
              <p className={styles.answeredNote}>Ответ уже отправлен.</p>
            ) : (
              <div className={styles.commentActions}>
                <button
                  type="button"
                  className={`${uiStyles.button} ${uiStyles.buttonSecondary} ${uiStyles.buttonSmall}`}
                  disabled={isPending}
                  onClick={() => createDraft(comment.id)}
                >
                  {pendingCommentId === comment.id
                    ? "Запускается…"
                    : "Создать черновик"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.sendAllBar}>
        <span className={styles.sendAllHint}>
          {post.sendableDraftCount > 0
            ? `Готовы к отправке: ${post.sendableDraftCount}`
            : "Готовых черновиков нет."}
        </span>
        <button
          type="button"
          className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
          disabled={isPending || post.sendableDraftCount === 0}
          onClick={sendAll}
        >
          Отправить все
        </button>
      </div>

      {isDialogOpen ? (
        <DraftBriefDialog
          brief={post.draftBrief}
          isPending={isPending}
          onCancel={() => setIsDialogOpen(false)}
          onConfirm={confirmBrief}
        />
      ) : null}
    </>
  );
}
