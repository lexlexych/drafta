import type { ChannelPlatform, ConnectCallbackResult } from "../types";

/**
 * Parsing of Zernio's account-connect (OAuth) callback. The URL-building /
 * API side lives in ./api.ts; here we only turn the query parameters Zernio
 * appends to our redirect into the connected account's external ID.
 *
 * Real contract (https://docs.zernio.com/guides/connecting-accounts): after
 * authorization Zernio redirects to our `redirect_url` with
 * `connected` (platform), `accountId`, `username`, `profileId`. On a failure
 * it uses `error` (and/or `denied`). Everything Zernio-specific stays in this
 * folder (vibecoding rule 4).
 */

/** Callback query params (assumed error keys aside — connected/accountId confirmed). */
const ACCOUNT_ID_PARAM = "accountId";
const PLATFORM_PARAM = "connected";
const USERNAME_PARAM = "username";
const ERROR_PARAMS = ["error", "denied"] as const;

const KNOWN_PLATFORMS: readonly ChannelPlatform[] = [
  "telegram",
  "whatsapp",
  "instagram",
  "facebook",
];

/** Thrown when Zernio's connect callback reports an error or omits the account ID. */
export class ZernioConnectCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZernioConnectCallbackError";
  }
}

/**
 * Turns Zernio's connect-callback query parameters into the connected
 * account's external ID (plus the platform and account handle it reports).
 * Throws `ZernioConnectCallbackError` when the provider signalled an error or
 * didn't return an account ID — the callback route maps that to a friendly
 * "connection failed" redirect.
 */
export function parseZernioConnectCallback(
  query: Record<string, string>,
): ConnectCallbackResult {
  for (const key of ERROR_PARAMS) {
    const value = query[key]?.trim();
    if (value) {
      throw new ZernioConnectCallbackError(
        `Zernio connect flow returned an error: ${value}`,
      );
    }
  }

  const externalAccountId = query[ACCOUNT_ID_PARAM]?.trim();
  if (!externalAccountId) {
    throw new ZernioConnectCallbackError(
      `Zernio connect callback is missing the "${ACCOUNT_ID_PARAM}" parameter.`,
    );
  }

  const reported = query[PLATFORM_PARAM]?.trim();
  const platform = KNOWN_PLATFORMS.find((candidate) => candidate === reported);

  // The account handle names the connection (the user doesn't type a name) —
  // optional here, the caller falls back to the platform label.
  const accountUsername = query[USERNAME_PARAM]?.trim() || undefined;

  // No credentials: Zernio holds the platform tokens, drafta stores only the
  // account ID (docs/architecture/06-data-model.md#channel_connections —
  // "зашифрованные credentials (пусто для Zernio)").
  return { externalAccountId, platform, accountUsername };
}
