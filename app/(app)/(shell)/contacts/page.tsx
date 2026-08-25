import Link from "next/link";

import {
  CONTACT_PAGE_SIZE,
  getContactCardView,
  getContactChannelFilters,
  getContactListView,
  listChannelConnections,
  listMergeCandidates,
} from "@/lib/db/contacts";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { PlatformDot } from "../_components/chips";
import { BackIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import { ContactList } from "./_components/contact-list";
import { ContactNotes } from "./contact-notes";
import { MergeContact } from "./merge-contact";
import { RefreshableContactAvatar } from "./refreshable-contact-avatar";
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
  // Фильтр по каналу — клиентское состояние `ContactList`, не query-параметр.
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
    // Первая страница без фильтра — дальше список дозагружает себя сам.
    getContactListView(supabase, workspace.id, channels, {
      limit: CONTACT_PAGE_SIZE,
    }),
  ]);

  // Карточка открывается только явным выбором пользователя — см. `../inbox/page.tsx`.
  const openedId = contactId;
  let card: Awaited<ReturnType<typeof getContactCardView>> = null;
  let mergeCandidates: Awaited<ReturnType<typeof listMergeCandidates>> = [];
  if (openedId) {
    [card, mergeCandidates] = await Promise.all([
      getContactCardView(supabase, workspace.id, channels, openedId),
      listMergeCandidates(supabase, workspace.id, openedId),
    ]);
  }
  const isDetail = contactId !== null;

  return (
    <div className={styles.panes} data-detail={isDetail}>
      <ContactList
        items={list.items}
        total={list.total}
        hasMore={list.hasMore}
        channels={filters}
        openedId={openedId}
      />

      <section className={styles.paneDetail}>
        {card ? (
          <>
            <div className={styles.threadHead}>
              <Link
                className={styles.backButton}
                href={PATHNAME}
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
                  <RefreshableContactAvatar
                    contactId={card.id}
                    contactName={card.name}
                    avatar={card.avatar}
                    size="lg"
                  />
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
                      href={
                        entry.kind === "dm"
                          ? buildHref("/inbox", {
                              [QUERY_KEYS.conversation]: entry.conversationId,
                            })
                          : buildHref("/comments", {
                              [QUERY_KEYS.post]: entry.conversationId,
                            })
                      }
                    >
                      <span className={cardStyles.historyLabel}>{entry.label}</span>
                      <time className={uiStyles.num}>{entry.time}</time>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.paneEmpty}>
            Выберите контакт слева, чтобы открыть карточку.
          </div>
        )}
      </section>
    </div>
  );
}
