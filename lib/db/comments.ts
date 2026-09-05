import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChannelPlatform } from "@/lib/channels/types";
import type {
  CommentEntryView,
  PostListView,
  PostThreadView,
} from "@/lib/comments/types";
import {
  listChannelConnections,
  type ChannelConnectionRow,
} from "@/lib/db/channel-connections";
import { resolveChannelCapabilities } from "@/lib/channels/capabilities";
import { avatarProxyUrl } from "@/lib/avatars";
import { listPostPrivateReplies } from "@/lib/db/comment-private-replies";
import { listPostTranslations } from "@/lib/db/comment-translations";
import {
  THREAD_PAGE_SIZE,
  olderThan,
  toThreadPage,
  type ThreadCursor,
} from "@/lib/db/thread-page";
import { DEFAULT_WORKSPACE_LANGUAGE } from "@/lib/i18n/languages";
import { avatarFor, countWithNoun, type ChannelBadgeView } from "@/lib/mock";
import { formatListTime, formatMessageTime } from "@/lib/mock/time";

/**
 * Typed data access behind the «Публикации» screen and the shell's comment
 * navigation counters. The comment domain has its own tables (`posts`,
 * `comments`) — nothing here touches `conversations`, `messages` or `drafts`,
 * and nothing in `lib/db/inbox.ts` touches these.
 *
 * `comment_drafts` is deliberately absent: the AI-draft surface was removed from
 * the screen while that flow is redesigned, and its pipeline lives entirely in
 * `lib/workflows/drafts/comment-drafts.steps.ts`.
 *
 * Every function takes an already-constructed `SupabaseClient` + `workspaceId`;
 * RLS (`posts_member_access` / `comments_member_access` /
 * `comment_drafts_member_access`) is the real isolation, the explicit
 * `workspace_id` filters are defense in depth.
 *
 * `supabase` is untyped (no generated `Database` generic) — same as the rest of
 * `lib/db/`.
 */

export type CommentsChannelUnread = {
  id: string;
  name: string;
  platform: ChannelPlatform;
  unreadCount: number;
};

export type CommentsNavigationCounters = {
  totalUnread: number;
  channels: CommentsChannelUnread[];
};

export type CommentsListFilter = {
  /** Каналы из мультиселекта в шапке списка; пусто — все. */
  channelIds?: readonly string[] | null;
  /** Смещение страницы — дозагрузка при скролле списка. */
  offset?: number;
  limit?: number;
};

/** Размер страницы списка постов: первая порция и каждая дозагрузка. */
export const POST_PAGE_SIZE = 30;

/** Размер страницы ленты комментариев: последние N и каждая подгрузка вверх. */
export const COMMENT_PAGE_SIZE = THREAD_PAGE_SIZE;

export type PostListPage = PostListView & {
  /** Сколько всего постов под фильтром — подпись «N постов» точная. */
  total: number;
  hasMore: boolean;
};

export type CommentsMutationResult =
  | { ok: true }
  | { ok: false; error: string };

const DELIVERY_LABELS: Record<string, string | null> = {
  received: null,
  pending: "Отправляется…",
  sent: "Отправлено",
  delivered: "Доставлено",
  failed: "Не доставлено",
};

type PostRow = {
  id: string;
  channel_connection_id: string;
  external_id: string;
  text: string;
  permalink: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  last_comment_at: string | null;
  unread_count: number;
};

const POST_COLUMNS =
  "id, channel_connection_id, external_id, text, permalink, thumbnail_url, published_at, last_comment_at, unread_count";

type CommentRow = {
  id: string;
  post_id: string;
  contact_identity_id: string | null;
  external_id: string | null;
  parent_external_id: string | null;
  direction: "incoming" | "outgoing";
  text: string;
  delivery_status: string;
  created_at: string;
};

const COMMENT_COLUMNS =
  "id, post_id, contact_identity_id, external_id, parent_external_id, direction, text, delivery_status, created_at";

type ContactIdentityRow = {
  id: string;
  contact_id: string | null;
  display_name: string | null;
  platform: string;
  external_id: string;
  avatar_url: string | null;
  avatar_fetched_at: string | null;
};

