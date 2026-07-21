import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createZernioProfile,
  getZernioConnectAuthUrl,
  ZernioApiError,
} from "./api";

const config = { apiBaseUrl: "https://zernio.com/api/v1", apiKey: "zk_test_123" };

function mockFetch(response: { ok: boolean; status?: number; json?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: async () => response.json,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createZernioProfile", () => {
  it("POSTs to /profiles with Bearer auth and returns the _id", async () => {
    const fetchMock = mockFetch({ ok: true, json: { _id: "prof_abc123" } });

    const id = await createZernioProfile(config, { name: "Acme" });

    expect(id).toBe("prof_abc123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/profiles");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer zk_test_123");
    expect(JSON.parse(init.body)).toMatchObject({ name: "Acme" });
  });

  it("throws ZernioApiError on a non-2xx response", async () => {
    mockFetch({ ok: false, status: 500, json: null });

    await expect(createZernioProfile(config, { name: "Acme" })).rejects.toThrow(
      ZernioApiError,
    );
  });

  it("throws when the response is missing _id", async () => {
    mockFetch({ ok: true, json: {} });

    await expect(createZernioProfile(config, { name: "Acme" })).rejects.toThrow(
      ZernioApiError,
    );
  });
});

describe("getZernioConnectAuthUrl", () => {
  it("GETs /connect/{platform} with profileId + redirect_url and returns authUrl", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: { authUrl: "https://api.telegram.org/auth?x=1", state: "z1" },
    });

    const authUrl = await getZernioConnectAuthUrl(config, {
      platform: "telegram",
      profileId: "prof_abc123",
      redirectUrl: "https://app.drafta.example/api/channels/zernio/connect/callback?cn=n1",
    });

    expect(authUrl).toBe("https://api.telegram.org/auth?x=1");
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://zernio.com/api/v1/connect/telegram",
    );
    expect(parsed.searchParams.get("profileId")).toBe("prof_abc123");
    expect(parsed.searchParams.get("redirect_url")).toBe(
      "https://app.drafta.example/api/channels/zernio/connect/callback?cn=n1",
    );
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer zk_test_123");
  });

  it("throws when the response is missing authUrl", async () => {
    mockFetch({ ok: true, json: {} });

    await expect(
      getZernioConnectAuthUrl(config, {
        platform: "telegram",
        profileId: "prof_1",
        redirectUrl: "https://app.example/cb",
      }),
    ).rejects.toThrow(ZernioApiError);
  });
});
