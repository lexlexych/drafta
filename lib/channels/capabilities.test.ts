import { describe, expect, it } from "vitest";

import {
  CHANNEL_PLATFORMS,
  DEFAULT_CHANNEL_CAPABILITIES,
  getDefaultChannelCapabilities,
  isChannelPlatform,
} from "./capabilities";
import type { ChannelPlatform } from "./types";

const PLATFORMS: ChannelPlatform[] = [
  "telegram",
  "whatsapp",
  "instagram",
  "facebook",
  "linkedin",
];

describe("channel capabilities", () => {
  it("defines defaults for exactly the five supported platforms", () => {
    expect(Object.keys(DEFAULT_CHANNEL_CAPABILITIES).sort()).toEqual(
      [...PLATFORMS].sort(),
    );
  });

  it.each(PLATFORMS)("provides a full capability set for %s", (platform) => {
    const capabilities = DEFAULT_CHANNEL_CAPABILITIES[platform];

    expect(typeof capabilities.supportsAttachments).toBe("boolean");
    expect(typeof capabilities.supportsReadReceipts).toBe("boolean");
    expect(typeof capabilities.supportsComments).toBe("boolean");
    expect(["flat", "parent", "email-headers"]).toContain(
      capabilities.threadingStyle,
    );
  });

  it("gives WhatsApp a 24-hour response window, per architecture §5", () => {
    expect(DEFAULT_CHANNEL_CAPABILITIES.whatsapp.responseWindowHours).toBe(
      24,
    );
  });

  it("gives Telegram no response window", () => {
    expect(
      DEFAULT_CHANNEL_CAPABILITIES.telegram.responseWindowHours,
    ).toBeNull();
  });

  it("exposes the same platform list for name checks", () => {
    expect([...CHANNEL_PLATFORMS].sort()).toEqual([...PLATFORMS].sort());
    expect(isChannelPlatform("linkedin")).toBe(true);
    expect(isChannelPlatform("tiktok")).toBe(false);
    expect(isChannelPlatform("toString")).toBe(false);
  });

  it("gives LinkedIn comments (company-page defaults) but no DMs features", () => {
    expect(DEFAULT_CHANNEL_CAPABILITIES.linkedin).toMatchObject({
      supportsComments: true,
      supportsPrivateReply: false,
      privateReplyWindowHours: null,
      threadingStyle: "parent",
    });
  });

  it("marks comment support only for Instagram, Facebook and LinkedIn", () => {
    expect(DEFAULT_CHANNEL_CAPABILITIES.instagram.supportsComments).toBe(
      true,
    );
    expect(DEFAULT_CHANNEL_CAPABILITIES.facebook.supportsComments).toBe(
      true,
    );
    expect(DEFAULT_CHANNEL_CAPABILITIES.linkedin.supportsComments).toBe(
      true,
    );
    expect(DEFAULT_CHANNEL_CAPABILITIES.telegram.supportsComments).toBe(
      false,
    );
    expect(DEFAULT_CHANNEL_CAPABILITIES.whatsapp.supportsComments).toBe(
      false,
    );
  });

  it("getDefaultChannelCapabilities returns an independent copy", () => {
    const copy = getDefaultChannelCapabilities("telegram");
    copy.supportsAttachments = false;

    expect(DEFAULT_CHANNEL_CAPABILITIES.telegram.supportsAttachments).toBe(
      true,
    );
  });
});
