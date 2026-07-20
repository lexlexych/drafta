import Link from "next/link";

import {
  getCategoryFilterOptions,
  getChannelFilters,
  getConversationList,
  getThread,
} from "@/lib/mock";

import { Avatar } from "../_components/avatar";
import { CategoryFilter } from "../_components/category-filter";
import { CategoryChip, ChannelChip } from "../_components/chips";
import { Composer } from "../_components/composer";
import { DraftPanel } from "../_components/draft-panel";
import { FilterChips } from "../_components/filter-chips";
import { BackIcon, ClockIcon, PictureIcon, SparkIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";

const PATHNAME = "/inbox";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const channelId = firstParam(params[QUERY_KEYS.channel]);
  const categoryId = firstParam(params[QUERY_KEYS.category]);
  const conversationId = firstParam(params[QUERY_KEYS.conversation]);

  const list = getConversationList("dm", { channelId, categoryId });
  const openedId = conversationId ?? list.items[0]?.id ?? null;
  const thread = openedId ? getThread(openedId) : null;
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
          channels={getChannelFilters("dm")}
          activeChannelId={channelId}
          extraParams={{ [QUERY_KEYS.category]: categoryId }}
        />

        <div className={styles.list}>
          {list.items.length === 0 ? (
            <div className={styles.empty}>Нет диалогов — измените фильтры</div>
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
              {item.avatar ? <Avatar avatar={item.avatar} size="md" /> : null}
              <span className={styles.listBody}>
                <span className={styles.listTitleRow}>
                  <b>{item.title}</b>
                  <time className={uiStyles.num}>{item.time}</time>
                </span>
                <span className={styles.listPreview}>{item.preview}</span>
                <span className={styles.listChips}>
                  <ChannelChip channel={item.channel} />
                  {item.category ? <CategoryChip category={item.category} /> : null}
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
        {thread ? (
          <>
            <div className={styles.threadHead}>
              <Link
                className={styles.backButton}
                href={buildHref(PATHNAME, listParams)}
                aria-label="Назад"
              >
                <BackIcon />
              </Link>
              <Avatar avatar={thread.avatar} size="md" />
              <div className={styles.threadWho}>
                <b>{thread.title}</b>
                <div className={styles.threadChips}>
                  <ChannelChip channel={thread.channel} />
                  {thread.category ? (
                    <CategoryChip category={thread.category} />
                  ) : null}
                  {thread.replyWindowLabel ? (
                    <span className={`${uiStyles.chip} ${uiStyles.chipStatus}`}>
                      <ClockIcon /> {thread.replyWindowLabel}
                    </span>
                  ) : null}
                </div>
              </div>
              {thread.contactId ? (
                <Link
                  className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonSecondary}`}
                  href={buildHref("/contacts", {
                    [QUERY_KEYS.contact]: thread.contactId,
                  })}
                >
                  Контакт
                </Link>
              ) : null}
            </div>

            <div className={styles.messages}>
              {thread.messages.map((message) => (
                <div
                  key={message.id}
                  className={`${styles.bubble} ${
                    message.direction === "in"
                      ? styles.bubbleIn
                      : styles.bubbleOut
                  }`}
                >
                  {message.attachmentName ? (
                    <>
                      <span className={styles.attachment}>
                        <PictureIcon /> фото · {message.attachmentName}
                      </span>
                      <br />
                    </>
                  ) : null}
                  {message.text}
                  <time className={`${styles.bubbleMeta} ${uiStyles.num}`}>
                    {message.time}
                    {message.deliveryLabel ? ` · ${message.deliveryLabel}` : ""}
                  </time>
                </div>
              ))}
              {thread.debounceNote ? (
                <div className={styles.systemLine}>
                  <SparkIcon /> {thread.debounceNote}
                </div>
              ) : null}
            </div>

            <div className={styles.draftWrap}>
              {thread.draft ? (
                <DraftPanel
                  key={thread.conversationId}
                  draft={thread.draft}
                  channelName={thread.channel.name}
                />
              ) : null}
              <Composer placeholder="Написать ответ вручную…" />
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
