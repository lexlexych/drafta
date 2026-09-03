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
  it("prefers the conversation participant picture for an Instagram DM", () => {
    const rawBody = JSON.stringify({
      id: "wh_avatar_1",
      event: "message.received",
      account: { id: "acct_ig_1", platform: "instagram" },
      conversation: {
        id: "conversation_1",
        participantPicture: "https://scontent.cdninstagram.com/profile.jpg",
      },
      message: {
        id: "message_1",
        text: "Hallo",
        sender: {
          id: "ig_user_1",
          name: "Anna",
          picture: "https://scontent.cdninstagram.com/sender.jpg",
        },
      },
    });

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(event?.type).toBe("message.received");
    expect(
      event?.type === "message.received" && event.message.sender.avatarUrl,
    ).toBe("https://scontent.cdninstagram.com/profile.jpg");
  });

  it("uses sender.picture when a conversation picture is absent", () => {
    const rawBody = JSON.stringify({
      id: "wh_avatar_2",
      event: "message.received",
      account: { id: "acct_ig_1", platform: "instagram" },
      conversation: { id: "conversation_1" },
      message: {
        id: "message_2",
        sender: {
          id: "ig_user_1",
          picture: "https://scontent.cdninstagram.com/sender.jpg",
        },
      },
    });

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;
    expect(
      event?.type === "message.received" && event.message.sender.avatarUrl,
    ).toBe("https://scontent.cdninstagram.com/sender.jpg");
  });

  it("maps a Telegram DM message.received fixture to a normalized event, field for field", () => {
    const rawBody = readFixture("telegram-dm.json");

    const events = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(events).toHaveLength(1);
    const expected: NormalizedEvent = {
      type: "message.received",
      providerEventId: "wh_evt_01HZXTELEGRAM0001",
      provider: "zernio",
      platform: "telegram",
      externalAccountId: "acct_tg_98213",
      conversation: { externalId: "tg_chat_77120" },
      message: {
        externalId: "tg_msg_55210",
        platformExternalId: "55210",
        text: "Здравствуйте! Подскажите, пожалуйста, режим работы сегодня?",
        attachments: [],
        sender: { externalId: "tg_user_44310", displayName: "Anna Keller" },
      },
      rawMetadata: JSON.parse(rawBody),
    };

    expect(events[0]).toEqual(expected);
  });

  it("maps an Instagram comment.received fixture to a normalized comment event", () => {
    const rawBody = readFixture("instagram-comment.json");

    const events = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(events).toHaveLength(1);
    const expected: NormalizedEvent = {
      type: "comment.received",
      providerEventId: "wh_evt_01HZXINSTAGRAMCMT01",
      provider: "zernio",
      platform: "instagram",
      externalAccountId: "acct_ig_55014",
      post: {
        externalId: "ig_post_88401",
        // The caption/preview/permalink ride along on the comment envelope —
        // this is what fills the post's title in «Публикации».
        text: "Робот byte (тест)",
        permalink: "https://www.instagram.com/p/ig_post_88401/",
        thumbnailUrl: "https://cdn.zernio.com/ig/ig_post_88401.jpg",
        metadata: {
          platformPostId: "ig_post_88401",
          postId: null,
          platform: "instagram",
        },
      },
      comment: {
        externalId: "ig_comment_66120",
        text: "Сколько стоит доставка по Берлину?",
        attachments: [],
        author: { externalId: "ig_user_31220", displayName: "Lena Fischer" },
      },
      rawMetadata: JSON.parse(rawBody),
    };

    expect(events[0]).toEqual(expected);
  });

  it("maps a comment reply (parentCommentId) to parentExternalId", () => {
    const rawBody = JSON.stringify({
      id: "wh_evt_reply",
      event: "comment.received",
      comment: {
        id: "ig_comment_reply_1",
        postId: null,
        platformPostId: "ig_post_88401",
        platform: "instagram",
        text: "Спасибо!",
        author: { id: "ig_user_99", username: "kunde" },
        isReply: true,
        parentCommentId: "ig_comment_66120",
      },
      post: { id: null, platformPostId: "ig_post_88401" },
      account: { id: "acct_ig_55014", platform: "instagram", username: "shop" },
    });

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(event?.type).toBe("comment.received");
    expect(event?.type === "comment.received" && event.post.externalId).toBe(
      "ig_post_88401",
    );
    expect(
      event?.type === "comment.received" && event.comment.parentExternalId,
    ).toBe("ig_comment_66120");
  });

  it("maps a conversation.started fixture: the thread plus who is on the other side", () => {
    const rawBody = readFixture("instagram-conversation-started.json");

    const events = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "conversation.started",
      providerEventId: "wh_evt_01HZXINSTAGRAMCONV01",
      provider: "zernio",
      platform: "instagram",
      externalAccountId: "acct_ig_55014",
      conversation: { externalId: "zc_conv_77120" },
      participant: {
        externalId: "ig_user_31220",
        displayName: "Lena Fischer",
        avatarUrl: "https://cdn.zernio.com/ig/ig_user_31220.jpg",
      },
      rawMetadata: JSON.parse(rawBody),
    });
  });

  it("names the participant from the conversation block on message.sent, not from the sender", () => {
    // Отправитель здесь — сам бизнес-аккаунт; принять его за контакт значило бы
    // завести контакт на самих себя.
    const rawBody = readFixture("instagram-message-sent.json");

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(event).toEqual({
      type: "message.sent",
      providerEventId: "wh_evt_01HZXINSTAGRAMSENT01",
      provider: "zernio",
      platform: "instagram",
      externalAccountId: "acct_ig_55014",
      conversation: { externalId: "zc_conv_77120" },
      participant: {
        externalId: "ig_user_31220",
        displayName: "Lena Fischer",
        avatarUrl: "https://cdn.zernio.com/ig/ig_user_31220.jpg",
      },
      message: {
        externalId: "zm_msg_88250",
        // Ключ, по которому эхо узнаёт нашу же отправку: send-эндпоинт Zernio
        // возвращает именно платформенный ID, он и лежит в `messages.external_id`.
        platformExternalId: "ig_msg_88250",
        text: "Здравствуйте! Доставка по Берлину — 4 евро.",
        attachments: [],
      },
      rawMetadata: JSON.parse(rawBody),
    });
  });

  it("keeps a thread whose participant the provider did not name", () => {
    // Тред всё равно нужен: без него отправленное сообщение некуда положить.
    const rawBody = JSON.stringify({
      id: "wh_evt_conv_2",
      event: "conversation.started",
      conversation: { id: "zc_conv_77121", status: "active" },
      account: { id: "acct_ig_55014", platform: "instagram" },
    });

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(event?.type).toBe("conversation.started");
    expect(
      event?.type === "conversation.started" && event.participant,
    ).toBeUndefined();
  });

  it("does not take a WhatsApp participant username as a name: it is the phone number again", () => {
    // У WhatsApp нет хэндлов, и Zernio кладёт в `participantUsername` номер —
    // ровно то, что уже лежит в `participantId` (`wa_id`). Взять его значило бы
    // записать контакту заглушку, выглядящую как настоящее имя, и заморозить
    // его номером: настоящее имя приходит только с первым сообщением.
    const rawBody = JSON.stringify({
      id: "wh_evt_wa_conv_1",
      event: "conversation.started",
      account: { id: "acct_wa_31207", platform: "whatsapp" },
      conversation: {
        id: "zc_wa_conv_1",
        participantId: "491512345678",
        participantName: "",
        participantUsername: "491512345678",
      },
    });

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(
      event?.type === "conversation.started" && event.participant,
    ).toEqual({
      externalId: "491512345678",
      displayName: undefined,
      avatarUrl: undefined,
    });
  });

  it("still takes a participant username that is a real handle", () => {
    // Обратная сторона: у Instagram `participantUsername` — это хэндл, он от
    // `participantId` отличается и именем быть обязан.
    const rawBody = JSON.stringify({
      id: "wh_evt_ig_conv_3",
      event: "conversation.started",
      account: { id: "acct_ig_55014", platform: "instagram" },
      conversation: {
        id: "zc_conv_77122",
        participantId: "ig_user_31220",
        participantUsername: "lena.fischer",
      },
    });

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(
      event?.type === "conversation.started" &&
        event.participant?.displayName,
    ).toBe("lena.fischer");
  });

  it("does not take a message sender name that only repeats the sender id", () => {
    const rawBody = JSON.stringify({
      id: "wh_evt_wa_msg_1",
      event: "message.received",
      account: { id: "acct_wa_31207", platform: "whatsapp" },
      conversation: { id: "zc_wa_conv_1" },
      message: {
        id: "wa_msg_1",
        text: "Добрый день!",
        sender: { id: "491512345678", name: "491512345678" },
      },
    });

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(
      event?.type === "message.received" && event.message.sender.displayName,
    ).toBeUndefined();
  });

  it("maps a post.external.created fixture to a post event — a natively published post before anyone comments", () => {
    const rawBody = readFixture("instagram-external-post.json");

    const events = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "post.published",
      providerEventId: "wh_evt_01HZXINSTAGRAMEXT01",
      provider: "zernio",
      platform: "instagram",
      externalAccountId: "acct_ig_55014",
      post: {
        // `post.id` on this envelope is the platform-native id, the same value
        // a later comment reports as `platformPostId`.
        externalId: "ig_post_88401",
        text: "Робот byte (тест)",
        permalink: "https://www.instagram.com/p/ig_post_88401/",
        thumbnailUrl: "https://cdn.zernio.com/ig/ig_post_88401.jpg",
        publishedAt: "2026-07-21T10:31:00.000Z",
        metadata: {
          platformPostId: "ig_post_88401",
          postId: null,
          platform: "instagram",
        },
      },
      rawMetadata: JSON.parse(rawBody),
    });
  });

  it("maps post.external.updated the same way (upsertPost only fills empty columns)", () => {
    const rawBody = JSON.stringify({
      id: "wh_evt_post_ext_2",
      event: "post.external.updated",
      account: { id: "acct_ig_55014", platform: "instagram" },
      post: {
        id: "ig_post_99001",
        platform: "instagram",
        content: "Осенняя коллекция уже в продаже!",
        url: "https://instagram.com/p/ig_post_99001",
        source: "external",
      },
    });

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(event?.type).toBe("post.published");
    expect(event?.type === "post.published" && event.post).toEqual({
      externalId: "ig_post_99001",
      text: "Осенняя коллекция уже в продаже!",
      permalink: "https://instagram.com/p/ig_post_99001",
      metadata: {
        platformPostId: "ig_post_99001",
        postId: null,
        platform: "instagram",
      },
    });
  });

  it("maps post.platform.published (published through Zernio) using the platform block's ids", () => {
    const rawBody = JSON.stringify({
      id: "wh_evt_post_platform_1",
      event: "post.platform.published",
      account: {
        accountId: "acct_ig_55014",
        platform: "instagram",
        username: "shop",
      },
      post: {
        id: "zernio_post_1",
        content: "Запускаем предзаказ",
        publishedAt: "2026-07-25T09:00:00.000Z",
      },
      platform: {
        name: "instagram",
        status: "published",
        platformPostId: "ig_post_99002",
        publishedUrl: "https://instagram.com/p/ig_post_99002",
      },
    });

    const [event] = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(event?.type).toBe("post.published");
    // `account.accountId` rather than `account.id`, which this envelope lacks.
    expect(event?.externalAccountId).toBe("acct_ig_55014");
    expect(event?.type === "post.published" && event.post).toEqual({
      externalId: "ig_post_99002",
      text: "Запускаем предзаказ",
      permalink: "https://instagram.com/p/ig_post_99002",
      publishedAt: "2026-07-25T09:00:00.000Z",
      metadata: {
        platformPostId: "ig_post_99002",
        postId: null,
        platform: "instagram",
      },
    });
  });

  it("skips a post.platform.failed-shaped envelope: no platform post id to list", () => {
    const rawBody = JSON.stringify({
      id: "wh_evt_post_platform_2",
      event: "post.platform.published",
      account: { accountId: "acct_ig_55014", platform: "instagram" },
      post: { id: "zernio_post_2", content: "Не опубликовалось" },
      platform: { name: "instagram", status: "failed", error: "rate limited" },
    });

    expect(parseZernioWebhook({ rawBody, headers: {} }).events).toEqual([]);
  });

  it("skips the post-level post.published rollup: it names no account, and every target arrives as post.platform.published", () => {
    const rawBody = JSON.stringify({
      id: "wh_evt_post_rollup_1",
      event: "post.published",
      post: {
        id: "zernio_post_1",
        content: "Запускаем предзаказ",
        status: "published",
        platforms: [
          {
            platform: "instagram",
            status: "published",
            accountId: "acct_ig_55014",
            platformPostId: "ig_post_99002",
          },
        ],
      },
    });

    expect(parseZernioWebhook({ rawBody, headers: {} }).events).toEqual([]);
  });

  it("maps a WhatsApp DM message.received fixture to a normalized event, field for field", () => {
    const rawBody = readFixture("whatsapp-dm.json");

    const events = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(events).toHaveLength(1);
    const expected: NormalizedEvent = {
      type: "message.received",
      providerEventId: "wh_evt_01HZXWHATSAPP0002",
      provider: "zernio",
      platform: "whatsapp",
      externalAccountId: "acct_wa_31207",
      conversation: { externalId: "wa_chat_12938" },
      message: {
        externalId: "wa_msg_88421",
        platformExternalId: "wamid.HBgLNDkxNTEyMzQ1Njc4FQIAEhg",
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

    const events = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type === "message.received" && event.message.attachments).toEqual([
      {
        type: "image",
        url: "https://media.zernio.com/wa/acct_wa_31207/img_5f3c1a.jpg",
      },
    ]);
  });

  it("skips an unknown event type instead of throwing (comment/reaction webhooks are out of DM scope)", () => {
    const rawBody = readFixture("unknown-event-type.json");

    const { events, unparsed } = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toEqual([]);
    // Refused, but not lost: the route journals this, which is what makes
    // "did the provider send it?" answerable from the database.
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0].providerEventId).toBe("wh_evt_01HZXREACTION0004");
    expect(unparsed[0].externalAccountId).toBe("acct_tg_98213");
    expect(unparsed[0].reason).toBe(
      'Unsupported event type "reaction.received"',
    );
    expect(unparsed[0].rawEnvelope).toMatchObject({
      event: "reaction.received",
    });
  });

  it("skips a message.received event for a platform this product doesn't support", () => {
    const rawBody = readFixture("unsupported-platform.json");

    const { events, unparsed } = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toEqual([]);
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0].providerEventId).toBe("wh_evt_01HZXTWITTER0005");
    expect(unparsed[0].reason).toBe('Unsupported platform "twitter"');
  });

  it("keeps parsing the rest of a batch when one event has an unknown type", () => {
    const rawBody = readFixture("batch-with-unknown-event.json");

    const { events, unparsed } = parseZernioWebhook({ rawBody, headers: {} });

    expect(events.map((event) => event.providerEventId)).toEqual([
      "wh_evt_01HZXTELEGRAM0001",
      "wh_evt_01HZXWHATSAPP0002",
    ]);
    expect(unparsed.map((envelope) => envelope.providerEventId)).toEqual([
      "wh_evt_01HZXREACTION0004",
    ]);
  });

  it("skips a malformed envelope (missing required fields) instead of throwing", () => {
    const rawBody = JSON.stringify({ not: "a zernio envelope" });

    const { events, unparsed } = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toEqual([]);
    // Nothing to key it on — the journal falls back to hashing the envelope,
    // and the payload itself survives either way.
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0].providerEventId).toBeNull();
    expect(unparsed[0].externalAccountId).toBeNull();
    expect(unparsed[0].reason).toBe(
      "Malformed envelope: missing id, event or account",
    );
    expect(unparsed[0].rawEnvelope).toEqual({ not: "a zernio envelope" });
  });

  it("wraps an envelope that is not even an object, so the journal's payload stays a JSON object", () => {
    const rawBody = JSON.stringify(["not an envelope"]);

    const { unparsed } = parseZernioWebhook({ rawBody, headers: {} });

    expect(unparsed).toHaveLength(1);
    expect(unparsed[0].rawEnvelope).toEqual({ envelope: "not an envelope" });
  });

  it("reports a message.sent event whose message block is unusable, instead of dropping it", () => {
    // The exact shape that hid a class of missing Instagram messages: the
    // adapter refuses the envelope, and the reason has to reach the journal.
    const rawBody = JSON.stringify({
      id: "wh_evt_no_sender",
      event: "message.sent",
      account: { id: "acct_ig_55014", platform: "instagram" },
      conversation: { id: "zc_conv_77120" },
      message: { id: "zm_msg_1", text: "Hallo!" },
    });

    const { events, unparsed } = parseZernioWebhook({ rawBody, headers: {} });

    expect(events).toEqual([]);
    expect(unparsed[0].reason).toBe(
      'Event "message.sent" has no usable message payload',
    );
    expect(unparsed[0].externalAccountId).toBe("acct_ig_55014");
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

    const events = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message.delivered");
  });

  it("keeps the entire raw envelope in rawMetadata, not just the normalized fields", () => {
    const rawBody = readFixture("telegram-dm.json");

    const events = parseZernioWebhook({ rawBody, headers: {} }).events;

    expect(events[0].rawMetadata).toEqual(JSON.parse(rawBody));
  });
});
