import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { NormalizedEvent } from "../types";
import { parseZernioWebhook } from "./parse";

function readFixture(name: string): string {
  const path = fileURLToPath(
    new URL(`./__fixtures__/${name}`, import.meta.url),
  );
  return readFileSync(path, "utf8");
}

describe("parseZernioWebhook", () => {
  it("maps a Telegram DM message.received fixture to a normalized event, field for field", () => {
    const rawBody = readFixture("telegram-dm.json");

    const events = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toHaveLength(1);
    const expected: NormalizedEvent = {
      type: "message.received",
      providerEventId: "wh_evt_01HZXTELEGRAM0001",
      provider: "zernio",
      platform: "telegram",
      externalAccountId: "acct_tg_98213",
      interactionKind: "dm",
      conversation: { externalId: "tg_chat_77120" },
      message: {
        externalId: "tg_msg_55210",
        text: "Здравствуйте! Подскажите, пожалуйста, режим работы сегодня?",
        attachments: [],
        sender: { externalId: "tg_user_44310", displayName: "Anna Keller" },
      },
      rawMetadata: JSON.parse(rawBody),
    };

    expect(events[0]).toEqual(expected);
  });

  it("maps a WhatsApp DM message.received fixture to a normalized event, field for field", () => {
    const rawBody = readFixture("whatsapp-dm.json");

    const events = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toHaveLength(1);
    const expected: NormalizedEvent = {
      type: "message.received",
      providerEventId: "wh_evt_01HZXWHATSAPP0002",
      provider: "zernio",
      platform: "whatsapp",
      externalAccountId: "acct_wa_31207",
      interactionKind: "dm",
      conversation: { externalId: "wa_chat_12938" },
      message: {
        externalId: "wa_msg_88421",
        text: "Добрый день! Можно узнать статус заказа №4521?",
        attachments: [],
        sender: {
          externalId: "wa_user_60214",
          displayName: "+49 151 2345678",
        },
      },
      rawMetadata: JSON.parse(rawBody),
    };

    expect(events[0]).toEqual(expected);
  });

  it("maps attachment metadata (type/url) from a fixture with an attachment; fileName/mimeType stay undefined (not in Zernio's real schema)", () => {
    const rawBody = readFixture("whatsapp-dm-with-attachment.json");

    const events = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toHaveLength(1);
    expect(events[0].message.attachments).toEqual([
      {
        type: "image",
        url: "https://media.zernio.com/wa/acct_wa_31207/img_5f3c1a.jpg",
      },
    ]);
  });

  it("skips an unknown event type instead of throwing (comment/reaction webhooks are out of DM scope)", () => {
    const rawBody = readFixture("unknown-event-type.json");

    const events = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toEqual([]);
  });

  it("skips a message.received event for a platform this product doesn't support", () => {
    const rawBody = readFixture("unsupported-platform.json");

    const events = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toEqual([]);
  });

  it("keeps parsing the rest of a batch when one event has an unknown type", () => {
    const rawBody = readFixture("batch-with-unknown-event.json");

    const events = parseZernioWebhook({ rawBody, headers: {} });

    expect(events.map((event) => event.providerEventId)).toEqual([
      "wh_evt_01HZXTELEGRAM0001",
      "wh_evt_01HZXWHATSAPP0002",
    ]);
  });

  it("skips a malformed envelope (missing required fields) instead of throwing", () => {
    const rawBody = JSON.stringify({ not: "a zernio envelope" });

    expect(parseZernioWebhook({ rawBody, headers: {} })).toEqual([]);
  });

  it("maps message.delivered using the same envelope shape as message.received", () => {
    const rawBody = JSON.stringify({
      id: "wh_evt_delivered_1",
      event: "message.delivered",
      account: { id: "acct_tg_98213", platform: "telegram" },
      conversation: { id: "tg_chat_77120" },
      message: {
        id: "tg_msg_out_1",
        sender: { id: "acct_tg_98213", name: null },
      },
    });

    const events = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message.delivered");
  });

  it("keeps the entire raw envelope in rawMetadata, not just the normalized fields", () => {
    const rawBody = readFixture("telegram-dm.json");

    const events = parseZernioWebhook({ rawBody, headers: {} });

    expect(events[0].rawMetadata).toEqual(JSON.parse(rawBody));
  });
});
