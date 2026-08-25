import { describe, expect, it } from "vitest";

import {
  avatarProxyUrl,
  AVATAR_TTL_DAYS,
  isAllowedAvatarSource,
  isAvatarStale,
} from "./avatars";

describe("contact avatars", () => {
  it("builds an authenticated proxy URL and fingerprints source changes", () => {
    const first = avatarProxyUrl("identity 1", "https://scontent.cdninstagram.com/a.jpg");
    const second = avatarProxyUrl("identity 1", "https://scontent.cdninstagram.com/b.jpg");

    expect(first).toMatch(/^\/api\/avatars\/identity%201\?v=/);
    expect(second).not.toBe(first);
    expect(avatarProxyUrl("identity 1", null)).toBeNull();
  });

  it("refreshes signed provider URLs after the configured TTL", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    expect(
      isAvatarStale(
        new Date(now.getTime() - (AVATAR_TTL_DAYS - 1) * 86_400_000).toISOString(),
        now,
      ),
    ).toBe(false);
    expect(
      isAvatarStale(
        new Date(now.getTime() - AVATAR_TTL_DAYS * 86_400_000).toISOString(),
        now,
      ),
    ).toBe(true);
    expect(isAvatarStale(null, now)).toBe(true);
  });

  it("allows only HTTPS Meta image CDNs used by Instagram avatars", () => {
    expect(
      isAllowedAvatarSource("https://scontent-fra3-1.cdninstagram.com/p.jpg?sig=1"),
    ).toBe(true);
    expect(isAllowedAvatarSource("https://platform-lookaside.fbsbx.com/p.jpg")).toBe(
      false,
    );
    expect(isAllowedAvatarSource("https://scontent.xx.fbcdn.net/p.jpg")).toBe(true);
    expect(isAllowedAvatarSource("http://scontent.xx.fbcdn.net/p.jpg")).toBe(false);
    expect(isAllowedAvatarSource("https://fbcdn.net.attacker.example/p.jpg")).toBe(
      false,
    );
    expect(isAllowedAvatarSource("https://127.0.0.1/p.jpg")).toBe(false);
  });
});
