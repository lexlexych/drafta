import type { ChannelPlatform } from "../types";

/**
 * Thin server-side client for the two Zernio REST endpoints the
 * account-connect (OAuth) flow needs. Kept a pure function of its injected
 * config (no `process.env`, no `"server-only"` import) so it stays
 * unit-testable by mocking `global.fetch` — the env is read in `./index.ts`,
 * same discipline as the webhook secret.
 *
 * Contract per the official OpenAPI spec (https://docs.zernio.com/api/openapi —
 * operationIds `createProfile`, `getConnectUrl`):
 *   - POST /v1/profiles  { name, description }
 *       -> 201 { message, profile: { _id, … } }        (id at profile._id)
 *   - GET  /v1/connect/{platform}  ?profileId&redirect_url
 *       -> 200 { authUrl, state }                       (authUrl at top level)
 * Both authenticate with `Authorization: Bearer <ZERNIO_API_KEY>`. A Zernio
 * "profile" (`profile._id`) groups connected accounts — drafta keeps one per
 * workspace (see lib/db/channel-provider-profile.ts).
 */

/** Zernio REST config — injected into the adapter, read from env in ./index.ts. */
export interface ZernioApiConfig {
  /** API base, e.g. `https://zernio.com/api/v1`. */
  apiBaseUrl: string;
  /** API key sent as `Authorization: Bearer`. */
  apiKey: string;
}

/** Thrown when a Zernio API call fails (non-2xx or an unexpected response shape). */
export class ZernioApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ZernioApiError";
  }
}

function authHeaders(config: ZernioApiConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}` };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Creates a Zernio profile (account group) and returns its `_id`. drafta
 * creates one lazily per workspace, on the first channel connection.
 */
export async function createZernioProfile(
  config: ZernioApiConfig,
  input: { name: string; description?: string },
): Promise<string> {
  const response = await fetch(joinUrl(config.apiBaseUrl, "profiles"), {
    method: "POST",
    headers: { ...authHeaders(config), "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, description: input.description }),
  });

  if (!response.ok) {
    throw new ZernioApiError(
      `Zernio profile creation failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  // Per the spec the 201 body is { message, profile: { _id, … } } — the id is
  // at profile._id, not top-level.
  const body = (await readJson(response)) as
    | { profile?: { _id?: unknown } }
    | null;
  const id = body?.profile?._id;
  if (typeof id !== "string" || id.length === 0) {
    throw new ZernioApiError("Zernio profile response is missing `profile._id`.");
  }

  return id;
}

/**
 * Asks Zernio for the hosted authorization URL for `platform` under
 * `profileId`, redirecting back to `redirectUrl` when done. Returns the
 * `authUrl` the browser must be sent to.
 */
export async function getZernioConnectAuthUrl(
  config: ZernioApiConfig,
  input: { platform: ChannelPlatform; profileId: string; redirectUrl: string },
): Promise<string> {
  const url = new URL(joinUrl(config.apiBaseUrl, `connect/${input.platform}`));
  url.searchParams.set("profileId", input.profileId);
  url.searchParams.set("redirect_url", input.redirectUrl);

  const response = await fetch(url, { method: "GET", headers: authHeaders(config) });

  if (!response.ok) {
    throw new ZernioApiError(
      `Zernio connect URL request failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  const body = (await readJson(response)) as { authUrl?: unknown } | null;
  const authUrl = body?.authUrl;
  if (typeof authUrl !== "string" || authUrl.length === 0) {
    throw new ZernioApiError("Zernio connect response is missing `authUrl`.");
  }

  return authUrl;
}
