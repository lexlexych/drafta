import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelOperationNotImplementedError } from "../types";
import { createZernioAdapter } from "./adapter";

const apiConfig = { apiBaseUrl: "https://zernio.com/api/v1", apiKey: "zk_test" };

afterEach(() => {
  vi.unstubAllGlobals();
});

function readFixture(name: string): string {
  const path = fileURLToPath(
    new URL(`./__fixtures__/${name}`, import.meta.url),
  );
  return readFileSync(path, "utf8");
}

describe("createZernioAdapter", () => {
  it("identifies itself as the zernio provider", () => {
    const adapter = createZernioAdapter(() => "secret");

    expect(adapter.provider).toBe("zernio");
  });

  it("verifyWebhook delegates to HMAC verification using the injected secret getter", () => {
    const secret = "injected-secret";
    const adapter = createZernioAdapter(() => secret);
    const rawBody = readFixture("telegram-dm.json");
    const validSignature = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("hex");

    expect(
      adapter.verifyWebhook({
        rawBody,
        headers: { "x-zernio-signature": validSignature },
      }),
    ).toBe(true);
    expect(
      adapter.verifyWebhook({
        rawBody,
        headers: { "x-zernio-signature": "0".repeat(64) },
      }),
    ).toBe(false);
  });

  it("parseWebhook delegates to the Zernio payload parser", () => {
    const adapter = createZernioAdapter(() => "secret");
    const rawBody = readFixture("telegram-dm.json");

    const events = adapter.parseWebhook({ rawBody, headers: {} });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message.received");
    expect(events[0].provider).toBe("zernio");
  });

  it("sendMessage is an explicit NotImplemented stub (outgoing sends are stage 3)", async () => {
    const adapter = createZernioAdapter(() => "secret");

    await expect(
      adapter.sendMessage({
        channelConnectionId: "conn_1",
        conversationExternalId: "chat_1",
        text: "hi",
      }),
    ).rejects.toThrow(ChannelOperationNotImplementedError);
  });

  it("exposes getConnectUrl only when the API config is injected", () => {
    expect(createZernioAdapter(() => "secret").getConnectUrl).toBeUndefined();
    expect(
      createZernioAdapter(() => "secret", () => apiConfig).getConnectUrl,
    ).toBeDefined();
  });

  it("getConnectUrl creates a profile when none is passed, then returns authUrl + the new id", async () => {
    const fetchMock = vi
      .fn()
      // POST /profiles -> 201 { message, profile: { _id } }
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ message: "Profile created successfully", profile: { _id: "prof_new" } }),
      })
      // GET /connect/telegram
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authUrl: "https://api.telegram.org/auth" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createZernioAdapter(() => "secret", () => apiConfig);
    const result = await adapter.getConnectUrl!({
      platform: "telegram",
      redirectUrl: "https://app.drafta.example/api/channels/zernio/connect/callback?cn=n1",
      providerProfileId: null,
      profileName: "Acme",
    });

    expect(result).toEqual({
      url: "https://api.telegram.org/auth",
      providerProfileId: "prof_new",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://zernio.com/api/v1/profiles");
  });

  it("getConnectUrl reuses an existing profile id (no profile creation call)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ authUrl: "https://api.telegram.org/auth" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createZernioAdapter(() => "secret", () => apiConfig);
    const result = await adapter.getConnectUrl!({
      platform: "telegram",
      redirectUrl: "https://app.drafta.example/cb?cn=n1",
      providerProfileId: "prof_existing",
      profileName: "Acme",
    });

    expect(result.providerProfileId).toBe("prof_existing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe(
      "/api/v1/connect/telegram",
    );
  });

  it("parseConnectCallback turns the provider's callback query into the account id", async () => {
    const adapter = createZernioAdapter(() => "secret");

    expect(adapter.parseConnectCallback).toBeDefined();
    const result = await adapter.parseConnectCallback!({
      query: { accountId: "acct_tg_98213", connected: "telegram" },
    });
    expect(result.externalAccountId).toBe("acct_tg_98213");
    expect(result.platform).toBe("telegram");
  });
});
