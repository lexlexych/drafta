import type { PrivateReplyStatus } from "@/lib/db/comment-private-replies";
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
  /**
   * Id комментария у провайдера и id того, кому он отвечает. По ним ветка
   * собирается на клиенте (`lib/comments/thread.ts`) из накопленного окна
   * страниц. `null` — комментарий верхнего уровня или наш ответ, которому
   * провайдер ещё не выдал id.
   */
  externalId: string | null;
  parentExternalId: string | null;
  authorName: string;
  avatar: AvatarView | null;
  text: string;
  /** Момент публикации в ISO — ключ сортировки окна и курсор подгрузки вверх. */
  createdAt: string;
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
  /**
   * Состояние личного сообщения автору этого комментария, если его уже
   * отправляли. `null` — не отправляли ни разу.
   */
  privateReply: { status: PrivateReplyStatus } | null;
  /**
   * Можно ли написать автору в ЛС: платформа поддерживает private reply,
   * комментарий не старше окна платформы и ЛС по нему ещё не заводили.
   */
  canPrivateReply: boolean;
  /**
   * Куда ведёт «Отвечено в ЛС»: в переписку контакта, если она уже есть в
   * drafta, иначе в его карточку. `null`, если комментатор не сопоставлен с
   * контактом.
   */
  dmHref: string | null;
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
  /**
   * Строка «N комментариев» под описанием в шапке треда. Считается запросом по
   * всей публикации, а не по загруженной странице.
   */
  postMeta: string;
  /**
   * Последняя страница комментариев — плоским списком в хронологии. В ветки её
   * раскладывает клиент (`lib/comments/thread.ts`), потому что родитель ответа
   * может приехать только со следующей страницей вверх.
   */
  comments: CommentEntryView[];
  /** Выше загруженной страницы есть ещё комментарии. */
  hasMoreBefore: boolean;
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
