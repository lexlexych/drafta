"use client";

/**
 * Левая панель «Комментариев»: шапка, фильтр по каналам и список постов.
 *
 * Отбор и пагинация — серверным действием `loadPostsAction`; устройство то же,
 * что у `../../inbox/_components/conversation-list.tsx`.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PostListItemView } from "@/lib/comments/types";
import type { ChannelFilterView } from "@/lib/mock";
import { countWithNoun } from "@/lib/mock/plural";

import { LinkActivity } from "../../_components/activity";
import { ChannelChip } from "../../_components/chips";
import { CommentsIcon, PlusIcon } from "../../_components/icons";
import { ListFilters, scopeLabel } from "../../_components/list-filters";
import { QUERY_KEYS, buildHref } from "../../_components/navigation";
import { usePagedList } from "../../_components/use-paged-list";
import styles from "../../_components/panes.module.css";
import uiStyles from "../../_components/ui.module.css";
import { loadPostsAction } from "../actions";
import { PUBLICATION_FILTERS, PublicationDrafts, type PublicationFilter } from "./publication-drafts";
import listStyles from "./publication-list.module.css";

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
  selectedDraftId,
}: {
  items: PostListItemView[];
  total: number;
  hasMore: boolean;
  channels: readonly ChannelFilterView[];
  openedId: string | null;
  hasCommentChannels: boolean;
  selectedDraftId?: string | null;
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

  const router = useRouter();
  const [publicationFilter, setPublicationFilter] = useState<PublicationFilter>("all");
  const [draftCount, setDraftCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const showPosts = publicationFilter === "all" || publicationFilter === "published";
  const isDefaultFilter = channelIds.length === 0;

  // «Создать» сразу заводит черновик Drafta и открывает мастер.
  async function createDraft() {
    setCreating(true);
    setCreateError("");
    try {
      const response = await fetch("/api/publications?source=draft", { method: "POST", cache: "no-store" });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error || "Не удалось создать черновик.");
      window.dispatchEvent(new Event("publication-changed"));
      router.push(`/comments?draft=${created.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Не удалось создать черновик.");
    } finally {
      setCreating(false);
    }
  }

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
          <h2>Публикации</h2>
          <button type="button" className={listStyles.create} disabled={creating} onClick={() => void createDraft()}>
            <PlusIcon />
            {creating ? "Создаём…" : "Создать"}
          </button>
        </div>
        <span className={styles.paneSubtitle}>{createError || subtitle}</span>
      </div>

      <div className={listStyles.filterRow} role="group" aria-label="Фильтр публикаций">
        {PUBLICATION_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={listStyles.filterChip}
            aria-pressed={publicationFilter === option.id}
            onClick={() => setPublicationFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {showPosts ? (
        <ListFilters
          channels={channels}
          selectedChannelIds={channelIds}
          onChannelsChange={setChannelIds}
        />
      ) : null}

      <div className={styles.list} ref={listRef}>
        <PublicationDrafts selectedId={selectedDraftId} filter={publicationFilter} onCountChange={setDraftCount} />

        {showPosts && draftCount > 0 ? (
          <div className={listStyles.groupLabel}>Посты в соцсетях</div>
        ) : null}

        {showPosts ? <>
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
        </> : null}
      </div>
    </section>
  );
}
