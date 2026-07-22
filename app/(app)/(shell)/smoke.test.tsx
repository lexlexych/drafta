// @vitest-environment jsdom

/**
 * Смоук-тесты рендера разделов UI-каркаса (T-07): страницы открываются,
 * ключевые элементы макета на месте. Layout'ы с гейтами Supabase здесь не
 * рендерятся (проверено вручную/DB-тестами — см. отчёт T-05). Большинство
 * страниц всё ещё работает на mock-данных; «Сообщения» (T-05, как и
 * «Настройки → Каналы» из T-04) подключены к реальному Supabase — здесь
 * `@/lib/db/inbox` мокается тем же приёмом, что и `@/lib/db/channel-connections`
 * ниже.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SETTINGS_SECTIONS } from "@/lib/mock";

import CommentsPage from "./comments/page";
import ContactsPage from "./contacts/page";
import DashboardPage from "./dashboard/page";
import InboxPage from "./inbox/page";
import SettingsPage from "./settings/page";
import { Sidebar } from "./_components/sidebar";
import { Tabbar } from "./_components/tabbar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Real settings sections are mocked so the page renders in jsdom without a
// request context or live Supabase.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/workspace", () => ({
  getAuthenticatedUser: async () => ({ id: "usr_alexey" }),
  getCurrentWorkspace: async () => ({
    id: "wsp_tonwerk",
    name: "Tonwerk Keramik",
    role: "owner",
  }),
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabaseClient: async () => ({}),
}));
const INBOX_CHANNELS = [
  {
    id: "chc_instagram_shop",
    workspace_id: "wsp_tonwerk",
    name: "Instagram Магазин",
    provider: "zernio",
    platform: "instagram",
    external_id: "17841400000000001",
    status: "active",
    capabilities: {},
    created_at: "2026-07-19T10:00:00.000Z",
  },
  {
    id: "chc_facebook_page",
    workspace_id: "wsp_tonwerk",
    name: "Facebook Страница",
    provider: "zernio",
    platform: "facebook",
    external_id: "102740000000002",
    status: "active",
    capabilities: {},
    created_at: "2026-07-19T10:01:00.000Z",
  },
];

vi.mock("@/lib/db/channel-connections", () => ({
  SUPPORTED_CHANNEL_PLATFORMS: ["telegram", "whatsapp", "instagram", "facebook"],
  listChannelConnections: async () => INBOX_CHANNELS,
}));

const CATEGORIES = [
  {
    id: "cat_spam",
    workspace_id: "wsp_tonwerk",
    name: "Спам",
    description: "Реклама и массовые рассылки.",
    draft_instruction: null,
    channel_connection_ids: [],
    incoming_kind: "both",
    skip_draft: true,
    priority: 0,
    is_default: false,
    created_at: "2026-07-21T10:00:00.000Z",
    updated_at: "2026-07-21T10:00:00.000Z",
  },
  {
    id: "cat_default",
    workspace_id: "wsp_tonwerk",
    name: "По умолчанию",
    description: "Всё остальное.",
    draft_instruction: null,
    channel_connection_ids: [],
    incoming_kind: "both",
    skip_draft: false,
    priority: 1,
    is_default: true,
    created_at: "2026-07-21T10:00:00.000Z",
    updated_at: "2026-07-21T10:00:00.000Z",
  },
];

vi.mock("@/lib/db/categories", () => ({
  listCategories: async () => CATEGORIES,
}));

const KNOWLEDGE_FILES = [
  {
    id: "kbf_price",
    workspace_id: "wsp_tonwerk",
    name: "02-прайс.md",
    content: "# Прайс\n\nЧашка — 24 €.",
    sort_order: 1,
    is_enabled: true,
    created_at: "2026-07-20T10:00:00.000Z",
    updated_at: "2026-07-21T10:00:00.000Z",
  },
];

vi.mock("@/lib/db/knowledge-base", () => ({
  listKnowledgeFiles: async () => KNOWLEDGE_FILES,
}));

const INBOX_LIST_ITEMS = [
  {
    id: "cnv_dm_anna_ig",
    kind: "dm",
    title: "Anna Weber",
    preview: "И сколько будет доставка в Гамбург?",
    time: "12:41",
    unreadCount: 3,
    channel: { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram" },
    category: null,
    avatar: { initials: "AW", hue: 120 },
  },
  {
    id: "cnv_dm_maxim_ig",
    kind: "dm",
    title: "Максим Литвинов",
    preview: "📎 Вот фото",
    time: "11:52",
    unreadCount: 1,
    channel: { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram" },
    category: null,
    avatar: { initials: "МЛ", hue: 60 },
  },
  {
    id: "cnv_dm_anna_fb",
    kind: "dm",
    title: "Anna Weber",
    preview: "Добрый день! Это Анна, писала вам в Instagram…",
    time: "11:05",
    unreadCount: 1,
    channel: { id: "chc_facebook_page", name: "Facebook Страница", platform: "facebook" },
    category: null,
    avatar: { initials: "AW", hue: 120 },
  },
];

const INBOX_THREAD_MAXIM = {
  conversationId: "cnv_dm_maxim_ig",
  contactId: "con_maxim",
  title: "Максим Литвинов",
  avatar: { initials: "МЛ", hue: 60 },
  channel: { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram" },
  category: null,
  replyWindowLabel: "Окно ответа: 20 ч",
  messages: [
    {
      id: "msg_dm_maxim_ig_2",
      direction: "in",
      text: "Добрый день. Заказ получил, но одна чашка со сколом на ручке 😞",
      time: "11:50",
      deliveryLabel: null,
      attachmentName: null,
    },
    {
      id: "msg_dm_maxim_ig_3",
      direction: "in",
      text: "Вот фото",
      time: "11:52",
      deliveryLabel: null,
      attachmentName: "IMG_2214.jpg",
    },
  ],
  debounceNote: null,
  draft: null,
};

const INBOX_THREAD_ANNA_IG = {
  ...INBOX_THREAD_MAXIM,
  conversationId: "cnv_dm_anna_ig",
  contactId: "con_anna",
  title: "Anna Weber",
  avatar: { initials: "AW", hue: 120 },
  messages: [
    {
      id: "msg_dm_anna_ig_3",
      direction: "in",
      text: "И сколько будет доставка в Гамбург?",
      time: "12:41",
      deliveryLabel: null,
      attachmentName: null,
    },
  ],
};

vi.mock("@/lib/db/inbox", () => ({
  listChannelConnections: async () => INBOX_CHANNELS,
  getChannelFiltersView: async () => [
    { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram", count: 4 },
    { id: "chc_facebook_page", name: "Facebook Страница", platform: "facebook", count: 1 },
  ],
  getInboxNavigationCounters: async () => ({
    totalUnread: 5,
    channels: [
      { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram", unreadCount: 4 },
      { id: "chc_facebook_page", name: "Facebook Страница", platform: "facebook", unreadCount: 1 },
    ],
  }),
  getConversationListView: async (
    _supabase: unknown,
    _workspaceId: string,
    _channels: unknown,
    filter: { channelId?: string | null } = {},
  ) => {
    const channelId = filter.channelId ?? null;
    const items = channelId
      ? INBOX_LIST_ITEMS.filter((item) => item.channel.id === channelId)
      : INBOX_LIST_ITEMS;
    const channel = channelId
      ? INBOX_CHANNELS.find((candidate) => candidate.id === channelId)
      : null;

    return {
      title: channel?.name ?? "Сообщения",
      subtitle: `${channel ? "канал" : "все каналы"} · ${items.length} диалог(а/ов)`,
      items,
    };
  },
  getThreadView: async (
    _supabase: unknown,
    _workspaceId: string,
    _channels: unknown,
    conversationId: string,
  ) => {
    if (conversationId === "cnv_dm_maxim_ig") return INBOX_THREAD_MAXIM;
    if (conversationId === "cnv_dm_anna_ig") return INBOX_THREAD_ANNA_IG;
    return null;
  },
  markConversationRead: async () => ({ ok: true }),
}));

vi.mock("./inbox/actions", () => ({
  markConversationReadAction: async () => ({ ok: true }),
}));

const CONTACT_LIST_ALL = [
  {
    id: "con_sofia",
    name: "Sofia Marchetti",
    avatar: { initials: "SM", hue: 200 },
    handles: "@sofia.ceramics",
    platforms: ["instagram"],
    tag: "VIP",
  },
  {
    id: "con_anna",
    name: "Anna Weber",
    avatar: { initials: "AW", hue: 120 },
    handles: "Anna Weber",
    platforms: ["facebook", "instagram"],
    tag: null,
  },
];

const CONTACT_LIST_FACEBOOK = [CONTACT_LIST_ALL[1]];

const CONTACT_CARDS: Record<string, unknown> = {
  con_sofia: {
    id: "con_sofia",
    name: "Sofia Marchetti",
    avatar: { initials: "SM", hue: 200 },
    tags: ["VIP"],
    notes: "Постоянный клиент, любит матовую глазурь.",
    identities: [
      {
        id: "cid_sofia_ig",
        platform: "instagram",
        platformLabel: "Instagram",
        handle: "@sofia.ceramics",
        channelName: "Instagram Магазин",
      },
    ],
    history: [
      {
        conversationId: "cnv_dm_sofia_ig",
        kind: "dm",
        label: "Переписка · Instagram Магазин",
        time: "12:41",
      },
    ],
  },
  con_anna: {
    id: "con_anna",
    name: "Anna Weber",
    avatar: { initials: "AW", hue: 120 },
    tags: [],
    notes: "",
    identities: [
      {
        id: "cid_anna_fb",
        platform: "facebook",
        platformLabel: "Facebook",
        handle: "Anna Weber",
        channelName: "Facebook Страница",
      },
    ],
    history: [
      {
        conversationId: "cnv_dm_anna_fb",
        kind: "dm",
        label: "Переписка · Facebook Страница",
        time: "11:05",
      },
    ],
  },
};

vi.mock("@/lib/db/contacts", () => ({
  listChannelConnections: async () => INBOX_CHANNELS,
  getContactChannelFilters: async () => [
    { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram", count: 2 },
    { id: "chc_facebook_page", name: "Facebook Страница", platform: "facebook", count: 1 },
  ],
  getContactNavigationCounters: async () => ({
    channels: [
      { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram", contactCount: 2 },
      { id: "chc_facebook_page", name: "Facebook Страница", platform: "facebook", contactCount: 1 },
    ],
  }),
  getContactListView: async (
    _supabase: unknown,
    _workspaceId: string,
    _channels: unknown,
    filter: { channelId?: string | null } = {},
  ) => {
    const channelId = filter.channelId ?? null;
    const items = channelId ? CONTACT_LIST_FACEBOOK : CONTACT_LIST_ALL;

    return {
      title: channelId ? "Facebook Страница" : "Контакты",
      subtitle: `${channelId ? "контакты канала" : "все каналы"} · ${items.length} контакта`,
      items,
    };
  },
  getContactCardView: async (
    _supabase: unknown,
    _workspaceId: string,
    _channels: unknown,
    contactId: string,
  ) => CONTACT_CARDS[contactId] ?? null,
  listMergeCandidates: async (
    _supabase: unknown,
    _workspaceId: string,
    contactId: string,
  ) =>
    Object.values(CONTACT_CARDS)
      .map((card) => card as { id: string; name: string })
      .filter((card) => card.id !== contactId)
      .map((card) => ({ id: card.id, name: card.name })),
}));

vi.mock("./contacts/actions", () => ({
  updateContactNotesAction: async () => ({ ok: true, data: null }),
  mergeContactsAction: async () => ({ ok: true, data: null }),
}));

afterEach(cleanup);

function searchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

describe("dashboard page", () => {
  it("renders stats, channel load and incoming feed", async () => {
    render(await DashboardPage());

    expect(screen.getByRole("heading", { name: "Дашборд" })).toBeDefined();
    expect(screen.getByText("черновиков ждут проверки")).toBeDefined();
    expect(screen.getByText("По каналам")).toBeDefined();
    expect(screen.getByText("Последние входящие")).toBeDefined();
    expect(screen.getAllByText("Instagram Магазин").length).toBeGreaterThan(0);
  });
});

describe("inbox page", () => {
  it("renders the dialog list and hides the panel when no active draft exists", async () => {
    render(await InboxPage({ searchParams: searchParams() }));

    expect(screen.getByRole("heading", { name: "Сообщения" })).toBeDefined();
    expect(screen.getAllByText("Anna Weber").length).toBeGreaterThan(0);
    expect(screen.queryByText("AI-черновик")).toBeNull();
    expect(screen.getByLabelText("Ответ")).toBeDefined();
  });

  it("filters the list by channel", async () => {
    render(
      await InboxPage({
        searchParams: searchParams({ channel: "chc_facebook_page" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Facebook Страница" }),
    ).toBeDefined();
    expect(screen.queryByText("Максим Литвинов")).toBeNull();
  });

  it("opens the requested conversation", async () => {
    render(
      await InboxPage({
        searchParams: searchParams({ conversation: "cnv_dm_maxim_ig" }),
      }),
    );

    expect(screen.getByText(/чашка со сколом/)).toBeDefined();
    expect(screen.getByText(/IMG_2214\.jpg/)).toBeDefined();
  });
});

describe("comments page", () => {
  it("renders posts grouped list and a comment thread", async () => {
    render(
      await CommentsPage({
        searchParams: searchParams({ conversation: "cnv_post_sea_ig" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Комментарии" })).toBeDefined();
    expect(screen.getByText("Комментарии к посту")).toBeDefined();
    expect(screen.getByText(/сгруппировано по постам/)).toBeDefined();
    expect(screen.getByText("черновик не создаётся")).toBeDefined();
    expect(screen.getByText(/Ответ на комментарий @dashkov\.art/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Принять и отправить" })).toBeDefined();
  });
});

describe("contacts page", () => {
  it("renders the contact list and card", async () => {
    render(await ContactsPage({ searchParams: searchParams() }));

    expect(screen.getByRole("heading", { name: "Контакты" })).toBeDefined();
    expect(screen.getByText("Карточка контакта")).toBeDefined();
    expect(screen.getByText("Identities по каналам")).toBeDefined();
    expect(screen.getByText("Кросс-канальная история")).toBeDefined();
    expect(screen.getByRole("button", { name: "Склеить с другим…" })).toBeDefined();
  });

  it("filters contacts by channel", async () => {
    render(
      await ContactsPage({
        searchParams: searchParams({ channel: "chc_facebook_page" }),
      }),
    );

    expect(screen.getByText(/контакты канала/)).toBeDefined();
    expect(screen.queryByText("Sofia Marchetti")).toBeNull();
  });
});

describe("settings page", () => {
  it("renders the channels section by default", async () => {
    render(await SettingsPage({ searchParams: searchParams() }));

    expect(screen.getAllByText("Каналы").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Переименовать" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "+ Подключить канал" })).toBeDefined();
  });

  it("renders the categories section with the locked default", async () => {
    render(
      await SettingsPage({ searchParams: searchParams({ section: "categories" }) }),
    );

    expect(screen.getByText("По умолчанию")).toBeDefined();
    expect(screen.getByText("без черновиков")).toBeDefined();
    expect(screen.getByText("системная")).toBeDefined();
  });

  it("renders the ai section with switches", async () => {
    render(await SettingsPage({ searchParams: searchParams({ section: "ai" }) }));

    expect(screen.getByLabelText("Тон ответов")).toBeDefined();
    expect(
      screen.getByRole("switch", { name: "Авто-генерация для сообщений" }),
    ).toBeDefined();
  });

  it("renders the real knowledge base section", async () => {
    render(
      await SettingsPage({
        searchParams: searchParams({ section: "knowledge" }),
      }),
    );

    expect(screen.getAllByText("База знаний").length).toBeGreaterThan(0);
    expect(
      SETTINGS_SECTIONS.some((section) => section.title === "База знаний"),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "02-прайс.md" })).toBeDefined();
    expect(screen.getByRole("button", { name: "+ Новый файл" })).toBeDefined();
    expect(screen.getByText(/Бюджет токенов/)).toBeDefined();
  });
});

// Real per-channel unread (T-05).
const messagesCounters = {
  totalUnread: 4,
  channels: [
    { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram" as const, unreadCount: 3 },
    { id: "chc_facebook_page", name: "Facebook Страница", platform: "facebook" as const, unreadCount: 1 },
  ],
};

// Real per-channel comment unread (stage 5).
const commentsCounters = {
  totalUnread: 2,
  channels: [
    { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram" as const, unreadCount: 2 },
  ],
};

// Real per-channel contact counts (этап 7).
const contactsCounters = {
  channels: [
    { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram" as const, contactCount: 2 },
    { id: "chc_facebook_page", name: "Facebook Страница", platform: "facebook" as const, contactCount: 1 },
  ],
};

describe("shell navigation", () => {
  it("renders sidebar sections with counters and no knowledge base", () => {
    render(
      <Sidebar
        workspaceName="Tonwerk Keramik"
        userName="Алексей"
        userRole="owner"
        messagesCounters={messagesCounters}
        commentsCounters={commentsCounters}
        contactsCounters={contactsCounters}
        settingsSections={SETTINGS_SECTIONS}
      />,
    );

    expect(screen.getByText("Дашборд")).toBeDefined();
    expect(screen.getByText("Сообщения")).toBeDefined();
    expect(screen.getByText("Комментарии")).toBeDefined();
    expect(screen.getByText("Контакты")).toBeDefined();
    expect(screen.getByText("Настройки")).toBeDefined();
    // Раздел «Сообщения» раскрыт по умолчанию — виден расхлоп реальных каналов
    // (T-05) со своим счётчиком, а не мока.
    expect(screen.getByText("Все каналы")).toBeDefined();
    expect(screen.getByText(String(messagesCounters.totalUnread))).toBeDefined();
    expect(screen.queryByText("База знаний")).toBeNull();
  });

  it("renders the mobile tabbar with unread badges", () => {
    render(
      <Tabbar
        messagesCounters={messagesCounters}
        commentsCounters={commentsCounters}
      />,
    );

    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.getByText(String(messagesCounters.totalUnread))).toBeDefined();
  });
});
