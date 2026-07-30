import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  NormalizedCommentEvent,
  NormalizedDirectMessageEvent,
  NormalizedEvent,
  NormalizedPostPublishedEvent,
  NormalizedPostRef,
  NormalizedSender,
} from "@/lib/channels/types";
import { emitInteractionReceived } from "@/lib/inngest/events";

/**
 * One normalized event → the DB side of §6.1's pipeline
 * (docs/architecture/07-data-flows.md#61-входящее-dm-или-комментарий):
 * `webhook_events` idempotency write, `channel_connection` resolution, then one
 * of three independent paths:
 *
 *   * `message.received` → contact/contact_identity, conversation, message,
 *     `interaction/received` (the DM draft pipeline debounces and generates);
 *   * `comment.received` → contact/contact_identity, post, comment. **No
 *     Inngest event**: a comment draft is never generated on arrival, only when
 *     the user asks for it from the «Комментарии» screen;
 *   * `post.published` → the post row alone, so a freshly published post is
 *     listed with zero comments.
 *
 * Delivery statuses update an existing message; anything else is journaled and
 * skipped. Called once per event returned by the adapter's `parseWebhook` — see
 * `app/api/webhooks/[provider]/route.ts`.
 *
 * `supabase` is untyped (`SupabaseClient` without a generated `Database`
 * generic) because this repo has no generated types yet — same as every
 * other Supabase client factory in `lib/db/`.
 *
 * Never throws: every branch that can fail catches its own errors, logs,
 * and (depending on whether the failure is a permanent business outcome or
 * a transient one worth a future retry — see `markProcessed`/
 * `markUnprocessedWithError` below) marks the `webhook_events` row
 * accordingly. The route always answers 200 once signature verification and
 * JSON parsing succeeded (vibecoding rule 6) — this function's job is to
 * make sure nothing is silently lost, not to decide the HTTP response.
 */
