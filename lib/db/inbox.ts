import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChannelPlatform } from "@/lib/channels/types";
import {
  listChannelConnections,
  type ChannelConnectionRow,
} from "@/lib/db/channel-connections";
import { getActiveConversationDraft } from "@/lib/db/drafts";
import type { ActiveDraftView } from "@/lib/drafts/types";
import {
  avatarFor,
  countWithNoun,
  type ChannelBadgeView,
  type ChannelFilterView,
  type ConversationListView,
  type ThreadMessageView,
  type ThreadView,
} from "@/lib/mock";
import {
  formatListTime,
  formatMessageTime,
  hoursLeftInReplyWindow,
} from "@/lib/mock/time";

/**
 * Typed data access behind the inbox "Сообщения" screen and the shell's
 * navigation counters (docs/epics/epic_02/T-05-inbox-messages.md). Mirrors
 * `lib/db/channel-connections.ts` (T-04): every function takes an
 * already-constructed `SupabaseClient` and a `workspaceId` rather than
 * resolving them itself, stays a plain function of its inputs (directly
 * testable against a real local Supabase), and leaves RLS (already enforced
 * by `conversations_member_access`/`messages_member_access`,
 * supabase/migrations/20260720120000_…) as the source of truth — the
 * explicit `workspace_id` filters below are defense in depth, not a
 * substitute for it.
 *
 * Returns view models shaped exactly like `lib/mock`'s
 * (`ConversationListView`, `ThreadView`, `ChannelFilterView`…) — per that
 * module's own docstring, this is the intended migration path: "когда mock
 * заменят реальные запросы lib/db, поменяется только этот слой: форма
 * моделей представления останется прежней". `category` is always `null` and
 * `debounceNote`/`draft` are always `null`/absent here: categories and AI
 * drafts have no real data yet at this stage (out of scope — see the
 * ticket's "Существенные факты" and epic E-002 "Вне скоупа").
 *
 * Callers pass in an already-loaded `channels: ChannelConnectionRow[]`
 * (from `listChannelConnections`) instead of each function re-fetching it,
 * so a single page render (which typically needs the channel list for a
 * filter dropdown *and* the conversation list *and* possibly a thread) only
 * loads `channel_connections` once.
 *
 * `supabase` is untyped (no generated `Database` generic) — same as every
 * other Supabase client factory/consumer in this repo (no generated types
 * yet).
 */

export type InboxChannelUnread = {
  id: string;
  name: string;
  platform: ChannelPlatform;
  unreadCount: number;
};

export type InboxNavigationCounters = {
  totalUnread: number;
  channels: InboxChannelUnread[];
};

export type ConversationListFilter = {
  channelId?: string | null;
};

type ConversationRow = {
  id: string;
  channel_connection_id: string;
  contact_id: string | null;
  status: string;
  last_incoming_at: string | null;
  unread_count: number;
};

type ContactRow = {
  id: string;
  display_name: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: "incoming" | "outgoing";
  text: string;
  attachments: unknown;
  delivery_status: string;
  created_at: string;
};

export type InboxThreadMessageView = ThreadMessageView & {
  /** Failed outgoing message — the thread renders the retry button (stage 3). */
  canRetrySend: boolean;
};

export type InboxThreadView = Omit<ThreadView, "draft" | "messages"> & {
  draft: ActiveDraftView | null;
  messages: InboxThreadMessageView[];
  /**
   * Set when the platform's response window (channel capabilities) has
   * already closed — the composer warns but does not block
   * (docs/architecture/16-rollout-plan.md, stage 3): the provider's own
   * rejection turns into `failed` + retry.
   */
  replyWindowWarning: string | null;
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

function readResponseWindowHours(
  capabilities: Record<string, unknown>,
): number | null {
  const value = capabilities.responseWindowHours;

  return typeof value === "number" ? value : null;
}

/**
 * `messages.attachments` (jsonb) holds `NormalizedAttachment[]`
 * (lib/channels/types.ts: `{ type, url?, fileName?, mimeType? }`) — MVP only
 * ever stores metadata, never a downloadable file (epic E-002 "вне скоупа",
 * open question №4), so the UI shows a generic "вложение" indicator, using
 * the file name only when the provider happened to report one.
 */
function attachmentIndicatorLabel(attachments: unknown): string | null {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return null;
  }

  const first = attachments[0] as { fileName?: unknown } | null;
  const fileName =
    first && typeof first === "object" && typeof first.fileName === "string"
      ? first.fileName
      : null;

  return fileName ?? "вложение";
}

