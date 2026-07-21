import type { ChannelPlatform } from "../types";

/**
 * Thin server-side client for the two Zernio REST endpoints the
 * account-connect (OAuth) flow needs. Kept a pure function of its injected
 * config (no `process.env`, no `"server-only"` import) so it stays
 * unit-testable by mocking `global.fetch` — the env is read in `./index.ts`,
 * same discipline as the webhook secret.
 *
 * Contract per the official OpenAPI spec (https://docs.zernio.com/api/openapi —
 * operationIds `listProfiles`, `createProfile`, `getConnectUrl`):
 *   - GET  /v1/profiles
 *       -> 200 { profiles: [ { _id, isDefault, … } ] }
 *   - POST /v1/profiles  { name, description }
 *       -> 201 { message, profile: { _id, … } }        (id at profile._id)
 *   - GET  /v1/connect/{platform}  ?profileId&redirect_url
 *       -> 200 { authUrl, state }                       (authUrl at top level)
 * Both authenticate with `Authorization: Bearer <ZERNIO_API_KEY>`. A Zernio
 * "profile" groups connected accounts. `ZERNIO_API_KEY` is one account-wide key,
 * so the adapter reuses an existing profile (preferring the default) rather than
 * creating a new one per connect — see lib/channels/zernio/adapter.ts.
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
 * Builds a `ZernioApiError` for a non-2xx response, including Zernio's own
 * error body (truncated) — without it a bare "HTTP 400" hides the real reason
 * (invalid field, duplicate, plan limit…).
 */
async function zernioHttpError(
  response: Response,
  context: string,
): Promise<ZernioApiError> {
  let detail = "";
  try {
    detail = (await response.text()).trim().slice(0, 500);
  } catch {
    // Body already consumed or unreadable — status alone will have to do.
  }

  return new ZernioApiError(
    `${context} (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    response.status,
  );
}

/** A Zernio profile (account group) as returned by GET /v1/profiles. */
export interface ZernioProfileSummary {
  id: string;
  isDefault: boolean;
}

/**
 * Lists the account's Zernio profiles (GET /v1/profiles). Response per spec:
 * `{ profiles: [ { _id, isDefault, … } ] }`. Used so the adapter can reuse an
 * existing profile (preferring the default) instead of creating a new one on a
 * shared, account-wide API key.
 */
export async function listZernioProfiles(
  config: ZernioApiConfig,
): Promise<ZernioProfileSummary[]> {
  const response = await fetch(joinUrl(config.apiBaseUrl, "profiles"), {
    method: "GET",
    headers: authHeaders(config),
  });

  if (!response.ok) {
    throw await zernioHttpError(response, "Zernio profiles list failed");
  }

  const body = (await readJson(response)) as
    | { profiles?: Array<{ _id?: unknown; isDefault?: unknown }> }
    | null;
  const profiles = Array.isArray(body?.profiles) ? body.profiles : [];

  return profiles
    .filter(
      (p): p is { _id: string; isDefault?: unknown } =>
        typeof p?._id === "string" && p._id.length > 0,
    )
    .map((p) => ({ id: p._id, isDefault: p.isDefault === true }));
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
    throw await zernioHttpError(response, "Zernio profile creation failed");
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
    throw await zernioHttpError(response, "Zernio connect URL request failed");
  }

  const body = (await readJson(response)) as { authUrl?: unknown } | null;
  const authUrl = body?.authUrl;
  if (typeof authUrl !== "string" || authUrl.length === 0) {
    throw new ZernioApiError("Zernio connect response is missing `authUrl`.");
  }

  return authUrl;
}
