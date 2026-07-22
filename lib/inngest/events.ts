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

export type DraftRegenerateRequestedEvent = {
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

export const draftRegenerateRequestedEvent = eventType(
  "draft/regenerate.requested",
  {
    schema: staticSchema<DraftRegenerateRequestedEvent>(),
  },
);

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

/** Emits the user-requested regeneration event; its allow-list contains IDs only. */
export async function emitDraftRegenerateRequested(
  payload: DraftRegenerateRequestedEvent,
): Promise<void> {
  await inngest.send(draftRegenerateRequestedEvent.create(payload));
}