async function loadContactsById(
  supabase: SupabaseClient,
  workspaceId: string,
  contactIds: string[],
): Promise<Map<string, ContactRow>> {
  const map = new Map<string, ContactRow>();

  if (contactIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("contacts")
    .select("id, display_name")
    .eq("workspace_id", workspaceId)
    .in("id", contactIds);

  if (error) {
    console.error("[inbox] failed to load contacts", error);
    throw new Error("Unable to load contacts.");
  }

  for (const row of (data ?? []) as ContactRow[]) {
    map.set(row.id, row);
  }

  return map;
}

async function loadContactById(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<ContactRow | null> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, display_name")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    console.error("[inbox] failed to load contact", error);
    throw new Error("Unable to load the contact.");
  }

  return (data as ContactRow | null) ?? null;
}

/**
 * Last message per conversation, for list previews. Fetches every message of
 * every given conversation and reduces client-side (ascending order, last
 * write per `conversation_id` wins) rather than a per-conversation `LIMIT 1`
 * query — same "small workspace, JS-side reduce" approach the mock layer
 * uses (`lib/mock/index.ts`'s `getDashboard`) and adequate at this stage's
 * scale ("сотни workspace'ов" — docs/architecture/01-overview.md), not
 * "millions of messages".
 */
async function loadLastMessageByConversation(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationIds: string[],
): Promise<Map<string, MessageRow>> {
  const map = new Map<string, MessageRow>();

  if (conversationIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, direction, text, attachments, delivery_status, created_at")
    .eq("workspace_id", workspaceId)
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[inbox] failed to load last messages", error);
    throw new Error("Unable to load messages.");
  }

  for (const row of (data ?? []) as MessageRow[]) {
    map.set(row.conversation_id, row);
  }

  return map;
}

async function listMessagesForConversation(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, direction, text, attachments, delivery_status, created_at")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[inbox] failed to load conversation messages", error);
    throw new Error("Unable to load messages.");
  }

  return (data ?? []) as MessageRow[];
}

/**
 * Per-channel unread DM counts for the whole workspace — the shared base of
 * both the shell's navigation counters (`getInboxNavigationCounters`) and
 * the inbox page's channel filter chips (`getChannelFiltersView`).
 */
async function listChannelUnreadCounts(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
): Promise<InboxChannelUnread[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("channel_connection_id, unread_count")
    .eq("workspace_id", workspaceId)
    .eq("kind", "dm");

  if (error) {
    console.error("[inbox] failed to aggregate unread counts", error);
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

  return channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    platform: channel.platform,
    unreadCount: totals.get(channel.id) ?? 0,
  }));
}

/** Sidebar "Сообщения" nav item: total + per-channel unread, under channel names — docs/architecture/10-ui.md. */
export async function getInboxNavigationCounters(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
): Promise<InboxNavigationCounters> {
  const perChannel = await listChannelUnreadCounts(supabase, workspaceId, channels);

  return {
    totalUnread: perChannel.reduce((total, channel) => total + channel.unreadCount, 0),
    channels: perChannel,
  };
}

