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
 *   - DELETE /v1/accounts/{accountId}
 *       -> 200 { message }                              (404 = already gone)
 *   - POST /v1/inbox/conversations/{conversationId}/messages  { accountId, message }
 *       -> 200 { success, data: { messageId } }        (id at data.messageId)
 *   - POST /v1/inbox/comments/{commentId}/replies  { accountId, message }
 *       -> 200 { success, data: { commentId } }         (id at data.commentId)
 *   - POST /v1/inbox/comments/{postId}/{commentId}/private-reply  { accountId, message }
 *       -> 200 { status, messageId, commentId, platform } (id at top level)
 *   - GET  /v1/inbox/conversations  ?accountId&limit&cursor
 *       -> 200 { data: Conversation[], pagination }     (participantPicture per row)
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

export interface ZernioConversationParticipant {
  participantExternalId: string;
  avatarUrl: string | null;
}

export interface ZernioConversationParticipantPage {
  participants: ZernioConversationParticipant[];
  nextCursor: string | null;
}

export interface ZernioPostThumbnail {
  postExternalId: string;
  thumbnailUrl: string | null;
}

export interface ZernioPostThumbnailPage {
  posts: ZernioPostThumbnail[];
  nextCursor: string | null;
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

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function nonEmptyHttpsUrl(value: unknown): string | null {
  const candidate = nonEmptyString(value);
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

/**
 * Disconnects a connected social account at Zernio (`deleteAccount`:
 * `DELETE /v1/accounts/{accountId}` — "Disconnects and removes a connected
 * social account", per the OpenAPI spec). One call is both the disconnect and
 * the removal on Zernio's side; it also fires their `account.disconnected`
 * webhook.
 *
 * A 404 is treated as success: the account is already gone at the provider,
 * which is exactly the state the caller wants.
 */
export async function deleteZernioAccount(
  config: ZernioApiConfig,
  accountId: string,
): Promise<void> {
  const response = await fetch(
    joinUrl(config.apiBaseUrl, `accounts/${encodeURIComponent(accountId)}`),
    { method: "DELETE", headers: authHeaders(config) },
  );

  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    throw await zernioHttpError(response, "Zernio account disconnect failed");
  }
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
 * Reads one conversation by id. Zernio currently returns
 * `participantPicture` here in production even though the generated response
 * type documents that field only on the list endpoint. A missing field is not
 * treated as an error: callers fall back to the documented paginated list.
 */
export async function getZernioConversationParticipant(
  config: ZernioApiConfig,
  input: {
    accountId: string;
    conversationExternalId: string;
    participantExternalId: string;
  },
): Promise<ZernioConversationParticipant | null> {
  const url = new URL(
    joinUrl(
      config.apiBaseUrl,
      `inbox/conversations/${encodeURIComponent(input.conversationExternalId)}`,
    ),
  );
  url.searchParams.set("accountId", input.accountId);

  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(config),
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await zernioHttpError(response, "Zernio conversation lookup failed");
  }

  const body = asRecord(await readJson(response));
  const row = asRecord(body?.data) ?? body;
  if (!row) {
    return null;
  }

  return {
    participantExternalId:
      nonEmptyString(row.participantId) ?? input.participantExternalId,
    avatarUrl: nonEmptyString(row.participantPicture),
  };
}

/** Lists conversation participants using Zernio's documented inbox endpoint. */
export async function listZernioConversationParticipants(
  config: ZernioApiConfig,
  input: { accountId: string; cursor?: string; limit?: number },
): Promise<ZernioConversationParticipantPage> {
  const url = new URL(joinUrl(config.apiBaseUrl, "inbox/conversations"));
  url.searchParams.set("accountId", input.accountId);
  url.searchParams.set(
    "limit",
    String(Math.min(100, Math.max(1, input.limit ?? 100))),
  );
  if (input.cursor) {
    url.searchParams.set("cursor", input.cursor);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(config),
  });
  if (!response.ok) {
    throw await zernioHttpError(response, "Zernio conversation list failed");
  }

  const body = asRecord(await readJson(response));
  const dataRecord = asRecord(body?.data);
  const rows = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(dataRecord?.conversations)
      ? dataRecord.conversations
      : [];
  const pagination = asRecord(body?.pagination) ?? asRecord(dataRecord?.pagination);

