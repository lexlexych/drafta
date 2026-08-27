import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChannelPlatform } from "@/lib/channels/types";
import type {
  CommentEntryView,
  CommentView,
  PostListView,
  PostThreadView,
} from "@/lib/comments/types";
import {
  listChannelConnections,
  type ChannelConnectionRow,
} from "@/lib/db/channel-connections";
import { avatarProxyUrl } from "@/lib/avatars";
import { listPostTranslations } from "@/lib/db/comment-translations";
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
 * `lib/inngest/functions/comment-draft-pipeline.ts`.
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

async function loadComments(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
): Promise<CommentRow[]> {
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[comments] failed to load comments", error);
    throw new Error("Unable to load comments.");
  }

  return (data ?? []) as CommentRow[];
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
      "id, display_name, platform, external_id, avatar_url, avatar_fetched_at",
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
 * One query reduced in JS — same scale note as `lib/db/inbox.ts`.
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
    .from("comments")
    .select("post_id, direction, text, created_at")
    .eq("workspace_id", workspaceId)
    .in("post_id", postIds)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[comments] failed to load list previews", error);
    throw new Error("Unable to load comments.");
  }

  for (const row of (data ?? []) as Array<{
    post_id: string;
    direction: "incoming" | "outgoing";
    text: string;
  }>) {
    const current = map.get(row.post_id) ?? { text: "", commentCount: 0 };
    map.set(row.post_id, {
      text: row.direction === "outgoing" ? `Вы: ${row.text}` : row.text,
      commentCount:
        current.commentCount + (row.direction === "incoming" ? 1 : 0),
    });
  }

  return map;
}

/**
 * Раскладывает плоский список комментариев в два уровня: сверху комментарии
 * под постом, под каждым — его ветка (наши ответы и ответы других людей).
 *
 * Родство идёт по провайдерским id: у ответа `parent_external_id` равен
 * `external_id` того, кому отвечают. Instagram укладывает ветку в два уровня —
 * ответ на ответ виден в той же ветке, — поэтому ответ поднимается к своему
 * верхнему предку, а не создаёт третий уровень. Ответ, чьего родителя в посте
 * нет (родитель удалён или ещё не доехал), остаётся верхним уровнем: потерять
 * его хуже, чем показать не с тем отступом.
 */
function buildCommentThread(
  comments: CommentRow[],
  entries: Map<string, CommentEntryView>,
): CommentView[] {
  const byExternalId = new Map<string, CommentRow>();

  for (const comment of comments) {
    if (comment.external_id) {
      byExternalId.set(comment.external_id, comment);
    }
  }

  const topLevelAncestor = (comment: CommentRow): CommentRow => {
    let current = comment;
    const visited = new Set<string>([comment.id]);

    while (current.parent_external_id) {
      const parent = byExternalId.get(current.parent_external_id);
      // Неизвестный или зациклившийся родитель — дальше подниматься некуда.
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      current = parent;
    }

    return current;
  };

  const threads: CommentView[] = [];
  const threadById = new Map<string, CommentView>();

  for (const comment of comments) {
    const entry = entries.get(comment.id);
    if (!entry) continue;

    const ancestor = topLevelAncestor(comment);

    if (ancestor.id === comment.id) {
      const thread: CommentView = { ...entry, replies: [] };
      threads.push(thread);
      threadById.set(comment.id, thread);
      continue;
    }

    const thread = threadById.get(ancestor.id);
    if (thread) {
      thread.replies.push(entry);
    } else {
      // Предок есть в посте, но ещё не разобран — такого при хронологическом
      // порядке не бывает, и всё же лучше показать комментарий, чем потерять.
      const orphan: CommentView = { ...entry, replies: [] };
      threads.push(orphan);
      threadById.set(comment.id, orphan);
    }
  }

  return threads;
}

/** Post thread: the post, its comments (chronological) and each comment's draft. */
export async function getPostThreadView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  postId: string,
  targetLanguage: string = DEFAULT_WORKSPACE_LANGUAGE,
): Promise<PostThreadView | null> {
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

  const [comments, translations] = await Promise.all([
    loadComments(supabase, workspaceId, post.id),
    listPostTranslations(supabase, workspaceId, post.id, targetLanguage),
  ]);

  const identityIds = [
    ...new Set(
      comments
        .map((comment) => comment.contact_identity_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const identitiesById = await loadIdentitiesById(supabase, workspaceId, identityIds);

  const nowIso = new Date().toISOString();

  const entries = new Map<string, CommentEntryView>();

  for (const comment of comments) {
    const identity = comment.contact_identity_id
      ? identitiesById.get(comment.contact_identity_id)
      : undefined;
    const isOurs = comment.direction === "outgoing";
    const authorName = isOurs
      ? "Вы"
      : (identity?.display_name?.trim() || identity?.external_id || "Комментатор");

    entries.set(comment.id, {
      id: comment.id,
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
      time: formatMessageTime(comment.created_at, nowIso),
      isOurs,
      deliveryLabel: isOurs
        ? (DELIVERY_LABELS[comment.delivery_status] ?? null)
        : null,
      translation: translations.get(comment.id) ?? null,
    });
  }

  const commentViews = buildCommentThread(comments, entries);

  const incomingCount = comments.filter(
    (comment) => comment.direction === "incoming",
  ).length;

  return {
    postId: post.id,
    postText: post.text,
    postUrl: post.permalink,
    postMeta: countWithNoun(incomingCount, [
      "комментарий",
      "комментария",
      "комментариев",
    ]),
    comments: commentViews,
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
 * отправке через Inngest. Текст приходит из поля под комментарием — сам набран
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
