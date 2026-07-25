import Link from "next/link";

import { listCategories, categoryBadges } from "@/lib/db/categories";
import {
  getChannelFiltersView,
  getConversationListView,
  getThreadView,
  listChannelConnections,
} from "@/lib/db/inbox";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { Avatar } from "../_components/avatar";
import { CategoryFilter } from "../_components/category-filter";
import { CategoryChip, ChannelChip } from "../_components/chips";
import { Composer } from "../_components/composer";
import { DraftPanel } from "../_components/draft-panel";
import { FilterChips } from "../_components/filter-chips";
import { BackIcon, ClockIcon, PictureIcon } from "../_components/icons";
import {
  QUERY_KEYS,
  buildHref,
  firstParam,
  parseIdList,
  serializeIdList,
} from "../_components/navigation";
import { RetrySendButton } from "../_components/retry-send-button";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";
import { MarkThreadRead } from "./mark-thread-read";

const PATHNAME = "/inbox";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const channelId = firstParam(params[QUERY_KEYS.channel]);
  const categoryIds = parseIdList(firstParam(params[QUERY_KEYS.category]));
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

  const categories = await listCategories(supabase, workspace.id);

  const [list, filterChannels] = await Promise.all([
    getConversationListView(
      supabase,
      workspace.id,
      channels,
      { channelId, categoryIds },
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

  const listParams = {
    [QUERY_KEYS.channel]: channelId,
    [QUERY_KEYS.category]: serializeIdList(categoryIds),
  };

  return (
    <div className={styles.panes} data-detail={isDetail}>
      <section className={styles.paneList}>
        <div className={styles.paneHead}>
          <div className={styles.paneHeadRow}>
            <h2>{list.title}</h2>
          </div>
          <span className={styles.paneSubtitle}>{list.subtitle}</span>
        </div>

        <FilterChips
          pathname={PATHNAME}
          channels={filterChannels}
          activeChannelId={channelId}
        />

        <CategoryFilter categories={categoryBadges(categories)} />

        <div className={styles.list}>
          {!hasChannels ? (
            <div className={styles.empty}>
              <p>Нет подключённых каналов.</p>
              <Link
                className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSmall}`}
                href={buildHref("/settings", { [QUERY_KEYS.section]: "channels" })}
              >
                Настройки → Каналы
              </Link>
            </div>
          ) : list.items.length === 0 ? (
            <div className={styles.empty}>
              {channelId
                ? "Нет диалогов с этим каналом."
                : "Нет диалогов — сообщения появятся здесь, когда придёт первое входящее."}
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
            <MarkThreadRead conversationId={thread.conversationId} />
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
              <DraftPanel
                key={`${thread.conversationId}:${thread.draft?.id ?? "none"}:${thread.draft?.updatedAt ?? "none"}`}
                draft={thread.draft}
                workspaceId={workspace.id}
                conversationId={thread.conversationId}
                debounceUntil={thread.draftDebounceUntil}
              />
              <Composer
                conversationId={thread.conversationId}
                placeholder="Написать ответ вручную…"
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
