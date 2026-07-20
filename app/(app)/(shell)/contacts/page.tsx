import Link from "next/link";

import { getChannelFilters, getContactCard, getContactList } from "@/lib/mock";

import { Avatar } from "../_components/avatar";
import { PlatformDot } from "../_components/chips";
import { FilterChips } from "../_components/filter-chips";
import { BackIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import { StubButton } from "../_components/stub";
import cardStyles from "./contacts.module.css";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";

const PATHNAME = "/contacts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const channelId = firstParam(params[QUERY_KEYS.channel]);
  const contactId = firstParam(params[QUERY_KEYS.contact]);

  const list = getContactList(channelId);
  const openedId = contactId ?? list.items[0]?.id ?? null;
  const card = openedId ? getContactCard(openedId) : null;
  const isDetail = contactId !== null;

  const listParams = { [QUERY_KEYS.channel]: channelId };

  return (
    <div className={styles.panes} data-detail={isDetail}>
      <section className={styles.paneList}>
        <div className={styles.paneHead}>
          <h2>{list.title}</h2>
          <span className={styles.paneSubtitle}>{list.subtitle}</span>
        </div>

        <FilterChips
          pathname={PATHNAME}
          channels={getChannelFilters("contacts")}
          activeChannelId={channelId}
        />

        <div className={styles.list}>
          {list.items.length === 0 ? (
            <div className={styles.empty}>Нет контактов — измените фильтр</div>
          ) : null}
          {list.items.map((item) => (
            <Link
              key={item.id}
              className={styles.listItem}
              data-active={item.id === openedId}
              href={buildHref(PATHNAME, {
                ...listParams,
                [QUERY_KEYS.contact]: item.id,
              })}
            >
              <Avatar avatar={item.avatar} size="md" />
              <span className={styles.listBody}>
                <span className={styles.listTitleRow}>
                  <b>{item.name}</b>
                </span>
                <span className={styles.listPreview}>{item.handles}</span>
                <span className={styles.listChips}>
                  {item.platforms.map((platform, index) => (
                    <PlatformDot key={`${platform}-${index}`} platform={platform} />
                  ))}
                  {item.tag ? (
                    <span className={uiStyles.chip}>{item.tag}</span>
                  ) : null}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.paneDetail}>
        {card ? (
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
                <b>Карточка контакта</b>
              </div>
            </div>

            <div className={cardStyles.card}>
              <div className={cardStyles.inner}>
                <div className={cardStyles.head}>
                  <Avatar avatar={card.avatar} size="lg" />
                  <div className={cardStyles.headName}>
                    <h2>{card.name}</h2>
                    <div className={cardStyles.tags}>
                      {card.tags.map((tag) => (
                        <span key={tag} className={uiStyles.chip}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <StubButton
                    className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonSecondary}`}
                  >
                    Склеить с другим…
                  </StubButton>
                </div>

                <div className={uiStyles.card}>
                  <h3>Identities по каналам</h3>
                  {card.identities.map((identity) => (
                    <div key={identity.id} className={cardStyles.identityRow}>
                      <span className={cardStyles.platform}>
                        <PlatformDot platform={identity.platform} />
                        {identity.platformLabel}
                      </span>
                      <span className={cardStyles.handle}>{identity.handle}</span>
                      <span className={cardStyles.via}>{identity.channelName}</span>
                    </div>
                  ))}
                </div>

                <div className={uiStyles.card}>
                  <h3>Заметки</h3>
                  <div className={cardStyles.notes}>
                    {card.notes ? (
                      card.notes
                    ) : (
                      <span className={cardStyles.notesEmpty}>Пока пусто</span>
                    )}
                  </div>
                </div>

                <div className={uiStyles.card}>
                  <h3>Кросс-канальная история</h3>
                  {card.history.map((entry) => (
                    <Link
                      key={entry.conversationId}
                      className={cardStyles.historyRow}
                      href={buildHref(
                        entry.kind === "dm" ? "/inbox" : "/comments",
                        { [QUERY_KEYS.conversation]: entry.conversationId },
                      )}
                    >
                      <span className={cardStyles.historyLabel}>{entry.label}</span>
                      <time className={uiStyles.num}>{entry.time}</time>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
