import { eventType, staticSchema } from "inngest";

import { inngest } from "./client";

/**
 * Payload for the `interaction/received` Inngest event
 * (docs/architecture/07-data-flows.md#61-входящее-dm-или-комментарий).
 *
 * Vibecoding rule 7 (docs/architecture/14-vibecoding-rules.md#7 /
 * docs/architecture/07-data-flows.md#62-дебаунс-и-генерация-черновика):
 * **every** Inngest event payload carries IDs only, never message text,
 * contact names, or any other personal data — this type is the enforcement,
 * every call site is a TypeScript error away from adding a fourth field.
 */
export type InteractionReceivedEvent = {
  messageId: string;
  conversationId: string;
  workspaceId: string;
};

export type ContactAvatarSyncRequestedEvent = {
  workspaceId: string;
  contactIdentityId: string;
  conversationId: string;
};

export type DraftRegenerateRequestedEvent = {
  conversationId: string;
  workspaceId: string;
};

/**
 * Payload for `draft/run-now.requested` — the user pressed «Запустить сейчас»
 * on the debounce countdown and does not want to wait out the rest of the
 * window (docs/architecture/07-data-flows.md#62-дебаунс-и-генерация-черновика).
 *
 * It ends the pipeline's `waitForEvent` early rather than starting a second
 * run. Every waiting run of the conversation wakes up; all but the newest are
 * dropped by the existing last-event check, so supersede behaviour is unchanged.
 * IDs only (vibecoding rule 7).
 */
export type DraftRunNowRequestedEvent = {
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
 * (docs/architecture/11-realtime-pwa.md#web-push) — emitted after a draft is
 * ready for a new incoming message. IDs only (vibecoding rule 7); the
 * `send-push` function reloads the contact/channel names server-side and never
 * puts message text into the push payload (§11 data-minimization).
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
export const interactionReceivedEvent = eventType("interaction/received", {
  schema: staticSchema<InteractionReceivedEvent>(),
});

export const contactAvatarSyncRequestedEvent = eventType(
  "contact/avatar.sync-requested",
  { schema: staticSchema<ContactAvatarSyncRequestedEvent>() },
);

export const draftRegenerateRequestedEvent = eventType(
  "draft/regenerate.requested",
  {
    schema: staticSchema<DraftRegenerateRequestedEvent>(),
  },
);

export const draftRunNowRequestedEvent = eventType("draft/run-now.requested", {
  schema: staticSchema<DraftRunNowRequestedEvent>(),
});

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
 * Emits `interaction/received`, fail-safe — see
 * docs/epics/epic_02/T-03-webhook-inbound.md (open question #2 of the epic,
 * docs/epics/epic_02/_index.md): by the time this is called, the message is
 * already durably committed to Postgres and the webhook route is about to
 * answer 200 regardless (vibecoding rule 6 — the route must stay under 1s
 * and never depend on a downstream system to decide its own response). A
 * failure to reach Inngest is logged and swallowed, never re-thrown or
 * awaited by the caller as something that could fail the request — Zernio
 * must not see this as a reason to retry (that would just re-hit the
 * `webhook_events` idempotency guard for no benefit, not recover the event).
 *
 * The event is consumed by the stage 2 `generate-draft` Inngest function;
 * this helper remains the emission boundary used by the webhook pipeline.
 */
export async function emitInteractionReceived(
  payload: InteractionReceivedEvent,
): Promise<void> {
  try {
    await inngest.send(interactionReceivedEvent.create(payload));
  } catch (error) {
    console.error(
      '[inngest] failed to emit "interaction/received" (webhook already persisted; not retried from here)',
      error,
    );
  }
}

/**
 * Requests a provider lookup after the webhook data is safely persisted.
 * Failure is cosmetic, so it follows the same fail-safe boundary as the
 * draft-pipeline event and never changes the webhook response.
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

/** Emits the user-requested regeneration event; its allow-list contains IDs only. */
export async function emitDraftRegenerateRequested(
  payload: DraftRegenerateRequestedEvent,
): Promise<void> {
  await inngest.send(draftRegenerateRequestedEvent.create(payload));
}

/**
 * Emits `draft/run-now.requested`. Deliberately throwing: the user pressed a
 * button and expects the countdown to end, so a failed emit has to surface as
 * an error toast rather than a timer that silently keeps running.
 */
export async function emitDraftRunNowRequested(
  payload: DraftRunNowRequestedEvent,
): Promise<void> {
  await inngest.send(draftRunNowRequestedEvent.create(payload));
}

/**
 * Emits `message/send`. Deliberately throwing (unlike the fail-safe
 * `emitInteractionReceived`): the caller is a server action that just
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
 * Emits `push/notify.requested`, fail-safe. Called at the tail of the draft
 * pipeline (draft already finalized): a failure to reach Inngest must never
 * fail the generation run, so it is logged and swallowed — the missed instant
 * push still shows up in the user's next digest. IDs only (rule 7).
 */
export async function emitPushNotifyRequested(
  payload: PushNotifyRequestedEvent,
): Promise<void> {
  try {
    await inngest.send(pushNotifyRequestedEvent.create(payload));
  } catch (error) {
    console.error(
      '[inngest] failed to emit "push/notify.requested" (draft already finalized; not retried from here)',
      error,
    );
  }
}
