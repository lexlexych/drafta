import Link from "next/link";

import {
  getCommentsChannelFiltersView,
  getPostListView,
  getPostThreadView,
  listChannelConnections,
} from "@/lib/db/comments";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { ChannelChip } from "../_components/chips";
import { FilterChips } from "../_components/filter-chips";
import { CommentsIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";
import { MarkPostRead } from "./_components/mark-post-read";
import { PostThread } from "./_components/post-thread";

const PATHNAME = "/comments";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const channelId = firstParam(params[QUERY_KEYS.channel]);
  const postId = firstParam(params[QUERY_KEYS.post]);

  const user = await getAuthenticatedUser();
  const workspace = user ? await getCurrentWorkspace(user.id) : null;

  if (!workspace) {
    // The shell layout redirects before this can render for a real request —
    // a safety net for this component in isolation (e.g. tests).
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const channels = await listChannelConnections(supabase, workspace.id);
  const commentCapableChannels = channels.filter(
    (channel) => channel.capabilities.supportsComments === true,
  );
  const hasCommentChannels = commentCapableChannels.length > 0;

  const [list, filterChannels] = await Promise.all([
    getPostListView(supabase, workspace.id, channels, { channelId }),
    getCommentsChannelFiltersView(supabase, workspace.id, channels),
  ]);

  // Пост открывается только явным выбором пользователя — см. `../inbox/page.tsx`.
  const post = postId
    ? await getPostThreadView(supabase, workspace.id, channels, postId)
    : null;
  const isDetail = postId !== null;

  const listParams = { [QUERY_KEYS.channel]: channelId };

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

        <div className={styles.list}>
          {!hasCommentChannels ? (
            <div className={styles.empty}>
              <p>Нет каналов с поддержкой комментариев.</p>
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
                ? "В этом канале ещё нет постов."
                : "Постов пока нет — они появятся здесь сразу после публикации."}
            </div>
          ) : null}
          {list.items.map((item) => (
            <Link
              key={item.id}
              className={styles.listItem}
              data-active={item.id === postId}
              data-unread={item.unreadCount > 0}
              href={buildHref(PATHNAME, {
                ...listParams,
                [QUERY_KEYS.post]: item.id,
              })}
            >
              <span
                className={`${uiStyles.avatar} ${uiStyles.avatarMd} ${styles.postIcon}`}
                aria-hidden="true"
              >
                <CommentsIcon size={17} />
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
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.paneDetail}>
        {post ? (
          <>
            <MarkPostRead postId={post.postId} />
            <PostThread post={post} backHref={buildHref(PATHNAME, listParams)} />
          </>
        ) : (
          <div className={styles.paneEmpty}>
            Выберите пост слева, чтобы открыть комментарии.
          </div>
        )}
      </section>
    </div>
  );
}
