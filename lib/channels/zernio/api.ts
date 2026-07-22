import type { ChannelPlatform } from "../types";

/**
 * Thin server-side client for the Zernio REST endpoints used by workspace
 * provisioning and the account-connect (OAuth) flow. Kept a pure function of its injected
 * config (no `process.env`, no `"server-only"` import) so it stays
 * unit-testable by mocking `global.fetch` — the env is read in `./index.ts`,
 * same discipline as the webhook secret.
 *
 * Contract per the official OpenAPI spec (https://docs.zernio.com/api/openapi —
 * operationIds `listProfiles`, `createProfile`, `getConnectUrl`,
 * `sendInboxMessage`):
 *   - POST /v1/profiles  { name, description }
 *       -> 201 { message, profile: { _id, … } }        (id at profile._id)
 *   - DELETE /v1/profiles/{profileId}
 *       -> 200 { message }
 *   - GET  /v1/connect/{platform}  ?profileId&redirect_url
 *       -> 200 { authUrl, state }                       (authUrl at top level)
 *   - POST /v1/inbox/conversations/{conversationId}/messages  { accountId, message }
 *       -> 200 { success, data: { messageId } }        (id at data.messageId)
 *   - POST /v1/inbox/comments/{commentId}/replies  { accountId, message }
 *       -> 200 { success, data: { commentId } }         (id at data.commentId)
 * Both authenticate with `Authorization: Bearer <ZERNIO_API_KEY>`. A Zernio
 * "profile" is the tenant boundary: drafta provisions exactly one per workspace
 * before the workspace row is created.
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

/**
 * Creates a Zernio profile (account group) and returns its `_id`. drafta
 * creates one during workspace bootstrap, before the workspace is persisted.
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

/** Deletes an empty Zernio profile when workspace bootstrap needs compensation. */
export async function deleteZernioProfile(
  config: ZernioApiConfig,
  profileId: string,
): Promise<void> {
  const response = await fetch(
    joinUrl(config.apiBaseUrl, `profiles/${encodeURIComponent(profileId)}`),
    { method: "DELETE", headers: authHeaders(config) },
  );

  if (!response.ok) {
    throw await zernioHttpError(response, "Zernio profile deletion failed");
  }
}

/**
 * Sends a text message into an existing inbox conversation
 * (`sendInboxMessage`). `conversationExternalId` is Zernio's own
 * platform-specific conversation ID — the value inbound webhooks report and
 * `conversations.external_id` stores. Returns the provider's ID of the sent
 * message (`data.messageId`; per the spec it is present for every platform
 * drafta supports), which becomes `messages.external_id` so later
 * delivered/read/failed webhooks match the row.
 */
export async function sendZernioInboxMessage(
  config: ZernioApiConfig,
  input: { accountId: string; conversationExternalId: string; text: string },
): Promise<string> {
  const response = await fetch(
    joinUrl(
      config.apiBaseUrl,
      `inbox/conversations/${encodeURIComponent(input.conversationExternalId)}/messages`,
    ),
    {
      method: "POST",
      headers: { ...authHeaders(config), "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: input.accountId, message: input.text }),
    },
  );

  if (!response.ok) {
    throw await zernioHttpError(response, "Zernio message send failed");
  }

  const body = (await readJson(response)) as
    | { data?: { messageId?: unknown } }
    | null;
  const messageId = body?.data?.messageId;
  if (typeof messageId !== "string" || messageId.length === 0) {
    throw new ZernioApiError(
      "Zernio send response is missing `data.messageId`.",
    );
  }

  return messageId;
}

/**
 * Publishes a reply to a specific comment (`replyToInboxPost`) — stage 5's
 * outgoing path (docs/architecture/07-data-flows.md#63-отправка-ответа: «для
 * комментария — как ответ на конкретный комментарий»). Per the OpenAPI spec
 * (POST /v1/inbox/comments/{postId}) the reply is addressed to the post
 * (`postExternalId` — the post's `platformPostId`, which `conversations.external_id`
 * stores) with `commentId` naming the specific comment being answered
 * (`messages.parent_external_id` of the outgoing reply). Returns the provider's
 * ID of the published reply (`data.commentId`), which becomes the outgoing
 * `messages.external_id`.
 */
export async function sendZernioCommentReply(
  config: ZernioApiConfig,
  input: {
    accountId: string;
    postExternalId: string;
    commentId: string;
    text: string;
  },
): Promise<string> {
  const response = await fetch(
    joinUrl(
      config.apiBaseUrl,
      `inbox/comments/${encodeURIComponent(input.postExternalId)}`,
    ),
    {
      method: "POST",
      headers: { ...authHeaders(config), "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: input.accountId,
        message: input.text,
        commentId: input.commentId,
      }),
    },
  );

  if (!response.ok) {
    throw await zernioHttpError(response, "Zernio comment reply failed");
  }

  const body = (await readJson(response)) as
    | { data?: { commentId?: unknown } }
    | null;
  const commentId = body?.data?.commentId;
  if (typeof commentId !== "string" || commentId.length === 0) {
    throw new ZernioApiError(
      "Zernio comment reply response is missing `data.commentId`.",
    );
  }

  return commentId;
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
