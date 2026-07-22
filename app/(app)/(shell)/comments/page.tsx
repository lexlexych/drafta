import Link from "next/link";

import {
  getCommentsChannelFiltersView,
  getPostListView,
  getPostThreadView,
  listChannelConnections,
} from "@/lib/db/comments-inbox";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { Avatar } from "../_components/avatar";
import { ChannelChip } from "../_components/chips";
import { DraftPanel } from "../_components/draft-panel";
import { FilterChips } from "../_components/filter-chips";
import { BackIcon, CommentsIcon, ExternalIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";
import { MarkThreadRead } from "../inbox/mark-thread-read";

const PATHNAME = "/comments";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const channelId = firstParam(params[QUERY_KEYS.channel]);
  const conversationId = firstParam(params[QUERY_KEYS.conversation]);

  const user = await getAuthenticatedUser();
  const workspace = user ? await getCurrentWorkspace(user.id) : null;

  if (!workspace) {
    // The shell layout redirects before this can render for a real request —
    // a safety net for this component in isolation (e.g. tests).
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const channels = await listChannelConnections(supabase, workspace.id);
  const commentCapableChannels = channels.filter(
    (channel) => channel.capabilities.supportsComments === true,
  );
  const hasCommentChannels = commentCapableChannels.length > 0;

  const [list, filterChannels] = await Promise.all([
    getPostListView(supabase, workspace.id, channels, { channelId }),
    getCommentsChannelFiltersView(supabase, workspace.id, channels),
  ]);

  const openedId = conversationId ?? list.items[0]?.id ?? null;
  const post = openedId
    ? await getPostThreadView(supabase, workspace.id, channels, openedId)
    : null;
  const isDetail = conversationId !== null;

  const listParams = { [QUERY_KEYS.channel]: channelId };

  return (
    <div className={styles.panes} data-detail={isDetail}>
      <section className={styles.paneList}>
        <div className={styles.paneHead}>
          <div className={styles.paneHeadRow}>
            <h2>{list.title}</h2>
          </div>
          <span className={styles.paneSubtitle}>{list.subtitle}</span>
        </div>

        <FilterChips
          pathname={PATHNAME}
          channels={filterChannels}
          activeChannelId={channelId}
        />

        <div className={styles.list}>
          {!hasCommentChannels ? (
            <div className={styles.empty}>
              <p>Нет каналов с поддержкой комментариев.</p>
              <Link
                className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSmall}`}
                href={buildHref("/settings", { [QUERY_KEYS.section]: "channels" })}
              >
                Настройки → Каналы
              </Link>
            </div>
          ) : list.items.length === 0 ? (
            <div className={styles.empty}>
              {channelId
                ? "Нет постов с комментариями в этом канале."
                : "Нет постов — комментарии появятся здесь, когда придёт первый."}
            </div>
          ) : null}
          {list.items.map((item) => (
            <Link
              key={item.id}
              className={styles.listItem}
              data-active={item.id === openedId}
              data-unread={item.unreadCount > 0}
              href={buildHref(PATHNAME, {
                ...listParams,
                [QUERY_KEYS.conversation]: item.id,
              })}
            >
              <span
                className={`${uiStyles.avatar} ${uiStyles.avatarMd} ${styles.postIcon}`}
                aria-hidden="true"
              >
                <CommentsIcon size={17} />
              </span>
              <span className={styles.listBody}>
                <span className={styles.listTitleRow}>
                  <b>{item.title}</b>
                  <time className={uiStyles.num}>{item.time}</time>
                </span>
                <span className={styles.listPreview}>{item.preview}</span>
                <span className={styles.listChips}>
                  <ChannelChip channel={item.channel} />
                  <span className={styles.listSpacer} />
                  {item.unreadCount > 0 ? (
                    <span className={`${uiStyles.unread} ${uiStyles.num}`}>
                      {item.unreadCount}
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.paneDetail}>
        {post ? (
          <>
            <MarkThreadRead conversationId={post.conversationId} />
            <div className={styles.threadHead}>
              <Link
                className={styles.backButton}
                href={buildHref(PATHNAME, listParams)}
                aria-label="Назад"
              >
                <BackIcon />
              </Link>
              <div className={styles.threadWho}>
                <b>Комментарии к посту</b>
                <div className={styles.threadChips}>
                  <ChannelChip channel={post.channel} />
                </div>
              </div>
            </div>

            <div className={styles.postCard}>
              <div className={styles.postCardTop}>
                <ChannelChip channel={post.channel} />
                {post.postUrl ? (
                  <a
                    className={styles.postLink}
                    href={post.postUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    пост <ExternalIcon />
                  </a>
                ) : null}
              </div>
              <div className={styles.postText}>{post.postText}</div>
              <div className={styles.postMeta}>{post.postMeta}</div>
            </div>

            <div className={`${styles.messages} ${styles.commentsList}`}>
              {post.comments.length === 0 ? (
                <div className={styles.empty}>Пока нет комментариев.</div>
              ) : null}
              {post.comments.map((comment) => (
                <div key={comment.id} className={styles.commentRow}>
                  <div
                    className={[
                      styles.comment,
                      comment.isReply ? styles.commentReply : "",
                      comment.draft ? styles.commentTarget : "",
                      comment.isOurs ? styles.commentOurs : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {comment.isOurs ? (
                      <span
                        className={`${uiStyles.avatar} ${uiStyles.avatarSm} ${styles.ourAvatar}`}
                        aria-hidden="true"
                      >
                        {comment.authorName.slice(0, 1)}
                      </span>
                    ) : comment.avatar ? (
                      <Avatar avatar={comment.avatar} size="sm" />
                    ) : null}
                    <div className={styles.commentBody}>
                      <div className={styles.commentHead}>
                        <b>{comment.authorName}</b>
                        {comment.authorHandle ? (
                          <span className={styles.commentHandle}>
                            {comment.authorHandle}
                          </span>
                        ) : null}
                        <span className={`${styles.commentHandle} ${uiStyles.num}`}>
                          {comment.time}
                          {comment.deliveryLabel ? ` · ${comment.deliveryLabel}` : ""}
                        </span>
                      </div>
                      <div className={styles.commentText}>{comment.text}</div>
                    </div>
                  </div>

                  {/* One draft per comment, rendered right under it (stage 5). */}
                  {comment.draft ? (
                    <div className={styles.commentDraft}>
                      <DraftPanel
                        key={`${comment.id}:${comment.draft.id}:${comment.draft.updatedAt}`}
                        draft={comment.draft}
                        workspaceId={workspace.id}
                        conversationId={post.conversationId}
                        targetMessageId={comment.id}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
