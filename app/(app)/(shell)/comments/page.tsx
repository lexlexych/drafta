import {
  POST_PAGE_SIZE,
  getCommentsChannelFiltersView,
  getPostListView,
  getPostThreadView,
  listChannelConnections,
} from "@/lib/db/comments";
import { listActiveReplyTemplates } from "@/lib/db/reply-templates";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getWorkspaceLanguage } from "@/lib/db/workspace-language";
import { defaultTemplateLanguage } from "@/lib/i18n/template-languages";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { QUERY_KEYS, firstParam } from "../_components/navigation";
import styles from "../_components/panes.module.css";
import { MarkPostRead } from "./_components/mark-post-read";
import { PostList } from "./_components/post-list";
import { PostThread } from "./_components/post-thread";

const PATHNAME = "/comments";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  // Фильтр по каналу — клиентское состояние `PostList`, не query-параметр.
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

  // Первая страница без фильтра — дальше список дозагружает себя сам.
  // Шаблоны для значка в поле ответа: список маленький и меняется редко —
  // едет пропом вместе с тредом, без отдельного клиентского запроса.
  // «Ответить» подставляет шаблоны комментариев, «Написать в ЛС» — шаблоны
  // сообщений: это разные поверхности и разные тексты (20260826110000).
  const [
    list,
    filterChannels,
    workspaceLanguage,
    commentTemplates,
    messageTemplates,
  ] = await Promise.all([
    getPostListView(supabase, workspace.id, channels, {
      limit: POST_PAGE_SIZE,
    }),
    getCommentsChannelFiltersView(supabase, workspace.id, channels),
    getWorkspaceLanguage(supabase, workspace.id),
    listActiveReplyTemplates(supabase, workspace.id, "comment"),
    listActiveReplyTemplates(supabase, workspace.id, "message"),
  ]);

  // Пост открывается только явным выбором пользователя — см. `../inbox/page.tsx`.
  const post = postId
    ? await getPostThreadView(
        supabase,
        workspace.id,
        channels,
        postId,
        workspaceLanguage,
      )
    : null;
  const isDetail = postId !== null;

  return (
    <div className={styles.panes} data-detail={isDetail}>
      <PostList
        items={list.items}
        total={list.total}
        hasMore={list.hasMore}
        channels={filterChannels}
        openedId={postId}
        hasCommentChannels={hasCommentChannels}
      />

      <section className={styles.paneDetail}>
        {post ? (
          <>
            <MarkPostRead postId={post.postId} />
            <PostThread
              post={post}
              backHref={PATHNAME}
              commentTemplates={commentTemplates}
              messageTemplates={messageTemplates}
              templateLanguage={defaultTemplateLanguage(workspaceLanguage)}
            />
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
