/**
 * Селекторы mock-данных: превращают набор из `data.ts` в модели представления,
 * которые компоненты получают пропсами. Внутри компонентов вшитых данных нет.
 *
 * Когда mock заменят реальные запросы `lib/db`, поменяется только этот слой:
 * форма моделей представления останется прежней.
 */

import { mockDashboardStats, mockWorkspaceData } from "./data";
import {
  formatDayDistance,
  formatDaysUntil,
  formatFullDate,
  formatListTime,
  formatMessageTime,
  hoursLeftInReplyWindow,
} from "./time";
import type {
  Category,
  ChannelConnection,
  Contact,
  ContactIdentity,
  Conversation,
  ConversationKind,
  Draft,
  DraftStatus,
  Invitation,
  Message,
  NotificationSettings,
  Platform,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from "./types";

export * from "./types";
export { MOCK_NOW } from "./data";

const data = mockWorkspaceData;
const now = data.now;

/* ------------------------------------------------------------------ */
/* Модели представления                                                */
/* ------------------------------------------------------------------ */

export type ChannelBadgeView = {
  id: string;
  name: string;
  platform: Platform;
};

export type CategoryBadgeView = {
  id: string;
  name: string;
  colorVar: string;
};

export type AvatarView = {
  initials: string;
  hue: number;
};

export type ChannelFilterView = ChannelBadgeView & {
  count: number;
};

export type NavigationCountersView = {
  dmUnread: number;
  commentsUnread: number;
  channels: Array<
    ChannelBadgeView & {
      dmUnread: number;
      commentsUnread: number;
      contactCount: number;
    }
  >;
};

export type ConversationListItemView = {
  id: string;
  kind: ConversationKind;
  title: string;
  preview: string;
  time: string;
  unreadCount: number;
  channel: ChannelBadgeView;
  category: CategoryBadgeView | null;
  avatar: AvatarView | null;
};

export type ConversationListView = {
  title: string;
  subtitle: string;
  items: ConversationListItemView[];
};

export type DraftView = {
  id: string;
  status: DraftStatus;
  text: string;
  alternativeText: string;
  caption: string;
  referenceText: string | null;
  kbFileNames: string[];
};

export type ThreadMessageView = {
  id: string;
  direction: "in" | "out";
  text: string;
  time: string;
  deliveryLabel: string | null;
  attachmentName: string | null;
};

export type ThreadView = {
  conversationId: string;
  contactId: string | null;
  title: string;
  avatar: AvatarView;
  channel: ChannelBadgeView;
  category: CategoryBadgeView | null;
  replyWindowLabel: string | null;
  messages: ThreadMessageView[];
  debounceNote: string | null;
  draft: DraftView | null;
};

export type CommentView = {
  id: string;
  authorName: string;
  authorHandle: string | null;
  avatar: AvatarView | null;
  text: string;
  time: string;
  category: CategoryBadgeView | null;
  isOurs: boolean;
  isReply: boolean;
  isDraftTarget: boolean;
  isMuted: boolean;
  noDraftNote: boolean;
};

export type PostThreadView = {
  conversationId: string;
  channel: ChannelBadgeView;
  postText: string;
  postUrl: string;
  postMeta: string;
  comments: CommentView[];
  draft: DraftView | null;
};

export type ContactListItemView = {
  id: string;
  name: string;
  avatar: AvatarView;
  handles: string;
  platforms: Platform[];
  tag: string | null;
};

export type ContactHistoryEntryView = {
  conversationId: string;
  kind: ConversationKind;
  label: string;
  time: string;
};

export type ContactCardView = {
  id: string;
  name: string;
  avatar: AvatarView;
  tags: string[];
  notes: string;
  identities: Array<{
    id: string;
    platform: Platform;
    platformLabel: string;
    handle: string;
    channelName: string;
  }>;
  history: ContactHistoryEntryView[];
};

export type DashboardFeedItemView = {
  conversationId: string;
  kind: ConversationKind;
  avatar: AvatarView;
  text: string;
  channel: ChannelBadgeView;
  category: CategoryBadgeView | null;
  time: string;
};

export type DashboardView = {
  date: string;
  stats: Array<{ id: string; value: string; label: string; highlighted: boolean }>;
  channelLoad: Array<ChannelBadgeView & { total: number; share: number }>;
  channelLoadNote: string;
  feed: DashboardFeedItemView[];
};

export type SettingsSectionId =
  | "channels"
  | "categories"
  | "ai"
  | "knowledge"
  | "team"
  | "notifications"
  | "privacy";

export type SettingsSectionView = {
  id: SettingsSectionId;
  title: string;
  description: string;
};

export type SettingsChannelRowView = {
  id: string;
  name: string;
  platform: Platform;
  statusLine: string;
};

export type SettingsCategoryRowView = {
  id: string;
  name: string;
  colorVar: string;
  priorityLabel: string;
  scopeLabel: string;
  extraLabels: string[];
  isDefault: boolean;
};

export type SettingsTeamRowView = {
  id: string;
  name: string;
  statusLine: string;
  avatar: AvatarView | null;
  removable: boolean;
  removeLabel: string;
};

/* ------------------------------------------------------------------ */
/* Вспомогательные функции                                             */
/* ------------------------------------------------------------------ */

const PLATFORM_LABELS: Record<Platform, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

const CATEGORY_INBOX_KIND_LABELS = {
  dm: "сообщения",
  comments: "комментарии",
  both: "оба",
} as const;

const DELIVERY_LABELS = {
  read: "Прочитано",
  delivered: "Доставлено",
  sent: "Отправлено",
  received: null,
} as const;

/**
 * Палитра точек категорий. Цвет — свойство интерфейса, а не таблицы
 * `categories`, поэтому назначается по позиции в списке приоритетов.
 */
const CATEGORY_COLOR_VARS = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5"];
const DEFAULT_CATEGORY_COLOR_VAR = "--cat-default";

export function platformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform];
}

