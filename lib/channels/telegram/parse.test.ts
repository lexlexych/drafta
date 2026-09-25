import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTelegramWebhook } from "./parse";
import { botIdFromSecretToken, createTelegramWebhookSecret } from "./secret-token";

const BOT_ID = "7012345678";
const headers = { "x-telegram-bot-api-secret-token": createTelegramWebhookSecret(BOT_ID) };

function fixture(name: string): string {
  return readFileSync(join(__dirname, "__fixtures__", name), "utf8");
}

describe("parseTelegramWebhook", () => {
  it("normalizes a private text message", () => {
    const result = parseTelegramWebhook({ rawBody: fixture("private-text.json"), headers });

    expect(result.unparsed).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "message.received",
      provider: "telegram",
      platform: "telegram",
      providerEventId: `${BOT_ID}:918273645`,
      externalAccountId: BOT_ID,
      conversation: { externalId: "555001" },
      message: {
        externalId: "42",
        text: "Hallo! Habt ihr morgen geöffnet?",
        attachments: [],
        sender: { externalId: "555001", displayName: "Anna Müller" },
      },
    });
  });

  it("uses the caption as text and keeps attachments without any URL", () => {
    const result = parseTelegramWebhook({
      rawBody: fixture("private-photo-caption.json"),
      headers,
    });
    const event = result.events[0];

    expect(event.type).toBe("message.received");
    if (event.type !== "message.received") return;

    expect(event.message.text).toBe("Das ist die Rechnung");
    expect(event.message.sender.displayName).toBe("@kunde42");
    expect(event.message.attachments).toEqual([
      { type: "image" },
      { type: "file", fileName: "rechnung.pdf", mimeType: "application/pdf" },
    ]);
    for (const attachment of event.message.attachments) {
      expect(attachment.url).toBeUndefined();
    }
  });

  it("drops group messages without journaling them", () => {
    const result = parseTelegramWebhook({ rawBody: fixture("group-message.json"), headers });

    expect(result).toEqual({ events: [], unparsed: [] });
  });

  it("refuses unsupported update kinds into unparsed", () => {
    const result = parseTelegramWebhook({ rawBody: fixture("edited-message.json"), headers });

    expect(result.events).toEqual([]);
    expect(result.unparsed).toHaveLength(1);
    expect(result.unparsed[0]).toMatchObject({
      providerEventId: `${BOT_ID}:918273648`,
      externalAccountId: BOT_ID,
      platform: "telegram",
      reason: 'Unsupported Telegram update kind "edited_message".',
    });
  });

  it("refuses an update without update_id", () => {
    const result = parseTelegramWebhook({ rawBody: JSON.stringify({ foo: 1 }), headers });

    expect(result.events).toEqual([]);
    expect(result.unparsed[0]).toMatchObject({ providerEventId: null });
  });

  it("throws without a secret token header", () => {
    expect(() =>
      parseTelegramWebhook({ rawBody: fixture("private-text.json"), headers: {} }),
    ).toThrow();
  });
});

describe("telegram secret token", () => {
  it("encodes the bot id and only allowed characters", () => {
    const secret = createTelegramWebhookSecret(BOT_ID);

    expect(secret).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(botIdFromSecretToken(secret)).toBe(BOT_ID);
  });

  it("rejects values that are not ours", () => {
    expect(botIdFromSecretToken(undefined)).toBeNull();
    expect(botIdFromSecretToken("abc_def")).toBeNull();
    expect(botIdFromSecretToken("123")).toBeNull();
    expect(botIdFromSecretToken("123_a b")).toBeNull();
  });
});
