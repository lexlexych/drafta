"use client";

/**
 * Левая панель «Сообщений»: шапка со счётчиком, фильтры и список диалогов.
 *
 * Фильтры по каналам и категориям живут в состоянии компонента, а отбор делает
 * серверное действие `loadConversationsAction` — список приходит страницами и
 * дозагружается при скролле. Почему не через query-параметры и как устроена
 * подмена серверной страницы — см. `../../_components/use-paged-list.ts`.
 *
 * Состояние переживает открытие диалога: `?conversation=…` меняет только
 * search-параметр того же маршрута, компонент не размонтируется.
 */

import Link from "next/link";

import type {
  CategoryBadgeView,
  ChannelFilterView,
  ConversationListItemView,
} from "@/lib/mock";
import { countWithNoun } from "@/lib/mock/plural";

import { Avatar } from "../../_components/avatar";
import { AutoReplyIcon } from "../../_components/icons";
import { LinkActivity } from "../../_components/activity";
import { CategoryChip, ChannelChip } from "../../_components/chips";
import { ListFilters, scopeLabel } from "../../_components/list-filters";
import { QUERY_KEYS, buildHref } from "../../_components/navigation";
import { usePagedList } from "../../_components/use-paged-list";
import styles from "../../_components/panes.module.css";
import uiStyles from "../../_components/ui.module.css";
import { loadConversationsAction } from "../actions";

const PATHNAME = "/inbox";

type ConversationFilter = {
  channelIds: string[];
  categoryIds: string[];
};

const EMPTY_FILTER: ConversationFilter = { channelIds: [], categoryIds: [] };

export function ConversationList({
  items: serverItems,
  total: serverTotal,
  hasMore: serverHasMore,
  channels,
  categories,
  openedId,
  hasChannels,
  autoReplyEnabled,
  autoReplyOpen,
}: {
  items: ConversationListItemView[];
  total: number;
  hasMore: boolean;
  channels: readonly ChannelFilterView[];
  categories: readonly CategoryBadgeView[];
  openedId: string | null;
  hasChannels: boolean;
  /** Состояние контура — подпись и вид значка в шапке. */
  autoReplyEnabled: boolean;
  /** Панель автоответов уже открыта справа. */
  autoReplyOpen: boolean;
}) {
  const {
    filter,
    setFilter,
    items,
    total,
    hasMore,
    isPending,
    error,
    listRef,
    sentinelRef,
  } = usePagedList<ConversationListItemView, ConversationFilter>({
    serverItems,
    serverTotal,
    serverHasMore,
    initialFilter: EMPTY_FILTER,
    isDefaultFilter: (next) =>
      next.channelIds.length === 0 && next.categoryIds.length === 0,
    loadPage: (next, offset) => loadConversationsAction({ ...next, offset }),
    activityLabel: "Загружаем диалоги…",
  });

  const { channelIds, categoryIds } = filter;
  const isDefaultFilter = channelIds.length === 0 && categoryIds.length === 0;

  const subtitle = [
    scopeLabel(channelIds, channels, "все каналы", [
      "канал",
      "канала",
      "каналов",
    ]),
    categoryIds.length === 0
      ? null
      : scopeLabel(categoryIds, categories, "", [
          "категория",
          "категории",
          "категорий",
        ]),
    countWithNoun(total, ["диалог", "диалога", "диалогов"]),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className={styles.paneList}>
      <div className={styles.paneHead}>
        <div className={styles.paneHeadRow}>
          <h2>Сообщения</h2>
          {/* Значок ведёт в панель автоответов на месте беседы. Подпись под ним
              говорит состояние контура, а `data-enabled` делает выключенный
              значок неактивным на вид, не отключая саму ссылку — выключенные
              автоответы настраивают тем же способом, что и включённые. */}
          <Link
            className={styles.autoReplyToggle}
            data-enabled={autoReplyEnabled}
            data-active={autoReplyOpen}
            href={buildHref(PATHNAME, { [QUERY_KEYS.autoReply]: "1" })}
            aria-label={`Автоответы: ${autoReplyEnabled ? "включены" : "выключены"}`}
            title="Автоответы"
          >
            <AutoReplyIcon />
            <span>{autoReplyEnabled ? "вкл" : "выкл"}</span>
            <LinkActivity label="Открываем автоответы…" />
          </Link>
        </div>
        <span className={styles.paneSubtitle}>{subtitle}</span>
      </div>

      <ListFilters
        channels={channels}
        selectedChannelIds={channelIds}
        onChannelsChange={(next) => setFilter({ ...filter, channelIds: next })}
        categories={categories}
        selectedCategoryIds={categoryIds}
        onCategoriesChange={(next) => setFilter({ ...filter, categoryIds: next })}
      />

      <div className={styles.list} ref={listRef}>
        {error ? <div className={styles.empty}>{error}</div> : null}

        {!error && !hasChannels ? (
          <div className={styles.empty}>
            <p>Нет подключённых каналов.</p>
            <Link
              className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSmall}`}
              href={buildHref("/settings", { [QUERY_KEYS.section]: "channels" })}
            >
              Настройки → Каналы
              <LinkActivity label="Открываем настройки…" />
            </Link>
          </div>
        ) : null}

        {!error && hasChannels && items.length === 0 && !isPending ? (
          <div className={styles.empty}>
            {isDefaultFilter
              ? "Нет диалогов — сообщения появятся здесь, когда придёт первое входящее."
              : "Нет диалогов под выбранный фильтр."}
          </div>
        ) : null}

        {items.map((item) => (
          <Link
            key={item.id}
            className={styles.listItem}
            data-active={item.id === openedId}
            data-unread={item.unreadCount > 0}
            href={buildHref(PATHNAME, { [QUERY_KEYS.conversation]: item.id })}
          >
            {item.avatar ? <Avatar avatar={item.avatar} size="md" /> : null}
            <span className={styles.listBody}>
              <span className={styles.listTitleRow}>
                <b>{item.title}</b>
                <time className={uiStyles.num}>{item.time}</time>
              </span>
              <span className={styles.listPreview}>
                {item.isAutoReplyPreview ? (
                  <span
                    className={styles.autoReplyMark}
                    title="Последний ответ отправлен автоматически"
                    aria-label="Последний ответ отправлен автоматически"
                  >
                    <AutoReplyIcon size={15} />
                  </span>
                ) : null}
                {item.preview}
              </span>
              <span className={styles.listChips}>
                <ChannelChip channel={item.channel} />
                {item.categories.map((category) => (
                  <CategoryChip key={category.id} category={category} />
                ))}
                <span className={styles.listSpacer} />
                {item.unreadCount > 0 ? (
                  <span className={`${uiStyles.unread} ${uiStyles.num}`}>
                    {item.unreadCount}
                  </span>
                ) : null}
              </span>
            </span>
            <LinkActivity label="Открываем диалог…" />
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
