import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChannelPlatform } from "@/lib/channels/types";
import {
  listChannelConnections,
  type ChannelConnectionRow,
} from "@/lib/db/channel-connections";
import { listActiveConversationDrafts } from "@/lib/db/drafts";
import type { ActiveDraftView } from "@/lib/drafts/types";
import {
  avatarFor,
  countWithNoun,
  type AvatarView,
  type ChannelBadgeView,
  type ChannelFilterView,
  type ConversationListView,
} from "@/lib/mock";
import { formatListTime, formatMessageTime } from "@/lib/mock/time";

/**
 * Typed data access behind the "Комментарии" screen and the shell's comment
 * navigation counters (docs/architecture/16-rollout-plan.md#этап-5--комментарии,
 * docs/architecture/10-ui.md#экраны-инбокса). Parallel to `lib/db/inbox.ts` but
 * scoped to `kind = "comments"`: a conversation is a post, its messages are the
 * comments under it (docs/architecture/06-data-model.md#conversations). Every
 * function takes an already-constructed `SupabaseClient` + `workspaceId`; RLS
 * (`conversations_member_access`/`messages_member_access`) is the real
 * isolation, the explicit `workspace_id` filters are defense in depth.
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
  channelId?: string | null;
};

export type CommentThreadItemView = {
  id: string;
  authorName: string;
  authorHandle: string | null;
  avatar: AvatarView | null;
  text: string;
  time: string;
  isOurs: boolean;
  isReply: boolean;
  /** Outgoing (our) reply delivery status; null for incoming comments. */
  deliveryLabel: string | null;
  /**
   * The AI draft answering this specific comment (stage 5). Every incoming
   * comment gets its own draft, rendered under it. Null while none is active
   * (auto-generation off, discarded, or a category that skips drafts).
   */
  draft: ActiveDraftView | null;
};

export type PostThreadView = {
  conversationId: string;
  channel: ChannelBadgeView;
  postText: string;
  postUrl: string | null;
  postMeta: string;
  comments: CommentThreadItemView[];
};

type ConversationRow = {
  id: string;
  channel_connection_id: string;
  status: string;
  last_incoming_at: string | null;
  unread_count: number;
  post_metadata: Record<string, unknown> | null;
};

type CommentMessageRow = {
  id: string;
  conversation_id: string;
  contact_identity_id: string | null;
  parent_external_id: string | null;
  direction: "incoming" | "outgoing";
  text: string;
  delivery_status: string;
  created_at: string;
};

type ContactIdentityRow = {
  id: string;
  display_name: string | null;
  platform: string;
  external_id: string;
};

const DELIVERY_LABELS: Record<string, string | null> = {
  received: null,
  pending: "Отправляется…",
  sent: "Отправлено",
  delivered: "Доставлено",
  read: "Прочитано",
  failed: "Не доставлено",
};

function channelBadge(channel: ChannelConnectionRow): ChannelBadgeView {
  return { id: channel.id, name: channel.name, platform: channel.platform };
}

function postText(postMetadata: Record<string, unknown> | null): string {
  const value = postMetadata?.text;
  return typeof value === "string" ? value : "";
}

function postUrl(postMetadata: Record<string, unknown> | null): string | null {
  const value = postMetadata?.permalink;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** First line, trimmed to a list-friendly length, for the post's list title. */
function postTitle(postMetadata: Record<string, unknown> | null): string {
  const text = postText(postMetadata).split("\n")[0]?.trim() ?? "";
  if (!text) {
    return "Пост";
  }
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

async function loadCommentMessages(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<CommentMessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, contact_identity_id, parent_external_id, direction, text, delivery_status, created_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[comments] failed to load comment messages", error);
    throw new Error("Unable to load comments.");
  }

  return (data ?? []) as CommentMessageRow[];
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

/** Last comment per post, for list previews (JS-side reduce — same scale note as lib/db/inbox.ts). */
async function loadLastCommentByConversation(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationIds: string[],
): Promise<Map<string, CommentMessageRow>> {
  const map = new Map<string, CommentMessageRow>();

  if (conversationIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, contact_identity_id, parent_external_id, direction, text, delivery_status, created_at",
    )
    .eq("workspace_id", workspaceId)
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[comments] failed to load last comments", error);
    throw new Error("Unable to load comments.");
  }

  for (const row of (data ?? []) as CommentMessageRow[]) {
    map.set(row.conversation_id, row);
  }

  return map;
}

async function listChannelUnreadCounts(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
): Promise<CommentsChannelUnread[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("channel_connection_id, unread_count")
    .eq("workspace_id", workspaceId)
    .eq("kind", "comments");

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
  // (lib/channels/capabilities.ts) — the same key the draft pipeline reads.
  return channels
    .filter((channel) => channel.capabilities.supportsComments === true)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      platform: channel.platform,
      unreadCount: totals.get(channel.id) ?? 0,
    }));
}