export async function processInboundEvent(
  supabase: SupabaseClient,
  event: NormalizedEvent,
): Promise<void> {
  const { data: channelConnection, error: channelConnectionError } =
    await supabase
      .from("channel_connections")
      .select("id, workspace_id, status")
      .eq("provider", event.provider)
      .eq("external_id", event.externalAccountId)
      .maybeSingle();

  if (channelConnectionError) {
    // A lookup failure here means we don't reliably know the workspace —
    // don't guess; log and drop this one event without journaling it.
    // Rare (DB connectivity), and the event isn't lost: Zernio's own retry
    // will redeliver it, and the (still-empty) webhook_events row means
    // that redelivery won't be mistaken for a duplicate.
    console.error(
      "[webhooks] failed to look up channel_connection",
      channelConnectionError,
    );
    return;
  }

  const workspaceId: string | null = channelConnection?.workspace_id ?? null;

  const { data: webhookEventRow, error: insertError } = await supabase
    .from("webhook_events")
    .insert({
      workspace_id: workspaceId,
      provider: event.provider,
      external_event_id: event.providerEventId,
      payload: event.rawMetadata,
    })
    .select("id")
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      // Same (provider, providerEventId) already journaled — a Zernio retry
      // of a delivery we've already seen. Idempotent no-op, regardless of
      // whether the first attempt succeeded, errored, or is mid-flight.
      return;
    }

    console.error(
      "[webhooks] failed to write webhook_events journal row",
      insertError,
    );
    return;
  }

  const webhookEventId: string = webhookEventRow.id;

  const markProcessed = async (processingError: string | null) => {
    const { error } = await supabase
      .from("webhook_events")
      .update({
        processed_at: new Date().toISOString(),
        processing_error: processingError,
      })
      .eq("id", webhookEventId);

    if (error) {
      console.error(
        "[webhooks] failed to mark webhook_events row processed",
        error,
      );
    }
  };

  // Left unprocessed on purpose (processed_at stays null) so a future
  // reconciliation pass can retry — see `webhook_events_processing_idx`
  // (supabase/migrations/20260720103000_create_schema_v1.sql) and the
  // `reconcile-webhooks` cron listed as a later stage
  // (docs/architecture/07-data-flows.md#66-полный-список-inngest-функций).
  // Reserved for genuinely transient failures (a DB write erroring
  // mid-pipeline), not for definitive business outcomes like an unknown
  // channel_connection or an out-of-scope event type — those are terminal
  // regardless of when they're retried, so they use `markProcessed` instead.
  const markUnprocessedWithError = async (processingError: string) => {
    const { error } = await supabase
      .from("webhook_events")
      .update({ processing_error: processingError })
      .eq("id", webhookEventId);

    if (error) {
      console.error(
        "[webhooks] failed to record webhook_events processing error",
        error,
      );
    }
  };

  if (!channelConnection) {
    await markProcessed(
      `Unknown channel_connection for provider "${event.provider}" external account id "${event.externalAccountId}"`,
    );
    return;
  }

  if (channelConnection.status !== "active") {
    await markProcessed(
      `channel_connection "${channelConnection.id}" is not active (status: "${channelConnection.status}")`,
    );
    return;
  }

  if (event.type === "message.received") {
    await processIncomingDirectMessage({
      supabase,
      event,
      channelConnectionId: channelConnection.id,
      workspaceId: channelConnection.workspace_id,
      markProcessed,
      markUnprocessedWithError,
    });
    return;
  }

  if (event.type === "comment.received") {
    await processIncomingComment({
      supabase,
      event,
      channelConnectionId: channelConnection.id,
      workspaceId: channelConnection.workspace_id,
      markProcessed,
      markUnprocessedWithError,
    });
    return;
  }

  if (event.type === "post.published") {
    await processPublishedPost({
      supabase,
      event,
      channelConnectionId: channelConnection.id,
      workspaceId: channelConnection.workspace_id,
      markProcessed,
      markUnprocessedWithError,
    });
    return;
  }

  const deliveryStatus = DELIVERY_STATUS_BY_EVENT_TYPE[event.type];
  if (deliveryStatus) {
    await processDeliveryStatusUpdate({
      supabase,
      event,
      channelConnectionId: channelConnection.id,
      deliveryStatus,
      markProcessed,
      markUnprocessedWithError,
    });
    return;
  }

  // A real, well-formed normalized event this route doesn't handle (e.g.
  // reactions, if a future adapter emits them into the normalized union).
  // Journaled, not an error.
  await markProcessed(
    `Event type "${event.type}" is not processed at this stage`,
  );
}

const DELIVERY_STATUS_BY_EVENT_TYPE: Partial<
  Record<NormalizedEvent["type"], "delivered" | "read" | "failed">
> = {
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};

type MarkProcessed = (processingError: string | null) => Promise<void>;
type MarkUnprocessedWithError = (processingError: string) => Promise<void>;

async function processIncomingDirectMessage(params: {
  supabase: SupabaseClient;
  event: NormalizedDirectMessageEvent;
  channelConnectionId: string;
  workspaceId: string;
  markProcessed: MarkProcessed;
  markUnprocessedWithError: MarkUnprocessedWithError;
}): Promise<void> {
  const {
    supabase,
    event,
    channelConnectionId,
    workspaceId,
    markProcessed,
    markUnprocessedWithError,
  } = params;

  try {
    const { contactIdentityId, contactId } = await upsertContactIdentity(
      supabase,
      workspaceId,
      event.platform,
      event.message.sender,
    );

    const conversationId = await upsertConversation(
      supabase,
      workspaceId,
      channelConnectionId,
      contactId,
      event.conversation.externalId,
    );

    const messageId = await insertIncomingMessage(
      supabase,
      workspaceId,
      conversationId,
      contactIdentityId,
      event,
    );

    await markProcessed(null);

    // Fail-safe by design (docs/architecture/14-vibecoding-rules.md#7) —
    // never allowed to turn a persisted message into a failed webhook. The
    // event payload is IDs-only.
    await emitInteractionReceived({ messageId, conversationId, workspaceId });
  } catch (error) {
    console.error("[webhooks] failed to process incoming direct message", error);
    await markUnprocessedWithError(describeError(error));
  }
}

