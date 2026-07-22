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

  it("sendMessage stays a NotImplemented stub without the REST config", async () => {
    const adapter = createZernioAdapter(() => "secret");

    await expect(
      adapter.sendMessage({
        channelConnectionId: "conn_1",
        externalAccountId: "acct_1",
        conversationExternalId: "chat_1",
        text: "hi",
      }),
    ).rejects.toThrow(ChannelOperationNotImplementedError);
  });

  it("sendMessage posts through the Zernio inbox API and maps the provider id", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { messageId: "zmsg_17" } }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createZernioAdapter(() => "secret", () => apiConfig);
    const result = await adapter.sendMessage({
      channelConnectionId: "conn_1",
      externalAccountId: "acct_tg_98213",
      conversationExternalId: "chat_42",
      text: "Добрый день!",
    });

    expect(result).toEqual({ providerMessageId: "zmsg_17" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://zernio.com/api/v1/inbox/conversations/chat_42/messages",
    );
    expect(JSON.parse(init.body)).toEqual({
      accountId: "acct_tg_98213",
      message: "Добрый день!",
    });
  });

  it("exposes getConnectUrl only when the API config is injected", () => {
    expect(createZernioAdapter(() => "secret").getConnectUrl).toBeUndefined();
    expect(
      createZernioAdapter(() => "secret", () => apiConfig).getConnectUrl,
    ).toBeDefined();
  });

  it("rejects connect when workspace provisioning did not persist a profile id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createZernioAdapter(() => "secret", () => apiConfig);

    await expect(
      adapter.getConnectUrl!({
        platform: "telegram",
        redirectUrl: "https://app.drafta.example/cb?cn=n1",
        providerProfileId: null,
      }),
    ).rejects.toThrow(/no Zernio profile/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getConnectUrl reuses a passed profile id (no list/create call)", async () => {
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