/** Sidebar/tabbar "Комментарии" nav item: total + per-channel unread. */
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
): Promise<ChannelFilterView[]> {
  const perChannel = await listChannelUnreadCounts(supabase, workspaceId, channels);

  return perChannel.map((channel) => ({
    id: channel.id,
    name: channel.name,
    platform: channel.platform,
    count: channel.unreadCount,
  }));
}

/** Post list — comment threads sorted by most recent comment, optionally narrowed to one channel. */
export async function getPostListView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  filter: CommentsListFilter = {},
): Promise<ConversationListView> {
  const channelId = filter.channelId ?? null;
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const selectedChannel = channelId ? (channelById.get(channelId) ?? null) : null;

  let filterBuilder = supabase
    .from("conversations")
    .select(
      "id, channel_connection_id, status, last_incoming_at, unread_count, post_metadata",
    )
    .eq("workspace_id", workspaceId)
    .eq("kind", "comments");

  if (channelId) {
    filterBuilder = filterBuilder.eq("channel_connection_id", channelId);
  }

  const { data: conversationRows, error: conversationsError } = await filterBuilder.order(
    "last_incoming_at",
    { ascending: false, nullsFirst: false },
  );

  if (conversationsError) {
    console.error("[comments] failed to list posts", conversationsError);
    throw new Error("Unable to load posts.");
  }

  const conversations = (conversationRows ?? []) as ConversationRow[];
  const conversationIds = conversations.map((row) => row.id);
  const lastCommentByConversation = await loadLastCommentByConversation(
    supabase,
    workspaceId,
    conversationIds,
  );

  const nowIso = new Date().toISOString();

  const items = conversations.map((conversation) => {
    const channel = channelById.get(conversation.channel_connection_id);
    const title = postTitle(conversation.post_metadata);
    const lastComment = lastCommentByConversation.get(conversation.id) ?? null;
    const previewBody = lastComment?.text ?? "";
    const preview =
      lastComment?.direction === "outgoing" ? `Вы: ${previewBody}` : previewBody;

    return {
      id: conversation.id,
      kind: "comments" as const,
      title,
      preview,
      time: conversation.last_incoming_at
        ? formatListTime(conversation.last_incoming_at, nowIso)
        : "",
      unreadCount: conversation.unread_count,
      channel: channel
        ? channelBadge(channel)
        : {
            id: conversation.channel_connection_id,
            name: "—",
            platform: "instagram" as const,
          },
      category: null,
      avatar: null,
    };
  });

  const countLabel = countWithNoun(items.length, ["пост", "поста", "постов"]);
  const scope = selectedChannel ? "канал" : "все каналы";

  return {
    title: selectedChannel?.name ?? "Комментарии",
    subtitle: [scope, countLabel].join(" · "),
    items,
  };
}

/** Post thread: the post + its comments (chronological) + the active draft. */
export async function getPostThreadView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  conversationId: string,
): Promise<PostThreadView | null> {
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, channel_connection_id, kind, post_metadata")
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError) {
    console.error("[comments] failed to load post", conversationError);
    throw new Error("Unable to load the post.");
  }

  if (!conversation || conversation.kind !== "comments") {
    return null;
  }

  const channel = channels.find(
    (candidate) => candidate.id === conversation.channel_connection_id,
  );

  if (!channel) {
    console.error(
      "[comments] post references an unknown channel_connection",
      conversation.id,
    );
    return null;
  }

  const [comments, drafts] = await Promise.all([
    loadCommentMessages(supabase, workspaceId, conversation.id),
    listActiveConversationDrafts(supabase, workspaceId, conversation.id),
  ]);

  const identityIds = [
    ...new Set(
      comments
        .map((comment) => comment.contact_identity_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const identitiesById = await loadIdentitiesById(supabase, workspaceId, identityIds);

  // One draft per comment, keyed by the comment it answers (last_message_id);
  // newest wins (drafts arrive newest-first).
  const draftByComment = new Map<string, ActiveDraftView>();
  for (const draft of drafts) {
    if (draft.lastMessageId && !draftByComment.has(draft.lastMessageId)) {
      draftByComment.set(draft.lastMessageId, draft);
    }
  }

  const nowIso = new Date().toISOString();
  const metadata = conversation.post_metadata as Record<string, unknown> | null;

  const commentViews: CommentThreadItemView[] = comments.map((comment) => {
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
      // Our own outgoing replies never carry a draft.
      draft: isOurs ? null : (draftByComment.get(comment.id) ?? null),
    };
  });

  const commentCount = comments.filter((comment) => comment.direction === "incoming").length;

  return {
    conversationId: conversation.id,
    channel: channelBadge(channel),
    postText: postText(metadata),
    postUrl: postUrl(metadata),
    postMeta: countWithNoun(commentCount, [
      "комментарий",
      "комментария",
      "комментариев",
    ]),
    comments: commentViews,
  };
}

export { listChannelConnections, type ChannelConnectionRow };
