import { describe, expect, it } from "vitest";

import { avatarProxyUrl } from "@/lib/avatars";

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
