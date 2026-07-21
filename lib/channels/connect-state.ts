import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { ChannelPlatform } from "./types";

/**
 * Signed `state` for the channel account-connect (OAuth) flow.
 *
 * When a user starts connecting a channel, the server action encodes the
 * pending intent (which workspace, which platform, the chosen connection
 * name) into a compact token, HMAC-signs it with `CHANNEL_CONNECT_STATE_SECRET`,
 * and stores it in an httpOnly cookie. The provider (Zernio) does not
 * round-trip an arbitrary `state` back to our callback, so instead the
 * signed token's `nonce` is echoed in the `redirect_url` (query param `cn`);
 * the callback route (`app/api/channels/[provider]/connect/callback/`) reads
 * the token from the cookie, verifies signature + expiry, and requires the
 * URL's nonce to match the token's `nonce` — a double-submit OAuth CSRF
 * defense that doesn't depend on the provider preserving our state.
 *
 * Provider-agnostic on purpose: it lives at the `lib/channels/` root, imports
 * no provider code (vibecoding rule 4), and the secret stays server-only
 * (docs/architecture/13-environments-secrets.md).
 */

/** How long a started connect flow stays valid before the user must retry. */
export const CONNECT_STATE_TTL_SECONDS = 10 * 60;

/** Name of the httpOnly cookie holding the signed connect-state token. */
export const CONNECT_STATE_COOKIE = "drafta_channel_connect";

/** Query parameter (on our own redirect_url) carrying the token's nonce for the CSRF double-submit check. */
export const CONNECT_STATE_NONCE_PARAM = "cn";

export interface ConnectStatePayload {
  workspaceId: string;
  platform: ChannelPlatform;
  name: string;
  /** Random per-attempt value; mirrored into an httpOnly cookie and re-checked on callback. */
  nonce: string;
}

interface SignedConnectState extends ConnectStatePayload {
  /** Expiry, epoch seconds. */
  exp: number;
}

export type VerifyConnectStateResult =
  | { ok: true; state: SignedConnectState }
  | { ok: false; reason: string };

function getStateSecret(): string {
  const secret = process.env.CHANNEL_CONNECT_STATE_SECRET;

  if (!secret) {
    throw new Error(
      "Missing required environment variable: CHANNEL_CONNECT_STATE_SECRET",
    );
  }

  return secret;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

/** A fresh, unguessable nonce for one connect attempt. */
export function createConnectNonce(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Signs the connect-state token. `exp` is derived from
 * `CONNECT_STATE_TTL_SECONDS` so a leaked/stale link can't be replayed
 * indefinitely.
 */
export function signConnectState(payload: ConnectStatePayload): string {
  const signed: SignedConnectState = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + CONNECT_STATE_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(signed)).toString("base64url");
  const signature = sign(encodedPayload, getStateSecret());

  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies the token's signature and expiry and returns the decoded state.
 * Does **not** check the nonce — the caller compares `state.nonce` with the
 * httpOnly cookie, because only the caller has request cookies.
 */
export function verifyConnectState(token: string): VerifyConnectStateResult {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "malformed" };
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = sign(encodedPayload, getStateSecret());

  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);
  // timingSafeEqual throws on a length mismatch, so rule it out first (see
  // the same guard in lib/channels/zernio/verify.ts).
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return { ok: false, reason: "bad-signature" };
  }

  let state: SignedConnectState;
  try {
    state = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SignedConnectState;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    typeof state.exp !== "number" ||
    state.exp < Math.floor(Date.now() / 1000)
  ) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, state };
}
