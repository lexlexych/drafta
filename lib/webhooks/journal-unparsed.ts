import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { UnparsedEnvelope } from "@/lib/channels/types";

/**
 * Journals one envelope the adapter refused into `webhook_events`.
 *
 * The pipeline in `./process-event.ts` only ever sees envelopes that
 * normalized successfully; everything the adapter could not read — an event
 * type it does not map, an unknown platform, a payload missing fields the
 * provider's own schema promises — used to end at a `console.warn`. The route
 * then answered 200, the provider marked the delivery done, and nothing in the
 * database recorded that the message had ever arrived. On a log retention of
 * an hour that makes a lost message indistinguishable from one the provider
 * never sent, which is exactly the question a whole class of missing Instagram
 * messages turned on.
 *
 * So: one row per refused envelope, carrying the payload verbatim and the
 * adapter's reason. Answering "did Zernio send it, and what did we do with
 * it?" becomes a `select` over `processing_error`.
 *
 * Never throws — diagnostics must not cost a delivery (the route answers 200
 * regardless, vibecoding rule 6), and a failure here is logged, not raised.
 */
export async function journalUnparsedEnvelope(
  supabase: SupabaseClient,
  provider: string,
  envelope: UnparsedEnvelope,
): Promise<void> {
  try {
    const workspaceId = await resolveWorkspaceId(
      supabase,
      provider,
      envelope.externalAccountId,
    );

    const { error } = await supabase.from("webhook_events").insert({
      workspace_id: workspaceId,
      provider,
      external_event_id: unparsedEventKey(envelope),
      payload: envelope.rawEnvelope,
      // Terminal, not transient: today's code will refuse the same envelope
      // however often it is retried. `processed_at` is therefore set, keeping
      // the row out of the future reconciliation queue
      // (`webhook_events_processing_idx`), with the reason in
      // `processing_error` — the same convention `process-event.ts` uses for
      // an unknown channel_connection or an out-of-scope event type.
      processed_at: new Date().toISOString(),
      processing_error: envelope.reason,
    });

    if (error && !isUniqueViolation(error)) {
      console.error("[webhooks] failed to journal an unparsed envelope", error);
    }
  } catch (error) {
    console.error("[webhooks] failed to journal an unparsed envelope", error);
  }
}

/**
 * `unparsed:` + the provider's event id, or a digest of the envelope when it
 * did not carry one.
 *
 * The prefix is what keeps the journal honest. `webhook_events` is unique on
 * (provider, external_event_id), so a refusal stored under the bare event id
 * would make that event permanently unprocessable: once the adapter learns to
 * read it, a redelivery would collide with the refusal and be dropped as a
 * duplicate. Prefixed, the refusal and a later real processing of the same
 * event can both exist, while a redelivery that is still unreadable stays
 * idempotent.
 */
function unparsedEventKey(envelope: UnparsedEnvelope): string {
  if (envelope.providerEventId) {
    return `unparsed:${envelope.providerEventId}`;
  }

  // Nothing to be idempotent on: hash the envelope so a provider retry of the
  // same body collapses onto one row instead of piling up.
  const digest = createHash("sha256")
    .update(JSON.stringify(envelope.rawEnvelope))
    .digest("hex");

  return `unparsed:sha256:${digest}`;
}

/**
 * Attributes the row to a workspace when the envelope named an account we know.
 * `webhook_events.workspace_id` is nullable for exactly this case
 * (supabase/migrations/20260720140000_webhook_inbound_pipeline.sql): an
 * envelope we could not read may well name an account we have never seen, and
 * an unattributable delivery is still worth journaling.
 */
async function resolveWorkspaceId(
  supabase: SupabaseClient,
  provider: string,
  externalAccountId: string | null,
): Promise<string | null> {
  if (!externalAccountId) {
    return null;
  }

  const { data, error } = await supabase
    .from("channel_connections")
    .select("workspace_id")
    .eq("provider", provider)
    .eq("external_id", externalAccountId)
    .maybeSingle();

  if (error) {
    console.error(
      "[webhooks] failed to attribute an unparsed envelope to a workspace",
      error,
    );
    return null;
  }

  return (data?.workspace_id as string | undefined) ?? null;
}

/** Same SQLSTATE check as `process-event.ts`, kept local to avoid importing
 * the whole inbound pipeline (and its workflow dependencies) for three lines. */
function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === "23505";
}
