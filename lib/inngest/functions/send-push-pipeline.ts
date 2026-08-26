import "server-only";

import { createAdminSupabaseClient } from "@/lib/db/admin";
import {
  listInstantSubscriptions,
  pruneSubscription,
  type PushSubscriptionRecord,
} from "@/lib/db/push-subscriptions";
import {
  sendWebPush,
  type WebPushPayload,
  type WebPushSendResult,
  type WebPushTarget,
} from "@/lib/push/web-push";

export type SendPushPipelineInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
};

export type SendPushPipelineResult =
  | { status: "sent"; delivered: number; pruned: number }
  | {
      status: "skipped";
      reason: "conversation-not-found" | "message-not-found" | "no-recipients";
    };

export type SendPushSteps = {
  run<T>(id: string, handler: () => Promise<T> | T): Promise<T>;
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
  | { status: "skip"; reason: Extract<SendPushPipelineResult, { status: "skipped" }>["reason"] };

export type SendPushDependencies = {
  loadContext(input: SendPushPipelineInput): Promise<LoadPushContextResult>;
  send(target: WebPushTarget, payload: WebPushPayload): Promise<WebPushSendResult>;
  prune(id: string): Promise<void>;
};

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }
  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

async function loadContext(
  input: SendPushPipelineInput,
): Promise<LoadPushContextResult> {
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

export const sendPushDependencies: SendPushDependencies = {
  loadContext,
  send: sendWebPush,
  prune: pruneSubscription,
};

/**
 * `send-push` pipeline (docs/architecture/11-realtime-pwa.md#web-push): load
 * names/channel + instant recipients → send one push each → prune dead
 * subscriptions (404/410). Sends run through Inngest with retries (vibecoding
 * rule 8). A dead-subscription prune is not an error; a genuine send error is
 * left to surface so the function's retry can re-attempt.
 */
export async function runSendPushPipeline(
  input: SendPushPipelineInput,
  steps: SendPushSteps,
  dependencies: SendPushDependencies = sendPushDependencies,
): Promise<SendPushPipelineResult> {
  const loaded = await steps.run("load-context", () =>
    dependencies.loadContext(input),
  );
  if (loaded.status === "skip") {
    return { status: "skipped", reason: loaded.reason };
  }

  const payload = buildInstantPayload(loaded.context);

  const outcome = await steps.run("send", async () => {
    let delivered = 0;
    let pruned = 0;
    for (const recipient of loaded.context.recipients) {
      const result = await dependencies.send(
        {
          endpoint: recipient.endpoint,
          p256dh: recipient.p256dh,
          authKey: recipient.authKey,
        },
        payload,
      );
      if (result.status === "sent") {
        delivered += 1;
      } else if (result.status === "expired") {
        await dependencies.prune(recipient.id);
        pruned += 1;
      } else {
        // Log and continue: one bad endpoint must not block the rest. The
        // digest still covers anyone missed here.
        console.error("[send-push] delivery error", {
          endpoint: recipient.endpoint,
          message: result.message,
        });
      }
    }
    return { delivered, pruned };
  });

  return { status: "sent", delivered: outcome.delivered, pruned: outcome.pruned };
}
