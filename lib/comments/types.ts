import type { AvatarView, ChannelBadgeView } from "@/lib/mock";

/**
 * View models of the «Комментарии» screen. Deliberately separate from the
 * message-side models (`lib/drafts/types.ts`, `lib/mock`'s conversation views):
 * a post is not a conversation and a comment is not a message, so nothing here
 * is shared with `/inbox` beyond the small presentational helpers (channel
 * badge, avatar).
 */

/** Statuses a comment draft can have while it is still on screen. */
export type ActiveCommentDraftStatus = "generating" | "ready" | "edited";

export type CommentDraftView = {
  id: string;
  workspaceId: string;
  postId: string;
  /** The comment this draft answers — it is rendered directly under it. */
  commentId: string;
  status: ActiveCommentDraftStatus;
  text: string;
  model: string | null;
  kbFileIds: string[];
  kbFileNames: string[];
  createdAt: string;
  updatedAt: string;
};

export type CommentView = {
  id: string;
  authorName: string;
  authorHandle: string | null;
  avatar: AvatarView | null;
  text: string;
  time: string;
  /** Our own published reply rather than someone's comment. */
  isOurs: boolean;
  /** A reply to another comment rather than a top-level comment. */
  isReply: boolean;
  /** Delivery status of our own reply; null for incoming comments. */
  deliveryLabel: string | null;
  /**
   * True once a reply to this comment has been published (or is on its way).
   * Such a comment no longer offers «Создать черновик».
   */
  isAnswered: boolean;
  draft: CommentDraftView | null;
};

/** The per-post brief the «Черновики» dialog collects. */
export type PostDraftBriefView = {
  /** What the post shows — e.g. what happens in the video. */
  description: string;
  /** How to answer — e.g. thank people for the kind words. */
  instruction: string;
  /**
   * Whether the user has already confirmed the brief for this post. Until then
   * «Создать черновик» on a single comment opens the dialog instead of
   * generating straight away.
   */
  isConfigured: boolean;
};

export type PostThreadView = {
  postId: string;
  channel: ChannelBadgeView;
  postText: string;
  postUrl: string | null;
  /** "N комментариев" line under the post card. */
  postMeta: string;
  draftBrief: PostDraftBriefView;
  comments: CommentView[];
  /** How many drafts are ready/edited — what «Отправить все» would send. */
  sendableDraftCount: number;
};

export type PostListItemView = {
  id: string;
  title: string;
  preview: string;
  time: string;
  unreadCount: number;
  commentCount: number;
  channel: ChannelBadgeView;
};

export type PostListView = {
  title: string;
  subtitle: string;
  items: PostListItemView[];
};
