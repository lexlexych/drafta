import type { AvatarView, ChannelBadgeView } from "@/lib/mock";

/**
 * View models of the «Публикации» screen. Deliberately separate from the
 * message-side models (`lib/drafts/types.ts`, `lib/mock`'s conversation views):
 * a post is not a conversation and a comment is not a message, so nothing here
 * is shared with `/inbox` beyond the small presentational helpers (channel
 * badge, avatar).
 */

export type CommentView = {
  id: string;
  authorName: string;
  avatar: AvatarView | null;
  text: string;
  time: string;
  /** Our own published reply rather than someone's comment. */
  isOurs: boolean;
  /** A reply to another comment rather than a top-level comment. */
  isReply: boolean;
  /** Delivery status of our own reply; null for incoming comments. */
  deliveryLabel: string | null;
};

export type PostThreadView = {
  postId: string;
  /** Описание публикации — заголовок треда (в макете было «Комментарии к посту»). */
  postText: string;
  /** Ссылка на публикацию в мессенджере; null, если провайдер её не сообщил. */
  postUrl: string | null;
  /** Строка «N комментариев» под описанием в шапке треда. */
  postMeta: string;
  comments: CommentView[];
};

export type PostListItemView = {
  id: string;
  title: string;
  preview: string;
  time: string;
  unreadCount: number;
  commentCount: number;
  thumbnailUrl: string | null;
  channel: ChannelBadgeView;
};

export type PostListView = {
  title: string;
  subtitle: string;
  items: PostListItemView[];
};