  const participants = rows.flatMap((value) => {
    const row = asRecord(value);
    const participantExternalId = nonEmptyString(row?.participantId);
    if (!row || !participantExternalId) {
      return [];
    }

    return [
      {
        participantExternalId,
        avatarUrl: nonEmptyString(row.participantPicture),
      },
    ];
  });

  return {
    participants,
    nextCursor: nonEmptyString(pagination?.nextCursor),
  };
}

/**
 * Lists post previews from Zernio's comments inbox. `picture` is the
 * provider-reported thumbnail URL documented on `GET /v1/inbox/comments`.
 * `minComments=0` keeps a just-published post eligible before its first
 * comment; callers pass the opaque cursor back unchanged.
 */
export async function listZernioPostThumbnails(
  config: ZernioApiConfig,
  input: { accountId: string; cursor?: string; limit?: number },
): Promise<ZernioPostThumbnailPage> {
  const url = new URL(joinUrl(config.apiBaseUrl, "inbox/comments"));
  url.searchParams.set("accountId", input.accountId);
  url.searchParams.set("minComments", "0");
  url.searchParams.set("sortBy", "date");
  url.searchParams.set("sortOrder", "desc");
  url.searchParams.set(
    "limit",
    String(Math.min(100, Math.max(1, input.limit ?? 100))),
  );
  if (input.cursor) {
    url.searchParams.set("cursor", input.cursor);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(config),
  });
  if (!response.ok) {
    throw await zernioHttpError(response, "Zernio post thumbnail list failed");
  }

  const body = asRecord(await readJson(response));
  const dataRecord = asRecord(body?.data);
  const rows = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(dataRecord?.posts)
      ? dataRecord.posts
      : [];
  const pagination = asRecord(body?.pagination) ?? asRecord(dataRecord?.pagination);

  const posts = rows.flatMap((value) => {
    const row = asRecord(value);
    const postExternalId = nonEmptyString(row?.id);
    if (!row || !postExternalId) return [];

    return [
      {
        postExternalId,
        thumbnailUrl: nonEmptyHttpsUrl(row.picture),
      },
    ];
  });

  return {
    posts,
    nextCursor: nonEmptyString(pagination?.nextCursor),
  };
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
 * Sends a private message to the author of a comment (`sendPrivateReplyToComment`
 * — "Send a private message to the author of a comment. Supported on Instagram
 * and Facebook only. One reply per comment, must be sent within 7 days").
 *
 * This is Meta's «private reply», the one path that opens a DM thread with
 * someone who has never written to us: it is addressed to a comment, not to a
 * conversation. The thread itself reaches drafta afterwards through the
 * `conversation.started` / `message.sent` webhooks.
 *
 * Unlike the other send endpoints, the id comes back at the top level
 * (`messageId`), not under `data`. `quickReplies`/`buttons` from the spec are
 * deliberately not used: a plain text DM is what the operator wrote.
 */
export async function sendZernioCommentPrivateReply(
  config: ZernioApiConfig,
  input: {
    accountId: string;
    postExternalId: string;
    commentExternalId: string;
    text: string;
  },
): Promise<string> {
  const response = await fetch(
    joinUrl(
      config.apiBaseUrl,
      `inbox/comments/${encodeURIComponent(input.postExternalId)}/${encodeURIComponent(input.commentExternalId)}/private-reply`,
    ),
    {
      method: "POST",
      headers: { ...authHeaders(config), "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: input.accountId, message: input.text }),
    },
  );

  if (!response.ok) {
    // A 400 here is a permanent outcome, not a hiccup: the 7-day window has
    // closed, the comment already got its one private reply, or the platform
    // does not support them. The caller turns 4xx into a non-retriable failure.
    throw await zernioHttpError(response, "Zernio private reply failed");
  }

  const body = (await readJson(response)) as { messageId?: unknown } | null;
  const messageId = body?.messageId;
  if (typeof messageId !== "string" || messageId.length === 0) {
    throw new ZernioApiError(
      "Zernio private reply response is missing `messageId`.",
    );
  }

  return messageId;
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
