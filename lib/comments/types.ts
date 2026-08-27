import type { CommentTranslationView } from "@/lib/db/comment-translations";
import type { AvatarView, ChannelBadgeView } from "@/lib/mock";

/**
 * View models of the «Публикации» screen. Deliberately separate from the
 * message-side models (`lib/drafts/types.ts`, `lib/mock`'s conversation views):
 * a post is not a conversation and a comment is not a message, so nothing here
 * is shared with `/inbox` beyond the small presentational helpers (channel
 * badge, avatar).
 */

/** Комментарий сам по себе, без своей ветки ответов. */
export type CommentEntryView = {
  id: string;
  authorName: string;
  avatar: AvatarView | null;
  text: string;
  time: string;
  /** Our own published reply rather than someone's comment. */
  isOurs: boolean;
  /** Delivery status of our own reply; null for incoming comments. */
  deliveryLabel: string | null;
  /**
   * Готовый перевод на язык workspace, если он уже в кэше. `null` — значок
   * перевода сходит за ним в server action при первом нажатии.
   */
  translation: CommentTranslationView | null;
};

export type CommentView = CommentEntryView & {
  /**
   * Ветка под комментарием в хронологии: наши ответы и ответы других людей.
   * Instagram укладывает всё в два уровня — ответ на ответ попадает в ту же
   * ветку, поэтому здесь ровно один уровень вложенности, а не дерево.
   */
  replies: CommentEntryView[];
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