/** Mobile filter chips (`FilterChips`) — same aggregation, `ChannelFilterView` shape. */
export async function getChannelFiltersView(
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

/** Dialog list — sorted by `last_incoming_at` desc, optionally narrowed to one `channel_connection_id`. */
export async function getConversationListView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  filter: ConversationListFilter = {},
): Promise<ConversationListView> {
  const channelId = filter.channelId ?? null;
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const selectedChannel = channelId ? (channelById.get(channelId) ?? null) : null;

  // The conditional `.eq()` must run before `.order()`: postgrest-js's
  // builder narrows from `PostgrestFilterBuilder` (has `.eq()`) to
  // `PostgrestTransformBuilder` (doesn't) once a transform method like
  // `.order()` is called, so filtering has to finish first.
  let filterBuilder = supabase
    .from("conversations")
    .select("id, channel_connection_id, contact_id, status, last_incoming_at, unread_count")
    .eq("workspace_id", workspaceId)
    .eq("kind", "dm");

  if (channelId) {
    filterBuilder = filterBuilder.eq("channel_connection_id", channelId);
  }

  const { data: conversationRows, error: conversationsError } = await filterBuilder.order(
    "last_incoming_at",
    { ascending: false, nullsFirst: false },
  );

  if (conversationsError) {
    console.error("[inbox] failed to list conversations", conversationsError);
    throw new Error("Unable to load conversations.");
  }

  const conversations = (conversationRows ?? []) as ConversationRow[];
  const conversationIds = conversations.map((row) => row.id);
  const contactIds = [
    ...new Set(
      conversations
        .map((row) => row.contact_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [contactsById, lastMessageByConversation] = await Promise.all([
    loadContactsById(supabase, workspaceId, contactIds),
    loadLastMessageByConversation(supabase, workspaceId, conversationIds),
  ]);

  const nowIso = new Date().toISOString();

  const items = conversations.map((conversation) => {
    const channel = channelById.get(conversation.channel_connection_id);
    const contact = conversation.contact_id
      ? contactsById.get(conversation.contact_id)
      : undefined;
    const name = contact?.display_name ?? "Без контакта";
    const lastMessage = lastMessageByConversation.get(conversation.id) ?? null;
    const attachmentLabel = attachmentIndicatorLabel(lastMessage?.attachments);
    const previewBody = lastMessage
      ? attachmentLabel
        ? `📎 ${lastMessage.text || attachmentLabel}`
        : lastMessage.text
      : "";
    const preview =
      lastMessage?.direction === "outgoing" ? `Вы: ${previewBody}` : previewBody;

    return {
      id: conversation.id,
      kind: "dm" as const,
      title: name,
      preview,
      time: conversation.last_incoming_at
        ? formatListTime(conversation.last_incoming_at, nowIso)
        : "",
      unreadCount: conversation.unread_count,
      channel: channel
        ? channelBadge(channel)
        : { id: conversation.channel_connection_id, name: "—", platform: "telegram" as const },
      category: null,
      avatar: avatarFor(contact?.id ?? conversation.id, name),
    };
  });

  const countLabel = countWithNoun(items.length, ["диалог", "диалога", "диалогов"]);
  const scope = selectedChannel ? "канал" : "все каналы";

  return {
    title: selectedChannel?.name ?? "Сообщения",
    subtitle: [scope, countLabel].join(" · "),
    items,
  };
}

/** Thread: full message history of one `kind = "dm"` conversation, chronological. */
export async function getThreadView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  conversationId: string,
): Promise<InboxThreadView | null> {
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, channel_connection_id, contact_id, kind, last_incoming_at")
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError) {
    console.error("[inbox] failed to load conversation", conversationError);
    throw new Error("Unable to load the conversation.");
  }

  if (!conversation || conversation.kind !== "dm") {
    return null;
  }

  const channel = channels.find(
    (candidate) => candidate.id === conversation.channel_connection_id,
  );

  if (!channel) {
    // Defensive only — the conversations→channel_connections FK
    // (supabase/migrations/20260720103000_create_schema_v1.sql) guarantees
    // this can't actually happen for a row in this workspace.
    console.error(
      "[inbox] conversation references an unknown channel_connection",
      conversation.id,
    );
    return null;
  }

  const [contact, messages, draft] = await Promise.all([
    conversation.contact_id
      ? loadContactById(supabase, workspaceId, conversation.contact_id)
      : Promise.resolve(null),
    listMessagesForConversation(supabase, workspaceId, conversation.id),
    getActiveConversationDraft(supabase, workspaceId, conversation.id),
  ]);

  const name = contact?.display_name ?? "Без контакта";
  const nowIso = new Date().toISOString();
  const responseWindowHours = readResponseWindowHours(channel.capabilities);
  const hoursLeft =
    responseWindowHours === null || !conversation.last_incoming_at
      ? null
      : hoursLeftInReplyWindow(conversation.last_incoming_at, nowIso, responseWindowHours);

  return {
    conversationId: conversation.id,
    contactId: contact?.id ?? null,
    title: name,
    avatar: avatarFor(contact?.id ?? conversation.id, name),
    channel: channelBadge(channel),
    category: null,
    replyWindowLabel:
      hoursLeft !== null && hoursLeft > 0 ? `Окно ответа: ${Math.round(hoursLeft)} ч` : null,
    replyWindowWarning:
      hoursLeft !== null && hoursLeft <= 0
        ? `Окно ответа (${responseWindowHours} ч) истекло — доставка не гарантируется.`
        : null,
    messages: messages.map((message) => ({
      id: message.id,
      direction: message.direction === "outgoing" ? ("out" as const) : ("in" as const),
      text: message.text,
      time: formatMessageTime(message.created_at, nowIso),
      deliveryLabel: DELIVERY_LABELS[message.delivery_status] ?? null,
      attachmentName: attachmentIndicatorLabel(message.attachments),
      canRetrySend:
        message.direction === "outgoing" && message.delivery_status === "failed",
    })),
    debounceNote: null,
    draft,
  };
}

export type MarkConversationReadResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Opening a thread resets its unread counter (ticket step 3). Kind-agnostic:
 * shared by the "Сообщения" and "Комментарии" screens (stage 5) — the
 * workspace + conversation scope is the ownership check.
 */
export async function markConversationRead(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<MarkConversationReadResult> {
  const { data, error } = await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[inbox] failed to mark conversation read", error);
    return { ok: false, error: "Не удалось обновить счётчик непрочитанного." };
  }

  if (!data) {
    return { ok: false, error: "Диалог не найден." };
  }

  return { ok: true };
}

/** Re-exported so callers only need one import for both the channel list and this module's functions. */
export { listChannelConnections, type ChannelConnectionRow };