function pluralize(count: number, forms: [string, string, string]): string {
  const lastTwoDigits = Math.abs(count) % 100;
  const lastDigit = lastTwoDigits % 10;

  if (lastTwoDigits > 10 && lastTwoDigits < 20) {
    return forms[2];
  }

  if (lastDigit > 1 && lastDigit < 5) {
    return forms[1];
  }

  return lastDigit === 1 ? forms[0] : forms[2];
}

/**
 * Exported (not just an internal mock helper) because `lib/db/inbox.ts`
 * (T-05) needs the exact same Russian pluralization for real conversation
 * counts — one source of truth instead of a second copy drifting from this one.
 */
export function countWithNoun(count: number, forms: [string, string, string]): string {
  return `${count} ${pluralize(count, forms)}`;
}

/** Детерминированный оттенок аватара: цвет не хранится, а выводится из id. */
function avatarHue(seed: string): number {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }

  return hash;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const second = parts[1]?.[0] ?? "";

  return `${first}${second}`.toUpperCase();
}

/**
 * Exported for the same reason as `countWithNoun` above: `lib/db/inbox.ts`
 * (T-05) derives avatars for real contacts the identical deterministic way
 * (hash of an id → hue), so a contact's avatar color doesn't change when a
 * conversation's data source moves from mock to `lib/db`.
 */
export function avatarFor(id: string, name: string): AvatarView {
  return { initials: initials(name), hue: avatarHue(id) };
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}

function byId<T extends { id: string }>(items: T[], id: string | null): T | null {
  if (!id) {
    return null;
  }

  return items.find((item) => item.id === id) ?? null;
}

function channelBadge(channel: ChannelConnection): ChannelBadgeView {
  return { id: channel.id, name: channel.name, platform: channel.platform };
}

function categoryBadge(category: Category): CategoryBadgeView {
  const colorVar = category.is_default
    ? DEFAULT_CATEGORY_COLOR_VAR
    : (CATEGORY_COLOR_VARS[data.categories.indexOf(category)] ??
      DEFAULT_CATEGORY_COLOR_VAR);

  return { id: category.id, name: category.name, colorVar };
}

function categoryBadgeById(id: string | null): CategoryBadgeView | null {
  const category = byId(data.categories, id);

  return category ? categoryBadge(category) : null;
}

