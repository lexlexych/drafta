import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  NormalizedCommentEvent,
  NormalizedConversationStartedEvent,
  NormalizedDirectMessageEvent,
  NormalizedEvent,
  NormalizedOutgoingMessageEvent,
  NormalizedPostPublishedEvent,
  NormalizedPostRef,
  NormalizedSender,
} from "@/lib/channels/types";
import { isAvatarStale } from "@/lib/avatars";
import {
  emitContactAvatarSyncRequested,
  emitPostThumbnailSyncRequested,
  emitPushNotifyRequested,
} from "@/lib/inngest/events";

/**
 * One normalized event → the DB side of §6.1's pipeline
 * (docs/architecture/07-data-flows.md#61-входящее-dm-или-комментарий):
 * `webhook_events` idempotency write, `channel_connection` resolution, then one
 * of three independent paths:
 *
 *   * `message.received` → contact/contact_identity, conversation, message,
 *     then the IDs-only `push/notify.requested`. A DM draft is never generated
 *     on arrival — the operator asks for one from the thread composer;
 *   * `comment.received` → contact/contact_identity, post, comment, then an
 *     IDs-only thumbnail lookup (the worker is a no-op once one is stored —
 *     which it usually is, since the comment payload brings the preview along).
 *     A comment draft is never generated on arrival;
 *   * `post.published` → the post row alone, so a freshly published post is
 *     listed with zero comments;
 *   * `conversation.started` / `message.sent` → the outbound half of a DM
 *     thread. Both exist for the same reason: a conversation can begin without
 *     any inbound message — a private reply to a comment opens one — and until
 *     these arrive it exists at the provider but nowhere in «Сообщения».
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

  if (event.type === "conversation.started") {
    await processConversationStarted({
      supabase,
      event,
      channelConnectionId: channelConnection.id,
      workspaceId: channelConnection.workspace_id,
      markProcessed,
      markUnprocessedWithError,
    });
    return;
  }

  if (event.type === "message.sent") {
    await processOutgoingMessage({
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
    const { contactIdentityId, contactId, avatarFetchedAt } =
      await upsertContactIdentity(
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
    await Promise.all([
      emitPushNotifyRequested({ messageId, conversationId, workspaceId }),
      ...(isAvatarStale(avatarFetchedAt)
        ? [
            emitContactAvatarSyncRequested({
              workspaceId,
              contactIdentityId,
              conversationId,
            }),
          ]
        : []),
    ]);
  } catch (error) {
    console.error("[webhooks] failed to process incoming direct message", error);
    await markUnprocessedWithError(describeError(error));
  }
}

/**
 * A comment arrival persists the post (if it isn't known yet), the author and
 * the comment. It then requests a cosmetic thumbnail lookup; comment drafts
 * remain explicitly requested from the «Комментарии» screen.
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

    // Fail-safe and IDs-only: the worker reloads the post and skips the Zernio
    // call when `thumbnail_url` is already present. If the provider does not
    // know the picture yet, the field stays null and a later comment retries.
    await emitPostThumbnailSyncRequested({ workspaceId, postId });
  } catch (error) {
    console.error("[webhooks] failed to process incoming comment", error);
    await markUnprocessedWithError(describeError(error));
  }
}

/**
 * Resolves the contact behind a thread's participant, when the provider named
 * one. Reuses the same identity key as the inbound path, so the person who
 * commented and the person we then DM'd stay one contact.
 */
async function resolveParticipantContactId(
  supabase: SupabaseClient,
  workspaceId: string,
  platform: string,
  participant: NormalizedSender | undefined,
): Promise<string | null> {
  if (!participant) {
    return null;
  }

  const { contactId } = await upsertContactIdentity(
    supabase,
    workspaceId,
    platform,
    participant,
  );

  return contactId;
}

/**
 * Attaches a contact to a thread that was created without one. The two events
 * can arrive in either order, and `message.sent` may not name the participant
 * at all, so whichever event knows the contact fills the gap.
 */
