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

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  listUserWorkspaces: async () => [
    { id: "wsp_tonwerk", name: "Tonwerk Keramik", role: "owner" },
  ],
}));
/**
 * Мутируемая заготовка ответа `get_dashboard_metrics`: подменяем сам RPC, а не
 * модуль `@/lib/db/dashboard`, чтобы под тестом осталась настоящая раскладка
 * ответа в модель представления — плитки, доли полос и блок токенов.
 */
const dashboardMetrics = {
  tokensTrackedSince: "2026-07-01T00:00:00.000Z" as string | null,
};

function dashboardMetricsPayload() {
  return {
    incoming_messages: 128,
    incoming_comments: 34,
    drafts_messages: 40,
    drafts_comments: 12,
    median_reply_seconds: 780,
    categories: [
      { category_id: "cat_spam", total: 80 },
      { category_id: null, total: 48 },
    ],
    tokens: {
      message_classification: { prompt: 500, completion: 10, total: 510 },
      message_draft: { prompt: 1200, completion: 300, total: 1500 },
      comment_classification: { prompt: 0, completion: 0, total: 0 },
      comment_draft: { prompt: 800, completion: 200, total: 1000 },
      total: { prompt: 2500, completion: 510, total: 3010 },
    },
    tokens_tracked_since: dashboardMetrics.tokensTrackedSince,
  };
}

vi.mock("@/lib/db/server", () => ({
  createServerSupabaseClient: async () => ({
    rpc: async () => ({ data: dashboardMetricsPayload(), error: null }),
  }),
}));
// Серверные действия меню пользователя: в jsdom важен только их импорт.
vi.mock("./workspace-actions", () => ({
  switchWorkspaceAction: async () => undefined,
  createWorkspaceFromShellAction: async () => undefined,
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
    skip_draft: false,
    priority: 1,
    is_default: true,
    created_at: "2026-07-21T10:00:00.000Z",
    updated_at: "2026-07-21T10:00:00.000Z",
  },
];

// `categoryBadges` is pure (a palette lookup by list position), so the real one
// is reused rather than stubbed — the chips and the dashboard chart must agree
// on colours, and a fake here would hide a mismatch.
vi.mock("@/lib/db/categories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/categories")>()),
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

