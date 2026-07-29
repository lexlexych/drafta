import { describe, expect, it } from "vitest";

import { mockWorkspaceData } from "./data";
import {
  getContactCard,
  getConversationList,
  getDashboard,
  getNavigationCounters,
  getPostThread,
  getThread,
} from "./index";

const data = mockWorkspaceData;

describe("mock data referential integrity", () => {
  const channelIds = new Set(data.channelConnections.map((entry) => entry.id));
  const categoryIds = new Set(data.categories.map((entry) => entry.id));
  const contactIds = new Set(data.contacts.map((entry) => entry.id));
  const identityIds = new Set(data.contactIdentities.map((entry) => entry.id));
  const conversationIds = new Set(data.conversations.map((entry) => entry.id));
  const messageIds = new Set(data.messages.map((entry) => entry.id));

  it("scopes every row to the single mock workspace", () => {
    const rows = [
      ...data.members,
      ...data.invitations,
      ...data.channelConnections,
      ...data.categories,
      ...data.contacts,
      ...data.contactIdentities,
      ...data.conversations,
      ...data.messages,
      ...data.drafts,
      data.aiSettings,
      data.notificationSettings,
    ];

    rows.forEach((row) => {
      expect(row.workspace_id).toBe(data.workspace.id);
    });
  });

  it("keeps conversation references valid", () => {
    data.conversations.forEach((conversation) => {
      expect(channelIds.has(conversation.channel_connection_id)).toBe(true);

      if (conversation.kind === "dm") {
        expect(conversation.contact_id).not.toBeNull();
        expect(contactIds.has(conversation.contact_id ?? "")).toBe(true);
        expect(conversation.post).toBeNull();
      } else {
        expect(conversation.contact_id).toBeNull();
        expect(conversation.post).not.toBeNull();
      }
    });
  });

  it("keeps message references valid", () => {
    data.messages.forEach((message) => {
      expect(conversationIds.has(message.conversation_id)).toBe(true);

      if (message.direction === "in") {
        expect(identityIds.has(message.contact_identity_id ?? "")).toBe(true);
      }

      if (message.parent_message_id !== null) {
        expect(messageIds.has(message.parent_message_id)).toBe(true);
      }
    });
  });

  it("keeps identity references valid", () => {
    data.contactIdentities.forEach((identity) => {
      expect(contactIds.has(identity.contact_id)).toBe(true);
      expect(channelIds.has(identity.channel_connection_id)).toBe(true);
    });
  });

  it("ties every draft to a conversation and its message range", () => {
    data.drafts.forEach((draft) => {
      expect(conversationIds.has(draft.conversation_id)).toBe(true);

      const first = data.messages.find(
        (message) => message.id === draft.first_message_id,
      );
      const last = data.messages.find(
        (message) => message.id === draft.last_message_id,
      );

      expect(first?.conversation_id).toBe(draft.conversation_id);
      expect(last?.conversation_id).toBe(draft.conversation_id);
    });
  });

  it("points every conversation category at a knowledge base category", () => {
    data.conversations.forEach((conversation) => {
      conversation.matched_kb_file_ids.forEach((id) => {
        expect(categoryIds.has(id)).toBe(true);
      });
    });
  });
});

describe("mock selectors", () => {
  it("counts unread per section and channel", () => {
    const counters = getNavigationCounters();
    const dmTotal = data.conversations
      .filter((conversation) => conversation.kind === "dm")
      .reduce((total, conversation) => total + conversation.unread_count, 0);

    expect(counters.dmUnread).toBe(dmTotal);
    expect(
      counters.channels.reduce((total, channel) => total + channel.dmUnread, 0),
    ).toBe(dmTotal);
  });

  it("filters conversation lists by channel and category", () => {
    const all = getConversationList("dm");
    const channelId = data.channelConnections[0].id;
    const filtered = getConversationList("dm", { channelId });

    expect(all.items.length).toBeGreaterThan(filtered.items.length);
    filtered.items.forEach((item) => {
      expect(item.channel.id).toBe(channelId);
    });

    // Категория, которую не назвал ни один черновик, не даёт ни одной беседы.
    const unused = data.categories.find(
      (category) =>
        !data.conversations.some((conversation) =>
          conversation.matched_kb_file_ids.includes(category.id),
        ),
    );
    const unusedFiltered = getConversationList("dm", {
      categoryId: unused?.id,
    });

    expect(unused).toBeDefined();
    expect(unusedFiltered.items).toHaveLength(0);
  });

  it("builds a dm thread with draft and debounce note", () => {
    const thread = getThread("cnv_dm_anna_ig");

    expect(thread?.messages).toHaveLength(3);
    expect(thread?.draft?.status).toBe("ready");
    expect(thread?.debounceNote).toContain("дебаунс");
    expect(thread?.replyWindowLabel).toContain("Окно ответа");
  });

  it("builds a post thread with the draft target marked", () => {
    const post = getPostThread("cnv_post_sea_ig");
    const target = post?.comments.find((comment) => comment.isDraftTarget);
    const ours = post?.comments.find((comment) => comment.isOurs);

    expect(target?.authorHandle).toBe("@dashkov.art");
    expect(ours?.isReply).toBe(true);
    expect(post?.draft?.referenceText).toContain("@dashkov.art");
  });

  it("builds a contact card with cross-channel history", () => {
    const card = getContactCard("con_anna");

    expect(card?.identities).toHaveLength(2);
    expect(card?.history.length).toBeGreaterThanOrEqual(2);
    expect(
      card?.history.some((entry) => entry.label.startsWith("Переписка")),
    ).toBe(true);
  });

  it("keeps dashboard feed to one entry per conversation", () => {
    const dashboard = getDashboard();
    const ids = dashboard.feed.map((item) => item.conversationId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(dashboard.feed.length).toBeLessThanOrEqual(5);
  });
});
