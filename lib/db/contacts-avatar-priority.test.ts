import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { contactAvatarPlatformRank } = await import("./contacts");

describe("contact avatar platform priority", () => {
  it("prefers Instagram, Facebook, Telegram and WhatsApp in that order", () => {
    const platforms = [
      "email",
      "whatsapp",
      "telegram",
      "facebook",
      "instagram",
      "custom",
    ];

    expect(
      platforms
        .map((platform, index) => ({ platform, index }))
        .sort(
          (left, right) =>
            contactAvatarPlatformRank(left.platform) -
              contactAvatarPlatformRank(right.platform) ||
            left.index - right.index,
        )
        .map(({ platform }) => platform),
    ).toEqual([
      "instagram",
      "facebook",
      "telegram",
      "whatsapp",
      "email",
      "custom",
    ]);
  });
});
