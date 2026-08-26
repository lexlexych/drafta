import Link from "next/link";

import { categoryBadges, listKnowledgeFiles } from "@/lib/db/knowledge-base";
import {
  CONVERSATION_PAGE_SIZE,
  getChannelFiltersView,
  getConversationListView,
  getThreadView,
  listChannelConnections,
} from "@/lib/db/inbox";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { Avatar } from "../_components/avatar";
import { ChannelChip } from "../_components/chips";
import { Composer } from "../_components/composer";
import { BackIcon, ClockIcon, PictureIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import { RetrySendButton } from "../_components/retry-send-button";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";
import { ConversationList } from "./_components/conversation-list";
import { MarkThreadRead } from "./mark-thread-read";

const PATHNAME = "/inbox";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  // Фильтры по каналу и категории — клиентское состояние `ConversationList`,
  // а не query-параметры: см. его докстринг.
  const conversationId = firstParam(params[QUERY_KEYS.conversation]);

  const user = await getAuthenticatedUser();
  const workspace = user ? await getCurrentWorkspace(user.id) : null;

  if (!workspace) {
    // The shell layout (../layout.tsx) already redirects to /login or
    // /onboarding before this can render for a real request — a safety net
    // for this component in isolation (e.g. tests), not a real-world state.
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const channels = await listChannelConnections(supabase, workspace.id);
  const hasChannels = channels.length > 0;

  const categories = await listKnowledgeFiles(supabase, workspace.id);

  // Первая страница без фильтра: дальше список дозагружает себя сам через
  // `loadConversationsAction` (см. `_components/conversation-list.tsx`).
  const [list, filterChannels] = await Promise.all([
    getConversationListView(
      supabase,
      workspace.id,
      channels,
      { limit: CONVERSATION_PAGE_SIZE },
      categories,
    ),
    getChannelFiltersView(supabase, workspace.id, channels),
  ]);

  // Диалог открывается только явным выбором пользователя: пока в адресе нет
  // `conversation`, правая панель пуста и ни один элемент списка не активен.
  const openedId = conversationId;
  const thread = openedId
    ? await getThreadView(supabase, workspace.id, channels, openedId, categories)
    : null;
  const isDetail = conversationId !== null;

  return (
    <div className={styles.panes} data-detail={isDetail}>
      <ConversationList
        items={list.items}
        total={list.total}
        hasMore={list.hasMore}
        channels={filterChannels}
        categories={categoryBadges(categories)}
        openedId={openedId}
        hasChannels={hasChannels}
      />

      <section className={styles.paneDetail}>
        {thread ? (
          <>
            <MarkThreadRead conversationId={thread.conversationId} />
            <div className={styles.threadHead}>
              <Link
                className={styles.backButton}
                href={PATHNAME}
                aria-label="Назад"
              >
                <BackIcon />
              </Link>
              <Avatar avatar={thread.avatar} size="md" />
              <div className={styles.threadWho}>
                <b>{thread.title}</b>
                <div className={styles.threadChips}>
                  <ChannelChip channel={thread.channel} />
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
                        <PictureIcon /> {message.attachmentName}
                      </span>
                      <br />
                    </>
                  ) : null}
                  {message.text}
                  <time className={`${styles.bubbleMeta} ${uiStyles.num}`}>
                    {message.time}
                    {message.deliveryLabel ? ` · ${message.deliveryLabel}` : ""}
                  </time>
                  {message.canRetrySend ? (
                    <RetrySendButton
                      conversationId={thread.conversationId}
                      messageId={message.id}
                    />
                  ) : null}
                </div>
              ))}
            </div>

            <div className={styles.draftWrap}>
              {/* Ключ только по диалогу: черновик приезжает в уже смонтированное
                  поле через Realtime, а ремоунт затёр бы набранный текст. */}
              <Composer
                key={thread.conversationId}
                conversationId={thread.conversationId}
                workspaceId={workspace.id}
                draft={thread.draft}
                placeholder="Написать ответ…"
                replyWindowWarning={thread.replyWindowWarning}
              />
            </div>
          </>
        ) : (
          <div className={styles.paneEmpty}>
            Выберите диалог слева, чтобы открыть переписку.
          </div>
        )}
      </section>
    </div>
  );
}
