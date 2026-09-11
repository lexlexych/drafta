import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const from = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/admin", () => ({ createAdminSupabaseClient: () => ({ from }) }));
import { POST } from "@/app/api/gpt/oauth/token/route";
import { hash, secret } from "./security";
import { validateAuthorization } from "./server";

function query(result: unknown) {
  const chain = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), gt: vi.fn(), update: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result) };
  for (const key of ["select","eq","is","gt","update"] as const) chain[key].mockReturnValue(chain);
  return chain;
}
const callback = "https://chatgpt.com/aip/g-test/oauth/callback";
beforeEach(() => {
  vi.stubEnv("GPT_OAUTH_CLIENT_ID", "test-client"); vi.stubEnv("GPT_OAUTH_CLIENT_SECRET", "test-secret");
  vi.stubEnv("GPT_OAUTH_REDIRECT_URIS", callback); from.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
const request = (extra: Record<string,string>) => new Request("https://drafta.test/api/gpt/oauth/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: "test-client", client_secret: "test-secret", grant_type: "authorization_code", redirect_uri: callback, ...extra }),
});
describe("GPT OAuth", () => {
  it("requires state and rejects unknown scopes, clients and redirects", () => {
    const params = new URLSearchParams({ client_id: "test-client", redirect_uri: callback, response_type: "code", state: "csrf-binding" });
    expect(validateAuthorization(params).state).toBe("csrf-binding");
    for (const [key,value] of [["state",""],["scope","admin"],["redirect_uri","https://evil.test"],["client_id","wrong"]]) {
      const copy = new URLSearchParams(params); copy.set(key,value); expect(() => validateAuthorization(copy)).toThrow();
    }
  });
  it("rejects an invalid client before querying credentials", async () => {
    expect((await POST(request({ client_secret: "wrong", code: secret() }))).status).toBe(401); expect(from).not.toHaveBeenCalled();
  });
  it("rejects expired, unknown and replayed codes", async () => {
    from.mockReturnValue(query({ data: null, error: null }));
    expect((await POST(request({ code: secret() }))).status).toBe(400);
    from.mockReturnValue(query({ data: { code_expires_at: "2000-01-01", redirect_uri: callback }, error: null }));
    expect((await POST(request({ code: secret() }))).status).toBe(400);
  });
  it("consumes the exact credential atomically and returns opaque rotated tokens", async () => {
    const code = secret();
    const initial = query({ data: { id: "grant", workspace_id: "w", user_id: "u", code_expires_at: "2099-01-01", redirect_uri: callback }, error: null });
    const member = query({ data: { user_id: "u" }, error: null });
    const update = query({ data: { id: "grant" }, error: null });
    from.mockReturnValueOnce(initial).mockReturnValueOnce(member).mockReturnValueOnce(update);
    const response = await POST(request({ code })); const result = await response.json();
    expect(response.status).toBe(200); expect(result.access_token).toHaveLength(43); expect(result.refresh_token).toHaveLength(43);
    expect(update.eq).toHaveBeenCalledWith("code_hash", hash(code));
    expect(update.update.mock.calls[0][0].access_hash).toBe(hash(result.access_token));
    expect(update.update.mock.calls[0][0].code_hash).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects a concurrent exchange that lost the compare-and-swap", async () => {
    from.mockReturnValueOnce(query({ data: { id: "grant", workspace_id: "w", user_id: "u", code_expires_at: "2099-01-01", redirect_uri: callback }, error: null }))
      .mockReturnValueOnce(query({ data: { user_id: "u" }, error: null }))
      .mockReturnValueOnce(query({ data: null, error: null }));
    expect((await POST(request({ code: secret() }))).status).toBe(400);
  });
  it("rejects a removed workspace member before rotating refresh credentials", async () => {
    from.mockReturnValueOnce(query({ data: { id: "grant", workspace_id: "w", user_id: "u" }, error: null }))
      .mockReturnValueOnce(query({ data: null, error: null }));
    expect((await POST(request({ grant_type: "refresh_token", refresh_token: secret() }))).status).toBe(400);
    expect(from).toHaveBeenCalledTimes(2);
  });
});
