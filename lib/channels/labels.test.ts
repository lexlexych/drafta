import { describe, expect, it } from "vitest";

import { buildChannelConnectionName, CHANNEL_PLATFORM_LABELS } from "./labels";

describe("buildChannelConnectionName", () => {
  it("names the connection after the authorized account", () => {
    expect(buildChannelConnectionName("instagram", "tonwerk.studio")).toBe(
      "tonwerk.studio",
    );
  });

  it("trims what the provider reported", () => {
    expect(buildChannelConnectionName("instagram", "  tonwerk  ")).toBe("tonwerk");
  });

  it("falls back to the platform label when there is no account name", () => {
    expect(buildChannelConnectionName("instagram")).toBe("Instagram");
    expect(buildChannelConnectionName("telegram", null)).toBe("Telegram");
    expect(buildChannelConnectionName("whatsapp", "   ")).toBe("WhatsApp");
  });

  it("labels every supported platform", () => {
    expect(Object.values(CHANNEL_PLATFORM_LABELS).every(Boolean)).toBe(true);
  });
});
