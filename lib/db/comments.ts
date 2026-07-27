import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChannelPlatform } from "@/lib/channels/types";
import type {
  ActiveCommentDraftStatus,
  CommentDraftView,
  CommentView,
  PostListView,
  PostThreadView,
} from "@/lib/comments/types";
import {
  listChannelConnections,
  type ChannelConnectionRow,
} from "@/lib/db/channel-connections";
import { avatarFor, countWithNoun, type ChannelBadgeView } from "@/lib/mock";
import { formatListTime, formatMessageTime } from "@/lib/mock/time";

/**
 * Typed data access behind the «Комментарии» screen and the shell's comment
 * navigation counters. The comment domain has its own tables (`posts`,
 * `comments`, `comment_drafts`) — nothing here touches `conversations`,
 * `messages` or `drafts`, and nothing in `lib/db/inbox.ts` touches these.
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

export type CommentDraftMutationResult =
  | { ok: true; draft: CommentDraftView }
  | { ok: false; error: string };

const ACTIVE_DRAFT_STATUSES: ActiveCommentDraftStatus[] = [
  "generating",
  "ready",
  "edited",
];

const SENDABLE_DRAFT_STATUSES = ["ready", "edited"] as const;

const DRAFT_COLUMNS =
  "id, workspace_id, post_id, comment_id, status, text, model, kb_file_ids, created_at, updated_at";

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
  published_at: string | null;
  draft_description: string;
  draft_instruction: string;
  draft_brief_set_at: string | null;
  last_comment_at: string | null;
  unread_count: number;
};

const POST_COLUMNS =
  "id, channel_connection_id, external_id, text, permalink, published_at, draft_description, draft_instruction, draft_brief_set_at, last_comment_at, unread_count";

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

type CommentDraftRow = {
  id: string;
  workspace_id: string;
  post_id: string;
  comment_id: string;
  status: string;
  text: string;
  model: string | null;
  kb_file_ids: string[] | null;
  created_at: string;
  updated_at: string;
};

type ContactIdentityRow = {
  id: string;
  display_name: string | null;
  platform: string;
  external_id: string;
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

function isActiveDraftStatus(
  status: string,
): status is ActiveCommentDraftStatus {
  return ACTIVE_DRAFT_STATUSES.includes(status as ActiveCommentDraftStatus);
}

async function mapDraftRow(
  supabase: SupabaseClient,
  row: CommentDraftRow,
): Promise<CommentDraftView> {
  if (!isActiveDraftStatus(row.status)) {
    throw new Error(`Cannot map inactive comment draft status: ${row.status}`);
  }

  const kbFileIds = row.kb_file_ids ?? [];
  let kbFileNames: string[] = [];

  if (kbFileIds.length > 0) {
    const { data, error } = await supabase
      .from("kb_files")
      .select("id, name")
      .eq("workspace_id", row.workspace_id)
      .in("id", kbFileIds);

    if (error) {
      console.error("[comments] failed to load draft knowledge-base names", error);
      throw new Error("Unable to load draft knowledge-base references.");
    }

    const namesById = new Map(
      ((data ?? []) as { id: string; name: string }[]).map((file) => [
        file.id,
        file.name,
      ]),
    );
    kbFileNames = kbFileIds.flatMap((id) => {
      const name = namesById.get(id);
      return name ? [name] : [];
    });
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    postId: row.post_id,
    commentId: row.comment_id,
    status: row.status,
    text: row.text,
    model: row.model,
    kbFileIds,
    kbFileNames,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    .select("id, display_name, platform, external_id")
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
    title: selectedChannel?.name ?? "Комментарии",
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

/** Post thread: the post, its comments (chronological) and each comment's draft. */
export async function getPostThreadView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  postId: string,
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

  const [comments, drafts] = await Promise.all([
    loadComments(supabase, workspaceId, post.id),
    listActivePostDrafts(supabase, workspaceId, post.id),
  ]);

  const identityIds = [
    ...new Set(
      comments
        .map((comment) => comment.contact_identity_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const identitiesById = await loadIdentitiesById(supabase, workspaceId, identityIds);

  const draftByComment = new Map(
    drafts.map((draft) => [draft.commentId, draft] as const),
  );
  // A comment counts as answered once one of our replies points at it. Our
  // replies carry the answered comment's provider id in `parent_external_id`.
  const answeredExternalIds = new Set(
    comments
      .filter(
        (comment) =>
          comment.direction === "outgoing" && comment.parent_external_id,
      )
      .map((comment) => comment.parent_external_id!),
  );

  const nowIso = new Date().toISOString();

  const commentViews: CommentView[] = comments.map((comment) => {
    const identity = comment.contact_identity_id
      ? identitiesById.get(comment.contact_identity_id)
      : undefined;
    const isOurs = comment.direction === "outgoing";
    const authorName = isOurs
      ? "Вы"
      : (identity?.display_name?.trim() || identity?.external_id || "Комментатор");

    return {
      id: comment.id,
      authorName,
      authorHandle:
        !isOurs && identity && identity.platform === "instagram"
          ? `@${identity.external_id}`
          : isOurs
            ? channel.name
            : null,
      avatar: isOurs ? null : avatarFor(identity?.id ?? comment.id, authorName),
      text: comment.text,
      time: formatMessageTime(comment.created_at, nowIso),
      isOurs,
      isReply: comment.parent_external_id !== null,
      deliveryLabel: isOurs
        ? (DELIVERY_LABELS[comment.delivery_status] ?? null)
        : null,
      isAnswered:
        !isOurs &&
        comment.external_id !== null &&
        answeredExternalIds.has(comment.external_id),
      // Our own replies never carry a draft.
      draft: isOurs ? null : (draftByComment.get(comment.id) ?? null),
    };
  });

  const incomingCount = comments.filter(
    (comment) => comment.direction === "incoming",
  ).length;

  return {
    postId: post.id,
    channel: channelBadge(channel),
    postText: post.text,
    postUrl: post.permalink,
    postMeta: countWithNoun(incomingCount, [
      "комментарий",
      "комментария",
      "комментариев",
    ]),
    draftBrief: {
      description: post.draft_description,
      instruction: post.draft_instruction,
      isConfigured: post.draft_brief_set_at !== null,
    },
    comments: commentViews,
    sendableDraftCount: drafts.filter(
      (draft) => draft.status === "ready" || draft.status === "edited",
    ).length,
  };
}

/** Every live draft of one post, one per comment. */
export async function listActivePostDrafts(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
): Promise<CommentDraftView[]> {
  const { data, error } = await supabase
    .from("comment_drafts")
    .select(DRAFT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId)
    .in("status", ACTIVE_DRAFT_STATUSES)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[comments] failed to load post drafts", error);
    throw new Error("Unable to load the drafts.");
  }

  return Promise.all(
    ((data ?? []) as CommentDraftRow[]).map((row) => mapDraftRow(supabase, row)),
  );
}

/** «Отправить все»: the ready/edited drafts of a post, oldest comment first. */
export async function listSendablePostDrafts(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
): Promise<Array<{ draftId: string; commentId: string }>> {
  const { data, error } = await supabase
    .from("comment_drafts")
    .select("id, comment_id, created_at")
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId)
    .in("status", SENDABLE_DRAFT_STATUSES)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[comments] failed to load sendable drafts", error);
    throw new Error("Unable to load the drafts.");
  }

  return ((data ?? []) as Array<{ id: string; comment_id: string }>).map((row) => ({
    draftId: row.id,
    commentId: row.comment_id,
  }));
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
 * Stores the «Черновики» brief. Setting `draft_brief_set_at` is what flips
 * «Создать черновик» from "open the dialog" to "generate right away".
 */
