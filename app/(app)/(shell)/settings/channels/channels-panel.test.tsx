// @vitest-environment jsdom

/**
 * Client-side behavior of the Channels panel (T-04): OAuth add flow, inline
 * rename, disable/enable with confirmation, and the post-OAuth result banner.
 * Server actions (`./actions.ts`) are mocked — the actual DB-backed business
 * logic they delegate to is covered by `lib/db/channel-connections.test.ts`.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelsPanel, type ChannelConnectionListItem } from "./channels-panel";

const startChannelConnectionAction = vi.fn();
const renameChannelConnectionAction = vi.fn();
const setChannelConnectionStatusAction = vi.fn();

vi.mock("./actions", () => ({
  startChannelConnectionAction: (...args: unknown[]) =>
    startChannelConnectionAction(...args),
  renameChannelConnectionAction: (...args: unknown[]) =>
    renameChannelConnectionAction(...args),
  setChannelConnectionStatusAction: (...args: unknown[]) =>
    setChannelConnectionStatusAction(...args),
}));

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

let assignMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assignMock = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: assignMock },
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

const supportedPlatforms: ChannelConnectionListItem["platform"][] = [
  "telegram",
  "whatsapp",
  "instagram",
  "facebook",
];

describe("ChannelsPanel", () => {
  it("starts the OAuth flow and redirects to the provider's auth url on success", async () => {
    startChannelConnectionAction.mockResolvedValue({
      ok: true,
      url: "https://connect.zernio.example/oauth/authorize?state=abc",
    });

    render(<ChannelsPanel channels={baseChannels} supportedPlatforms={supportedPlatforms} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Подключить канал" }));
    // No external-id field anymore — only a name.
    expect(screen.queryByLabelText("Внешний ID аккаунта")).toBeNull();
    fireEvent.change(screen.getByLabelText("Имя подключения"), {
      target: { value: "WhatsApp Сервис" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Подключить" }));

    await waitFor(() =>
      expect(startChannelConnectionAction).toHaveBeenCalledWith({
        platform: "telegram",
        name: "WhatsApp Сервис",
      }),
    );
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith(
        "https://connect.zernio.example/oauth/authorize?state=abc",
      ),
    );
  });

  it("shows the error and keeps the form open when starting the flow fails", async () => {
    startChannelConnectionAction.mockResolvedValue({
      ok: false,
      error: "Выберите поддерживаемую платформу.",
    });

    render(<ChannelsPanel channels={baseChannels} supportedPlatforms={supportedPlatforms} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Подключить канал" }));
    fireEvent.change(screen.getByLabelText("Имя подключения"), {
      target: { value: "Некорректный" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Подключить" }));

    expect(
      await screen.findByText("Выберите поддерживаемую платформу."),
    ).toBeDefined();
    expect(screen.getByLabelText("Имя подключения")).toBeDefined();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("shows a success banner after returning from OAuth", () => {
    render(
      <ChannelsPanel
        channels={baseChannels}
        supportedPlatforms={supportedPlatforms}
        connectResult={{ status: "connected", reason: null }}
      />,
    );

    expect(screen.getByText("Канал подключён.")).toBeDefined();
  });

  it("maps a connect error reason to a friendly banner", () => {
    render(
      <ChannelsPanel
        channels={baseChannels}
        supportedPlatforms={supportedPlatforms}
        connectResult={{ status: "error", reason: "duplicate" }}
      />,
    );

    expect(
      screen.getByText("Этот аккаунт уже подключён к рабочему пространству."),
    ).toBeDefined();
  });

  it("renames a channel inline", async () => {
    renameChannelConnectionAction.mockResolvedValue({ ok: true, data: {} });

    render(<ChannelsPanel channels={baseChannels} supportedPlatforms={supportedPlatforms} />);

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

    render(<ChannelsPanel channels={baseChannels} supportedPlatforms={supportedPlatforms} />);
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

    render(<ChannelsPanel channels={baseChannels} supportedPlatforms={supportedPlatforms} />);
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));

    expect(setChannelConnectionStatusAction).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("marks a disconnected channel visually and offers to re-enable it", () => {
    const disconnected: ChannelConnectionListItem[] = [
      { ...baseChannels[0], status: "disconnected" },
    ];

    const { container } = render(
      <ChannelsPanel channels={disconnected} supportedPlatforms={supportedPlatforms} />,
    );

    expect(screen.getByRole("button", { name: "Включить" })).toBeDefined();
    expect(screen.getByText(/отключён/)).toBeDefined();
    expect(container.querySelector('[data-disconnected="true"]')).not.toBeNull();
  });
});
