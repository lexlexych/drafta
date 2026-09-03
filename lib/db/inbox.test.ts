import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// `inbox.ts` imports `"server-only"`, which throws outside a Next.js build —
// same reason `channel-connections.test.ts` (T-04) neutralizes the marker
// package before importing the module under test.
vi.mock("server-only", () => ({}));

// These DB-backed tests need a live local Supabase (`supabase start`,
// `supabase db reset`) reachable through the same env vars production code
// reads (lib/db/env.ts / lib/db/admin.ts) — skipped (not failed) otherwise,
// same convention as lib/db/channel-connections.test.ts (T-04) so `npm test`
// stays green in a fresh clone.
const hasLocalSupabaseConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY,
);

if (!hasLocalSupabaseConfig) {
  console.warn(
    "[inbox.test.ts] skipping DB-backed tests — set NEXT_PUBLIC_SUPABASE_URL, " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY to a running local Supabase " +
      "(`supabase start`, values from `supabase status`) to run them.",
  );
}

describe.skipIf(!hasLocalSupabaseConfig)("lib/db/inbox", () => {
  let supabase: SupabaseClient;
  let getInboxNavigationCounters: typeof import("./inbox").getInboxNavigationCounters;
  let getChannelFiltersView: typeof import("./inbox").getChannelFiltersView;
  let getConversationListView: typeof import("./inbox").getConversationListView;
  let getThreadView: typeof import("./inbox").getThreadView;
  let getOlderThreadMessages: typeof import("./inbox").getOlderThreadMessages;
  let MESSAGE_PAGE_SIZE: typeof import("./inbox").MESSAGE_PAGE_SIZE;
  let markConversationRead: typeof import("./inbox").markConversationRead;
  let listChannelConnections: typeof import("./channel-connections").listChannelConnections;
  const workspaceIdsToClean: string[] = [];

  beforeAll(async () => {
    ({
      getInboxNavigationCounters,
      getChannelFiltersView,
      getConversationListView,
      getThreadView,
      getOlderThreadMessages,
      MESSAGE_PAGE_SIZE,
      markConversationRead,
    } = await import("./inbox"));
    ({ listChannelConnections } = await import("./channel-connections"));
    const { createAdminSupabaseClient } = await import("./admin");
    // Admin (service_role) client — bypasses RLS on purpose, same rationale
    // as channel-connections.test.ts: these tests exercise the business
    // logic in inbox.ts (sorting, filtering, aggregation, mapping), not RLS
    // itself. RLS isolation is covered separately by
    // tests/rls/isolation.integration.ts (`npm run test:rls`), extended by
    // this ticket with a `markConversationRead` cross-workspace case.
    supabase = createAdminSupabaseClient();
  });

  afterEach(async () => {
    // workspaces cascade-delete everything below (docs/architecture/06-data-model.md
    // "все связи от workspace вниз — с каскадным удалением").
    while (workspaceIdsToClean.length > 0) {
      const workspaceId = workspaceIdsToClean.pop();
      await supabase.from("workspaces").delete().eq("id", workspaceId);
    }
  });

  async function createTestWorkspace(): Promise<string> {
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ name: `T-05 test ${randomUUID()}` })
      .select("id")
      .single();
    if (error) throw error;
    workspaceIdsToClean.push(data.id);
    return data.id;
  }

  async function createChannel(
    workspaceId: string,
    overrides: { name?: string; platform?: string; externalId?: string } = {},
  ): Promise<string> {
    const { data, error } = await supabase
      .from("channel_connections")
      .insert({
        workspace_id: workspaceId,
        name: overrides.name ?? "Test Channel",
        provider: "zernio",
        platform: overrides.platform ?? "telegram",
        external_id: overrides.externalId ?? `ext-${randomUUID()}`,
        capabilities: { responseWindowHours: 24 },
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function createContact(workspaceId: string, displayName: string): Promise<string> {
    const { data, error } = await supabase
      .from("contacts")
      .insert({ workspace_id: workspaceId, display_name: displayName })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function createConversation(
    workspaceId: string,
    channelId: string,
    contactId: string,
    overrides: { lastIncomingAt?: string; unreadCount?: number; externalId?: string } = {},
  ): Promise<string> {
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        channel_connection_id: channelId,
        contact_id: contactId,
        external_id: overrides.externalId ?? `conv-${randomUUID()}`,
        status: "open",
        last_incoming_at: overrides.lastIncomingAt ?? new Date().toISOString(),
        unread_count: overrides.unreadCount ?? 0,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function createMessage(
    workspaceId: string,
    conversationId: string,
    overrides: {
      direction?: "incoming" | "outgoing";
      text?: string;
      createdAt?: string;
      externalId?: string;
      attachments?: unknown[];
    } = {},
  ): Promise<string> {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        external_id: overrides.externalId ?? `msg-${randomUUID()}`,
        direction: overrides.direction ?? "incoming",
        text: overrides.text ?? "Hello",
        attachments: overrides.attachments ?? [],
        delivery_status: "received",
        created_at: overrides.createdAt ?? new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  it("sorts the conversation list by last_incoming_at desc", async () => {
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId);
    const contactAlice = await createContact(workspaceId, "Alice");
    const contactBob = await createContact(workspaceId, "Bob");

    const older = await createConversation(workspaceId, channelId, contactAlice, {
      lastIncomingAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const newer = await createConversation(workspaceId, channelId, contactBob, {
      lastIncomingAt: new Date().toISOString(),
    });
    // Список показывает только треды, в которых что-то есть, — см. вью
    // `conversation_list_entries` (20260903100000).
    await createMessage(workspaceId, older);
    await createMessage(workspaceId, newer);

    const channels = await listChannelConnections(supabase, workspaceId);
    const list = await getConversationListView(supabase, workspaceId, channels);

    expect(list.items.map((item) => item.id)).toEqual([newer, older]);
  });

  it("filters the conversation list to one channel_connection", async () => {
    const workspaceId = await createTestWorkspace();
    const channelA = await createChannel(workspaceId, {
      name: "Telegram A",
      externalId: "chan-a",
    });
    const channelB = await createChannel(workspaceId, {
      name: "Telegram B",
      externalId: "chan-b",
    });
    const contactId = await createContact(workspaceId, "Alice");

    const conversationA = await createConversation(workspaceId, channelA, contactId);
    const conversationB = await createConversation(workspaceId, channelB, contactId);
    // Оба треда непустые: иначе B выпал бы из списка сам по себе и тест
    // зеленел бы, ничего не проверив про фильтр.
    await createMessage(workspaceId, conversationA);
    await createMessage(workspaceId, conversationB);

    const channels = await listChannelConnections(supabase, workspaceId);
    const list = await getConversationListView(supabase, workspaceId, channels, {
      channelIds: [channelA],
    });

    expect(list.items.map((item) => item.id)).toEqual([conversationA]);
    expect(list.title).toBe("Telegram A");
  });

  it("keeps two connections of the same platform distinct in the channel filters (T-05 step 6)", async () => {
    const workspaceId = await createTestWorkspace();
    const shop = await createChannel(workspaceId, {
      name: "Telegram Shop",
      platform: "telegram",
      externalId: "shop",
    });
    const support = await createChannel(workspaceId, {
      name: "Telegram Support",
      platform: "telegram",
      externalId: "support",
    });
    const contactId = await createContact(workspaceId, "Alice");
    await createConversation(workspaceId, shop, contactId, { unreadCount: 1 });
    await createConversation(workspaceId, support, contactId, { unreadCount: 2 });

    const channels = await listChannelConnections(supabase, workspaceId);
    const filters = await getChannelFiltersView(supabase, workspaceId, channels);

    expect(
      filters
        .map((filter) => ({ name: filter.name, count: filter.count }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ).toEqual([
      { name: "Telegram Shop", count: 1 },
      { name: "Telegram Support", count: 2 },
    ]);
  });

  it("aggregates total and per-channel unread for the nav counters", async () => {
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId);
    const contactId = await createContact(workspaceId, "Alice");
    await createConversation(workspaceId, channelId, contactId, { unreadCount: 3 });
    await createConversation(workspaceId, channelId, contactId, { unreadCount: 2 });

    const channels = await listChannelConnections(supabase, workspaceId);
    const counters = await getInboxNavigationCounters(supabase, workspaceId, channels);

    expect(counters.totalUnread).toBe(5);
    expect(counters.channels).toHaveLength(1);
    expect(counters.channels[0].unreadCount).toBe(5);
  });

  it("returns thread messages chronologically, mapping direction and attachments", async () => {
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId, { platform: "instagram" });
    const contactId = await createContact(workspaceId, "Alice Attach");
    const conversationId = await createConversation(workspaceId, channelId, contactId);

    await createMessage(workspaceId, conversationId, {
      text: "First",
      createdAt: new Date(Date.now() - 120_000).toISOString(),
    });
    await createMessage(workspaceId, conversationId, {
      direction: "outgoing",
      text: "Reply",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await createMessage(workspaceId, conversationId, {
      text: "",
      createdAt: new Date().toISOString(),
      attachments: [{ type: "image", fileName: "photo.jpg" }],
    });

    const channels = await listChannelConnections(supabase, workspaceId);
    const thread = await getThreadView(supabase, workspaceId, channels, conversationId);

    expect(thread).not.toBeNull();
    expect(thread?.messages.map((message) => message.text)).toEqual(["First", "Reply", ""]);
    expect(thread?.messages.map((message) => message.direction)).toEqual([
      "in",
      "out",
      "in",
    ]);
    expect(thread?.messages[2]?.attachmentName).toBe("photo.jpg");
    // No real categories/drafts at this stage — see this ticket's
    // "Существенные факты" and lib/db/inbox.ts's module docstring.
    expect(thread?.categories).toEqual([]);
    expect(thread?.draft).toBeNull();
  });

  it("hides a conversation that has no messages yet", async () => {
    // Подключение WhatsApp приносит `conversation.started` на каждый тред
    // синхронизированной истории, но без самих сообщений. Такие строки — шум:
    // ни превью, ни повода открывать. Диалог не удаляется и появится в списке
    // сам, как только в него придёт первое сообщение.
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId);
    const contactId = await createContact(workspaceId, "+491512345678");
    const empty = await createConversation(workspaceId, channelId, contactId);
    const withMessage = await createConversation(workspaceId, channelId, contactId);
    await createMessage(workspaceId, withMessage);

    const channels = await listChannelConnections(supabase, workspaceId);
    const list = await getConversationListView(supabase, workspaceId, channels);

    expect(list.items.map((item) => item.id)).toEqual([withMessage]);
    expect(list.items.map((item) => item.id)).not.toContain(empty);
    // Счётчик страницы тоже считает по вью, иначе пагинация обещала бы строки,
    // которых в списке нет.
    expect(list.total).toBe(1);
  });

  it("previews a conversation with its last message, not its first", async () => {
    // Превью читается из вью `conversation_message_previews`: по строке на
    // диалог вместо «загрузить всю историю и свести в JS».
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId);
    const contactId = await createContact(workspaceId, "Petra Preview");
    const conversationId = await createConversation(workspaceId, channelId, contactId);

    await createMessage(workspaceId, conversationId, {
      text: "Первый вопрос",
      createdAt: new Date(Date.now() - 120_000).toISOString(),
    });
    await createMessage(workspaceId, conversationId, {
      direction: "outgoing",
      text: "Наш ответ",
      createdAt: new Date().toISOString(),
    });

    const channels = await listChannelConnections(supabase, workspaceId);
    const list = await getConversationListView(supabase, workspaceId, channels, {});
    const item = list.items.find((entry) => entry.id === conversationId);

    expect(item?.preview).toBe("Вы: Наш ответ");
  });

  /** Переписка длиннее страницы: `count` сообщений через минуту друг от друга. */
  async function createLongThread(count: number) {
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId, { platform: "instagram" });
    const contactId = await createContact(workspaceId, "Paula Page");
    const conversationId = await createConversation(workspaceId, channelId, contactId);
    const start = Date.now() - count * 60_000;

    for (let index = 0; index < count; index += 1) {
      await createMessage(workspaceId, conversationId, {
        text: `Message ${index}`,
        createdAt: new Date(start + index * 60_000).toISOString(),
      });
    }

    return { workspaceId, conversationId };
  }

  it("opens a long thread on its last page, not on the whole history", async () => {
    const total = MESSAGE_PAGE_SIZE + 5;
    const { workspaceId, conversationId } = await createLongThread(total);

    const channels = await listChannelConnections(supabase, workspaceId);
    const thread = await getThreadView(supabase, workspaceId, channels, conversationId);

    expect(thread?.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    // Хвост переписки в хронологии: последнее сообщение — последним.
    expect(thread?.messages[0]?.text).toBe("Message 5");
    expect(thread?.messages[MESSAGE_PAGE_SIZE - 1]?.text).toBe(
      `Message ${total - 1}`,
    );
    expect(thread?.hasMoreBefore).toBe(true);
  });

  it("walks the thread upwards by cursor until it runs out", async () => {
    const total = MESSAGE_PAGE_SIZE + 5;
    const { workspaceId, conversationId } = await createLongThread(total);

    const channels = await listChannelConnections(supabase, workspaceId);
    const thread = await getThreadView(supabase, workspaceId, channels, conversationId);
    const oldest = thread!.messages[0]!;

    const older = await getOlderThreadMessages(supabase, workspaceId, conversationId, {
      createdAt: oldest.createdAt,
      id: oldest.id,
    });

    expect(older.items.map((message) => message.text)).toEqual([
      "Message 0",
      "Message 1",
      "Message 2",
      "Message 3",
      "Message 4",
    ]);
    // Курсор исключающий: сообщение, от которого листали, повторно не приезжает.
    expect(older.items.some((message) => message.id === oldest.id)).toBe(false);
    expect(older.hasMoreBefore).toBe(false);
  });

  it("splits messages sharing a created_at deterministically, by id", async () => {
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId, { platform: "instagram" });
    const contactId = await createContact(workspaceId, "Tie Break");
    const conversationId = await createConversation(workspaceId, channelId, contactId);
    // Все в одну отметку времени: без тай-брейка по id страница и подгрузка
    // могли бы вернуть одно и то же сообщение дважды — или потерять его.
    const sameMoment = new Date().toISOString();
    const total = MESSAGE_PAGE_SIZE + 1;

    for (let index = 0; index < total; index += 1) {
      await createMessage(workspaceId, conversationId, {
        text: `Same ${index}`,
        createdAt: sameMoment,
      });
    }

    const channels = await listChannelConnections(supabase, workspaceId);
    const thread = await getThreadView(supabase, workspaceId, channels, conversationId);
    const oldest = thread!.messages[0]!;
    const older = await getOlderThreadMessages(supabase, workspaceId, conversationId, {
      createdAt: oldest.createdAt,
      id: oldest.id,
    });

    expect(thread?.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(older.items).toHaveLength(1);
    expect(older.hasMoreBefore).toBe(false);

    const seen = new Set(
      [...thread!.messages, ...older.items].map((message) => message.id),
    );
    expect(seen.size).toBe(total);
  });

  it("marks a conversation read, resetting unread_count to 0", async () => {
    const workspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId);
    const contactId = await createContact(workspaceId, "Alice");
    const conversationId = await createConversation(workspaceId, channelId, contactId, {
      unreadCount: 4,
    });

    const result = await markConversationRead(supabase, workspaceId, conversationId);
    expect(result.ok).toBe(true);

    const { data } = await supabase
      .from("conversations")
      .select("unread_count")
      .eq("id", conversationId)
      .single();
    expect(data?.unread_count).toBe(0);
  });

  it("scopes markConversationRead to the given workspace id — a foreign workspace id can't touch someone else's conversation", async () => {
    const workspaceId = await createTestWorkspace();
    const foreignWorkspaceId = await createTestWorkspace();
    const channelId = await createChannel(workspaceId);
    const contactId = await createContact(workspaceId, "Alice");
    const conversationId = await createConversation(workspaceId, channelId, contactId, {
      unreadCount: 4,
    });

    const result = await markConversationRead(supabase, foreignWorkspaceId, conversationId);
    expect(result.ok).toBe(false);

    const { data } = await supabase
      .from("conversations")
      .select("unread_count")
      .eq("id", conversationId)
      .single();
    expect(data?.unread_count).toBe(4);
  });
});
