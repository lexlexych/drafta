import Link from "next/link";

import {
  getContactCardView,
  getContactChannelFilters,
  getContactListView,
  listChannelConnections,
  listMergeCandidates,
} from "@/lib/db/contacts";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { Avatar } from "../_components/avatar";
import { PlatformDot } from "../_components/chips";
import { FilterChips } from "../_components/filter-chips";
import { BackIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import { ContactNotes } from "./contact-notes";
import { MergeContact } from "./merge-contact";
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

  const user = await getAuthenticatedUser();
  const workspace = user ? await getCurrentWorkspace(user.id) : null;

  if (!workspace) {
    // The shell layout already gates auth/workspace; this is a defensive null.
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const channels = await listChannelConnections(supabase, workspace.id);
  const [filters, list] = await Promise.all([
    getContactChannelFilters(supabase, workspace.id, channels),
    getContactListView(supabase, workspace.id, channels, { channelId }),
  ]);

  const openedId = contactId ?? list.items[0]?.id ?? null;
  let card: Awaited<ReturnType<typeof getContactCardView>> = null;
  let mergeCandidates: Awaited<ReturnType<typeof listMergeCandidates>> = [];
  if (openedId) {
    [card, mergeCandidates] = await Promise.all([
      getContactCardView(supabase, workspace.id, channels, openedId),
      listMergeCandidates(supabase, workspace.id, openedId),
    ]);
  }
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
          channels={filters}
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
                  <MergeContact contactId={card.id} candidates={mergeCandidates} />
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
                  <ContactNotes
                    key={card.id}
                    contactId={card.id}
                    notes={card.notes}
                  />
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
