import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// `route.ts` transitively imports `lib/channels/zernio/index.ts` and
// `lib/db/admin.ts`, both `import "server-only"` — which throws outside a
// Next.js build (see lib/channels/zernio/index.test.ts's precedent for why
// those files are tested via source-text assertions rather than import).
// Neutralizing the marker package itself lets *this* file import the real
// route and exercise real signature verification, real parsing, and a real
// Supabase admin client against local Supabase — the "route handler
// вызывается напрямую" integration tests T-03 step 5 asks for.
vi.mock("server-only", () => ({}));

// Emission is asserted at the unit level in lib/inngest/events.test.ts
// (exact payload shape, fail-safe on rejection). Mocked here too so the
// route suite can (a) assert the route passes the right IDs through without
// depending on network access to a real Inngest endpoint, and (b) prove a
// rejected emission still lets the webhook answer 200 with the message
// already persisted — see the "Inngest emission failure" test below.
const emitInteractionReceivedMock = vi.fn().mockResolvedValue(undefined);
const emitContactAvatarSyncRequestedMock = vi.fn().mockResolvedValue(undefined);
const emitPostThumbnailSyncRequestedMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/inngest/events", () => ({
  emitInteractionReceived: (...args: unknown[]) => emitInteractionReceivedMock(...args),
  emitContactAvatarSyncRequested: (...args: unknown[]) =>
    emitContactAvatarSyncRequestedMock(...args),
  emitPostThumbnailSyncRequested: (...args: unknown[]) =>
    emitPostThumbnailSyncRequestedMock(...args),
}));

const ZERNIO_WEBHOOK_SECRET = "test-zernio-webhook-secret";
process.env.ZERNIO_WEBHOOK_SECRET = ZERNIO_WEBHOOK_SECRET;

// These DB-backed integration tests need a live local Supabase
// (`supabase start`, `supabase db reset` — see this ticket's Definition of
// Done) reachable through the same env vars production code reads
// (lib/db/env.ts / lib/db/admin.ts). Skipped (not failed) when they aren't
// set, so `npm test` stays green in a fresh clone that hasn't run
// `supabase start` yet — DB-dependent tests in this repo are opt-in via env
// (see tests/rls/setup.ts for the same idea applied to the RLS suite,
// though that one is gated behind a separate `test:rls` script; these are
// gated by env presence instead because T-03's Definition of Done runs them
// under plain `npm test`).
const hasLocalSupabaseConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY,
);

if (!hasLocalSupabaseConfig) {
  console.warn(
    "[route.test.ts] skipping DB-backed webhook route tests — set NEXT_PUBLIC_SUPABASE_URL, " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY to a running local Supabase " +
      "(`supabase start`, values from `supabase status`) to run them.",
  );
}

function readFixture(name: string): string {
  return readFileSync(
    join(process.cwd(), "lib/channels/zernio/__fixtures__", name),
    "utf8",
  );
}

