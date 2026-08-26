import { eventType, staticSchema } from "inngest";

import { inngest } from "./client";

export type ContactAvatarSyncRequestedEvent = {
  workspaceId: string;
  contactIdentityId: string;
  conversationId: string;
};

export type PostThumbnailSyncRequestedEvent = {
  workspaceId: string;
  postId: string;
};

/**
 * Payload for `draft/generate.requested` — the user pressed the AI icon in the
 * thread composer (docs/architecture/07-data-flows.md#62-генерация-черновика).
 * A DM draft is never generated on arrival, so this event is the only way one
 * ever comes into existence.
 *
 * Vibecoding rule 7 (docs/architecture/14-vibecoding-rules.md#7): **every**
 * Inngest event payload carries IDs only, never message text, contact names, or
 * any other personal data — this type is the enforcement, every call site is a
 * TypeScript error away from adding a third field.
 */
export type DraftGenerateRequestedEvent = {
  conversationId: string;
  workspaceId: string;
};

/**
 * Payload for `draft/generate.cancelled` — the user pressed «стоп» while the
 * draft was still generating. It is matched against the running `generate-draft`
 * run by `conversationId` through that function's `cancelOn` expression.
 * IDs only (vibecoding rule 7).
 */
export type DraftGenerateCancelledEvent = {
  conversationId: string;
  workspaceId: string;
};

/**
 * Payload for the `message/send` Inngest event
 * (docs/architecture/07-data-flows.md#63-отправка-ответа) — the outgoing
 * message is already persisted as `pending`; the event carries IDs only
 * (vibecoding rule 7), the send-message function reloads the text itself.
 */
export type MessageSendRequestedEvent = {
  messageId: string;
  conversationId: string;
  workspaceId: string;
};

/**
 * Payload for the `comment/drafts.requested` Inngest event — the user asked for
 * comment drafts from the «Комментарии» screen (comments are never drafted on
 * arrival). IDs only (vibecoding rule 7): the post's draft brief is stored on
 * the `posts` row and read by the pipeline itself, never carried in the event.
 *
 * `commentId` narrows the run to a single comment («Создать черновик» under one
 * comment, or its regenerate button). Omitted, the run covers every comment of
 * the post that still needs a draft.
 */
export type CommentDraftsRequestedEvent = {
  workspaceId: string;
  postId: string;
  commentId?: string;
};

/**
 * Payload for the `comment/send` Inngest event — the outgoing reply is already
 * persisted as `pending`; the event carries IDs only (vibecoding rule 7), the
 * `send-comment` function reloads the text itself.
 */
export type CommentSendRequestedEvent = {
  workspaceId: string;
  postId: string;
  /** The outgoing `comments` row to publish. */
  replyCommentId: string;
};

/**
 * Payload for the `push/notify.requested` Inngest event
 * (docs/architecture/11-realtime-pwa.md#web-push) — emitted by the webhook
 * pipeline as soon as an incoming direct message is persisted. IDs only
 * (vibecoding rule 7); the `send-push` function reloads the contact/channel
 * names server-side and never puts message text into the push payload
 * (§11 data-minimization).
 */
export type PushNotifyRequestedEvent = {
  messageId: string;
  conversationId: string;
  workspaceId: string;
};

/**
 * Inngest SDK v4 event definitions. `staticSchema` provides compile-time
 * validation without adding a runtime validation dependency; payload fields
 * remain an explicit allow-list of pseudonymous IDs (vibecoding rule 7).
 */
export const contactAvatarSyncRequestedEvent = eventType(
  "contact/avatar.sync-requested",
  { schema: staticSchema<ContactAvatarSyncRequestedEvent>() },
);

export const postThumbnailSyncRequestedEvent = eventType(
  "post/thumbnail.sync-requested",
  { schema: staticSchema<PostThumbnailSyncRequestedEvent>() },
);

export const draftGenerateRequestedEvent = eventType(
  "draft/generate.requested",
  {
    schema: staticSchema<DraftGenerateRequestedEvent>(),
  },
);

export const draftGenerateCancelledEvent = eventType(
  "draft/generate.cancelled",
  {
    schema: staticSchema<DraftGenerateCancelledEvent>(),
  },
);

export const messageSendRequestedEvent = eventType("message/send", {
  schema: staticSchema<MessageSendRequestedEvent>(),
});

export const pushNotifyRequestedEvent = eventType("push/notify.requested", {
  schema: staticSchema<PushNotifyRequestedEvent>(),
});

export const commentDraftsRequestedEvent = eventType(
  "comment/drafts.requested",
  {
    schema: staticSchema<CommentDraftsRequestedEvent>(),
  },
);

export const commentSendRequestedEvent = eventType("comment/send", {
  schema: staticSchema<CommentSendRequestedEvent>(),
});

