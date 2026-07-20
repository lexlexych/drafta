// @vitest-environment jsdom

/**
 * Client-side behavior of the Channels panel (T-04): add form, inline
 * rename, disable/enable with confirmation. Server actions
 * (`./actions.ts`) are mocked — the actual DB-backed business logic they
 * delegate to is covered by `lib/db/channel-connections.test.ts`.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelsPanel, type ChannelConnectionListItem } from "./channels-panel";

const createChannelConnectionAction = vi.fn();
const renameChannelConnectionAction = vi.fn();
const setChannelConnectionStatusAction = vi.fn();

vi.mock("./actions", () => ({
  createChannelConnectionAction: (...args: unknown[]) =>
    createChannelConnectionAction(...args),
  renameChannelConnectionAction: (...args: unknown[]) =>
    renameChannelConnectionAction(...args),
  setChannelConnectionStatusAction: (...args: unknown[]) =>
    setChannelConnectionStatusAction(...args),
}));

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseChannels: ChannelConnectionListItem[] = [
  {
    id: "chc_telegram_shop",
    name: "Telegram Shop",
    platform: "telegram",
    externalId: "tg_shop_001",
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
  it("submits the add-channel form and refreshes on success", async () => {
    createChannelConnectionAction.mockResolvedValue({ ok: true, data: {} });

    render(<ChannelsPanel channels={baseChannels} supportedPlatforms={supportedPlatforms} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Подключить канал" }));
    fireEvent.change(screen.getByLabelText("Внешний ID аккаунта"), {
      target: { value: "wa_shop_9001" },
    });
    fireEvent.change(screen.getByLabelText("Имя подключения"), {
      target: { value: "WhatsApp Сервис" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Подключить канал" }));

    await waitFor(() =>
      expect(createChannelConnectionAction).toHaveBeenCalledWith({
        platform: "telegram",
        externalId: "wa_shop_9001",
        name: "WhatsApp Сервис",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Form closes and clears after success.
    expect(screen.queryByLabelText("Имя подключения")).toBeNull();
  });

  it("shows the friendly duplicate error and keeps the form open for correction", async () => {
    createChannelConnectionAction.mockResolvedValue({
      ok: false,
      error: "Такой канал уже подключён: этот внешний ID уже используется в этом workspace.",
    });

    render(<ChannelsPanel channels={baseChannels} supportedPlatforms={supportedPlatforms} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Подключить канал" }));
    fireEvent.change(screen.getByLabelText("Внешний ID аккаунта"), {
      target: { value: "tg_shop_001" },
    });
    fireEvent.change(screen.getByLabelText("Имя подключения"), {
      target: { value: "Telegram Дубликат" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Подключить канал" }));

    expect(
      await screen.findByText(
        "Такой канал уже подключён: этот внешний ID уже используется в этом workspace.",
      ),
    ).toBeDefined();
    expect(screen.getByLabelText("Имя подключения")).toBeDefined();
    expect(refresh).not.toHaveBeenCalled();
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