function signBody(rawBody: string): string {
  return createHmac("sha256", ZERNIO_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
}

/** A minimal, schema-shaped Zernio DM envelope for scenarios that need a
 * payload not covered by lib/channels/zernio/__fixtures__ (e.g. an account
 * id guaranteed not to match any channel_connection). Same shape as the
 * real fixtures — see lib/channels/zernio/parse.ts's documented envelope. */
function buildEnvelope(overrides: {
  id: string;
  event?: string;
  accountId: string;
  platform?: string;
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  text?: string;
  participantPicture?: string;
}): string {
  return JSON.stringify({
    id: overrides.id,
    event: overrides.event ?? "message.received",
    timestamp: new Date().toISOString(),
    account: { id: overrides.accountId, platform: overrides.platform ?? "telegram" },
    conversation: {
      id: overrides.conversationId,
      platformConversationId: overrides.conversationId,
      participantPicture: overrides.participantPicture,
    },
    message: {
      id: overrides.messageId,
      conversationId: overrides.conversationId,
      platform: overrides.platform ?? "telegram",
      platformMessageId: overrides.messageId,
      direction: "incoming",
      text: overrides.text ?? "Test message",
      attachments: [],
      sender: { id: overrides.senderId, name: overrides.senderName },
      sentAt: new Date().toISOString(),
      isRead: false,
    },
  });
}

describe.skipIf(!hasLocalSupabaseConfig)("POST /api/webhooks/[provider] (zernio)", () => {
  let POST: typeof import("./route").POST;
  let supabase: SupabaseClient;
  const workspaceIdsToClean: string[] = [];

  beforeAll(async () => {
    ({ POST } = await import("./route"));
    const { createAdminSupabaseClient } = await import("@/lib/db/admin");
    supabase = createAdminSupabaseClient();
  });

  afterEach(async () => {
    emitInteractionReceivedMock.mockClear();
    emitContactAvatarSyncRequestedMock.mockClear();

    // workspaces cascade-delete channel_connections/contacts/contact_identities/
    // conversations/messages/posts/comments/webhook_events (docs/architecture/06-data-model.md
    // "все связи от workspace вниз — с каскадным удалением") — one delete per
    // test workspace is enough to fully clean up.
    while (workspaceIdsToClean.length > 0) {
      const workspaceId = workspaceIdsToClean.pop();
      await supabase.from("workspaces").delete().eq("id", workspaceId);
    }
  });

  async function postZernioWebhook(rawBody: string, signatureOverride?: string) {
    const request = new NextRequest("http://localhost/api/webhooks/zernio", {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "x-zernio-signature": signatureOverride ?? signBody(rawBody),
      },
    });

    return POST(request, { params: Promise.resolve({ provider: "zernio" }) });
  }

  async function createTestWorkspace(): Promise<string> {
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ name: `T-03 test ${randomUUID()}` })
      .select("id")
      .single();
    if (error) throw error;
    workspaceIdsToClean.push(data.id);
    return data.id;
  }

  async function createTestChannelConnection(
    workspaceId: string,
    options: { platform: string; externalId: string; status?: string },
  ): Promise<string> {
    const { data, error } = await supabase
      .from("channel_connections")
      .insert({
        workspace_id: workspaceId,
        name: "Test channel",
        provider: "zernio",
        platform: options.platform,
        external_id: options.externalId,
        status: options.status ?? "active",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  it("happy path: a DM webhook creates contact, contact_identity, conversation, message and bumps last_incoming_at/unread_count", async () => {
    const workspaceId = await createTestWorkspace();
    await createTestChannelConnection(workspaceId, {
      platform: "telegram",
      externalId: "acct_tg_98213",
    });
    const rawBody = readFixture("telegram-dm.json");

    const response = await postZernioWebhook(rawBody);
    expect(response.status).toBe(200);

    const { data: contactIdentity } = await supabase
      .from("contact_identities")
      .select("id, contact_id, platform, external_id, display_name")
      .eq("workspace_id", workspaceId)
      .eq("platform", "telegram")
      .eq("external_id", "tg_user_44310")
      .single();
    expect(contactIdentity).toBeTruthy();

    const { data: contact } = await supabase
      .from("contacts")
      .select("id, display_name")
      .eq("id", contactIdentity!.contact_id)
      .single();
    expect(contact?.display_name).toBe("Anna Keller");

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, external_id, contact_id, last_incoming_at, unread_count")
      .eq("workspace_id", workspaceId)
      .eq("external_id", "tg_chat_77120")
      .single();
    expect(conversation?.contact_id).toBe(contact!.id);
    expect(conversation?.last_incoming_at).not.toBeNull();
    expect(conversation?.unread_count).toBe(1);

    const { data: message } = await supabase
      .from("messages")
      .select("id, direction, text, delivery_status, contact_identity_id, external_id")
      .eq("conversation_id", conversation!.id)
      .eq("external_id", "tg_msg_55210")
      .single();
    expect(message?.direction).toBe("incoming");
    expect(message?.text).toContain("режим работы сегодня");
    expect(message?.delivery_status).toBe("received");
    expect(message?.contact_identity_id).toBe(contactIdentity!.id);

    const { data: webhookEvent } = await supabase
      .from("webhook_events")
      .select("workspace_id, processed_at, processing_error")
      .eq("provider", "zernio")
      .eq("external_event_id", "wh_evt_01HZXTELEGRAM0001")
      .single();
    expect(webhookEvent?.workspace_id).toBe(workspaceId);
    expect(webhookEvent?.processed_at).not.toBeNull();
    expect(webhookEvent?.processing_error).toBeNull();

    // Rule 7 (docs/architecture/14-vibecoding-rules.md#7): only IDs cross
    // into the Inngest payload — see lib/inngest/events.test.ts for the
    // exact-keys check; here we confirm the route wires the *right* IDs
    // through (not e.g. the workspace's other conversation, or nothing).
    expect(emitInteractionReceivedMock).toHaveBeenCalledWith({
      messageId: message!.id,
      conversationId: conversation!.id,
      workspaceId,
    });
    expect(emitContactAvatarSyncRequestedMock).toHaveBeenCalledWith({
      contactIdentityId: contactIdentity!.id,
      conversationId: conversation!.id,
      workspaceId,
    });
  });

  it("stores participantPicture from an Instagram DM without scheduling an API lookup", async () => {
    const workspaceId = await createTestWorkspace();
    await createTestChannelConnection(workspaceId, {
      platform: "instagram",
      externalId: "acct_ig_avatar_1",
    });
    const avatarUrl = "https://scontent-fra3-1.cdninstagram.com/avatar.jpg?sig=1";
    const response = await postZernioWebhook(
      buildEnvelope({
        id: "wh_evt_avatar_1",
        accountId: "acct_ig_avatar_1",
        platform: "instagram",
        conversationId: "ig_conversation_avatar_1",
        messageId: "ig_message_avatar_1",
        senderId: "ig_sender_avatar_1",
        senderName: "Avatar Contact",
        participantPicture: avatarUrl,
      }),
    );

    expect(response.status).toBe(200);
    const { data: identity } = await supabase
      .from("contact_identities")
      .select("avatar_url, avatar_fetched_at")
      .eq("workspace_id", workspaceId)
      .eq("external_id", "ig_sender_avatar_1")
      .single();
    expect(identity?.avatar_url).toBe(avatarUrl);
    expect(identity?.avatar_fetched_at).not.toBeNull();
    expect(emitContactAvatarSyncRequestedMock).not.toHaveBeenCalled();
  });

  it("idempotency: delivering the same webhook twice processes it once (one webhook_events row, one message)", async () => {
    const workspaceId = await createTestWorkspace();
    await createTestChannelConnection(workspaceId, {
      platform: "telegram",
      externalId: "acct_tg_98213",
    });
    const rawBody = readFixture("telegram-dm.json");

    const first = await postZernioWebhook(rawBody);
    const second = await postZernioWebhook(rawBody);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const { data: webhookEvents } = await supabase
      .from("webhook_events")
      .select("id")
      .eq("provider", "zernio")
      .eq("external_event_id", "wh_evt_01HZXTELEGRAM0001");
    expect(webhookEvents).toHaveLength(1);

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, unread_count")
      .eq("workspace_id", workspaceId)
      .eq("external_id", "tg_chat_77120")
      .single();
    expect(conversation?.unread_count).toBe(1); // not double-counted

    const { data: messages } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", conversation!.id)
      .eq("external_id", "tg_msg_55210");
    expect(messages).toHaveLength(1);

    // Only the first delivery reaches Inngest — the second is a pure
    // idempotency no-op (docs/architecture/07-data-flows.md#61).
    expect(emitInteractionReceivedMock).toHaveBeenCalledTimes(1);
  });

  it("two messages from the same sender: one contact, one conversation, two messages", async () => {
    const workspaceId = await createTestWorkspace();
    await createTestChannelConnection(workspaceId, {
      platform: "whatsapp",
      externalId: "acct_wa_31207",
    });

    const first = await postZernioWebhook(readFixture("whatsapp-dm.json"));
    const second = await postZernioWebhook(readFixture("whatsapp-dm-with-attachment.json"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const { data: contactIdentities } = await supabase
      .from("contact_identities")
      .select("id, contact_id")
      .eq("workspace_id", workspaceId)
      .eq("platform", "whatsapp")
      .eq("external_id", "wa_user_60214");
    expect(contactIdentities).toHaveLength(1);

    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, unread_count")
      .eq("workspace_id", workspaceId)
      .eq("external_id", "wa_chat_12938");
    expect(conversations).toHaveLength(1);
    expect(conversations![0].unread_count).toBe(2);

    const { data: messages } = await supabase
      .from("messages")
      .select("id, external_id, attachments")
      .eq("conversation_id", conversations![0].id);
    expect(messages).toHaveLength(2);
    const withAttachment = messages!.find((m) => m.external_id === "wa_msg_88422");
    expect(withAttachment?.attachments).toEqual([
      { type: "image", url: "https://media.zernio.com/wa/acct_wa_31207/img_5f3c1a.jpg" },
    ]);
  });

  it("invalid signature: 401 and nothing written to the database", async () => {
    const rawBody = buildEnvelope({
      id: "wh_evt_test_invalid_signature_0001",
      accountId: "acct_test_invalid_sig",
      conversationId: "conv_invalid_sig",
      messageId: "msg_invalid_sig",
      senderId: "sender_invalid_sig",
      senderName: "Invalid Signature Sender",
    });

    const response = await postZernioWebhook(rawBody, "0".repeat(64));
    expect(response.status).toBe(401);

    const { data: webhookEvents } = await supabase
      .from("webhook_events")
      .select("id")
      .eq("provider", "zernio")
      .eq("external_event_id", "wh_evt_test_invalid_signature_0001");
    expect(webhookEvents).toHaveLength(0);

    const { data: messages } = await supabase
      .from("messages")
      .select("id")
      .eq("external_id", "msg_invalid_sig");
    expect(messages).toHaveLength(0);

    expect(emitInteractionReceivedMock).not.toHaveBeenCalled();
  });

  it("unknown external account id: 200, webhook_event journaled with an error, no message created", async () => {
    const rawBody = buildEnvelope({
      id: "wh_evt_test_unknown_account_0001",
      accountId: "acct_does_not_exist_in_any_workspace",
      conversationId: "conv_unknown_account",
      messageId: "msg_unknown_account",
      senderId: "sender_unknown_account",
      senderName: "Unknown Account Sender",
    });

    const response = await postZernioWebhook(rawBody);
    expect(response.status).toBe(200);

    const { data: webhookEvent } = await supabase
      .from("webhook_events")
      .select("workspace_id, processed_at, processing_error")
      .eq("provider", "zernio")
      .eq("external_event_id", "wh_evt_test_unknown_account_0001")
      .single();
    expect(webhookEvent?.workspace_id).toBeNull();
    expect(webhookEvent?.processed_at).not.toBeNull();
    expect(webhookEvent?.processing_error).toMatch(/unknown channel_connection/i);

    const { data: messages } = await supabase
      .from("messages")
      .select("id")
      .eq("external_id", "msg_unknown_account");
    expect(messages).toHaveLength(0);

    expect(emitInteractionReceivedMock).not.toHaveBeenCalled();
  });

  it("unknown provider: 404", async () => {
    const request = new NextRequest("http://localhost/api/webhooks/does-not-exist", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request, {
      params: Promise.resolve({ provider: "does-not-exist" }),
    });
    expect(response.status).toBe(404);
  });

  it("Inngest emission failure is fail-safe: the webhook still returns 200 and the message is still persisted", async () => {
    emitInteractionReceivedMock.mockRejectedValueOnce(new Error("inngest down"));

    const workspaceId = await createTestWorkspace();
    await createTestChannelConnection(workspaceId, {
      platform: "telegram",
      externalId: "acct_tg_98213",
    });

    // emitInteractionReceived itself never rejects by contract (see
    // lib/inngest/events.ts / events.test.ts) — this mock deliberately
    // bypasses that contract to prove there's a second layer of defense:
    // even a rejecting emitter (lib/webhooks/process-event.ts's own
    // try/catch around the whole DM pipeline) must not turn into a failed
    // webhook or a lost message.
    const response = await postZernioWebhook(readFixture("telegram-dm.json"));

    expect(response.status).toBe(200);
    const { data: message } = await supabase
      .from("messages")
      .select("id")
      .eq("external_id", "tg_msg_55210");
    expect(message).toHaveLength(1);
  });

  it("inactive channel_connection: 200, webhook_event journaled with an error, no message created", async () => {
    const workspaceId = await createTestWorkspace();
    await createTestChannelConnection(workspaceId, {
      platform: "telegram",
      externalId: "acct_tg_disconnected",
      status: "disconnected",
    });
    const rawBody = buildEnvelope({
      id: "wh_evt_test_inactive_channel_0001",
      accountId: "acct_tg_disconnected",
      conversationId: "conv_inactive_channel",
      messageId: "msg_inactive_channel",
      senderId: "sender_inactive_channel",
      senderName: "Inactive Channel Sender",
    });

    const response = await postZernioWebhook(rawBody);
    expect(response.status).toBe(200);

    const { data: webhookEvent } = await supabase
      .from("webhook_events")
      .select("workspace_id, processed_at, processing_error")
      .eq("provider", "zernio")
      .eq("external_event_id", "wh_evt_test_inactive_channel_0001")
      .single();
    // Unlike the "unknown account" case, the channel_connection *was* found
    // — its workspace is known and attributed even though the channel is
    // disconnected (docs/epics/epic_02/T-03-webhook-inbound.md step 2).
    expect(webhookEvent?.workspace_id).toBe(workspaceId);
    expect(webhookEvent?.processed_at).not.toBeNull();
    expect(webhookEvent?.processing_error).toMatch(/not active/i);

    const { data: messages } = await supabase
      .from("messages")
      .select("id")
      .eq("external_id", "msg_inactive_channel");
    expect(messages).toHaveLength(0);
    expect(emitInteractionReceivedMock).not.toHaveBeenCalled();
  });

  it(
    "concurrent webhooks for the same conversation: unread_count is not lost under a race " +
      "(regression for the T-03 review finding)",
    async () => {
      const workspaceId = await createTestWorkspace();
      await createTestChannelConnection(workspaceId, {
        platform: "telegram",
        externalId: "acct_tg_concurrent",
      });

      // Mirrors the reviewer's manual repro: many distinct messages from the
      // same sender into a brand-new conversation, delivered concurrently
      // (not one-by-one like every other test in this file). Before the fix,
      // bumpConversationOnNewIncomingMessage did a `select unread_count` then
      // `update ... + 1` as two separate PostgREST round trips — interleaved
      // awaits across these concurrent requests raced on a stale read and
      // lost increments (empirically: 20 concurrent messages left
      // unread_count at 9 instead of 20).
      const MESSAGE_COUNT = 20;
      const responses = await Promise.all(
        Array.from({ length: MESSAGE_COUNT }, (_, index) =>
          postZernioWebhook(
            buildEnvelope({
              id: `wh_evt_test_concurrent_${index}`,
              accountId: "acct_tg_concurrent",
              conversationId: "conv_concurrent",
              messageId: `msg_concurrent_${index}`,
              senderId: "sender_concurrent",
              senderName: "Concurrent Sender",
            }),
          ),
        ),
      );

      for (const response of responses) {
        expect(response.status).toBe(200);
      }

      const { data: conversation } = await supabase
        .from("conversations")
        .select("id, unread_count")
        .eq("workspace_id", workspaceId)
        .eq("external_id", "conv_concurrent")
        .single();

      const { data: messages } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversation!.id);
      expect(messages).toHaveLength(MESSAGE_COUNT);

      // The atomic `bump_conversation_unread_count` RPC
      // (supabase/migrations/20260720150000_bump_conversation_unread_count_rpc.sql)
      // must account for every one of the concurrently delivered messages.
      expect(conversation?.unread_count).toBe(MESSAGE_COUNT);
    },
    20000,
  );

  it("delivery status update: message.delivered updates an existing message's delivery_status", async () => {
    const workspaceId = await createTestWorkspace();
    await createTestChannelConnection(workspaceId, {
      platform: "telegram",
      externalId: "acct_tg_98213",
    });

    // Seed the message via a real message.received delivery first.
    const receivedResponse = await postZernioWebhook(readFixture("telegram-dm.json"));
    expect(receivedResponse.status).toBe(200);

    const deliveredBody = buildEnvelope({
      id: "wh_evt_test_delivery_status_0001",
      event: "message.delivered",
      accountId: "acct_tg_98213",
      conversationId: "tg_chat_77120",
      messageId: "tg_msg_55210", // same message external id as the seeded one
      senderId: "tg_user_44310",
      senderName: "Anna Keller",
    });
    const deliveredResponse = await postZernioWebhook(deliveredBody);
    expect(deliveredResponse.status).toBe(200);

    const { data: message } = await supabase
      .from("messages")
      .select("delivery_status")
      .eq("workspace_id", workspaceId)
      .eq("external_id", "tg_msg_55210")
      .single();
    expect(message?.delivery_status).toBe("delivered");

    const { data: webhookEvent } = await supabase
      .from("webhook_events")
      .select("processed_at, processing_error")
      .eq("provider", "zernio")
      .eq("external_event_id", "wh_evt_test_delivery_status_0001")
      .single();
    expect(webhookEvent?.processed_at).not.toBeNull();
    expect(webhookEvent?.processing_error).toBeNull();
  });
});
