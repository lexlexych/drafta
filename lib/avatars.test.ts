import { describe, expect, it } from "vitest";

import { AVATAR_TTL_DAYS, avatarProxyUrl, isAvatarStale } from "@/lib/avatars";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = "2026-07-30T12:00:00.000Z";

function daysAgo(days: number): string {
  return new Date(Date.parse(now) - days * DAY_MS).toISOString();
}

describe("isAvatarStale", () => {
  it("is stale when the provider has never been asked", () => {
    expect(isAvatarStale(null, now)).toBe(true);
    expect(isAvatarStale(undefined, now)).toBe(true);
  });

  it("is fresh inside the TTL and stale past it", () => {
    expect(isAvatarStale(daysAgo(AVATAR_TTL_DAYS - 1), now)).toBe(false);
    expect(isAvatarStale(daysAgo(AVATAR_TTL_DAYS + 1), now)).toBe(true);
  });

  it("treats an unparseable timestamp as never fetched, so it self-heals", () => {
    expect(isAvatarStale("not-a-date", now)).toBe(true);
  });
});

describe("avatarProxyUrl", () => {
  it("points at our proxy route, never at the platform CDN", () => {
    const url = avatarProxyUrl(
      "11111111-1111-4111-8111-111111111111",
      "https://scontent.cdninstagram.com/v/photo.jpg",
    );

    expect(url).toMatch(
      /^\/api\/avatars\/11111111-1111-4111-8111-111111111111\?v=[0-9a-z]+$/,
    );
    expect(url).not.toContain("cdninstagram");
  });

  it("changes the fingerprint when the stored picture changes", () => {
    const before = avatarProxyUrl("identity-1", "https://cdn.example/one.jpg");
    const after = avatarProxyUrl("identity-1", "https://cdn.example/two.jpg");

    // Same route, different `v` — otherwise the browser would keep serving the
    // previous photo out of its private cache for a day.
    expect(before).not.toBe(after);
  });

  it("is stable for an unchanged picture", () => {
    expect(avatarProxyUrl("identity-1", "https://cdn.example/one.jpg")).toBe(
      avatarProxyUrl("identity-1", "https://cdn.example/one.jpg"),
    );
  });

  it("returns null when the platform reported no picture", () => {
    expect(avatarProxyUrl("identity-1", null)).toBeNull();
    expect(avatarProxyUrl("identity-1", undefined)).toBeNull();
    expect(avatarProxyUrl("identity-1", "   ")).toBeNull();
  });
});