/**
 * Requests a provider lookup after the webhook data is safely persisted.
 * Failure is cosmetic, so it follows the same fail-safe boundary as the push
 * event and never changes the webhook response.
 */
export async function emitContactAvatarSyncRequested(
  payload: ContactAvatarSyncRequestedEvent,
): Promise<void> {
  try {
    await inngest.send(contactAvatarSyncRequestedEvent.create(payload));
  } catch (error) {
    console.error(
      '[inngest] failed to emit "contact/avatar.sync-requested"',
      error,
    );
  }
}

/**
 * Requests a one-post thumbnail lookup after the post/comment is persisted.
 * The worker re-checks `posts.thumbnail_url` before calling the provider, so
 * repeated comment events are cheap once the first lookup succeeds.
 */
export async function emitPostThumbnailSyncRequested(
  payload: PostThumbnailSyncRequestedEvent,
): Promise<void> {
  try {
    await inngest.send(postThumbnailSyncRequestedEvent.create(payload));
  } catch (error) {
    console.error(
      '[inngest] failed to emit "post/thumbnail.sync-requested"',
      error,
    );
  }
}

/**
 * Emits the user-requested generation event; its allow-list contains IDs only.
 * Deliberately throwing: the composer is already locked waiting for a draft, so
 * a failed emit has to surface as an error toast rather than a field that stays
 * blocked forever.
 */
export async function emitDraftGenerateRequested(
  payload: DraftGenerateRequestedEvent,
): Promise<void> {
  await inngest.send(draftGenerateRequestedEvent.create(payload));
}

/**
 * Emits `draft/generate.cancelled`, fail-safe. The action that calls it also
 * marks the generating draft `discarded`, and that is what actually unblocks the
 * composer — cancelling the Inngest run only saves the rest of the work, so a
 * failed emit must not turn «стоп» into an error the user has to act on.
 */
export async function emitDraftGenerateCancelled(
  payload: DraftGenerateCancelledEvent,
): Promise<void> {
  try {
    await inngest.send(draftGenerateCancelledEvent.create(payload));
  } catch (error) {
    console.error(
      '[inngest] failed to emit "draft/generate.cancelled" (draft already discarded; not retried from here)',
      error,
    );
  }
}

/**
 * Emits `message/send`. Deliberately throwing (unlike the fail-safe
 * `emitPushNotifyRequested`): the caller is a server action that just
 * persisted a `pending` outgoing message — if the event never reaches
 * Inngest nothing will ever send it, so the action must learn about the
 * failure, mark the message `failed`, and surface the retry button
 * (docs/architecture/07-data-flows.md#63-отправка-ответа).
 */
export async function emitMessageSendRequested(
  payload: MessageSendRequestedEvent,
): Promise<void> {
  await inngest.send(messageSendRequestedEvent.create(payload));
}

/**
 * Emits `comment/drafts.requested`. Deliberately throwing: the user pressed a
 * button and is waiting for the drafts to start appearing — if the event never
 * reaches Inngest nothing will generate them, so the action must say so.
 */
export async function emitCommentDraftsRequested(
  payload: CommentDraftsRequestedEvent,
): Promise<void> {
  await inngest.send(commentDraftsRequestedEvent.create(payload));
}

/**
 * Emits `comment/send`. Throwing for the same reason as `message/send`: the
 * reply is already persisted `pending`, so a failed emit has to be compensated
 * to `failed` by the caller rather than left silently unsent.
 */
export async function emitCommentSendRequested(
  payload: CommentSendRequestedEvent,
): Promise<void> {
  await inngest.send(commentSendRequestedEvent.create(payload));
}

/**
 * Emits `push/notify.requested`, fail-safe — see
 * docs/epics/epic_02/T-03-webhook-inbound.md (open question #2 of the epic,
 * docs/epics/epic_02/_index.md): by the time this is called, the message is
 * already durably committed to Postgres and the webhook route is about to
 * answer 200 regardless (vibecoding rule 6 — the route must stay under 1s and
 * never depend on a downstream system to decide its own response). A failure to
 * reach Inngest is logged and swallowed, never re-thrown or awaited by the
 * caller as something that could fail the request — Zernio must not see this as
 * a reason to retry (that would just re-hit the `webhook_events` idempotency
 * guard for no benefit), and the missed instant push still shows up in the
 * user's next digest. IDs only (rule 7).
 */
export async function emitPushNotifyRequested(
  payload: PushNotifyRequestedEvent,
): Promise<void> {
  try {
    await inngest.send(pushNotifyRequestedEvent.create(payload));
  } catch (error) {
    console.error(
      '[inngest] failed to emit "push/notify.requested" (webhook already persisted; not retried from here)',
      error,
    );
  }
}
