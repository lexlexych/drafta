import { createAdminSupabaseClient } from "@/lib/db/admin";
import { check, failure, json, limitedText, PublicationError, validateClient } from "@/lib/publications/server";
import { hash, OAUTH_SCOPE, secret, verifyChallenge } from "@/lib/publications/security";

export async function POST(request: Request) {
  try {
    const raw = await limitedText(request, 10000);
    let params: URLSearchParams;
    try { params = request.headers.get("content-type")?.includes("application/json")
      ? new URLSearchParams(JSON.parse(raw)) : new URLSearchParams(raw); }
    catch { throw new PublicationError(400, "invalid_request"); }
    let clientId = params.get("client_id") ?? "", clientSecret = params.get("client_secret") ?? "";
    const basic = request.headers.get("authorization")?.match(/^Basic (.+)$/i)?.[1];
    if (basic) {
      const credentials = Buffer.from(basic, "base64").toString("utf8");
      const separator = credentials.indexOf(":");
      clientId = decodeURIComponent(credentials.slice(0, separator));
      clientSecret = decodeURIComponent(credentials.slice(separator + 1));
    }
    validateClient(clientId, clientSecret);
    const type = params.get("grant_type");
    if (type !== "authorization_code" && type !== "refresh_token") throw new PublicationError(400, "unsupported_grant_type");
    const credential = params.get(type === "authorization_code" ? "code" : "refresh_token") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new PublicationError(400, "invalid_grant");
    const column = type === "authorization_code" ? "code_hash" : "refresh_hash";
    const db = createAdminSupabaseClient(); const now = new Date().toISOString();
    const { data: grant, error } = await db.from("gpt_oauth_grants").select("*")
      .eq(column, hash(credential)).is("revoked_at", null).gt("expires_at", now).maybeSingle();
    check(error);
    if (!grant || (type === "authorization_code" && (grant.code_expires_at <= now
      || grant.redirect_uri !== params.get("redirect_uri")
      || (grant.code_challenge && !verifyChallenge(params.get("code_verifier") ?? "", grant.code_challenge))))) {
      throw new PublicationError(400, "invalid_grant");
    }
    const { data: member, error: memberError } = await db.from("workspace_members").select("user_id")
      .eq("workspace_id", grant.workspace_id).eq("user_id", grant.user_id).maybeSingle();
    check(memberError);
    if (!member) throw new PublicationError(400, "invalid_grant");
    const access = secret(), refresh = secret();
    // Compare-and-swap consumes a code/refresh token exactly once, even concurrently.
    const { data: updated, error: updateError } = await db.from("gpt_oauth_grants").update({
      code_hash: null, access_hash: hash(access), refresh_hash: hash(refresh),
      access_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }).eq("id", grant.id).eq(column, hash(credential)).is("revoked_at", null)
      .gt("expires_at", now).select("id").maybeSingle();
    check(updateError);
    if (!updated) throw new PublicationError(400, "invalid_grant");
    return json({ access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, scope: OAUTH_SCOPE });
  } catch (error) { return failure(error); }
}
