import "server-only";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";
import { equalSecret, hash, OAUTH_SCOPE, validRedirect } from "./security";

export class PublicationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function check(error: unknown) { if (error) throw new PublicationError(500, "Не удалось сохранить изменения. Попробуйте ещё раз."); }
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new PublicationError(403, "Недопустимый источник запроса.");
}
export async function memberContext() {
  const user = await getAuthenticatedUser();
  if (!user) throw new PublicationError(401, "Войдите в Drafta.");
  const workspace = await getCurrentWorkspace(user.id);
  if (!workspace) throw new PublicationError(403, "Рабочее пространство недоступно.");
  return { user, workspace, db: createAdminSupabaseClient() };
}
export function oauthConfig() {
  const clientId = process.env.GPT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GPT_OAUTH_CLIENT_SECRET;
  const redirects = (process.env.GPT_OAUTH_REDIRECT_URIS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!clientId || !clientSecret || !redirects.length) throw new PublicationError(503, "Подключение ChatGPT ещё не настроено.");
  return { clientId, clientSecret, redirects };
}
export function validateAuthorization(params: URLSearchParams) {
  const config = oauthConfig();
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const scope = params.get("scope") || OAUTH_SCOPE;
  const challenge = params.get("code_challenge");
  if (params.get("client_id") !== config.clientId || !validRedirect(redirectUri, config.redirects)
    || params.get("response_type") !== "code" || !state || state.length > 2048
    || scope.split(" ").sort().join(" ") !== OAUTH_SCOPE.split(" ").sort().join(" ")
    || (challenge && (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || params.get("code_challenge_method") !== "S256"))) {
    throw new PublicationError(400, "Некорректный запрос подключения ChatGPT.");
  }
  return { redirectUri, state, challenge };
}
export function validateClient(clientId: string, clientSecret: string) {
  const config = oauthConfig();
  if (!equalSecret(clientId, config.clientId) || !equalSecret(clientSecret, config.clientSecret)) {
    throw new PublicationError(401, "invalid_client");
  }
}
export async function gptContext(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
  if (!bearer) throw new PublicationError(401, "invalid_token");
  const db = createAdminSupabaseClient();
  const now = new Date().toISOString();
  const { data: grant, error } = await db.from("gpt_oauth_grants").select("id,workspace_id,user_id,kb_ids")
    .eq("access_hash", hash(bearer)).is("revoked_at", null).gt("access_expires_at", now).gt("expires_at", now).maybeSingle();
  check(error);
  if (!grant) throw new PublicationError(401, "invalid_token");
  const { data: member, error: memberError } = await db.from("workspace_members").select("user_id")
    .eq("workspace_id", grant.workspace_id).eq("user_id", grant.user_id).maybeSingle();
  check(memberError);
  if (!member) throw new PublicationError(401, "invalid_token");
  const { data: permitted, error: limitError } = await db.rpc("limit_gpt_request", { g: grant.id });
  check(limitError);
  if (!permitted) throw new PublicationError(429, "Слишком много запросов. Повторите через минуту.");
  return { db, grant };
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
}
export function failure(error: unknown) {
  return json({ error: error instanceof PublicationError ? error.message : "Внутренняя ошибка. Повторите запрос." }, error instanceof PublicationError ? error.status : 500);
}
export async function limitedText(request: Request, limit = 90000) {
  if (Number(request.headers.get("content-length")) > limit) throw new PublicationError(413, "Слишком большой запрос.");
  const reader = request.body?.getReader();
  if (!reader) throw new PublicationError(400, "Пустой запрос.");
  let total = 0; const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > limit) throw new PublicationError(413, "Слишком большой запрос.");
      parts.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(parts).toString("utf8");
}
export async function readJson(request: Request) {
  const text = await limitedText(request);
  try { return JSON.parse(text); } catch { throw new PublicationError(400, "Некорректный JSON."); }
}
