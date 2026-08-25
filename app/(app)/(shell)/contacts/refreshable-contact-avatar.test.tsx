// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RefreshableContactAvatar } from "./refreshable-contact-avatar";

const refreshContactAvatarAction = vi.fn();

vi.mock("./actions", () => ({
  refreshContactAvatarAction: (...args: unknown[]) =>
    refreshContactAvatarAction(...args),
}));

const refreshRouter = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshRouter }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RefreshableContactAvatar", () => {
  it("loads the current avatar on an explicit click and refreshes the page data", async () => {
    refreshContactAvatarAction.mockResolvedValue({
      ok: true,
      data: { imageUrl: "/api/avatars/identity_ig?v=fresh" },
    });

    const { container } = render(
      <RefreshableContactAvatar
        contactId="contact_1"
        contactName="Anna Klein"
        avatar={{
          initials: "AK",
          hue: 120,
          imageUrl: "/api/avatars/identity_ig?v=old",
        }}
        size="md"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Обновить аватар контакта Anna Klein",
      }),
    );

    await waitFor(() =>
      expect(refreshContactAvatarAction).toHaveBeenCalledWith("contact_1"),
    );
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "/api/avatars/identity_ig?v=fresh",
      ),
    );
    expect(refreshRouter).toHaveBeenCalledTimes(1);
  });

  it("keeps the old avatar and exposes the provider error", async () => {
    refreshContactAvatarAction.mockResolvedValue({
      ok: false,
      error: "У контакта нет активного канала с поддержкой аватаров.",
    });

    const { container } = render(
      <RefreshableContactAvatar
        contactId="contact_2"
        contactName="Max Wolf"
        avatar={{
          initials: "MW",
          hue: 220,
          imageUrl: "/api/avatars/identity_tg?v=old",
        }}
        size="lg"
      />,
    );

    const button = screen.getByRole("button", {
      name: "Обновить аватар контакта Max Wolf",
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(button.getAttribute("title")).toBe(
        "У контакта нет активного канала с поддержкой аватаров.",
      ),
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/avatars/identity_tg?v=old",
    );
    expect(refreshRouter).not.toHaveBeenCalled();
  });
});
