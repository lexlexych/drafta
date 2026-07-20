// @vitest-environment jsdom

/**
 * Смоук-тесты рендера разделов UI-каркаса (T-07): страницы открываются,
 * ключевые элементы макета на месте. Layout'ы с гейтами Supabase здесь
 * не рендерятся — их проверяют тесты T-05; страницы работают на mock-данных.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SETTINGS_SECTIONS, getNavigationCounters } from "@/lib/mock";

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

// Settings → Channels (T-04) is the one section on this page backed by real
// Supabase queries — every other section here stays on `lib/mock` (T-07
// UI-каркас). `server-only` throws outside a Next build (see route.test.ts's
// precedent); `lib/db/workspace`/`lib/db/server`/`lib/db/channel-connections`
// are mocked so the page renders in jsdom without a request context or a
// live database — two fixture channels preserve this file's existing
// "renders the channels section" assertions below.
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
vi.mock("@/lib/db/channel-connections", () => ({
  SUPPORTED_CHANNEL_PLATFORMS: ["telegram", "whatsapp", "instagram", "facebook"],
  listChannelConnections: async () => [
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
  ],
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
  it("renders the dialog list and the first thread with a draft panel", async () => {
    render(await InboxPage({ searchParams: searchParams() }));

    expect(screen.getByRole("heading", { name: "Сообщения" })).toBeDefined();
    expect(screen.getAllByText("Anna Weber").length).toBeGreaterThan(0);
    expect(screen.getByText("AI-черновик")).toBeDefined();
    expect(screen.getByRole("button", { name: "Принять и отправить" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Править" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Отклонить" })).toBeDefined();
    expect(screen.getByText(/дебаунс/)).toBeDefined();
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

  it("does not contain the knowledge base section (stage 4)", async () => {
    render(await SettingsPage({ searchParams: searchParams() }));

    expect(screen.queryByText("База знаний")).toBeNull();
    expect(
      SETTINGS_SECTIONS.some((section) => section.title === "База знаний"),
    ).toBe(false);
  });
});

describe("shell navigation", () => {
  it("renders sidebar sections with counters and no knowledge base", () => {
    render(
      <Sidebar
        workspaceName="Tonwerk Keramik"
        userName="Алексей"
        userRole="owner"
        counters={getNavigationCounters()}
        settingsSections={SETTINGS_SECTIONS}
      />,
    );

    expect(screen.getByText("Дашборд")).toBeDefined();
    expect(screen.getByText("Сообщения")).toBeDefined();
    expect(screen.getByText("Комментарии")).toBeDefined();
    expect(screen.getByText("Контакты")).toBeDefined();
    expect(screen.getByText("Настройки")).toBeDefined();
    // Раздел «Сообщения» раскрыт по умолчанию — виден расхлоп каналов.
    expect(screen.getByText("Все каналы")).toBeDefined();
    expect(screen.queryByText("База знаний")).toBeNull();
  });

  it("renders the mobile tabbar with unread badges", () => {
    const counters = getNavigationCounters();

    render(<Tabbar counters={counters} />);

    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.getByText(String(counters.dmUnread))).toBeDefined();
  });
});
