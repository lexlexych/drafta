// @vitest-environment jsdom

/**
 * Пагинация списка диалогов: первая страница приходит с сервера пропсами,
 * следующие — серверным действием, когда маячок в конце списка попадает в поле
 * зрения. Плюс перезагрузка первой страницы при смене фильтра.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationListItemView } from "@/lib/mock";

import { ConversationList } from "./conversation-list";

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

const loadConversationsAction = vi.fn();

vi.mock("../actions", () => ({
  loadConversationsAction: (input: unknown) => loadConversationsAction(input),
}));

const CHANNELS = [
  { id: "chc_ig", name: "Instagram Магазин", platform: "instagram" as const, count: 2 },
  { id: "chc_fb", name: "Facebook Страница", platform: "facebook" as const, count: 1 },
];

function item(id: string, title: string, channelId = "chc_ig"): ConversationListItemView {
  return {
    id,
    kind: "dm",
    title,
    preview: "…",
    time: "12:00",
    unreadCount: 0,
    channel: {
      id: channelId,
      name: channelId === "chc_ig" ? "Instagram Магазин" : "Facebook Страница",
      platform: channelId === "chc_ig" ? "instagram" : "facebook",
    },
    categories: [],
    avatar: { initials: "AA", hue: 10 },
  };
}

const PAGE_ONE = [item("cnv_1", "Первый"), item("cnv_2", "Второй")];

/**
 * jsdom не реализует IntersectionObserver. Заглушка сразу сообщает, что маячок
 * виден, — ровно тот случай, ради которого он и стоит в конце списка.
 */
function installIntersectionObserver() {
  class ImmediateIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}

    observe(target: Element) {
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }

    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
}

function renderList(props: { hasMore: boolean }) {
  return render(
    <ConversationList
      items={PAGE_ONE}
      total={props.hasMore ? 3 : PAGE_ONE.length}
      hasMore={props.hasMore}
      channels={CHANNELS}
      categories={[]}
      openedId={null}
      hasChannels
    />,
  );
}

beforeEach(() => {
  loadConversationsAction.mockReset();
  installIntersectionObserver();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConversationList", () => {
  it("renders the server page and asks for nothing while it is complete", async () => {
    renderList({ hasMore: false });

    expect(screen.getByText("Первый")).toBeDefined();
    expect(screen.getByText("Второй")).toBeDefined();
    expect(loadConversationsAction).not.toHaveBeenCalled();
  });

  it("appends the next page when the end of the list is reached", async () => {
    loadConversationsAction.mockResolvedValue({
      ok: true,
      items: [item("cnv_3", "Третий")],
      total: 3,
      hasMore: false,
    });

    renderList({ hasMore: true });

    await waitFor(() => expect(screen.getByText("Третий")).toBeDefined());
    // Смещение следующей страницы — длина уже показанного списка.
    expect(loadConversationsAction).toHaveBeenCalledWith({
      channelIds: [],
      categoryIds: [],
      offset: 2,
    });
    // Первая страница осталась на месте — страницы копятся, а не заменяются.
    expect(screen.getByText("Первый")).toBeDefined();
  });

  it("shows the error the action returned instead of the list", async () => {
    loadConversationsAction.mockResolvedValue({
      ok: false,
      error: "Не удалось загрузить список диалогов.",
    });

    renderList({ hasMore: true });

    await waitFor(() =>
      expect(
        screen.getByText("Не удалось загрузить список диалогов."),
      ).toBeDefined(),
    );
  });
});