async function linkConversationContact(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  contactId: string | null,
): Promise<void> {
  if (!contactId) {
    return;
  }

  const { error } = await supabase
    .from("conversations")
    .update({ contact_id: contactId })
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .is("contact_id", null);

  if (error) {
    console.error("[webhooks] failed to link a conversation contact", error);
  }
}

/**
 * A DM thread appears for the first time. Nothing to insert beyond the
 * conversation itself: the messages arrive as their own events.
 */
async function processConversationStarted(params: {
  supabase: SupabaseClient;
  event: NormalizedConversationStartedEvent;
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
    const contactId = await resolveParticipantContactId(
      supabase,
      workspaceId,
      event.platform,
      event.participant,
    );

    const conversationId = await upsertConversation(
      supabase,
      workspaceId,
      channelConnectionId,
      contactId,
      event.conversation.externalId,
    );

    await linkConversationContact(
      supabase,
      workspaceId,
      conversationId,
      contactId,
    );
    await markProcessed(null);
  } catch (error) {
    console.error("[webhooks] failed to process a started conversation", error);
    await markUnprocessedWithError(describeError(error));
  }
}

/**
 * A message we sent, reported back by the provider.
 *
 * Most of these are ours and already sit in `messages` with the same
 * `external_id` — the insert below no-ops on them. The ones that are not are
 * exactly what makes this worth handling: a private reply to a comment, or a
 * reply typed in the provider's own dashboard, neither of which drafta would
 * otherwise show in the thread.
 */
async function processOutgoingMessage(params: {
  supabase: SupabaseClient;
  event: NormalizedOutgoingMessageEvent;
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
    const contactId = await resolveParticipantContactId(
      supabase,
      workspaceId,
      event.platform,
      event.participant,
    );

    const conversationId = await upsertConversation(
      supabase,
      workspaceId,
      channelConnectionId,
      contactId,
      event.conversation.externalId,
    );

    await linkConversationContact(
      supabase,
      workspaceId,
      conversationId,
      contactId,
    );
    await insertOutgoingMessageFromProvider(
      supabase,
      workspaceId,
      conversationId,
      event,
    );
    await markProcessed(null);
  } catch (error) {
    console.error("[webhooks] failed to process an outgoing message", error);
    await markUnprocessedWithError(describeError(error));
  }
}

/**
 * Every ID one message can be reported under.
 *
 * A provider does not necessarily answer a send with the same ID it later uses
 * in webhooks: Zernio's `sendInboxMessage` returns the *platform's* ID (which is
 * what `messages.external_id` then holds for everything drafta sent), while its
 * `message.sent` / delivery-status webhooks identify the same message by
 * Zernio's own. Matching on one key alone silently missed every echo of our own
 * sends and turned each into a second bubble in the thread.
 */
function messageExternalIds(message: {
  externalId: string;
  platformExternalId?: string;
}): string[] {
  const { externalId, platformExternalId } = message;

  return platformExternalId && platformExternalId !== externalId
    ? [externalId, platformExternalId]
    : [externalId];
}

/**
 * How long after a send its echo may still claim the row drafta created for it.
 * Generous on purpose: the window only has to cover the gap between the provider
 * accepting a send and the `send-message` pipeline recording the ID, and a row
 * that stayed without an ID for a quarter of an hour is not one we are racing
 * with anymore.
 */
const OUTGOING_ECHO_ADOPTION_WINDOW_MS = 15 * 60 * 1000;

/**
 * Records a provider-reported outgoing message, unless it is one drafta sent.
 *
 * Ours are recognized two ways, because there is a window in which neither alone
 * is enough:
 *
 *   * by ID — `messages.external_id` holds whichever ID the send endpoint
 *     answered with, so both of the event's IDs have to be tried
 *     (`messageExternalIds`);
 *   * by adoption — until the `send-message` pipeline's `mark-sent` step lands,
 *     the row has no ID at all, and an echo arriving in that gap would otherwise
 *     insert a duplicate next to it.
 *
 * Only what neither finds is genuinely from outside drafta — a private reply, or
 * an answer typed in the provider's own app — and that is what gets inserted.
 * Matching first (rather than relying on the unique index) also keeps the row's
 * own `delivery_status`: `delivered`/`read` may already have overtaken this event.
 */
