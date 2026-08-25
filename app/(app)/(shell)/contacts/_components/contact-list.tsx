"use client";

/**
 * Левая панель «Контактов»: шапка, фильтр по каналам и список контактов.
 *
 * Отбор и пагинация — серверным действием `loadContactsAction`; устройство то
 * же, что у `../../inbox/_components/conversation-list.tsx`.
 */

import Link from "next/link";

import type { ChannelFilterView, ContactListItemView } from "@/lib/mock";
import { countWithNoun } from "@/lib/mock/plural";

import { LinkActivity } from "../../_components/activity";
import { PlatformDot } from "../../_components/chips";
import { ListFilters, scopeLabel } from "../../_components/list-filters";
import { QUERY_KEYS, buildHref } from "../../_components/navigation";
import { usePagedList } from "../../_components/use-paged-list";
import styles from "../../_components/panes.module.css";
import uiStyles from "../../_components/ui.module.css";
import { loadContactsAction } from "../actions";
import contactStyles from "../contacts.module.css";
import { RefreshableContactAvatar } from "../refreshable-contact-avatar";

const PATHNAME = "/contacts";

/** Один и тот же пустой фильтр — чтобы не пересоздавать массив на каждый рендер. */
const EMPTY_CHANNEL_FILTER: string[] = [];

export function ContactList({
  items: serverItems,
  total: serverTotal,
  hasMore: serverHasMore,
  channels,
  openedId,
}: {
  items: ContactListItemView[];
  total: number;
  hasMore: boolean;
  channels: readonly ChannelFilterView[];
  openedId: string | null;
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
  } = usePagedList<ContactListItemView, string[]>({
    serverItems,
    serverTotal,
    serverHasMore,
    initialFilter: EMPTY_CHANNEL_FILTER,
    isDefaultFilter: (next) => next.length === 0,
    loadPage: (next, offset) => loadContactsAction({ channelIds: next, offset }),
    activityLabel: "Загружаем контакты…",
  });

  const isDefaultFilter = channelIds.length === 0;

  const subtitle = [
    scopeLabel(channelIds, channels, "все каналы", [
      "канал",
      "канала",
      "каналов",
    ]),
    countWithNoun(total, ["контакт", "контакта", "контактов"]),
  ].join(" · ");

  return (
    <section className={styles.paneList}>
      <div className={styles.paneHead}>
        <h2>Контакты</h2>
        <span className={styles.paneSubtitle}>{subtitle}</span>
      </div>

      <ListFilters
        channels={channels}
        selectedChannelIds={channelIds}
        onChannelsChange={setChannelIds}
      />

      <div className={styles.list} ref={listRef}>
        {error ? <div className={styles.empty}>{error}</div> : null}

        {!error && items.length === 0 && !isPending ? (
          <div className={styles.empty}>
            {isDefaultFilter
              ? "Контактов пока нет — они появятся вместе с первым входящим."
              : "Нет контактов под выбранный фильтр."}
          </div>
        ) : null}

        {items.map((item) => {
          const href = buildHref(PATHNAME, { [QUERY_KEYS.contact]: item.id });

          return (
            <div
              key={item.id}
              className={styles.listItem}
              data-active={item.id === openedId}
            >
              <RefreshableContactAvatar
                contactId={item.id}
                contactName={item.name}
                avatar={item.avatar}
                size="md"
                href={href}
              />
              <Link className={contactStyles.listContactLink} href={href}>
                <span className={styles.listBody}>
                  <span className={styles.listTitleRow}>
                    <b>{item.name}</b>
                  </span>
                  <span className={styles.listPreview}>{item.handles}</span>
                  <span className={styles.listChips}>
                    {item.platforms.map((platform, index) => (
                      <PlatformDot
                        key={`${platform}-${index}`}
                        platform={platform}
                      />
                    ))}
                    {item.tag ? (
                      <span className={uiStyles.chip}>{item.tag}</span>
                    ) : null}
                  </span>
                </span>
                <LinkActivity label="Открываем карточку…" />
              </Link>
            </div>
          );
        })}

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
