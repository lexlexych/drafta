import { describe, expect, it } from "vitest";

import {
  defaultAuthenticatedPath,
  getSafeRedirectPath,
} from "./redirects";

describe("getSafeRedirectPath", () => {
  it("keeps an application-relative path and its query", () => {
    expect(getSafeRedirectPath("/inbox?filter=unread#top")).toBe(
      "/inbox?filter=unread#top",
    );
  });

  it("uses the fallback for an absent or external redirect", () => {
    expect(getSafeRedirectPath(null)).toBe(defaultAuthenticatedPath);
    expect(getSafeRedirectPath("https://example.com")).toBe(
      defaultAuthenticatedPath,
    );
    expect(getSafeRedirectPath("//example.com")).toBe(defaultAuthenticatedPath);
    expect(getSafeRedirectPath("/\\example.com")).toBe(
      defaultAuthenticatedPath,
    );
  });

  it("accepts an explicit fallback", () => {
    expect(getSafeRedirectPath("https://example.com", "/login")).toBe("/login");
  });
});