async function insertOutgoingMessageFromProvider(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  event: NormalizedOutgoingMessageEvent,
): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from("messages")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .in("external_id", messageExternalIds(event.message))
    .limit(1)
    .maybeSingle();
  if (selectError) throw selectError;

  if (existing) {
    return;
  }

  if (
    await adoptPendingOutgoingMessage(
      supabase,
      workspaceId,
      conversationId,
      event,
    )
  ) {
    return;
  }

  const { error: insertError } = await supabase.from("messages").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    external_id: event.message.externalId,
    direction: "outgoing",
    text: event.message.text,
    attachments: event.message.attachments,
    delivery_status: "sent",
    provider_metadata: event.rawMetadata,
    sent_at: new Date().toISOString(),
  });

  if (insertError) {
    // Someone else won the race with the same external id — the row we wanted
    // exists, which is the outcome this function is after.
    if (isUniqueViolation(insertError)) return;
    throw insertError;
  }
}

/**
 * Claims the row drafta already created for this send, when the echo overtook
 * the pipeline that was about to stamp the provider's ID on it
 * (docs/architecture/07-data-flows.md#63-отправка-ответа). Without this an echo
 * arriving inside that gap is indistinguishable from a message sent elsewhere.
 *
 * Matched on the thread, the text and a time window, because in that gap the row
 * carries nothing else to match on. The `external_id is null` filter is what
 * keeps it honest: a row an earlier echo already claimed is invisible here, so
 * two identical replies sent in a row still adopt one row each.
 *
 * The stamped value is the *platform* ID — the same one `mark-sent` is about to
 * write — so the pipeline's own update stays idempotent instead of colliding
 * with `messages_conversation_external_id_key`. `delivery_status` is left alone
 * for the same reason: the row must stay `pending` for `mark-sent`'s guard.
 *
 * Returns true when the echo is accounted for and must not be inserted.
 */
async function adoptPendingOutgoingMessage(
  supabase: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  event: NormalizedOutgoingMessageEvent,
): Promise<boolean> {
  const text = event.message.text;

  // An attachment-only message carries no text to match on, and matching every
  // textless pending row against every textless echo would adopt the wrong one.
  if (!text) {
    return false;
  }

  const createdAfter = new Date(
    Date.now() - OUTGOING_ECHO_ADOPTION_WINDOW_MS,
  ).toISOString();

  const { data: candidate, error: selectError } = await supabase
    .from("messages")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outgoing")
    .eq("text", text)
    .is("external_id", null)
    .gte("created_at", createdAfter)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selectError) throw selectError;

  if (!candidate) {
    return false;
  }

  const { data: adopted, error: updateError } = await supabase
    .from("messages")
    .update({
      external_id:
        event.message.platformExternalId ?? event.message.externalId,
      provider_metadata: event.rawMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", candidate.id)
    .is("external_id", null)
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;

  if (!adopted) {
    // A concurrent echo claimed the same row between the select and the update.
    // The row exists and is one of ours either way, so inserting now would
    // recreate exactly the duplicate this function exists to prevent.
    console.warn(
      "[webhooks] an outgoing echo lost the race to adopt a pending message; not inserting a duplicate",
      { conversationId },
    );
  }

  return true;
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
    const postId = await upsertPost(
      supabase,
      workspaceId,
      channelConnectionId,
      event.post,
    );
    await markProcessed(null);
    await emitPostThumbnailSyncRequested({ workspaceId, postId });
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
): Promise<{
  contactIdentityId: string;
  contactId: string;
  avatarFetchedAt: string | null;
}> {
  const externalId = sender.externalId;

  const { data: existing, error: selectError } = await supabase
    .from("contact_identities")
    .select("id, contact_id, avatar_url, avatar_fetched_at")
    .eq("workspace_id", workspaceId)
    .eq("platform", platform)
    .eq("external_id", externalId)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) {
    const avatarFetchedAt = await refreshIdentityAvatar(
      supabase,
      existing.id,
      existing.avatar_url,
      existing.avatar_fetched_at,
      sender.avatarUrl,
    );
    return {
      contactIdentityId: existing.id,
      contactId: existing.contact_id,
      avatarFetchedAt,
    };
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
      avatar_url: sender.avatarUrl ?? null,
      avatar_fetched_at: sender.avatarUrl ? new Date().toISOString() : null,
    })
    .select("id, avatar_fetched_at")
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
        .select("id, contact_id, avatar_url, avatar_fetched_at")
        .eq("workspace_id", workspaceId)
        .eq("platform", platform)
        .eq("external_id", externalId)
        .single();
      if (winnerError || !winner) throw winnerError ?? identityError;
      const avatarFetchedAt = await refreshIdentityAvatar(
        supabase,
        winner.id,
        winner.avatar_url,
        winner.avatar_fetched_at,
        sender.avatarUrl,
      );
      return {
        contactIdentityId: winner.id,
        contactId: winner.contact_id,
        avatarFetchedAt,
      };
    }
    throw identityError;
  }

  return {
    contactIdentityId: newIdentity.id,
    contactId: newContact.id,
    avatarFetchedAt: newIdentity.avatar_fetched_at,
  };
}

