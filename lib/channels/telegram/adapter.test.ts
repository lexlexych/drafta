import { describe, expect, it, vi } from "vitest";

import { isNonRetriableSendError } from "@/lib/jobs/send-pipeline";

import { createTelegramAdapter, type TelegramBotCredentials } from "./adapter";
import { TelegramApiError } from "./api";
import { inspectTelegramBotToken, registerTelegramWebhook } from "./connect";
import { createTelegramWebhookSecret } from "./secret-token";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/channels/zernio", () => ({}));
vi.mock("@/lib/channels/telegram", () => ({}));

const BOT_ID = "7012345678";
const TOKEN = `${BOT_ID}:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`;
const SECRET = createTelegramWebhookSecret(BOT_ID);
const CREDENTIALS: TelegramBotCredentials = { botToken: TOKEN, webhookSecret: SECRET };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeAdapter(
  fetchImpl: typeof fetch,
  credentials: TelegramBotCredentials | null = CREDENTIALS,
) {
  const getCredentials = vi.fn(async (botId: string) =>
    botId === BOT_ID ? credentials : null,
  );
  return {
    adapter: createTelegramAdapter({ getCredentials, api: { fetchImpl } }),
    getCredentials,
  };
}

describe("telegram adapter — verifyWebhook", () => {
  const fetchImpl = vi.fn() as unknown as typeof fetch;

  it("accepts the stored secret", async () => {
    const { adapter } = makeAdapter(fetchImpl);
    await expect(
      adapter.verifyWebhook({
        rawBody: "{}",
        headers: { "x-telegram-bot-api-secret-token": SECRET },
      }),
    ).resolves.toBe(true);
  });

  it("rejects a wrong, missing, malformed or unknown-bot secret", async () => {
    const { adapter } = makeAdapter(fetchImpl);
    const verify = (value?: string) =>
      adapter.verifyWebhook({
        rawBody: "{}",
        headers: value ? { "x-telegram-bot-api-secret-token": value } : {},
      });

    await expect(verify(createTelegramWebhookSecret(BOT_ID))).resolves.toBe(false);
    await expect(verify(`${SECRET}x`)).resolves.toBe(false);
    await expect(verify()).resolves.toBe(false);
    await expect(verify("garbage")).resolves.toBe(false);
    await expect(verify(createTelegramWebhookSecret("999"))).resolves.toBe(false);
  });
});

describe("telegram adapter — sendMessage", () => {
  it("sends text to the chat and returns the Telegram message id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, result: { message_id: 77 } }),
    ) as unknown as typeof fetch;
    const { adapter } = makeAdapter(fetchImpl);

    const result = await adapter.sendMessage({
      channelConnectionId: "00000000-0000-0000-0000-000000000001",
      externalAccountId: BOT_ID,
      conversationExternalId: "555001",
      text: "Ja, bis 18 Uhr!",
    });

    expect(result).toEqual({ providerMessageId: "77" });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(init.body)).toEqual({ chat_id: "555001", text: "Ja, bis 18 Uhr!" });
  });

  it("maps Telegram errors to a status and never leaks the token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
        403,
      ),
    ) as unknown as typeof fetch;
    const { adapter } = makeAdapter(fetchImpl);

    const error = await adapter
      .sendMessage({
        channelConnectionId: "c",
        externalAccountId: BOT_ID,
        conversationExternalId: "555001",
        text: "hi",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).status).toBe(403);
    expect((error as Error).message).not.toContain(TOKEN);
    expect(isNonRetriableSendError(error)).toBe(true);
  });

  it("keeps 429 retriable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 3 } },
        429,
      ),
    ) as unknown as typeof fetch;
    const { adapter } = makeAdapter(fetchImpl);

    const error = (await adapter
      .sendMessage({ channelConnectionId: "c", externalAccountId: BOT_ID, conversationExternalId: "1", text: "x" })
      .catch((caught: unknown) => caught)) as TelegramApiError;

    expect(error.retryAfter).toBe(3);
    expect(isNonRetriableSendError(error)).toBe(false);
  });

  it("hides network errors behind a generic message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
    }) as unknown as typeof fetch;
    const { adapter } = makeAdapter(fetchImpl);

    const error = (await adapter
      .sendMessage({ channelConnectionId: "c", externalAccountId: BOT_ID, conversationExternalId: "1", text: "x" })
      .catch((caught: unknown) => caught)) as Error;

    expect(error.message).toBe("Telegram sendMessage: network error.");
  });

  it("fails non-retriably without stored credentials", async () => {
    const { adapter } = makeAdapter(vi.fn() as unknown as typeof fetch, null);

    const error = await adapter
      .sendMessage({ channelConnectionId: "c", externalAccountId: BOT_ID, conversationExternalId: "1", text: "x" })
      .catch((caught: unknown) => caught);

    expect(isNonRetriableSendError(error)).toBe(true);
  });
});

describe("telegram adapter — disconnectAccount", () => {
  it("deletes the webhook", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result: true })) as unknown as typeof fetch;
    const { adapter } = makeAdapter(fetchImpl);

    await adapter.disconnectAccount!({ externalAccountId: BOT_ID });

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`);
  });

  it("is idempotent for a revoked token or missing credentials", async () => {
    const revoked = vi.fn(async () =>
      jsonResponse({ ok: false, error_code: 401, description: "Unauthorized" }, 401),
    ) as unknown as typeof fetch;
    await expect(
      makeAdapter(revoked).adapter.disconnectAccount!({ externalAccountId: BOT_ID }),
    ).resolves.toBeUndefined();

    const untouched = vi.fn() as unknown as typeof fetch;
    await expect(
      makeAdapter(untouched, null).adapter.disconnectAccount!({ externalAccountId: BOT_ID }),
    ).resolves.toBeUndefined();
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe("telegram connect", () => {
  it("rejects a malformed token without calling Telegram", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(inspectTelegramBotToken("not-a-token", { fetchImpl })).resolves.toEqual({
      ok: false,
      reason: "invalid-format",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the bot identity and a fresh webhook secret", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ok: true,
        result: { id: Number(BOT_ID), is_bot: true, first_name: "Shop", username: "drafta_shop_bot" },
      }),
    ) as unknown as typeof fetch;

    const result = await inspectTelegramBotToken(TOKEN, { fetchImpl });

    expect(result).toMatchObject({ ok: true, botId: BOT_ID, username: "drafta_shop_bot" });
    if (result.ok) {
      expect(result.webhookSecret.startsWith(`${BOT_ID}_`)).toBe(true);
    }
  });

  it("reports a token Telegram rejects", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, error_code: 401, description: "Unauthorized" }, 401),
    ) as unknown as typeof fetch;

    await expect(inspectTelegramBotToken(TOKEN, { fetchImpl })).resolves.toEqual({
      ok: false,
      reason: "invalid-token",
    });
  });

  it("registers the webhook for private messages only", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result: true })) as unknown as typeof fetch;

    await registerTelegramWebhook(
      TOKEN,
      { url: "https://app.drafta.test/api/webhooks/telegram", webhookSecret: SECRET },
      { fetchImpl },
    );

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/setWebhook`);
    expect(JSON.parse(init.body)).toEqual({
      url: "https://app.drafta.test/api/webhooks/telegram",
      secret_token: SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
  });
});