function channelBadge(channel: ChannelConnectionRow): ChannelBadgeView {
  return { id: channel.id, name: channel.name, platform: channel.platform };
}

/** First line, trimmed to a list-friendly length, for the post's list title. */
function postTitle(post: PostRow): string {
  const text = post.text.split("\n")[0]?.trim() ?? "";

  if (!text) {
    return "Пост без описания";
  }

  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Страница ленты комментариев: последние `limit` записей, либо `limit` записей
 * строго старше курсора — плюс родители тех ответов, чьи родители в окно не
 * попали (см. `completeAncestors`). Наружу — в хронологии.
 */
async function loadCommentsPage(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
  { limit, before }: { limit: number; before: ThreadCursor | null },
): Promise<{ rows: CommentRow[]; hasMoreBefore: boolean }> {
  const query = supabase
    .from("comments")
    .select(COMMENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId);

  const { data, error } = await olderThan(query, before)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (error) {
    console.error("[comments] failed to load comments", error);
    throw new Error("Unable to load comments.");
  }

  const page = toThreadPage((data ?? []) as CommentRow[], limit);
  const rows = await completeAncestors(supabase, workspaceId, postId, page.rows);

  return { rows, hasMoreBefore: page.hasMoreBefore };
}

/**
 * Дотягивает родителей ответов, оставшихся за краем окна.
 *
 * Без этого ответ, чей комментарий опубликован месяц назад, приехал бы отдельной
 * карточкой верхнего уровня — и перепрыгнул бы под своего родителя, как только
 * оператор долистает вверх. Дешевле дотянуть недостающих предков сразу: их
 * единицы, запрос идёт по `comments_post_external_id_key`.
 *
 * Цикл — потому что родитель может сам оказаться ответом (Instagram кладёт
 * ответ на ответ в ту же ветку). Потолок в три круга: глубже реальных данных не
 * бывает, а зациклиться на битых ссылках нельзя.
 *
 * Курсор следующей страницы считается по окну, а не по дотянутым предкам,
 * поэтому предок приедет ещё раз вместе со своей страницей — клиент отсеет его
 * по `id`.
 */
async function completeAncestors(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
  rows: CommentRow[],
): Promise<CommentRow[]> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const known = new Set(
    rows.map((row) => row.external_id).filter((id): id is string => Boolean(id)),
  );
  let frontier = rows;

  for (let round = 0; round < 3; round += 1) {
    const missing = [
      ...new Set(
        frontier
          .map((row) => row.parent_external_id)
          .filter((id): id is string => id !== null && !known.has(id)),
      ),
    ];

    if (missing.length === 0) {
      break;
    }

    const { data, error } = await supabase
      .from("comments")
      .select(COMMENT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("post_id", postId)
      .in("external_id", missing);

    if (error) {
      // Ветка без родителя всё ещё читается — показать её отдельной карточкой
      // лучше, чем не открыть пост.
      console.error("[comments] failed to load parent comments", error);
      break;
    }

    const parents = (data ?? []) as CommentRow[];

    // Родителя, которого нет в посте (удалён или ещё не доехал), больше не
    // ищем: иначе следующий круг запросит его снова.
    for (const id of missing) known.add(id);

    if (parents.length === 0) {
      break;
    }

    for (const parent of parents) {
      byId.set(parent.id, parent);
      if (parent.external_id) known.add(parent.external_id);
    }

    frontier = parents;
  }

  if (byId.size === rows.length) {
    return rows;
  }

  // Дотянутые предки старше окна — пересобираем хронологию целиком, с тем же
  // тай-брейком по id, что и в запросе.
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

async function loadIdentitiesById(
  supabase: SupabaseClient,
  workspaceId: string,
  identityIds: string[],
): Promise<Map<string, ContactIdentityRow>> {
  const map = new Map<string, ContactIdentityRow>();

  if (identityIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("contact_identities")
    .select(
      "id, contact_id, display_name, platform, external_id, avatar_url, avatar_fetched_at",
    )
    .eq("workspace_id", workspaceId)
    .in("id", identityIds);

  if (error) {
    console.error("[comments] failed to load comment authors", error);
    throw new Error("Unable to load comment authors.");
  }

  for (const row of (data ?? []) as ContactIdentityRow[]) {
    map.set(row.id, row);
  }

  return map;
}

/**
 * Переписки этих контактов в канале поста — чтобы «Отвечено в ЛС» вело сразу в
 * тред, а не в карточку контакта.
 *
 * Тред может ещё не существовать: private reply создаёт его на стороне Meta, а
 * в drafta он появляется вебхуком `conversation.started`, который приходит
 * отдельно. Пустая карта — нормальный промежуточный случай, а не ошибка.
 */
async function loadContactConversations(
  supabase: SupabaseClient,
  workspaceId: string,
  channelConnectionId: string,
  contactIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  if (contactIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("workspace_id", workspaceId)
    .eq("channel_connection_id", channelConnectionId)
    .in("contact_id", [...new Set(contactIds)]);

  if (error) {
    console.error("[comments] failed to load contact conversations", error);
    return map;
  }

  for (const row of (data ?? []) as Array<{
    id: string;
    contact_id: string | null;
  }>) {
    if (row.contact_id && !map.has(row.contact_id)) {
      map.set(row.contact_id, row.id);
    }
  }

  return map;
}

async function listChannelUnreadCounts(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
): Promise<CommentsChannelUnread[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("channel_connection_id, unread_count")
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[comments] failed to aggregate unread counts", error);
    throw new Error("Unable to load unread counts.");
  }

  const totals = new Map<string, number>();

  for (const row of (data ?? []) as Array<{
    channel_connection_id: string;
    unread_count: number;
  }>) {
    totals.set(
      row.channel_connection_id,
      (totals.get(row.channel_connection_id) ?? 0) + row.unread_count,
    );
  }

  // Only channels that actually support comments belong on this screen
  // (docs/architecture/05-channels.md#capabilities-канала). `supportsComments`
  // is the canonical ChannelCapabilities key written on connect
  // (lib/channels/capabilities.ts).
  return channels
    .filter((channel) => channel.capabilities.supportsComments === true)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      platform: channel.platform,
      unreadCount: totals.get(channel.id) ?? 0,
    }));
}