export async function savePostDraftBrief(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
  brief: { description: string; instruction: string },
): Promise<CommentsMutationResult> {
  const { data, error } = await supabase
    .from("posts")
    .update({
      draft_description: brief.description.trim(),
      draft_instruction: brief.instruction.trim(),
      draft_brief_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", postId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[comments] failed to save the post draft brief", error);
    return { ok: false, error: "Не удалось сохранить настройки черновиков." };
  }

  return data ? { ok: true } : { ok: false, error: "Пост не найден." };
}

/** RLS-scoped ownership check before emitting an asynchronous generation. */
export async function findPostForGeneration(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
): Promise<{ isBriefConfigured: boolean } | null> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, draft_brief_set_at")
    .eq("workspace_id", workspaceId)
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    console.error("[comments] failed to validate the post", error);
    return null;
  }

  return data ? { isBriefConfigured: data.draft_brief_set_at !== null } : null;
}

export async function editCommentDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  draftId: string,
  text: string,
): Promise<CommentDraftMutationResult> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return { ok: false, error: "Текст черновика не может быть пустым." };
  }

  const { data, error } = await supabase
    .from("comment_drafts")
    .update({
      text: normalizedText,
      status: "edited",
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", draftId)
    .in("status", ["ready", "edited"])
    .select(DRAFT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[comments] failed to edit a comment draft", error);
    return { ok: false, error: "Не удалось сохранить черновик." };
  }

  if (!data) {
    return { ok: false, error: "Черновик уже изменился — обновите страницу." };
  }

  return { ok: true, draft: await mapDraftRow(supabase, data as CommentDraftRow) };
}

export async function discardCommentDraft(
  supabase: SupabaseClient,
  workspaceId: string,
  draftId: string,
): Promise<CommentsMutationResult> {
  const { data, error } = await supabase
    .from("comment_drafts")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", draftId)
    .in("status", ["ready", "edited"])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[comments] failed to discard a comment draft", error);
    return { ok: false, error: "Не удалось отклонить черновик." };
  }

  return data
    ? { ok: true }
    : { ok: false, error: "Черновик уже изменился — обновите страницу." };
}

/**
 * Accepts one comment draft: draft → `sent`, an outgoing `pending` comment
 * inserted against the comment it answers — one transaction (see
 * `accept_comment_draft_for_send`). The caller emits `comment/send` afterwards.
 */
export async function acceptCommentDraftForSend(
  supabase: SupabaseClient,
  workspaceId: string,
  commentId: string,
  draftId: string,
): Promise<{ ok: true; replyCommentId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("accept_comment_draft_for_send", {
    target_workspace_id: workspaceId,
    target_comment_id: commentId,
    target_draft_id: draftId,
  });

  if (error) {
    console.error("[comments] accept_comment_draft_for_send failed", error);
    return { ok: false, error: "Не удалось подготовить отправку." };
  }

  if (typeof data !== "string" || data.length === 0) {
    return { ok: false, error: "Черновик уже изменился — обновите страницу." };
  }

  return { ok: true, replyCommentId: data };
}

/**
 * Compensation when emitting `comment/send` throws after the reply was already
 * persisted `pending`: without the event nothing will ever publish it.
 */
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