vi.mock("@/lib/db/ai-settings", () => ({
  getWorkspaceAiSettings: async () => ({
    id: "ais_tonwerk",
    workspace_id: "wsp_tonwerk",
    system_prompt: "Пиши от лица мастерской Tonwerk.",
    comment_system_prompt: "Отвечай на комментарии Tonwerk коротко.",
    debounce_seconds: 45,
    model: "mistral-large-latest",
    auto_generate_dm: true,
    created_at: "2026-07-22T10:00:00.000Z",
    updated_at: "2026-07-22T10:00:00.000Z",
  }),
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

/** Отбор, который в бою делает запрос: списки фильтруются по `channelIds`. */
function filterByChannels<T extends { channel: { id: string } }>(
  items: T[],
  channelIds: string[] | undefined,
): T[] {
  return channelIds && channelIds.length > 0
    ? items.filter((item) => channelIds.includes(item.channel.id))
    : items;
}

vi.mock("@/lib/db/inbox", () => ({
  CONVERSATION_PAGE_SIZE: 30,
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
    filter: { channelIds?: string[] } = {},
  ) => {
    const items = filterByChannels(INBOX_LIST_ITEMS, filter.channelIds);

    return {
      title: "Сообщения",
      subtitle: `все каналы · ${items.length} диалог(а/ов)`,
      items,
      total: items.length,
      hasMore: false,
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
  loadConversationsAction: async (input: { channelIds: string[] }) => {
    const items = filterByChannels(INBOX_LIST_ITEMS, input.channelIds);

    return { ok: true, items, total: items.length, hasMore: false };
  },
}));

const POST_LIST_ITEMS = [
  {
    id: "post_autumn_ig",
    title: "Осенняя коллекция уже в продаже",
    preview: "Сколько стоит доставка по Берлину?",
    time: "10:12",
    unreadCount: 2,
    commentCount: 2,
    channel: {
      id: "chc_instagram_shop",
      name: "Instagram Магазин",
      platform: "instagram",
    },
  },
  {
    id: "post_fresh_ig",
    title: "Новый стеллаж в мастерской",
    preview: "Пока нет комментариев",
    time: "09:40",
    unreadCount: 0,
    commentCount: 0,
    channel: {
      id: "chc_instagram_shop",
      name: "Instagram Магазин",
      platform: "instagram",
    },
  },
];

const POST_THREAD = {
  postId: "post_autumn_ig",
  channel: {
    id: "chc_instagram_shop",
    name: "Instagram Магазин",
    platform: "instagram",
  },
  postText: "Осенняя коллекция уже в продаже — заходите за новинками!",
  postUrl: "https://instagram.com/p/ig_post_autumn",
  postMeta: "2 комментария",
  draftBrief: { description: "", instruction: "", isConfigured: false },
  sendableDraftCount: 0,
  comments: [
    {
      id: "cmt_lena",
      authorName: "Lena Fischer",
      authorHandle: "@ig_user_lena",
      avatar: { initials: "LF", hue: 40 },
      text: "Сколько стоит доставка по Берлину?",
      time: "10:12",
      isOurs: false,
      isReply: false,
      deliveryLabel: null,
      isAnswered: false,
      draft: null,
    },
  ],
};

vi.mock("@/lib/db/comments", () => ({
  POST_PAGE_SIZE: 30,
  listChannelConnections: async () => INBOX_CHANNELS,
  getCommentsChannelFiltersView: async () => [
    {
      id: "chc_instagram_shop",
      name: "Instagram Магазин",
      platform: "instagram",
      count: 2,
    },
  ],
  getCommentsNavigationCounters: async () => ({
    totalUnread: 2,
    channels: [],
  }),
  getPostListView: async (
    _supabase: unknown,
    _workspaceId: string,
    _channels: unknown,
    filter: { channelIds?: string[] } = {},
  ) => {
    const items = filterByChannels(POST_LIST_ITEMS, filter.channelIds);

    return {
      title: "Комментарии",
      subtitle: `все каналы · ${items.length} поста`,
      items,
      total: items.length,
      hasMore: false,
    };
  },
  getPostThreadView: async (
    _supabase: unknown,
    _workspaceId: string,
    _channels: unknown,
    postId: string,
  ) => (postId === "post_autumn_ig" ? POST_THREAD : null),
}));

vi.mock("./comments/actions", () => ({
  markPostReadAction: async () => ({ ok: true }),
  configureCommentDraftsAction: async () => ({ ok: true }),
  generateCommentDraftAction: async () => ({ ok: true }),
  editCommentDraftAction: async () => ({ ok: true }),
  discardCommentDraftAction: async () => ({ ok: true }),
  sendCommentDraftAction: async () => ({ ok: true }),
  sendAllCommentDraftsAction: async () => ({ ok: true, sent: 0, failed: 0 }),
  loadPostsAction: async (input: { channelIds: string[] }) => {
    const items = filterByChannels(POST_LIST_ITEMS, input.channelIds);

    return { ok: true, items, total: items.length, hasMore: false };
  },
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

/**
 * Контакт привязан к платформе, а не к подключению — как и в `lib/db/contacts`,
 * выбранные каналы разворачиваются в набор платформ.
 */
function contactsForChannels(channelIds: string[] | undefined) {
  if (!channelIds || channelIds.length === 0) {
    return CONTACT_LIST_ALL;
  }

  const platforms = INBOX_CHANNELS.filter((channel) =>
    channelIds.includes(channel.id),
  ).map((channel) => channel.platform);

  return CONTACT_LIST_ALL.filter((contact) =>
    contact.platforms.some((platform) => platforms.includes(platform)),
  );
}

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
  CONTACT_PAGE_SIZE: 40,
  listChannelConnections: async () => INBOX_CHANNELS,
  getContactChannelFilters: async () => [
    { id: "chc_instagram_shop", name: "Instagram Магазин", platform: "instagram", count: 2 },
    { id: "chc_facebook_page", name: "Facebook Страница", platform: "facebook", count: 1 },
  ],
  getContactListView: async (
    _supabase: unknown,
    _workspaceId: string,
    _channels: unknown,
    filter: { channelIds?: string[] } = {},
  ) => {
    const items = contactsForChannels(filter.channelIds);

    return {
      title: "Контакты",
      subtitle: `все каналы · ${items.length} контакта`,
      items,
      total: items.length,
      hasMore: false,
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
  loadContactsAction: async (input: { channelIds: string[] }) => {
    const items = contactsForChannels(input.channelIds);

    return { ok: true, items, total: items.length, hasMore: false };
  },
}));

afterEach(cleanup);
afterEach(() => {
  dashboardMetrics.tokensTrackedSince = "2026-07-01T00:00:00.000Z";
});

function searchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

describe("dashboard page", () => {
  it("renders the stats, the category chart and the token block", async () => {
    render(await DashboardPage({ searchParams: searchParams() }));

    expect(screen.getByRole("heading", { name: "Дашборд" })).toBeDefined();
    expect(screen.getByText("Входящих сообщений")).toBeDefined();
    expect(screen.getByText("Создано черновиков")).toBeDefined();
    expect(screen.getByText("Комментариев")).toBeDefined();
    expect(screen.getByText("Медиана времени ответа")).toBeDefined();

    expect(screen.getByText("Сообщения по категориям")).toBeDefined();
    expect(screen.getByText("Спам")).toBeDefined();
    // Unclassified messages are charted too, under their own label.
    expect(screen.getByText("Без категории")).toBeDefined();

    expect(screen.getByText("Расход токенов")).toBeDefined();
    expect(screen.getByText("Классификация сообщений")).toBeDefined();
    expect(screen.getByText("Черновики комментариев")).toBeDefined();
  });

  it("defaults to the day period and marks the requested one instead", async () => {
    const { unmount } = render(
      await DashboardPage({ searchParams: searchParams() }),
    );

    expect(screen.getByRole("link", { name: "День" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Месяц" }).getAttribute("aria-current")).toBeNull();
    unmount();

    render(await DashboardPage({ searchParams: searchParams({ period: "month" }) }));

    expect(screen.getByRole("link", { name: "Месяц" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("за последние 30 дней")).toBeDefined();
  });

  it("explains the empty token block before any usage is recorded", async () => {
    dashboardMetrics.tokensTrackedSince = null;

    render(await DashboardPage({ searchParams: searchParams() }));

    expect(screen.getByText(/Учёт расхода токенов только что включён/)).toBeDefined();
    expect(screen.queryByText("Классификация сообщений")).toBeNull();
  });
});

describe("inbox page", () => {
  it("renders the dialog list without opening a thread until one is picked", async () => {
    const { container } = render(
      await InboxPage({ searchParams: searchParams() }),
    );

    expect(screen.getByRole("heading", { name: "Сообщения" })).toBeDefined();
    expect(screen.getAllByText("Anna Weber").length).toBeGreaterThan(0);
    // Ни один диалог не выбран автоматически — панель треда пуста.
    expect(screen.queryByLabelText("Ответ")).toBeNull();
    expect(screen.getByText(/Выберите диалог/)).toBeDefined();

    // `data-unread` есть только у строк списка диалогов (не у чипсов фильтра).
    const listItems = container.querySelectorAll("[data-unread]");

    expect(listItems.length).toBe(3);
    listItems.forEach((item) => {
      expect(item.getAttribute("data-active")).toBe("false");
    });
  });

  it("opens the thread of the picked conversation with its composer", async () => {
    render(
      await InboxPage({
        searchParams: searchParams({ conversation: "cnv_dm_anna_ig" }),
      }),
    );

    expect(screen.queryByText("AI-черновик")).toBeNull();
    expect(screen.getByLabelText("Ответ")).toBeDefined();
  });

  // Фильтр — состояние списка, а не query-параметр: страница рендерится без
  // фильтра, отбор делает серверное действие по выбору в мультиселекте.
  it("filters the list by channel through the multi-select", async () => {
    render(await InboxPage({ searchParams: searchParams() }));

    expect(screen.getAllByText("Максим Литвинов").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Фильтр по каналам" }));
    fireEvent.click(screen.getByLabelText(/Facebook Страница/));

    await waitFor(() =>
      expect(screen.queryByText("Максим Литвинов")).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Фильтр по каналам" }).textContent,
    ).toContain("Facebook Страница");
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
  it("lists every post, including one without comments yet", async () => {
    render(await CommentsPage({ searchParams: searchParams() }));

    expect(screen.getByRole("heading", { name: "Комментарии" })).toBeDefined();
    expect(screen.getByText("Новый стеллаж в мастерской")).toBeDefined();
    expect(screen.getByText("Пока нет комментариев")).toBeDefined();
    expect(screen.getByText(/Выберите пост слева/)).toBeDefined();
  });

  it("opens a post with its comments and the draft controls", async () => {
    render(
      await CommentsPage({
        searchParams: searchParams({ post: "post_autumn_ig" }),
      }),
    );

    expect(screen.getByText("Комментарии к посту")).toBeDefined();
    expect(screen.getByRole("button", { name: "Черновики" })).toBeDefined();
    expect(screen.getByText("Lena Fischer")).toBeDefined();
    // Черновик не создаётся при получении комментария — его запускает кнопка.
    expect(screen.getByRole("button", { name: "Создать черновик" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Отправить все" })).toBeDefined();
  });

  it("asks for the draft brief before generating for a single comment", async () => {
    render(
      await CommentsPage({
        searchParams: searchParams({ post: "post_autumn_ig" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Создать черновик" }));

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("Черновики к комментариям")).toBeDefined();
  });
});

describe("contacts page", () => {
  it("renders the contact list without opening a card until one is picked", async () => {
    render(await ContactsPage({ searchParams: searchParams() }));

    expect(screen.getByRole("heading", { name: "Контакты" })).toBeDefined();
    expect(screen.queryByText("Карточка контакта")).toBeNull();
    expect(screen.getByText(/Выберите контакт/)).toBeDefined();
  });

  it("renders the card of the picked contact", async () => {
    render(
      await ContactsPage({ searchParams: searchParams({ contact: "con_sofia" }) }),
    );

    expect(screen.getByText("Карточка контакта")).toBeDefined();
    expect(screen.getByText("Identities по каналам")).toBeDefined();
    expect(screen.getByText("Кросс-канальная история")).toBeDefined();
    expect(screen.getByRole("button", { name: "Склеить с другим…" })).toBeDefined();
  });

  it("filters contacts by channel through the multi-select", async () => {
    render(await ContactsPage({ searchParams: searchParams() }));

    expect(screen.getAllByText("Sofia Marchetti").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Фильтр по каналам" }));
    fireEvent.click(screen.getByLabelText(/Facebook Страница/));

    // Контакт привязан к платформе, а не к подключению — Sofia не на Facebook.
    await waitFor(() =>
      expect(screen.queryByText("Sofia Marchetti")).toBeNull(),
    );
  });
});

describe("settings page", () => {
  it("renders the channels section by default", async () => {
    render(await SettingsPage({ searchParams: searchParams() }));

    expect(screen.getAllByText("Каналы").length).toBeGreaterThan(0);
    // Instagram и Facebook уже подключены — у них строка канала, у остальных
    // платформ (включая Email) — кнопка подключения.
    expect(screen.getAllByRole("button", { name: "Переименовать" })).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Подключить Telegram" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Подключить Email" })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Подключить Instagram" }),
    ).toBeNull();
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

    expect(screen.getByLabelText("Черновики сообщений")).toBeDefined();
    expect(screen.getByLabelText("Черновики комментариев")).toBeDefined();
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

// Real DM unread total (T-05).
const messagesCounters = { totalUnread: 4 };

// Real comment unread total (stage 5).
const commentsCounters = { totalUnread: 2 };

const WORKSPACES = [
  { id: "wsp_tonwerk", name: "Tonwerk Keramik" },
  { id: "wsp_second", name: "Второй workspace" },
];

function renderSidebar() {
  render(
    <Sidebar
      workspaceName="Tonwerk Keramik"
      workspaces={WORKSPACES}
      currentWorkspaceId="wsp_tonwerk"
      userName="Алексей"
      userRole="owner"
      messagesCounters={messagesCounters}
      commentsCounters={commentsCounters}
    />,
  );
}

describe("shell navigation", () => {
  it("renders sidebar sections with counters and no expandable items", () => {
    renderSidebar();

    expect(screen.getByText("Дашборд")).toBeDefined();
    expect(screen.getByText("Сообщения")).toBeDefined();
    expect(screen.getByText("Комментарии")).toBeDefined();
    expect(screen.getByText("Контакты")).toBeDefined();
    expect(screen.getByText(String(messagesCounters.totalUnread))).toBeDefined();
    // Разделы больше не расхлопываются в каналы — списки показывают все каналы.
    expect(screen.queryByText("Все каналы")).toBeNull();
    expect(screen.queryByText("Instagram Магазин")).toBeNull();
    // «Настройки» — обычная ссылка: подразделов в меню нет, они на экране.
    expect(
      screen.getByRole("link", { name: /Настройки/ }).getAttribute("href"),
    ).toBe("/settings");
    SETTINGS_SECTIONS.forEach((section) => {
      expect(screen.queryByText(section.title)).toBeNull();
    });
  });

  it("offers workspace switching, creation and logout in the user menu", () => {
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: /Алексей/ }));

    expect(screen.getByText("Второй workspace")).toBeDefined();
    expect(screen.getByRole("button", { name: /Выйти/ })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Создать workspace/ }));

    expect(
      screen.getByLabelText("Название нового рабочего пространства"),
    ).toBeDefined();
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
