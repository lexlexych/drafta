import { createHmac, timingSafeEqual } from "node:crypto";

import type { VerifyWebhookInput } from "../types";

/**
 * Zernio webhook signature verification.
 *
 * Format confirmed against docs.zernio.com/webhooks (checked 2026-07-20,
 * see docs/epics/epic_02/_index.md open question #1): the signature is the
 * **lowercase hex HMAC-SHA256 of the raw, unparsed request body**, keyed by
 * the workspace's `ZERNIO_WEBHOOK_SECRET`, sent in the `X-Zernio-Signature`
 * header. Zernio's docs also list a legacy header alias,
 * `X-Late-Signature`, accepted the same way — we honor both so we don't
 * silently reject valid webhooks sent through the older header name.
 *
 * Everything the docs did *not* confirm (exact nested payload shape) lives
 * in ./parse.ts, not here — signature verification only needs the raw
 * bytes and the header, both already part of `VerifyWebhookInput`.
 *
 * `VerifyWebhookInput.headers` keys are already lower-cased by the caller
 * per the interface contract (lib/channels/types.ts).
 */
const SIGNATURE_HEADER = "x-zernio-signature";
const LEGACY_SIGNATURE_HEADER = "x-late-signature";

export function verifyZernioSignature(
  input: VerifyWebhookInput,
  secret: string,
): boolean {
  const provided =
    input.headers[SIGNATURE_HEADER] ?? input.headers[LEGACY_SIGNATURE_HEADER];

  if (!provided || !secret) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(input.rawBody, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided.trim().toLowerCase(), "utf8");

  // timingSafeEqual throws on a length mismatch instead of returning false,
  // so it must be ruled out first. A well-formed hex digest is always the
  // same length, so this early return doesn't leak anything an attacker
  // couldn't already infer from the (public) hash algorithm.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