async function refreshIdentityAvatar(
  supabase: SupabaseClient,
  contactIdentityId: string,
  currentAvatarUrl: string | null,
  currentFetchedAt: string | null,
  incomingAvatarUrl: string | undefined,
): Promise<string | null> {
  if (!incomingAvatarUrl) {
    return currentFetchedAt;
  }

  const fetchedAt = new Date().toISOString();
  if (incomingAvatarUrl === currentAvatarUrl && !isAvatarStale(currentFetchedAt)) {
    return currentFetchedAt;
  }

  const { error } = await supabase
    .from("contact_identities")
    .update({
      avatar_url: incomingAvatarUrl,
      avatar_fetched_at: fetchedAt,
      updated_at: fetchedAt,
    })
    .eq("id", contactIdentityId);

  if (error) {
    // Decorative data must never make a valid inbound message fail.
    console.error("[webhooks] failed to refresh a contact avatar", error);
    return currentFetchedAt;
  }

  return fetchedAt;
}

async function upsertConversation(
  supabase: SupabaseClient,
  workspaceId: string,
  channelConnectionId: string,
  // Nullable, unlike the inbound path: `message.sent` may not name the
  // participant, and the schema allows a thread without a contact. Whichever
  // event does know them attaches the contact afterwards.
  contactId: string | null,
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
 * post is new. An existing row is only *enriched*: which of the caption,
 * permalink, preview and publication time a provider reports differs per event
 * (and per how long its own sync has known the post), so a later event fills
 * the gaps and never blanks out what an earlier one already stored.
 */
async function upsertPost(
  supabase: SupabaseClient,
  workspaceId: string,
  channelConnectionId: string,
  post: NormalizedPostRef,
): Promise<string> {
  const { data: existing, error: selectError } = await supabase
    .from("posts")
    .select("id, text, permalink, thumbnail_url, published_at")
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
    if (post.thumbnailUrl && !existing.thumbnail_url) {
      enrichment.thumbnail_url = post.thumbnailUrl;
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
      thumbnail_url: post.thumbnailUrl ?? null,
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

    // Both IDs, for the same reason the outgoing echo needs both: a status for a
    // message drafta sent has to find a row keyed by the platform's ID.
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", conversation.id)
      .in("external_id", messageExternalIds(event.message))
      .limit(1)
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
