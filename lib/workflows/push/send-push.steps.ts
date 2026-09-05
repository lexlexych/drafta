import "server-only";

import { createAdminSupabaseClient } from "@/lib/db/admin";
import {
  listInstantSubscriptions,
  pruneSubscription,
  type PushSubscriptionRecord,
} from "@/lib/db/push-subscriptions";
import { sendWebPush, type WebPushPayload } from "@/lib/push/web-push";

export type SendPushInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
};

export type SendPushResult =
  | { status: "sent"; delivered: number; pruned: number }
  | {
      status: "skipped";
      reason: "conversation-not-found" | "message-not-found" | "no-recipients";
    };

/**
 * Loaded once by `load-context`. Carries only names/channel/kind (allowed in a
 * push payload, §11) — **never** the message text, which stays out of the
 * Apple/Google push infrastructure (data-minimization).
 */
export type LoadedPushContext = {
  conversationId: string;
  senderName: string;
  channelName: string;
  recipients: PushSubscriptionRecord[];
};

export type LoadPushContextResult =
  | { status: "ok"; context: LoadedPushContext }
  | { status: "skip"; reason: Extract<SendPushResult, { status: "skipped" }>["reason"] };

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }
  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

export async function loadPushContext(
  input: SendPushInput,
): Promise<LoadPushContextResult> {
  "use step";

  const supabase = createAdminSupabaseClient();

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, channel_connection_id, contact_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.conversationId)
    .maybeSingle();
  assertQuerySucceeded(conversationError, "Loading push conversation");

  if (!conversation) {
    return { status: "skip", reason: "conversation-not-found" };
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .select("id, contact_identity_id")
    .eq("workspace_id", input.workspaceId)
    .eq("conversation_id", input.conversationId)
    .eq("id", input.messageId)
    .maybeSingle();
  assertQuerySucceeded(messageError, "Loading push message");

  if (!message) {
    return { status: "skip", reason: "message-not-found" };
  }

  const recipients = await listInstantSubscriptions(input.workspaceId);
  if (recipients.length === 0) {
    return { status: "skip", reason: "no-recipients" };
  }

  // Имя автора: сначала identity конкретного сообщения, затем контакт
  // диалога, иначе — обобщённо.
  const [{ data: identity, error: identityError }, { data: channel, error: channelError }, contactResult] =
    await Promise.all([
      message.contact_identity_id
        ? supabase
            .from("contact_identities")
            .select("display_name")
            .eq("workspace_id", input.workspaceId)
            .eq("id", message.contact_identity_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("channel_connections")
        .select("name")
        .eq("workspace_id", input.workspaceId)
        .eq("id", conversation.channel_connection_id)
        .maybeSingle(),
      conversation.contact_id
        ? supabase
            .from("contacts")
            .select("display_name")
            .eq("workspace_id", input.workspaceId)
            .eq("id", conversation.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  assertQuerySucceeded(identityError, "Loading push author identity");
  assertQuerySucceeded(channelError, "Loading push channel");
  assertQuerySucceeded(contactResult.error, "Loading push contact");

  const senderName =
    (typeof identity?.display_name === "string" && identity.display_name.trim()) ||
    (typeof contactResult.data?.display_name === "string" &&
      contactResult.data.display_name.trim()) ||
    "Новый контакт";
  const channelName =
    (typeof channel?.name === "string" && channel.name.trim()) || "канал";

  return {
    status: "ok",
    context: {
      conversationId: input.conversationId,
      senderName,
      channelName,
      recipients,
    },
  };
}

/**
 * Push copy (docs/architecture/11-realtime-pwa.md#частота-уведомлений):
 * «{имя} ({канал}) — Новое сообщение». Only names, channel label and a
 * deep-link — no message text.
 *
 * It announces the arrival itself, not a draft: drafts are generated on request
 * from the thread composer, so there is nothing ready to announce when the
 * message lands. Instant pushes stay a direct-message thing — a comment draft
 * only ever exists because the user asked for it while looking at the post.
 */
export function buildInstantPayload(
  context: LoadedPushContext,
): WebPushPayload {
  return {
    title: `${context.senderName} (${context.channelName})`,
    body: "Новое сообщение",
    // Deep-link uses the `conversation` query key (see (shell)/_components/navigation.ts).
    url: `/inbox?conversation=${context.conversationId}`,
    tag: `conversation:${context.conversationId}`,
  };
}
loadPushContext.maxRetries = 3;

/**
 * Одна доставка на получателя. Мёртвые подписки (404/410) вычищаются здесь же
 * и ошибкой не считаются; настоящая ошибка доставки логируется и не роняет
 * остальных получателей — пропущенного всё равно догонит дайджест.
 */
export async function deliverInstantPush(input: {
  context: LoadedPushContext;
  payload: WebPushPayload;
}): Promise<{ delivered: number; pruned: number }> {
  "use step";

  let delivered = 0;
  let pruned = 0;

  for (const recipient of input.context.recipients) {
    const result = await sendWebPush(
      {
        endpoint: recipient.endpoint,
        p256dh: recipient.p256dh,
        authKey: recipient.authKey,
      },
      input.payload,
    );

    if (result.status === "sent") {
      delivered += 1;
    } else if (result.status === "expired") {
      await pruneSubscription(recipient.id);
      pruned += 1;
    } else {
      console.error("[send-push] delivery error", {
        endpoint: recipient.endpoint,
        message: result.message,
      });
    }
  }

  return { delivered, pruned };
}
deliverInstantPush.maxRetries = 3;
