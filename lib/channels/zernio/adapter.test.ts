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
});
