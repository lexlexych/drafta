/**
 * Типы mock-данных UI-каркаса.
 *
 * Форма повторяет таблицы главы «6. Модель данных» и термины глоссария (§2):
 * тенант — всегда `workspace`, подключённый канал — `channel_connection`.
 * Задача формы — чтобы замена mock-данных реальными запросами `lib/db`
 * не требовала переписывания компонентов.
 */

import type { ChannelPlatform } from "@/lib/channels/types";

/**
 * The mockup (E-001/T-07, docs/references/ui-mockup.html) only ever showcases
 * Instagram/Facebook, but real `channel_connections` (T-01/T-04) can be any
 * of the four platforms the channel layer supports. Reusing `ChannelPlatform`
 * here (rather than redeclaring a narrower union) is what lets
 * `lib/db/inbox.ts` (T-05) return view models typed against these same
 * `ConversationListItemView`/`ThreadView` shapes for a real Telegram/WhatsApp
 * channel without a type mismatch.
 */
export type Platform = ChannelPlatform;

export type ChannelProvider = "zernio" | "postmark" | "meta";

export type ChannelConnectionStatus = "connected" | "disconnected";

export type WorkspaceRole = "owner" | "member";

export type ConversationKind = "dm" | "comments";

export type ConversationStatus = "open" | "snoozed" | "closed";

export type MessageDirection = "in" | "out";

export type MessageDeliveryStatus = "received" | "sent" | "delivered" | "read";

export type DraftStatus =
  | "generating"
  | "ready"
  | "edited"
  | "sent"
  | "discarded"
  | "superseded";

export type NotificationMode = "instant" | "digest";

export type InvitationStatus = "pending" | "accepted" | "expired";

/** `workspaces` — тенант. */
export type Workspace = {
  id: string;
  name: string;
  plan: string;
};

/** `workspace_members` — связь user↔workspace. */
export type WorkspaceMember = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  display_name: string;
  is_online: boolean;
};

/** `invitations` — приглашение в workspace. */
export type Invitation = {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  status: InvitationStatus;
  expires_at: string;
};

/** `channel_connections` — подключённый канал с пользовательским именем. */
export type ChannelConnection = {
  id: string;
  workspace_id: string;
  /** Имя, заданное пользователем: видно в списках, тредах и меню (§5, §10). */
  name: string;
  provider: ChannelProvider;
  platform: Platform;
  external_account_id: string;
  status: ChannelConnectionStatus;
  capabilities: {
    can_send_dm: boolean;
    can_reply_to_comment: boolean;
    reply_window_hours: number | null;
  };
};

/**
 * `kb_files` — категория базы знаний: название плюс markdown, который её
 * описывает и одновременно является знанием по ней. Все активные уходят в
 * системный промпт (docs/architecture/09-categories.md).
 */
export type Category = {
  id: string;
  workspace_id: string;
  name: string;
  content: string;
  sort_order: number;
  is_enabled: boolean;
};

/** `contacts` — человек, намеренно отделён от канальной личности. */
export type Contact = {
  id: string;
  workspace_id: string;
  display_name: string;
  notes: string;
  tags: string[];
  avatar_url: string | null;
};

/** `contact_identities` — канальная личность контакта. */
export type ContactIdentity = {
  id: string;
  workspace_id: string;
  contact_id: string;
  channel_connection_id: string;
  platform: Platform;
  /** Внешний ID: username, телефон, email… */
  external_id: string;
  display_name: string;
};

/** Метаданные поста для `conversations.kind = "comments"` (jsonb). */
export type PostMetadata = {
  external_id: string;
  text_preview: string;
  url: string;
  platform: Platform;
  published_at: string;
  like_count: number;
  comment_count: number;
};

/** `conversations` — нить взаимодействия: переписка или ветка комментариев. */
export type Conversation = {
  id: string;
  workspace_id: string;
  channel_connection_id: string;
  kind: ConversationKind;
  /** Для `dm` — контакт-собеседник; для `comments` авторы разные, поле пустое. */
  contact_id: string | null;
  external_id: string;
  status: ConversationStatus;
  last_incoming_at: string;
  unread_count: number;
  /** Категории последнего черновика; перезаписываются целиком при каждом. */
  matched_kb_file_ids: string[];
  post: PostMetadata | null;
};

export type MessageAttachment = {
  id: string;
  kind: "image" | "file";
  file_name: string;
};

/** `messages` — сообщение или комментарий. */
export type Message = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  direction: MessageDirection;
  text: string;
  /** Автор входящего; у исходящих — пусто (отвечает workspace). */
  contact_identity_id: string | null;
  /** Для комментариев — ответ на другой комментарий. */
  parent_message_id: string | null;
  delivery_status: MessageDeliveryStatus;
  attachments: MessageAttachment[];
  created_at: string;
  external_id: string;
};

/** `drafts` — AI-черновик ответа. */
export type Draft = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  /** Диапазон входящих, на которые отвечает черновик (дебаунс — пачка). */
  first_message_id: string;
  last_message_id: string;
  text: string;
  status: DraftStatus;
  model: string;
  /** Использованные файлы базы знаний (§8). */
  kb_file_names: string[];
  /**
   * Только для макета: текст, который подставляет заглушка «Сгенерировать
   * заново». В реальной модели данных поля нет — черновик перегенерирует LLM.
   */
  mock_alternative_text: string;
};

/** `ai_settings` — настройки генерации на workspace. */
export type AiSettings = {
  workspace_id: string;
  tone: string;
  language: string;
  signature: string;
  debounce_seconds: number;
  model: string;
  auto_draft_dm: boolean;
  auto_draft_comments: boolean;
};

/** `notification_settings` — частота push на пару пользователь+workspace. */
export type NotificationSettings = {
  workspace_id: string;
  user_id: string;
  mode: NotificationMode;
  digest_interval_minutes: number;
  last_digest_at: string | null;
};

/** Полный набор mock-данных одного workspace. */
export type MockWorkspaceData = {
  now: string;
  workspace: Workspace;
  members: WorkspaceMember[];
  currentUserId: string;
  invitations: Invitation[];
  channelConnections: ChannelConnection[];
  categories: Category[];
  contacts: Contact[];
  contactIdentities: ContactIdentity[];
  conversations: Conversation[];
  messages: Message[];
  drafts: Draft[];
  aiSettings: AiSettings;
  notificationSettings: NotificationSettings;
};
