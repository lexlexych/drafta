import "server-only";

import { registerChannelAdapter } from "../registry";
import { createZernioAdapter } from "./adapter";
import type { ZernioApiConfig } from "./api";

/**
 * Reads `ZERNIO_WEBHOOK_SECRET` from the environment. Kept in this
 * `"server-only"`-guarded module — never in `./adapter.ts` — so the secret
 * can never end up in a client bundle, mirroring how
 * `lib/db/admin.ts#getSupabaseSecretKey` guards `SUPABASE_SECRET_KEY`
 * (docs/architecture/13-environments-secrets.md).
 *
 * The getter is passed to `createZernioAdapter`, not called eagerly here —
 * importing this module (e.g. from the webhook route in T-03) doesn't
 * require the env var to be set; only actually verifying a webhook does.
 */
function getZernioWebhookSecret(): string {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error(
      "Missing required environment variable: ZERNIO_WEBHOOK_SECRET",
    );
  }

  return secret;
}

/**
 * Reads the Zernio REST config used by the account-connect (OAuth) flow —
 * `ZERNIO_API_BASE_URL` (e.g. https://zernio.com/api/v1) and `ZERNIO_API_KEY`
 * (Bearer token). Guarded the same way and read lazily: only starting a
 * connect flow needs these set, not importing the module or handling a webhook.
 */
function getZernioApiConfig(): ZernioApiConfig {
  const apiBaseUrl = process.env.ZERNIO_API_BASE_URL;
  const apiKey = process.env.ZERNIO_API_KEY;

  if (!apiBaseUrl) {
    throw new Error("Missing required environment variable: ZERNIO_API_BASE_URL");
  }
  if (!apiKey) {
    throw new Error("Missing required environment variable: ZERNIO_API_KEY");
  }

  return { apiBaseUrl, apiKey };
}

/**
 * The Zernio adapter instance the app uses. Importing this module registers
 * it under the "zernio" provider name (lib/channels/registry.ts) — the
 * callers are the webhook route, `app/api/webhooks/[provider]/` (T-03), and
 * the account-connect flow, `app/api/channels/[provider]/connect/callback/`
 * and Settings → Channels, both resolving adapters by the `[provider]` name.
 */
export const zernioAdapter = createZernioAdapter(
  getZernioWebhookSecret,
  getZernioApiConfig,
);

registerChannelAdapter(zernioAdapter);