/**
 * A comment arrival persists the post (if it isn't known yet), the author and
 * the comment — and stops there. Comment drafts are explicitly requested from
 * the «Комментарии» screen, so nothing is emitted to Inngest here.
 */
async function processIncomingComment(params: {
  supabase: SupabaseClient;
  event: NormalizedCommentEvent;
  channelConnectionId: string;
  workspaceId: string;
  markProcessed: MarkProcessed;
  markUnprocessedWithError: MarkUnprocessedWithError;
}): Promise<void> {
  const {
    supabase,
    event,
    channelConnectionId,
    workspaceId,
    markProcessed,
    markUnprocessedWithError,
  } = params;

  try {
    // A post's comments have many different authors — each new one becomes its
    // own identity/contact, the same way a DM's single author does.
    const { contactIdentityId } = await upsertContactIdentity(
      supabase,
      workspaceId,
      event.platform,
      event.comment.author,
    );

    const postId = await upsertPost(
      supabase,
      workspaceId,
      channelConnectionId,
      event.post,
    );

    await insertIncomingComment(
      supabase,
      workspaceId,
      postId,
      contactIdentityId,
      event,
    );

    await markProcessed(null);
  } catch (error) {
    console.error("[webhooks] failed to process incoming comment", error);
    await markUnprocessedWithError(describeError(error));
  }
}

/** A post goes live: it appears in «Комментарии» right away, with no comments. */
async function processPublishedPost(params: {
  supabase: SupabaseClient;
  event: NormalizedPostPublishedEvent;
  channelConnectionId: string;
  workspaceId: string;
  markProcessed: MarkProcessed;
  markUnprocessedWithError: MarkUnprocessedWithError;
}): Promise<void> {
  const {
    supabase,
    event,
    channelConnectionId,
    workspaceId,
    markProcessed,
    markUnprocessedWithError,
  } = params;

  try {
    await upsertPost(supabase, workspaceId, channelConnectionId, event.post);
    await markProcessed(null);
  } catch (error) {
    console.error("[webhooks] failed to process published post", error);
    await markUnprocessedWithError(describeError(error));
  }
}

async function upsertContactIdentity(
  supabase: SupabaseClient,
  workspaceId: string,
  platform: string,
  sender: NormalizedSender,
): Promise<{ contactIdentityId: string; contactId: string }> {
  const externalId = sender.externalId;

  const { data: existing, error: selectError } = await supabase
    .from("contact_identities")
    .select("id, contact_id")
    .eq("workspace_id", workspaceId)
    .eq("platform", platform)
    .eq("external_id", externalId)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) {
    return { contactIdentityId: existing.id, contactId: existing.contact_id };
  }

  // New identity → new contact (docs/architecture/06-data-model.md#contact_identities:
  // "склейка" of two contacts is a manual, later UI action, not automatic here).
  const displayName = sender.displayName?.trim() || externalId;

  const { data: newContact, error: contactError } = await supabase
    .from("contacts")
    .insert({ workspace_id: workspaceId, display_name: displayName })
    .select("id")
    .single();
  if (contactError) throw contactError;

  const { data: newIdentity, error: identityError } = await supabase
    .from("contact_identities")
    .insert({
      workspace_id: workspaceId,
      contact_id: newContact.id,
      platform,
      external_id: externalId,
      display_name: sender.displayName ?? null,
    })
    .select("id")
    .single();

  if (identityError) {
    if (isUniqueViolation(identityError)) {
      // Lost a race with a concurrent webhook creating the same identity —
      // re-select the winner. The `contact` row just created above becomes
      // an unused orphan (harmless: nothing references it, no constraint
      // violation) rather than something worth a multi-statement
      // transaction for at this scope.
      const { data: winner, error: winnerError } = await supabase
        .from("contact_identities")
        .select("id, contact_id")
        .eq("workspace_id", workspaceId)
        .eq("platform", platform)
        .eq("external_id", externalId)
        .single();
      if (winnerError || !winner) throw winnerError ?? identityError;
      return { contactIdentityId: winner.id, contactId: winner.contact_id };
    }
    throw identityError;
  }

  return { contactIdentityId: newIdentity.id, contactId: newContact.id };
}

