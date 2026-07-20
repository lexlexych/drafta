import Link from "next/link";

import {
  getCategoryFilterOptions,
  getChannelFilters,
  getConversationList,
  getPostThread,
} from "@/lib/mock";

import { Avatar } from "../_components/avatar";
import { CategoryFilter } from "../_components/category-filter";
import { CategoryChip, ChannelChip } from "../_components/chips";
import { Composer } from "../_components/composer";
import { DraftPanel } from "../_components/draft-panel";
import { FilterChips } from "../_components/filter-chips";
import { BackIcon, CommentsIcon, ExternalIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";

const PATHNAME = "/comments";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const channelId = firstParam(params[QUERY_KEYS.channel]);
  const categoryId = firstParam(params[QUERY_KEYS.category]);
  const conversationId = firstParam(params[QUERY_KEYS.conversation]);

  const list = getConversationList("comments", { channelId, categoryId });
  const openedId = conversationId ?? list.items[0]?.id ?? null;
  const post = openedId ? getPostThread(openedId) : null;
  const isDetail = conversationId !== null;

  const listParams = {
    [QUERY_KEYS.channel]: channelId,
    [QUERY_KEYS.category]: categoryId,
  };

  return (
    <div className={styles.panes} data-detail={isDetail}>
      <section className={styles.paneList}>
        <div className={styles.paneHead}>
          <div className={styles.paneHeadRow}>
            <h2>{list.title}</h2>
            <CategoryFilter categories={getCategoryFilterOptions()} />
          </div>
          <span className={styles.paneSubtitle}>{list.subtitle}</span>
        </div>

        <FilterChips
          pathname={PATHNAME}
          channels={getChannelFilters("comments")}
          activeChannelId={channelId}
          extraParams={{ [QUERY_KEYS.category]: categoryId }}
        />

        <div className={styles.list}>
          {list.items.length === 0 ? (
            <div className={styles.empty}>
              Нет постов с комментариями этой категории
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
                <span className={styles.postLink}>
                  пост <ExternalIcon />
                </span>
              </div>
              <div className={styles.postText}>{post.postText}</div>
              <div className={styles.postMeta}>{post.postMeta}</div>
            </div>

            <div className={`${styles.messages} ${styles.commentsList}`}>
              {post.comments.map((comment) => (
                <div
                  key={comment.id}
                  className={[
                    styles.comment,
                    comment.isReply ? styles.commentReply : "",
                    comment.isDraftTarget ? styles.commentTarget : "",
                    comment.isMuted ? styles.commentMuted : "",
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
                      </span>
                    </div>
                    <div className={styles.commentText}>{comment.text}</div>
                    {!comment.isOurs ? (
                      <div className={styles.commentChips}>
                        {comment.category ? (
                          <CategoryChip category={comment.category} />
                        ) : null}
                        {comment.noDraftNote ? (
                          <span className={styles.noDraftNote}>
                            черновик не создаётся
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.draftWrap}>
              {post.draft ? (
                <DraftPanel
                  key={post.conversationId}
                  draft={post.draft}
                  channelName={post.channel.name}
                />
              ) : null}
              <Composer placeholder="Ответить на комментарий вручную…" />
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
