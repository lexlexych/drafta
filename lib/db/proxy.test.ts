import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { updateSession } from "./proxy";

type CookieAdapter = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (
    cookiesToSet: Array<{
      name: string;
      options: Record<string, unknown>;
      value: string;
    }>,
    headers: Record<string, string>,
  ) => void;
};

describe("updateSession", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    mocks.getClaims.mockReset();
    mocks.createServerClient.mockReset();
    mocks.createServerClient.mockImplementation(() => ({
      auth: {
        getClaims: mocks.getClaims,
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects an unauthenticated protected request and preserves refreshed cookies", async () => {
    mocks.getClaims.mockImplementation(async () => {
      const cookieAdapter = mocks.createServerClient.mock.calls[0][2]
        .cookies as CookieAdapter;

      cookieAdapter.setAll(
        [
          {
            name: "sb-example-auth-token",
            options: { path: "/" },
            value: "refreshed-token",
          },
        ],
        { "Cache-Control": "private, no-store" },
      );

      return { data: null, error: null };
    });

    const response = await updateSession(
      new NextRequest("https://drafta.test/dashboard?tab=overview"),
    );

    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://drafta.test/login?next=%2Fdashboard%3Ftab%3Doverview",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.cookies.get("sb-example-auth-token")?.value).toBe(
      "refreshed-token",
    );
  });

  it("sends an authenticated user away from a login page", async () => {
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: "5ba5cb5b-826a-4aa2-bfab-2a0b38f2d170",
        },
      },
      error: null,
    });

    const response = await updateSession(
      new NextRequest("https://drafta.test/login"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://drafta.test/dashboard",
    );
  });

  it("keeps the password-recovery page available for a recovery session", async () => {
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: "5ba5cb5b-826a-4aa2-bfab-2a0b38f2d170",
        },
      },
      error: null,
    });

    const response = await updateSession(
      new NextRequest("https://drafta.test/update-password"),
    );

    expect(response.status).toBe(200);
  });

  it("lets both exact email callback routes exchange their PKCE code", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });

    for (const pathname of ["/auth/confirm", "/auth/recovery"]) {
      const response = await updateSession(
        new NextRequest(`https://drafta.test${pathname}?code=pkce-code`),
      );

      expect(response.status).toBe(200);
    }
  });
});
