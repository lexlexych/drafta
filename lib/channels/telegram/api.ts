/**
 * Thin client for the Telegram Bot API (https://core.telegram.org/bots/api).
 *
 * Every call is `POST https://api.telegram.org/bot<token>/<method>` with a
 * JSON body; Telegram answers `{ ok: true, result }` or
 * `{ ok: false, error_code, description, parameters? }`.
 *
 * The bot token is part of the URL, so nothing here ever logs a URL or puts
 * one into an error: `TelegramApiError` carries only the method name,
 * Telegram's `error_code` and its description (which never echoes the token).
 * Network failures are rethrown with a generic message for the same reason —
 * the runtime's own fetch error may name the request URL.
 */

export const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

export class TelegramApiError extends Error {
  constructor(
    message: string,
    /**
     * Telegram's `error_code` (HTTP-like: 400, 401, 403, 429…). Named `status`
     * so the send pipeline's `isNonRetriableSendError` classifies it the same
     * way it classifies every other provider's HTTP errors.
     */
    readonly status?: number,
    /** Seconds to wait before retrying, when Telegram rate-limits (429). */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export interface TelegramApiOptions {
  /** Overridable for tests. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export async function callTelegramApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  options: TelegramApiOptions = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? TELEGRAM_API_BASE_URL;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new TelegramApiError(`Telegram ${method}: network error.`);
  }

  let payload: TelegramResponse<T> | null = null;
  try {
    payload = (await response.json()) as TelegramResponse<T>;
  } catch {
    payload = null;
  }

  if (!payload || !payload.ok) {
    const status = payload?.error_code ?? response.status;
    const description = payload?.description ?? `HTTP ${response.status}`;
    throw new TelegramApiError(
      `Telegram ${method} failed: ${description}`,
      status,
      payload?.parameters?.retry_after,
    );
  }

  return payload.result as T;
}

export interface TelegramBotUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export function getMe(
  token: string,
  options?: TelegramApiOptions,
): Promise<TelegramBotUser> {
  return callTelegramApi<TelegramBotUser>(token, "getMe", {}, options);
}

export interface SetWebhookParams {
  url: string;
  secretToken: string;
  allowedUpdates: string[];
  dropPendingUpdates?: boolean;
}

export async function setWebhook(
  token: string,
  params: SetWebhookParams,
  options?: TelegramApiOptions,
): Promise<void> {
  await callTelegramApi<boolean>(
    token,
    "setWebhook",
    {
      url: params.url,
      secret_token: params.secretToken,
      allowed_updates: params.allowedUpdates,
      drop_pending_updates: params.dropPendingUpdates ?? false,
    },
    options,
  );
}

export async function deleteWebhook(
  token: string,
  options?: TelegramApiOptions,
): Promise<void> {
  await callTelegramApi<boolean>(token, "deleteWebhook", {}, options);
}

export interface TelegramSentMessage {
  message_id: number;
}

export function sendTextMessage(
  token: string,
  params: { chatId: string; text: string },
  options?: TelegramApiOptions,
): Promise<TelegramSentMessage> {
  return callTelegramApi<TelegramSentMessage>(
    token,
    "sendMessage",
    { chat_id: params.chatId, text: params.text },
    options,
  );
}