async function upsertConversation(
  supabase: SupabaseClient,
  workspaceId: string,
  channelConnectionId: string,
  contactId: string,
  externalId: string,
): Promise<string> {
  const { data: existing, error: selectError } = await supabase
    .from("conversations")
    .select("id")
    .eq("channel_connection_id", channelConnectionId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from("conversations")
    .insert({
      workspace_id: workspaceId,
      channel_connection_id: channelConnectionId,
      contact_id: contactId,
      external_id: externalId,
      status: "open",
    })
    .select("id")
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      const { data: winner, error: winnerError } = await supabase
        .from("conversations")
        .select("id")
        .eq("channel_connection_id", channelConnectionId)
        .eq("external_id", externalId)
        .single();
      if (winnerError || !winner) throw winnerError ?? insertError;
      return winner.id;
    }
    throw insertError;
  }

  return created.id;
}

/**
 * Resolves the post row for a normalized post reference, creating it when the
 * post is new. An existing row is only *enriched*: `post.published` carries the
 * caption and permalink, `comment.received` carries neither, and a comment on
 * an older post must never blank out what a publish event already stored.
 */
async function upsertPost(
  supabase: SupabaseClient,
  workspaceId: string,
  channelConnectionId: string,
  post: NormalizedPostRef,
): Promise<string> {
  const { data: existing, error: selectError } = await supabase
    .from("posts")
    .select("id, text, permalink, published_at")
    .eq("channel_connection_id", channelConnectionId)
    .eq("external_id", post.externalId)
    .maybeSingle();
  if (selectError) throw selectError;

  if (existing) {
    const enrichment: Record<string, unknown> = {};
    if (post.text?.trim() && !existing.text?.trim()) {
      enrichment.text = post.text;
    }
    if (post.permalink && !existing.permalink) {
      enrichment.permalink = post.permalink;
    }
    if (post.publishedAt && !existing.published_at) {
      enrichment.published_at = post.publishedAt;
    }

    if (Object.keys(enrichment).length > 0) {
      enrichment.updated_at = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("posts")
        .update(enrichment)
        .eq("id", existing.id);
      if (updateError) throw updateError;
    }

    return existing.id;
  }

  const { data: created, error: insertError } = await supabase
    .from("posts")
    .insert({
      workspace_id: workspaceId,
      channel_connection_id: channelConnectionId,
      external_id: post.externalId,
      text: post.text ?? "",
      permalink: post.permalink ?? null,
      published_at: post.publishedAt ?? null,
      metadata: post.metadata ?? {},
    })
    .select("id")
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      const { data: winner, error: winnerError } = await supabase
        .from("posts")
        .select("id")
        .eq("channel_connection_id", channelConnectionId)
        .eq("external_id", post.externalId)
        .single();
      if (winnerError || !winner) throw winnerError ?? insertError;
      return winner.id;
    }
    throw insertError;
  }

  return created.id;
}

async function insertIncomingMessage(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  contactIdentityId: string,
  event: NormalizedDirectMessageEvent,
): Promise<string> {
  const { data: created, error: insertError } = await supabase
    .from("messages")
    .insert({
      workspace_id: workspaceId,
      conversation_id: conversationId,
      contact_identity_id: contactIdentityId,
      external_id: event.message.externalId,
      direction: "incoming",
      text: event.message.text,
      attachments: event.message.attachments,
      delivery_status: "received",
      provider_metadata: event.rawMetadata,
    })
    .select("id")
    .single();

  if (!insertError) {
    // Genuinely new message — and only a genuinely new message — bumps the
    // conversation's counters. A duplicate (below) must not double-count.
    await bumpConversationOnNewIncomingMessage(supabase, conversationId);
    return created.id;
  }

  if (isUniqueViolation(insertError)) {
    // (conversation_id, external_id) already exists — per T-03 step 2,
    // skip without error; this webhook delivery is a true no-op.
    const { data: existing, error: selectError } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("external_id", event.message.externalId)
      .single();
    if (selectError || !existing) throw selectError ?? insertError;
    return existing.id;
  }

  throw insertError;
}

