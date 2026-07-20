import type {
  ConnectCallbackResult,
  GetConnectUrlInput,
} from "../types";

/**
 * Zernio account-connect (OAuth) flow — the provider side of "add a channel".
 *
 * Instead of the user copying an external account ID out of the Zernio
 * dashboard, drafta redirects the browser to Zernio's hosted authorization
 * page (`ZERNIO_CONNECT_URL`); Zernio runs the platform's OAuth and redirects
 * back to our callback with the connected account's ID. The user never sees
 * Zernio itself (docs/architecture/05-channels.md).
 *
 * The exact hosted-connect contract (query parameter names, the callback's
 * `account_id` field) is **not yet confirmed against a live Zernio API** —
 * unlike webhook verification (./verify.ts) it has no fixtures. It is
 * expressed here as a single, documented seam driven by env
 * (`ZERNIO_CONNECT_URL`, `ZERNIO_API_KEY`); when the real endpoint is
 * available, only the constants and the callback field name below change.
 * Everything Zernio-specific stays in this folder (vibecoding rule 4).
 */

/** Config read from the environment in ./index.ts and injected into the adapter. */
export interface ZernioConnectConfig {
  /** Base URL of Zernio's hosted account-authorization page. */
  connectUrl: string;
  /** Zernio API key / client identifier that scopes the connect session to our app. */
  apiKey: string;
}

/** Callback query parameter Zernio appends with the connected account's ID (assumed contract). */
const ACCOUNT_ID_PARAM = "account_id";
/** Callback query parameter Zernio uses to signal a user-side failure/decline (assumed contract). */
const ERROR_PARAM = "error";

/**
 * Builds the URL that starts Zernio's hosted account-connect flow. `state` is
 * an opaque, signed token (lib/channels/connect-state.ts) round-tripped back
 * to our callback for CSRF protection; `redirectUrl` is our callback route.
 */
export function buildZernioConnectUrl(
  config: ZernioConnectConfig,
  input: GetConnectUrlInput,
): string {
  const url = new URL(config.connectUrl);
  url.searchParams.set("client", config.apiKey);
  url.searchParams.set("platform", input.platform);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("state", input.state);

  return url.toString();
}

/** Thrown when Zernio's connect callback reports an error or omits the account ID. */
export class ZernioConnectCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZernioConnectCallbackError";
  }
}

/**
 * Turns Zernio's connect-callback query parameters into the connected
 * account's external ID. Throws `ZernioConnectCallbackError` when the
 * provider signalled an error or didn't return an account ID — the callback
 * route maps that to a friendly "connection failed" redirect.
 */
export function parseZernioConnectCallback(
  query: Record<string, string>,
): ConnectCallbackResult {
  const providerError = query[ERROR_PARAM]?.trim();
  if (providerError) {
    throw new ZernioConnectCallbackError(
      `Zernio connect flow returned an error: ${providerError}`,
    );
  }

  const externalAccountId = query[ACCOUNT_ID_PARAM]?.trim();
  if (!externalAccountId) {
    throw new ZernioConnectCallbackError(
      `Zernio connect callback is missing the "${ACCOUNT_ID_PARAM}" parameter.`,
    );
  }

  // No credentials: Zernio holds the platform tokens, drafta stores only the
  // account ID (docs/architecture/06-data-model.md#channel_connections —
  // "зашифрованные credentials (пусто для Zernio)").
  return { externalAccountId };
}
