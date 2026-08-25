"use client";

/**
 * Левая панель «Комментариев»: шапка, фильтр по каналам и список постов.
 *
 * Отбор и пагинация — серверным действием `loadPostsAction`; устройство то же,
 * что у `../../inbox/_components/conversation-list.tsx`.
 */

import Link from "next/link";

import type { PostListItemView } from "@/lib/comments/types";
import type { ChannelFilterView } from "@/lib/mock";
import { countWithNoun } from "@/lib/mock/plural";

import { LinkActivity } from "../../_components/activity";
import { ChannelChip } from "../../_components/chips";
import { CommentsIcon } from "../../_components/icons";
import { ListFilters, scopeLabel } from "../../_components/list-filters";
import { QUERY_KEYS, buildHref } from "../../_components/navigation";
import { usePagedList } from "../../_components/use-paged-list";
import styles from "../../_components/panes.module.css";
import uiStyles from "../../_components/ui.module.css";
import { loadPostsAction } from "../actions";

const PATHNAME = "/comments";

/** Один и тот же пустой фильтр — чтобы не пересоздавать массив на каждый рендер. */
const EMPTY_CHANNEL_FILTER: string[] = [];

export function PostList({
  items: serverItems,
  total: serverTotal,
  hasMore: serverHasMore,
  channels,
  openedId,
  hasCommentChannels,
}: {
  items: PostListItemView[];
  total: number;
  hasMore: boolean;
  channels: readonly ChannelFilterView[];
  openedId: string | null;
  hasCommentChannels: boolean;
}) {
  const {
    filter: channelIds,
    setFilter: setChannelIds,
    items,
    total,
    hasMore,
    isPending,
    error,
    listRef,
    sentinelRef,
  } = usePagedList<PostListItemView, string[]>({
    serverItems,
    serverTotal,
    serverHasMore,
    initialFilter: EMPTY_CHANNEL_FILTER,
    isDefaultFilter: (next) => next.length === 0,
    loadPage: (next, offset) => loadPostsAction({ channelIds: next, offset }),
    activityLabel: "Загружаем посты…",
  });

  const isDefaultFilter = channelIds.length === 0;

  const subtitle = [
    scopeLabel(channelIds, channels, "все каналы", [
      "канал",
      "канала",
      "каналов",
    ]),
    countWithNoun(total, ["пост", "поста", "постов"]),
  ].join(" · ");

  return (
    <section className={styles.paneList}>
      <div className={styles.paneHead}>
        <div className={styles.paneHeadRow}>
          <h2>Комментарии</h2>
        </div>
        <span className={styles.paneSubtitle}>{subtitle}</span>
      </div>

      <ListFilters
        channels={channels}
        selectedChannelIds={channelIds}
        onChannelsChange={setChannelIds}
      />

      <div className={styles.list} ref={listRef}>
        {error ? <div className={styles.empty}>{error}</div> : null}

        {!error && !hasCommentChannels ? (
          <div className={styles.empty}>
            <p>Нет каналов с поддержкой комментариев.</p>
            <Link
              className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSmall}`}
              href={buildHref("/settings", { [QUERY_KEYS.section]: "channels" })}
            >
              Настройки → Каналы
              <LinkActivity label="Открываем настройки…" />
            </Link>
          </div>
        ) : null}

        {!error && hasCommentChannels && items.length === 0 && !isPending ? (
          <div className={styles.empty}>
            {isDefaultFilter
              ? "Постов пока нет — они появятся здесь сразу после публикации."
              : "Нет постов под выбранный фильтр."}
          </div>
        ) : null}

        {items.map((item) => (
          <Link
            key={item.id}
            className={styles.listItem}
            data-active={item.id === openedId}
            data-unread={item.unreadCount > 0}
            href={buildHref(PATHNAME, { [QUERY_KEYS.post]: item.id })}
          >
            <span
              className={styles.postThumbnail}
              aria-hidden="true"
            >
              <CommentsIcon size={17} />
              {item.thumbnailUrl?.startsWith("https://") ? (
                // Provider post previews are decorative; the adjacent title
                // remains the accessible identity of the list item.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.postThumbnailImage}
                  src={item.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  referrerPolicy="no-referrer"
                  onError={(event) => {
                    // Reveal the CommentsIcon already rendered underneath.
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
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
            <LinkActivity label="Открываем пост…" />
          </Link>
        ))}

        <div aria-hidden="true" ref={sentinelRef} />
        {hasMore ? (
          <div className={styles.listMore}>
            {isPending ? "Загружаем ещё…" : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