async function insertIncomingComment(
  supabase: SupabaseClient,
  workspaceId: string,
  postId: string,
  contactIdentityId: string,
  event: NormalizedCommentEvent,
): Promise<string> {
  const { data: created, error: insertError } = await supabase
    .from("comments")
    .insert({
      workspace_id: workspaceId,
      post_id: postId,
      contact_identity_id: contactIdentityId,
      external_id: event.comment.externalId,
      parent_external_id: event.comment.parentExternalId ?? null,
      direction: "incoming",
      text: event.comment.text,
      attachments: event.comment.attachments,
      delivery_status: "received",
      provider_metadata: event.rawMetadata,
    })
    .select("id")
    .single();

  if (!insertError) {
    await bumpPostOnNewComment(supabase, postId);
    return created.id;
  }

  if (isUniqueViolation(insertError)) {
    const { data: existing, error: selectError } = await supabase
      .from("comments")
      .select("id")
      .eq("post_id", postId)
      .eq("external_id", event.comment.externalId)
      .single();
    if (selectError || !existing) throw selectError ?? insertError;
    return existing.id;
  }

  throw insertError;
}

async function bumpConversationOnNewIncomingMessage(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<void> {
  // Atomic `unread_count = unread_count + 1` on the Postgres side (see
  // supabase/migrations/20260720150000_bump_conversation_unread_count_rpc.sql).
  // A client-side select-then-update pair here is not atomic across two
  // PostgREST round trips and loses updates under concurrent webhook
  // delivery for the same conversation (T-03 review finding) — the RPC call
  // is a single SQL statement, so Postgres serializes concurrent increments
  // of the same row instead of two requests racing on a stale read.
  const { error } = await supabase.rpc("bump_conversation_unread_count", {
    target_conversation_id: conversationId,
  });
  if (error) throw error;
}

/** Same atomic-increment reasoning as the DM counter, for `posts`. */
async function bumpPostOnNewComment(
  supabase: SupabaseClient,
  postId: string,
): Promise<void> {
  const { error } = await supabase.rpc("bump_post_unread_count", {
    target_post_id: postId,
  });
  if (error) throw error;
}

async function processDeliveryStatusUpdate(params: {
  supabase: SupabaseClient;
  event: NormalizedDirectMessageEvent;
  channelConnectionId: string;
  deliveryStatus: "delivered" | "read" | "failed";
  markProcessed: MarkProcessed;
  markUnprocessedWithError: MarkUnprocessedWithError;
}): Promise<void> {
  const {
    supabase,
    event,
    channelConnectionId,
    deliveryStatus,
    markProcessed,
    markUnprocessedWithError,
  } = params;

  try {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id")
      .eq("channel_connection_id", channelConnectionId)
      .eq("external_id", event.conversation.externalId)
      .maybeSingle();
    if (conversationError) throw conversationError;

    if (!conversation) {
      await markProcessed(
        `No conversation found for delivery status update (external id "${event.conversation.externalId}")`,
      );
      return;
    }

    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", conversation.id)
      .eq("external_id", event.message.externalId)
      .maybeSingle();
    if (messageError) throw messageError;

    if (!message) {
      await markProcessed(
        `No message found for delivery status update (external id "${event.message.externalId}")`,
      );
      return;
    }

    const { error: updateError } = await supabase
      .from("messages")
      .update({ delivery_status: deliveryStatus })
      .eq("id", message.id);
    if (updateError) throw updateError;

    await markProcessed(null);
  } catch (error) {
    console.error(
      "[webhooks] failed to process delivery status update",
      error,
    );
    await markUnprocessedWithError(describeError(error));
  }
}

function isUniqueViolation(error: { code?: string }): boolean {
  // Postgres SQLSTATE for unique_violation — stable across Postgres
  // versions, unlike PostgREST's prose error message.
  return error.code === "23505";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown processing error";
}