function requireChannel(id: string): ChannelConnection {
  const channel = byId(data.channelConnections, id);

  if (!channel) {
    throw new Error(`Mock channel_connection "${id}" is missing.`);
  }

  return channel;
}

function identityHandle(identity: ContactIdentity): string {
  return identity.platform === "instagram"
    ? `@${identity.external_id}`
    : identity.display_name;
}

function messagesOf(conversationId: string): Message[] {
  return data.messages
    .filter((message) => message.conversation_id === conversationId)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

function draftOf(conversationId: string): Draft | null {
  return (
    data.drafts.find((draft) => draft.conversation_id === conversationId) ?? null
  );
}

function conversationsOfKind(kind: ConversationKind): Conversation[] {
  return data.conversations
    .filter((conversation) => conversation.kind === kind)
    .sort((left, right) =>
      right.last_incoming_at.localeCompare(left.last_incoming_at),
    );
}

/* ------------------------------------------------------------------ */
/* Workspace и навигация                                               */
/* ------------------------------------------------------------------ */

export function getWorkspace(): Workspace {
  return data.workspace;
}

export function getCurrentMember(): WorkspaceMember {
  const member = data.members.find(
    (candidate) => candidate.user_id === data.currentUserId,
  );

  if (!member) {
    throw new Error("Mock workspace has no current member.");
  }

  return member;
}

export function getChannelConnections(): ChannelConnection[] {
  return data.channelConnections;
}

export function getCategories(): Category[] {
  return [...data.categories].sort((left, right) => left.priority - right.priority);
}

export function getCategoryFilterOptions(): CategoryBadgeView[] {
  return getCategories().map(categoryBadge);
}

function unreadFor(kind: ConversationKind, channelId?: string): number {
  return data.conversations
    .filter(
      (conversation) =>
        conversation.kind === kind &&
        (!channelId || conversation.channel_connection_id === channelId),
    )
    .reduce((total, conversation) => total + conversation.unread_count, 0);
}

function contactCountFor(channelId?: string): number {
  return data.contacts.filter((contact) =>
    data.contactIdentities.some(
      (identity) =>
        identity.contact_id === contact.id &&
        (!channelId || identity.channel_connection_id === channelId),
    ),
  ).length;
}

export function getNavigationCounters(): NavigationCountersView {
  return {
    dmUnread: unreadFor("dm"),
    commentsUnread: unreadFor("comments"),
    channels: data.channelConnections.map((channel) => ({
      ...channelBadge(channel),
      dmUnread: unreadFor("dm", channel.id),
      commentsUnread: unreadFor("comments", channel.id),
      contactCount: contactCountFor(channel.id),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Черновики                                                           */
/* ------------------------------------------------------------------ */

function draftView(draft: Draft | null, conversation: Conversation): DraftView | null {
  if (!draft) {
    return null;
  }

  const channel = requireChannel(conversation.channel_connection_id);
  const isComments = conversation.kind === "comments";
  let referenceText: string | null = null;

  if (isComments) {
    const target = byId(data.messages, draft.last_message_id);
    const identity = byId(data.contactIdentities, target?.contact_identity_id ?? null);

    if (target && identity) {
      referenceText = `Ответ на комментарий ${identityHandle(identity)}: «${truncate(
        target.text,
        32,
      )}»`;
    }
  }

  return {
    id: draft.id,
    status: draft.status,
    text: draft.text,
    alternativeText: draft.mock_alternative_text,
    caption: isComments
      ? `${platformLabel(channel.platform)} · публичный ответ`
      : `Модель: ${draft.model}`,
    referenceText,
    kbFileNames: draft.kb_file_names,
  };
}

function draftsAwaitingReview(): number {
  return data.drafts.filter(
    (draft) => draft.status === "ready" || draft.status === "edited",
  ).length;
}

/* ------------------------------------------------------------------ */
/* Списки диалогов и постов                                            */
/* ------------------------------------------------------------------ */

function dmListItem(conversation: Conversation): ConversationListItemView {
  const contact = byId(data.contacts, conversation.contact_id);
  const messages = messagesOf(conversation.id);
  const last = messages[messages.length - 1];
  const name = contact?.display_name ?? "Без контакта";
  const attachment = last?.attachments[0];
  const previewText = attachment ? `📷 ${last.text}` : (last?.text ?? "");

  return {
    id: conversation.id,
    kind: "dm",
    title: name,
    preview: `${last?.direction === "out" ? "Вы: " : ""}${previewText}`,
    time: formatListTime(conversation.last_incoming_at, now),
    unreadCount: conversation.unread_count,
    channel: channelBadge(requireChannel(conversation.channel_connection_id)),
    category: categoryBadgeById(conversation.category_id),
    avatar: avatarFor(contact?.id ?? conversation.id, name),
  };
}

function postListItem(conversation: Conversation): ConversationListItemView {
  const messages = messagesOf(conversation.id);
  const last = messages[messages.length - 1];
  const identity = byId(data.contactIdentities, last?.contact_identity_id ?? null);
  const authorName = identity?.display_name ?? getWorkspace().name;

  return {
    id: conversation.id,
    kind: "comments",
    title: conversation.post?.text_preview ?? "",
    preview: `${authorName}: ${last?.text ?? ""}`,
    time: formatListTime(conversation.last_incoming_at, now),
    unreadCount: conversation.unread_count,
    channel: channelBadge(requireChannel(conversation.channel_connection_id)),
    category: null,
    avatar: null,
  };
}

function conversationMatchesCategory(
  conversation: Conversation,
  categoryId: string | null,
): boolean {
  if (!categoryId) {
    return true;
  }

  if (conversation.kind === "dm") {
    return conversation.category_id === categoryId;
  }

  return messagesOf(conversation.id).some(
    (message) => message.direction === "in" && message.category_id === categoryId,
  );
}

export type ConversationListFilter = {
  channelId?: string | null;
  categoryId?: string | null;
};

export function getConversationList(
  kind: ConversationKind,
  filter: ConversationListFilter = {},
): ConversationListView {
  const channelId = filter.channelId ?? null;
  const categoryId = filter.categoryId ?? null;
  const channel = channelId ? byId(data.channelConnections, channelId) : null;
  const category = categoryId ? byId(data.categories, categoryId) : null;

  const items = conversationsOfKind(kind)
    .filter(
      (conversation) =>
        (!channelId || conversation.channel_connection_id === channelId) &&
        conversationMatchesCategory(conversation, categoryId),
    )
    .map((conversation) =>
      kind === "dm" ? dmListItem(conversation) : postListItem(conversation),
    );

  const scope = channel
    ? "канал"
    : kind === "comments"
      ? "сгруппировано по постам"
      : "все каналы";

  const countLabel =
    kind === "dm"
      ? countWithNoun(items.length, ["диалог", "диалога", "диалогов"])
      : countWithNoun(items.length, ["пост", "поста", "постов"]);

  return {
    title: channel?.name ?? (kind === "dm" ? "Сообщения" : "Комментарии"),
    subtitle: [scope, category?.name, countLabel].filter(Boolean).join(" · "),
    items,
  };
}

export function getChannelFilters(
  kind: ConversationKind | "contacts",
): ChannelFilterView[] {
  return data.channelConnections.map((channel) => ({
    ...channelBadge(channel),
    count:
      kind === "contacts"
        ? contactCountFor(channel.id)
        : unreadFor(kind, channel.id),
  }));
}

/* ------------------------------------------------------------------ */
/* Тред переписки                                                      */
/* ------------------------------------------------------------------ */

export function getThread(conversationId: string): ThreadView | null {
  const conversation = byId(data.conversations, conversationId);

  if (!conversation || conversation.kind !== "dm") {
    return null;
  }

  const channel = requireChannel(conversation.channel_connection_id);
  const contact = byId(data.contacts, conversation.contact_id);
  const messages = messagesOf(conversation.id);
  const draft = draftOf(conversation.id);
  const name = contact?.display_name ?? "Без контакта";

  const windowHours = channel.capabilities.reply_window_hours;
  const hoursLeft =
    windowHours === null
      ? null
      : hoursLeftInReplyWindow(conversation.last_incoming_at, now, windowHours);

  const batchSize =
    draft && draft.status !== "sent"
      ? messages.filter(
          (message) =>
            message.direction === "in" &&
            message.created_at >=
              (byId(data.messages, draft.first_message_id)?.created_at ?? ""),
        ).length
      : 0;

  return {
    conversationId: conversation.id,
    contactId: contact?.id ?? null,
    title: name,
    avatar: avatarFor(contact?.id ?? conversation.id, name),
    channel: channelBadge(channel),
    category: categoryBadgeById(conversation.category_id),
    replyWindowLabel:
      hoursLeft !== null && hoursLeft > 0
        ? `Окно ответа: ${Math.round(hoursLeft)} ч`
        : null,
    messages: messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      text: message.text,
      time: formatMessageTime(message.created_at, now),
      deliveryLabel: DELIVERY_LABELS[message.delivery_status],
      attachmentName: message.attachments[0]?.file_name ?? null,
    })),
    debounceNote:
      batchSize > 1
        ? `Пауза ${data.aiSettings.debounce_seconds} сек — дебаунс: один черновик на пачку из ${countWithNoun(
            batchSize,
            ["сообщения", "сообщений", "сообщений"],
          )}`
        : null,
    draft: draftView(draft, conversation),
  };
}

/* ------------------------------------------------------------------ */
/* Ветка комментариев                                                  */
/* ------------------------------------------------------------------ */

export function getPostThread(conversationId: string): PostThreadView | null {
  const conversation = byId(data.conversations, conversationId);

  if (!conversation || conversation.kind !== "comments" || !conversation.post) {
    return null;
  }

  const channel = requireChannel(conversation.channel_connection_id);
  const draft = draftOf(conversation.id);
  const draftIsLive =
    draft !== null && draft.status !== "sent" && draft.status !== "discarded";
  const post = conversation.post;

  const comments: CommentView[] = messagesOf(conversation.id).map((message) => {
    const identity = byId(data.contactIdentities, message.contact_identity_id);
    const category = byId(data.categories, message.category_id);
    const isOurs = message.direction === "out";
    const authorName = identity?.display_name ?? getWorkspace().name;

    return {
      id: message.id,
      authorName,
      authorHandle: isOurs
        ? `Вы · ${channel.name}`
        : identity && identity.platform === "instagram"
          ? identityHandle(identity)
          : null,
      avatar: isOurs ? null : avatarFor(identity?.id ?? message.id, authorName),
      text: message.text,
      time: formatMessageTime(message.created_at, now),
      category: isOurs || !category ? null : categoryBadge(category),
      isOurs,
      isReply: message.parent_message_id !== null,
      isDraftTarget: draftIsLive && draft?.last_message_id === message.id,
      isMuted: category?.no_draft === true,
      noDraftNote: category?.no_draft === true,
    };
  });

  return {
    conversationId: conversation.id,
    channel: channelBadge(channel),
    postText: post.text_preview,
    postUrl: post.url,
    postMeta: [
      formatDayDistance(post.published_at, now),
      `${countWithNoun(post.like_count, ["отметка", "отметки", "отметок"])} «Нравится»`,
      countWithNoun(post.comment_count, [
        "комментарий",
        "комментария",
        "комментариев",
      ]),
    ].join(" · "),
    comments,
    draft: draftView(draft, conversation),
  };
}

/* ------------------------------------------------------------------ */
/* Контакты                                                            */
/* ------------------------------------------------------------------ */

function identitiesOf(contactId: string): ContactIdentity[] {
  return data.contactIdentities.filter(
    (identity) => identity.contact_id === contactId,
  );
}

function contactListItem(contact: Contact): ContactListItemView {
  const identities = identitiesOf(contact.id);

  return {
    id: contact.id,
    name: contact.display_name,
    avatar: avatarFor(contact.id, contact.display_name),
    handles: identities.map(identityHandle).join(" · "),
    platforms: identities.map((identity) => identity.platform),
    tag: contact.tags[0] ?? null,
  };
}

export function getContactList(channelId?: string | null): {
  title: string;
  subtitle: string;
  items: ContactListItemView[];
} {
  const channel = channelId ? byId(data.channelConnections, channelId) : null;
  const items = data.contacts
    .filter((contact) =>
      identitiesOf(contact.id).some(
        (identity) => !channelId || identity.channel_connection_id === channelId,
      ),
    )
    .map(contactListItem);

  return {
    title: channel?.name ?? "Контакты",
    subtitle: [
      channel ? "контакты канала" : "все каналы",
      countWithNoun(items.length, ["контакт", "контакта", "контактов"]),
    ].join(" · "),
    items,
  };
}

export function getContactCard(contactId: string): ContactCardView | null {
  const contact = byId(data.contacts, contactId);

  if (!contact) {
    return null;
  }

  const identities = identitiesOf(contact.id);
  const identityIds = new Set(identities.map((identity) => identity.id));

  const history: ContactHistoryEntryView[] = data.conversations
    .filter((conversation) =>
      conversation.kind === "dm"
        ? conversation.contact_id === contact.id
        : messagesOf(conversation.id).some(
            (message) =>
              message.contact_identity_id !== null &&
              identityIds.has(message.contact_identity_id),
          ),
    )
    .sort((left, right) =>
      right.last_incoming_at.localeCompare(left.last_incoming_at),
    )
    .map((conversation) => {
      const channel = requireChannel(conversation.channel_connection_id);

      return {
        conversationId: conversation.id,
        kind: conversation.kind,
        label:
          conversation.kind === "dm"
            ? `Переписка · ${channel.name}`
            : `Комментарий к посту «${truncate(conversation.post?.text_preview ?? "", 28)}»`,
        time: formatMessageTime(conversation.last_incoming_at, now),
      };
    });

  return {
    id: contact.id,
    name: contact.display_name,
    avatar: avatarFor(contact.id, contact.display_name),
    tags: contact.tags,
    notes: contact.notes,
    identities: identities.map((identity) => ({
      id: identity.id,
      platform: identity.platform,
      platformLabel: platformLabel(identity.platform),
      handle: identityHandle(identity),
      channelName: requireChannel(identity.channel_connection_id).name,
    })),
    history,
  };
}

/* ------------------------------------------------------------------ */
/* Дашборд                                                             */
/* ------------------------------------------------------------------ */

export function getDashboard(): DashboardView {
  const dmUnread = unreadFor("dm");
  const commentsUnread = unreadFor("comments");
  const openDialogs = data.conversations.filter(
    (conversation) => conversation.kind === "dm" && conversation.status === "open",
  ).length;

  const channelLoad = data.channelConnections.map((channel) => ({
    ...channelBadge(channel),
    total: unreadFor("dm", channel.id) + unreadFor("comments", channel.id),
  }));
  const maxLoad = Math.max(1, ...channelLoad.map((entry) => entry.total));

  // Одно (последнее) входящее на диалог — лента, как в макете.
  const latestIncomingByConversation = new Map<string, Message>();

  data.messages
    .filter((message) => message.direction === "in")
    .forEach((message) => {
      const current = latestIncomingByConversation.get(message.conversation_id);

      if (!current || current.created_at < message.created_at) {
        latestIncomingByConversation.set(message.conversation_id, message);
      }
    });

  const feed: DashboardFeedItemView[] = [...latestIncomingByConversation.values()]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 5)
    .flatMap((message) => {
      const conversation = byId(data.conversations, message.conversation_id);

      if (!conversation) {
        return [];
      }

      const identity = byId(data.contactIdentities, message.contact_identity_id);
      const authorName = identity?.display_name ?? "Неизвестный отправитель";
      const isComment = conversation.kind === "comments";

      return [
        {
          conversationId: conversation.id,
          kind: conversation.kind,
          avatar: avatarFor(identity?.id ?? message.id, authorName),
          text: isComment
            ? `Комментарий: «${truncate(message.text, 34)}»`
            : truncate(message.text, 44),
          channel: channelBadge(requireChannel(conversation.channel_connection_id)),
          category: categoryBadgeById(message.category_id),
          time: formatMessageTime(message.created_at, now),
        },
      ];
    });

  return {
    date: formatFullDate(now),
    stats: [
      {
        id: "incoming",
        value: String(dmUnread + commentsUnread),
        label: "новых входящих",
        highlighted: false,
      },
      {
        id: "drafts",
        value: String(draftsAwaitingReview()),
        label: "черновиков ждут проверки",
        highlighted: true,
      },
      {
        id: "open",
        value: String(openDialogs),
        label: "открытых диалогов",
        highlighted: false,
      },
      {
        id: "median",
        value: `${mockDashboardStats.median_reply_minutes} мин`,
        label: "медиана времени ответа",
        highlighted: false,
      },
    ],
    channelLoad: channelLoad.map((entry) => ({
      ...entry,
      share: Math.round((entry.total / maxLoad) * 100),
    })),
    channelLoadNote: `сообщения: ${dmUnread} · комментарии: ${commentsUnread}`,
    feed,
  };
}

/* ------------------------------------------------------------------ */
/* Настройки                                                           */
/* ------------------------------------------------------------------ */

export const SETTINGS_SECTIONS: SettingsSectionView[] = [
  { id: "channels", title: "Каналы", description: "Подключения и их имена" },
  {
    id: "categories",
    title: "Категории",
    description: "Правила классификации входящих",
  },
  { id: "ai", title: "AI", description: "Тон, язык, дебаунс, авто-генерация" },
  {
    id: "knowledge",
    title: "База знаний",
    description: "Markdown-файлы для AI-ответов",
  },
  { id: "team", title: "Команда", description: "Участники и приглашения" },
  { id: "notifications", title: "Уведомления", description: "Частота push" },
  {
    id: "privacy",
    title: "Приватность",
    description: "Экспорт и удаление данных",
  },
];

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function getSettingsChannels(): SettingsChannelRowView[] {
  return data.channelConnections.map((channel) => ({
    id: channel.id,
    name: channel.name,
    platform: channel.platform,
    statusLine: `${platformLabel(channel.platform)} · ${
      channel.status === "connected" ? "подключён" : "отключён"
    } · через ${channel.provider === "zernio" ? "Zernio" : channel.provider}`,
  }));
}

export function getSettingsCategories(): SettingsCategoryRowView[] {
  return getCategories().map((category) => {
    const scopeChannels = category.channel_connection_ids.length
      ? category.channel_connection_ids
          .map((id) => requireChannel(id).name)
          .join(", ")
      : "все";

    const extraLabels: string[] = [];

    if (category.extra_action) {
      extraLabels.push(`действие: ${category.extra_action}`);
    }

    if (category.no_draft) {
      extraLabels.push("без черновиков");
    }

    if (category.is_default) {
      extraLabels.push("системная");
    }

    return {
      id: category.id,
      name: category.name,
      colorVar: categoryBadge(category).colorVar,
      priorityLabel: String(category.priority),
      scopeLabel: `каналы: ${scopeChannels} · тип: ${
        CATEGORY_INBOX_KIND_LABELS[category.inbox_kind]
      }`,
      extraLabels,
      isDefault: category.is_default,
    };
  });
}

export function getNotificationSettings(): NotificationSettings {
  return data.notificationSettings;
}

export function getSettingsTeam(): SettingsTeamRowView[] {
  const roleLabel = (role: WorkspaceRole) => role;

  const members: SettingsTeamRowView[] = data.members.map((member) => ({
    id: member.id,
    name: member.display_name,
    statusLine: `${roleLabel(member.role)} · ${
      member.user_id === data.currentUserId
        ? "вы"
        : member.is_online
          ? "в сети"
          : "не в сети"
    }`,
    avatar: avatarFor(member.id, member.display_name),
    removable: member.user_id !== data.currentUserId,
    removeLabel: "Убрать",
  }));

  const invitations: SettingsTeamRowView[] = data.invitations.map(
    (invitation: Invitation) => ({
      id: invitation.id,
      name: invitation.email,
      statusLine: `приглашение отправлено · истекает ${formatDaysUntil(
        invitation.expires_at,
        now,
      )}`,
      avatar: null,
      removable: true,
      removeLabel: "Отозвать",
    }),
  );

  return [...members, ...invitations];
}
