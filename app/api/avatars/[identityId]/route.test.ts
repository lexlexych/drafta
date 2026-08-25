import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createServerSupabaseClientMock = vi.fn();
vi.mock("@/lib/db/server", () => ({
  createServerSupabaseClient: () => createServerSupabaseClientMock(),
}));

const { GET } = await import("./route");

function mockIdentity(avatarUrl: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: avatarUrl ? { avatar_url: avatarUrl } : null,
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  createServerSupabaseClientMock.mockResolvedValue({
    from: vi.fn(() => ({ select })),
  });
}

afterEach(() => {
  createServerSupabaseClientMock.mockReset();
  vi.unstubAllGlobals();
});

describe("GET /api/avatars/[identityId]", () => {
  it("proxies a trusted Instagram CDN image with private caching", async () => {
    mockIdentity("https://scontent-fra3-1.cdninstagram.com/avatar.jpg");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET({} as never, {
      params: Promise.resolve({ identityId: "identity_1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("rejects an untrusted source without making an outbound request", async () => {
    mockIdentity("https://attacker.example/avatar.jpg");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET({} as never, {
      params: Promise.resolve({ identityId: "identity_1" }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a redirect from a trusted CDN to an untrusted host", async () => {
    mockIdentity("https://scontent.cdninstagram.com/avatar.jpg");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://127.0.0.1/internal" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET({} as never, {
      params: Promise.resolve({ identityId: "identity_1" }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
