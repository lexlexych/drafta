import "server-only";

import { registerChannelAdapter } from "../registry";
import { createZernioAdapter } from "./adapter";

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
 * The Zernio adapter instance the app uses. Importing this module registers
 * it under the "zernio" provider name (lib/channels/registry.ts) — the
 * eventual caller is the webhook route,
 * `app/api/webhooks/[provider]/` (T-03), which resolves adapters by the
 * `[provider]` URL segment.
 */
export const zernioAdapter = createZernioAdapter(getZernioWebhookSecret);

registerChannelAdapter(zernioAdapter);