/** Sidebar/tabbar «Комментарии» nav item: total + per-channel unread. */
export async function getCommentsNavigationCounters(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
): Promise<CommentsNavigationCounters> {
  const perChannel = await listChannelUnreadCounts(supabase, workspaceId, channels);

  return {
    totalUnread: perChannel.reduce((total, channel) => total + channel.unreadCount, 0),
    channels: perChannel,
  };
}

/** Mobile filter chips — comment-capable channels with their unread counts. */
export async function getCommentsChannelFiltersView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
) {
  const perChannel = await listChannelUnreadCounts(supabase, workspaceId, channels);

  return perChannel.map((channel) => ({
    id: channel.id,
    name: channel.name,
    platform: channel.platform,
    count: channel.unreadCount,
  }));
}

/**
 * Post list. Every known post is listed, including one published a minute ago
 * with no comments yet — that is the point of persisting `post.published`.
 * Sorted by the latest comment, falling back to the publication time so a fresh
 * empty post still lands at the top.
 */
export async function getPostListView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  filter: CommentsListFilter = {},
): Promise<PostListPage> {
  const channelIds = filter.channelIds ?? [];
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const selectedChannel =
    channelIds.length === 1 ? (channelById.get(channelIds[0]) ?? null) : null;
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.max(1, filter.limit ?? POST_PAGE_SIZE);

  let filterBuilder = supabase
    .from("posts")
    .select(POST_COLUMNS, { count: "exact" })
    .eq("workspace_id", workspaceId);

  if (channelIds.length > 0) {
    filterBuilder = filterBuilder.in("channel_connection_id", [...channelIds]);
  }

  const {
    data: postRows,
    error: postsError,
    count,
  } = await filterBuilder
    .order("last_comment_at", { ascending: false, nullsFirst: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (postsError) {
    console.error("[comments] failed to list posts", postsError);
    throw new Error("Unable to load posts.");
  }

  const posts = (postRows ?? []) as PostRow[];
  const previews = await loadListPreviews(
    supabase,
    workspaceId,
    posts.map((post) => post.id),
  );
  const nowIso = new Date().toISOString();

  const items = posts.map((post) => {
    const channel = channelById.get(post.channel_connection_id);
    const preview = previews.get(post.id);
    const activityAt = post.last_comment_at ?? post.published_at;

    return {
      id: post.id,
      title: postTitle(post),
      preview: preview?.text ?? "Пока нет комментариев",
      time: activityAt ? formatListTime(activityAt, nowIso) : "",
      unreadCount: post.unread_count,
      commentCount: preview?.commentCount ?? 0,
      thumbnailUrl: post.thumbnail_url,
      channel: channel
        ? channelBadge(channel)
        : {
            id: post.channel_connection_id,
            name: "—",
            platform: "instagram" as const,
          },
    };
  });

  const total = count ?? items.length;
  const countLabel = countWithNoun(total, ["пост", "поста", "постов"]);
  const scope = selectedChannel ? "канал" : "все каналы";

  return {
    title: selectedChannel?.name ?? "Публикации",
    subtitle: [scope, countLabel].join(" · "),
    items,
    total,
    hasMore: offset + items.length < total,
  };
}

/**
 * Last comment text + incoming comment count per post, for the list previews.
 *
 * Читает вью `post_comment_previews` (`distinct on (post_id)` плюс оконный
 * счётчик входящих, supabase/migrations/20260828130000_add_thread_preview_views.sql):
 * по строке на публикацию вместо «загрузить всю ленту тридцати публикаций и
 * свести в JS», как было раньше. Вью объявлено с `security_invoker`, поэтому RLS
 * `comments` действует ровно так же, как при прямом запросе к таблице.
 */
async function loadListPreviews(
  supabase: SupabaseClient,
  workspaceId: string,
  postIds: string[],
): Promise<Map<string, { text: string; commentCount: number }>> {
  const map = new Map<string, { text: string; commentCount: number }>();

  if (postIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("post_comment_previews")
    .select("post_id, direction, text, incoming_count")
    .eq("workspace_id", workspaceId)
    .in("post_id", postIds);

  if (error) {
    console.error("[comments] failed to load list previews", error);
    throw new Error("Unable to load comments.");
  }

  for (const row of (data ?? []) as Array<{
    post_id: string;
    direction: "incoming" | "outgoing";
    text: string;
    incoming_count: number;
  }>) {
    map.set(row.post_id, {
      text: row.direction === "outgoing" ? `Вы: ${row.text}` : row.text,
      commentCount: row.incoming_count ?? 0,
    });
  }

  return map;
}

/**
 * Комментарии страницы в виде, который рисуют карточки: перевод, пометка
 * «Отвечено в ЛС», автор и ссылка на его переписку. Общий шаг первой страницы
 * (`getPostThreadView`) и подгрузки вверх (`getOlderPostComments`) — все
 * попутные запросы идут по id страницы, а не по всей ленте публикации.
 */
async function buildCommentEntries(
  supabase: SupabaseClient,
  workspaceId: string,
  post: PostRow,
  channel: ChannelConnectionRow,
  comments: CommentRow[],
  targetLanguage: string,
): Promise<CommentEntryView[]> {
  if (comments.length === 0) {
    return [];
  }

  const commentIds = comments.map((comment) => comment.id);

  const [translations, privateReplies] = await Promise.all([
    listPostTranslations(
      supabase,
      workspaceId,
      post.id,
      targetLanguage,
      commentIds,
    ),
    listPostPrivateReplies(supabase, workspaceId, post.id, commentIds),
  ]);

  const identityIds = [
    ...new Set(
      comments
        .map((comment) => comment.contact_identity_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const identitiesById = await loadIdentitiesById(supabase, workspaceId, identityIds);
  const conversationByContact = await loadContactConversations(
    supabase,
    workspaceId,
    post.channel_connection_id,
    [...identitiesById.values()]
      .map((identity) => identity.contact_id)
      .filter((id): id is string => Boolean(id)),
  );

  // Окно private reply — правило платформы, а не наше: Meta разрешает написать
  // автору комментария только в течение недели после него.
  const capabilities = resolveChannelCapabilities(
    channel.platform,
    channel.capabilities,
  );
  const privateReplyWindowMs =
    capabilities.supportsPrivateReply && capabilities.privateReplyWindowHours
      ? capabilities.privateReplyWindowHours * 60 * 60 * 1000
      : null;

  const nowIso = new Date().toISOString();

  return comments.map((comment) => {
    const identity = comment.contact_identity_id
      ? identitiesById.get(comment.contact_identity_id)
      : undefined;
    const isOurs = comment.direction === "outgoing";
    const authorName = isOurs
      ? "Вы"
      : (identity?.display_name?.trim() || identity?.external_id || "Комментатор");

    return {
      id: comment.id,
      externalId: comment.external_id,
      parentExternalId: comment.parent_external_id,
      authorName,
      avatar: isOurs
        ? null
        : avatarFor(
            identity?.id ?? comment.id,
            authorName,
            identity
              ? avatarProxyUrl(
                  identity.id,
                  identity.avatar_url,
                  identity.avatar_fetched_at,
                )
              : null,
          ),
      text: comment.text,
      createdAt: comment.created_at,
      time: formatMessageTime(comment.created_at, nowIso),
      isOurs,
      deliveryLabel: isOurs
        ? (DELIVERY_LABELS[comment.delivery_status] ?? null)
        : null,
      translation: translations.get(comment.id) ?? null,
      privateReply: privateReplies.get(comment.id) ?? null,
      canPrivateReply:
        !isOurs &&
        privateReplyWindowMs !== null &&
        !privateReplies.has(comment.id) &&
        Date.parse(comment.created_at) + privateReplyWindowMs > Date.now(),
      dmHref: identity?.contact_id
        ? (() => {
            const conversationId = conversationByContact.get(
              identity.contact_id,
            );
            return conversationId
              ? `/inbox?conversation=${conversationId}`
              : `/contacts?contact=${identity.contact_id}`;
          })()
        : null,
    };
  });
}

/** Публикация вместе со своим каналом — общий пролог обоих загрузчиков треда. */
async function loadPostWithChannel(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  postId: string,
): Promise<{ post: PostRow; channel: ChannelConnectionRow } | null> {
  const { data: postRow, error: postError } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", postId)
    .maybeSingle();

  if (postError) {
    console.error("[comments] failed to load post", postError);
    throw new Error("Unable to load the post.");
  }

  if (!postRow) {
    return null;
  }

  const post = postRow as PostRow;
  const channel = channels.find(
    (candidate) => candidate.id === post.channel_connection_id,
  );

  if (!channel) {
    console.error("[comments] post references an unknown channel_connection", post.id);
    return null;
  }

  return { post, channel };
}

/**
 * Сколько всего входящих комментариев под публикацией — строка «N комментариев»
 * в шапке треда. Отдельным счётным запросом, а не по загруженной странице:
 * страница знает только про свой хвост ленты.
 */
async function countIncomingComments(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId)
    .eq("direction", "incoming");

  if (error) {
    console.error("[comments] failed to count comments", error);
    return 0;
  }

  return count ?? 0;
}

/**
 * Post thread: публикация и последняя страница её комментариев в хронологии.
 *
 * Вся лента разом не грузится — под публикацией может быть сколько угодно
 * комментариев, а на экране виден только её хвост. Предыдущие страницы
 * подтягивает `getOlderPostComments` при скролле вверх. Комментарии едут
 * плоским списком: в ветки их раскладывает клиент (`lib/comments/thread.ts`),
 * потому что родитель ответа может приехать только со следующей страницей.
 */
export async function getPostThreadView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  postId: string,
  targetLanguage: string = DEFAULT_WORKSPACE_LANGUAGE,
): Promise<PostThreadView | null> {
  const loaded = await loadPostWithChannel(supabase, workspaceId, channels, postId);

  if (!loaded) {
    return null;
  }

  const { post, channel } = loaded;

  const [page, incomingCount] = await Promise.all([
    loadCommentsPage(supabase, workspaceId, post.id, {
      limit: COMMENT_PAGE_SIZE,
      before: null,
    }),
    countIncomingComments(supabase, workspaceId, post.id),
  ]);

  const comments = await buildCommentEntries(
    supabase,
    workspaceId,
    post,
    channel,
    page.rows,
    targetLanguage,
  );

  return {
    postId: post.id,
    postText: post.text,
    postUrl: post.permalink,
    postMeta: countWithNoun(incomingCount, [
      "комментарий",
      "комментария",
      "комментариев",
    ]),
    comments,
    hasMoreBefore: page.hasMoreBefore,
  };
}

/** Страница ленты выше уже загруженной — скролл треда комментариев вверх. */
export type OlderPostCommentsPage = {
  items: CommentEntryView[];
  hasMoreBefore: boolean;
};

/**
 * Предыдущая страница комментариев: `COMMENT_PAGE_SIZE` записей строго старше
 * курсора. Курсор — самый старый из уже загруженных комментариев, поэтому новый
 * комментарий, пришедший снизу за время чтения, окно не сдвигает.
 */
export async function getOlderPostComments(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  postId: string,
  before: ThreadCursor,
  targetLanguage: string = DEFAULT_WORKSPACE_LANGUAGE,
): Promise<OlderPostCommentsPage | null> {
  const loaded = await loadPostWithChannel(supabase, workspaceId, channels, postId);

  if (!loaded) {
    return null;
  }

  const { post, channel } = loaded;
  const page = await loadCommentsPage(supabase, workspaceId, post.id, {
    limit: COMMENT_PAGE_SIZE,
    before,
  });

  return {
    items: await buildCommentEntries(
      supabase,
      workspaceId,
      post,
      channel,
      page.rows,
      targetLanguage,
    ),
    hasMoreBefore: page.hasMoreBefore,
  };
}

/** Opening a post resets its unread counter, same contract as a DM thread. */
export async function markPostRead(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
): Promise<CommentsMutationResult> {
  const { data, error } = await supabase
    .from("posts")
    .update({ unread_count: 0 })
    .eq("workspace_id", workspaceId)
    .eq("id", postId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[comments] failed to mark post read", error);
    return { ok: false, error: "Не удалось обновить счётчик непрочитанного." };
  }

  return data ? { ok: true } : { ok: false, error: "Пост не найден." };
}

/**
 * Ручной ответ на комментарий: строка `comments` в статусе `pending`, готовая к
 * отправке прогоном. Текст приходит из поля под комментарием — сам набран
 * или подставлен шаблоном.
 *
 * Вся проверка внутри RPC (`accept_manual_comment_reply`): комментарий должен
 * существовать в этом workspace и быть входящим, а пост блокируется на время
 * вставки. `null` в ответе означает, что одно из условий не выполнено, — от
 * пустого текста до чужого id.
 */
export async function acceptManualCommentReply(
  supabase: SupabaseClient,
  workspaceId: string,
  commentId: string,
  text: string,
): Promise<{ ok: true; replyCommentId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("accept_manual_comment_reply", {
    target_workspace_id: workspaceId,
    target_comment_id: commentId,
    reply_text: text,
  });

  if (error) {
    console.error("[comments] accept_manual_comment_reply failed", error);
    return { ok: false, error: "Не удалось подготовить отправку." };
  }

  if (typeof data !== "string" || data.length === 0) {
    return { ok: false, error: "Комментарий не найден." };
  }

  return { ok: true, replyCommentId: data };
}

export async function markCommentSendFailedAfterEmit(
  supabase: SupabaseClient,
  workspaceId: string,
  replyCommentId: string,
): Promise<void> {
  const { error } = await supabase
    .from("comments")
    .update({ delivery_status: "failed", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", replyCommentId)
    .eq("delivery_status", "pending");

  if (error) {
    console.error("[comments] failed to mark an unsent reply as failed", error);
  }
}

export { listChannelConnections, type ChannelConnectionRow };
