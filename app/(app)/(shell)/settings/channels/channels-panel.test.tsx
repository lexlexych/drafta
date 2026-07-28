// @vitest-environment jsdom

/**
 * Client-side behavior of the Channels panel: one block per platform, the
 * Instagram onboarding → OAuth flow, the "в разработке" stub for the rest,
 * inline rename, disable/enable with confirmation, and the post-OAuth result
 * banner. Server actions (`./actions.ts`) are mocked — the actual DB-backed
 * business logic they delegate to is covered by
 * `lib/db/channel-connections.test.ts`.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelsPanel, type ChannelConnectionListItem } from "./channels-panel";

const startChannelConnectionAction = vi.fn();
const renameChannelConnectionAction = vi.fn();
const setChannelConnectionStatusAction = vi.fn();
const deleteChannelConnectionAction = vi.fn();

vi.mock("./actions", () => ({
  startChannelConnectionAction: (...args: unknown[]) =>
    startChannelConnectionAction(...args),
  renameChannelConnectionAction: (...args: unknown[]) =>
    renameChannelConnectionAction(...args),
  setChannelConnectionStatusAction: (...args: unknown[]) =>
    setChannelConnectionStatusAction(...args),
  deleteChannelConnectionAction: (...args: unknown[]) =>
    deleteChannelConnectionAction(...args),
}));

const refresh = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
}));

let assignMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assignMock = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      assign: assignMock,
      href: "http://localhost/settings?section=channels&connect=error&reason=duplicate",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseChannels: ChannelConnectionListItem[] = [
  {
    id: "chc_telegram_shop",
    name: "Telegram Shop",
    platform: "telegram",
    status: "active",
  },
];

describe("ChannelsPanel", () => {
  it("shows one connect button per platform block", () => {
    render(<ChannelsPanel channels={[]} />);

    for (const label of ["Instagram", "Telegram", "WhatsApp", "Facebook", "Email"]) {
      expect(
        screen.getByRole("button", { name: `Подключить ${label}` }),
      ).toBeDefined();
    }
  });

  it("shows the onboarding prerequisites before the Instagram authorization", () => {
    render(<ChannelsPanel channels={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Подключить Instagram" }));

    expect(screen.getByText(/Перед подключением Instagram/)).toBeDefined();
    expect(screen.getByText(/профессиональный/)).toBeDefined();
    expect(screen.getByText(/уже вошли именно в тот аккаунт/)).toBeDefined();
    // The connect button itself is replaced by the onboarding.
    expect(
      screen.queryByRole("button", { name: "Подключить Instagram" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Войти через Instagram" }),
    ).toBeDefined();
    expect(startChannelConnectionAction).not.toHaveBeenCalled();
  });

  it("starts the OAuth flow from the onboarding and redirects to the provider", async () => {
    startChannelConnectionAction.mockResolvedValue({
      ok: true,
      url: "https://zernio.com/connect/instagram?token=abc",
    });

    render(<ChannelsPanel channels={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Подключить Instagram" }));
    // The user no longer names the connection — it comes from the account.
    expect(screen.queryByLabelText("Имя подключения")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Войти через Instagram" }));

    await waitFor(() =>
      expect(startChannelConnectionAction).toHaveBeenCalledWith({
        platform: "instagram",
      }),
    );
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith(
        "https://zernio.com/connect/instagram?token=abc",
      ),
    );
  });

  it("shows the error and keeps the onboarding open when starting the flow fails", async () => {
    startChannelConnectionAction.mockResolvedValue({
      ok: false,
      error: "Не удалось начать подключение канала.",
    });

    render(<ChannelsPanel channels={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Подключить Instagram" }));
    fireEvent.click(screen.getByRole("button", { name: "Войти через Instagram" }));

    expect(
      await screen.findByText("Не удалось начать подключение канала."),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Войти через Instagram" }),
    ).toBeDefined();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("closes the onboarding on cancel", () => {
    render(<ChannelsPanel channels={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Подключить Instagram" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(
      screen.getByRole("button", { name: "Подключить Instagram" }),
    ).toBeDefined();
  });

  it("shows a work-in-progress stub for platforms without a connect flow", () => {
    render(<ChannelsPanel channels={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Подключить WhatsApp" }));

    expect(screen.getByText(/«WhatsApp» пока в разработке/)).toBeDefined();
    expect(startChannelConnectionAction).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("shows a success banner after returning from OAuth", () => {
    render(
      <ChannelsPanel
        channels={baseChannels}
        connectResult={{ status: "connected", reason: null }}
      />,
    );

    expect(screen.getByText("Канал подключён.")).toBeDefined();
  });

  it("maps a connect error reason to a friendly banner", () => {
    render(
      <ChannelsPanel
        channels={baseChannels}
        connectResult={{ status: "error", reason: "duplicate" }}
      />,
    );

    expect(
      screen.getByText("Канал этой платформы уже подключён к рабочему пространству."),
    ).toBeDefined();
  });

  it("strips the one-shot result params from the url so the banner cannot come back", () => {
    render(
      <ChannelsPanel
        channels={baseChannels}
        connectResult={{ status: "error", reason: "duplicate" }}
      />,
    );

    // Otherwise every later router.refresh() (rename, disable, delete) would
    // re-render the same params and resurrect the banner.
    expect(replace).toHaveBeenCalledWith("/settings?section=channels", {
      scroll: false,
    });
  });

  it("drops the banner as soon as the user starts another connect", () => {
    render(
      <ChannelsPanel
        channels={[]}
        connectResult={{ status: "error", reason: "duplicate" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Подключить Instagram" }));

    expect(
      screen.queryByText(
        "Канал этой платформы уже подключён к рабочему пространству.",
      ),
    ).toBeNull();
  });

  it("drops the banner when the user starts deleting a channel", () => {
    render(
      <ChannelsPanel
        channels={baseChannels}
        connectResult={{ status: "connected", reason: null }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Удалить канал «Telegram Shop»" }),
    );

    expect(screen.queryByText("Канал подключён.")).toBeNull();
  });

  it("replaces the connect button of a connected platform with its channel row", () => {
    render(<ChannelsPanel channels={baseChannels} />);

    expect(screen.getByText("Telegram Shop")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Подключить Telegram" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Подключить Instagram" }),
    ).toBeDefined();
  });

  it("renames a channel inline", async () => {
    renameChannelConnectionAction.mockResolvedValue({ ok: true, data: {} });

    render(<ChannelsPanel channels={baseChannels} />);

    fireEvent.click(screen.getByRole("button", { name: "Переименовать" }));
    fireEvent.change(screen.getByLabelText("Новое имя для «Telegram Shop»"), {
      target: { value: "Telegram Магазин" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(renameChannelConnectionAction).toHaveBeenCalledWith({
        id: "chc_telegram_shop",
        name: "Telegram Магазин",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("disables a channel after confirmation", async () => {
    setChannelConnectionStatusAction.mockResolvedValue({ ok: true, data: {} });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ChannelsPanel channels={baseChannels} />);
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(setChannelConnectionStatusAction).toHaveBeenCalledWith({
        id: "chc_telegram_shop",
        status: "disconnected",
      }),
    );

    confirmSpy.mockRestore();
  });

  it("does not change status when the disable confirmation is declined", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<ChannelsPanel channels={baseChannels} />);
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));

    expect(setChannelConnectionStatusAction).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("asks for confirmation before deleting a channel and explains what is lost", () => {
    render(<ChannelsPanel channels={baseChannels} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Удалить канал «Telegram Shop»" }),
    );

    expect(screen.getByText("Удалить канал «Telegram Shop»?")).toBeDefined();
    expect(
      screen.getByText(/перестанут отображаться в\s+drafta/),
    ).toBeDefined();
    expect(screen.getByText(/В Telegram они останутся/)).toBeDefined();
    expect(deleteChannelConnectionAction).not.toHaveBeenCalled();
  });

  it("deletes the channel on confirmation", async () => {
    deleteChannelConnectionAction.mockResolvedValue({ ok: true });

    render(<ChannelsPanel channels={baseChannels} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Удалить канал «Telegram Shop»" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Удалить канал" }));

    await waitFor(() =>
      expect(deleteChannelConnectionAction).toHaveBeenCalledWith({
        id: "chc_telegram_shop",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("keeps the channel when the deletion is cancelled", () => {
    render(<ChannelsPanel channels={baseChannels} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Удалить канал «Telegram Shop»" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(screen.getByText("Telegram Shop")).toBeDefined();
    expect(deleteChannelConnectionAction).not.toHaveBeenCalled();
  });

  it("surfaces the provider warning when the account could not be disconnected", async () => {
    deleteChannelConnectionAction.mockResolvedValue({
      ok: true,
      warning: "Канал удалён, но провайдер не подтвердил отключение аккаунта.",
    });

    render(<ChannelsPanel channels={baseChannels} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Удалить канал «Telegram Shop»" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Удалить канал" }));

    expect(
      await screen.findByText(
        "Канал удалён, но провайдер не подтвердил отключение аккаунта.",
      ),
    ).toBeDefined();
  });

  it("shows the error and keeps the confirmation open when the deletion fails", async () => {
    deleteChannelConnectionAction.mockResolvedValue({
      ok: false,
      error: "Не удалось удалить канал.",
    });

    render(<ChannelsPanel channels={baseChannels} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Удалить канал «Telegram Shop»" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Удалить канал" }));

    expect(await screen.findByText("Не удалось удалить канал.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Удалить канал" })).toBeDefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("marks a disconnected channel visually and offers to re-enable it", () => {
    const disconnected: ChannelConnectionListItem[] = [
      { ...baseChannels[0], status: "disconnected" },
    ];

    const { container } = render(<ChannelsPanel channels={disconnected} />);

    expect(screen.getByRole("button", { name: "Включить" })).toBeDefined();
    expect(screen.getByText(/отключён/)).toBeDefined();
    expect(container.querySelector('[data-disconnected="true"]')).not.toBeNull();
  });
});
