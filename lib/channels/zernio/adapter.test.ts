import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ChannelOperationNotImplementedError } from "../types";
import { createZernioAdapter } from "./adapter";

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

  it("exposes getConnectUrl only when connect config is injected", async () => {
    const withoutConfig = createZernioAdapter(() => "secret");
    expect(withoutConfig.getConnectUrl).toBeUndefined();

    const withConfig = createZernioAdapter(() => "secret", () => ({
      connectUrl: "https://connect.zernio.example/oauth/authorize",
      apiKey: "zk_test_123",
    }));
    expect(withConfig.getConnectUrl).toBeDefined();

    const url = new URL(
      await withConfig.getConnectUrl!({
        workspaceId: "ws_1",
        platform: "telegram",
        redirectUrl: "https://app.drafta.example/api/channels/zernio/connect/callback",
        state: "signed.state",
      }),
    );
    expect(url.searchParams.get("platform")).toBe("telegram");
    expect(url.searchParams.get("state")).toBe("signed.state");
  });

  it("parseConnectCallback turns the provider's callback query into the account id", async () => {
    const adapter = createZernioAdapter(() => "secret");

    expect(adapter.parseConnectCallback).toBeDefined();
    const result = await adapter.parseConnectCallback!({
      query: { account_id: "acct_tg_98213" },
    });
    expect(result.externalAccountId).toBe("acct_tg_98213");
  });
});
