import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { allowedImageUrl, equalSecret, hash, imageMime, secret, validRedirect, verifyChallenge } from "./security";
import { importIdentity, validateImport, type ImportPayload } from "./import";
import { DEFAULT_CONTEXT, validateContext } from "./types";
import { downloadImage } from "./assets";

const image = (id: string) => ({ id, name: `${id}.png`, mime_type: "image/png", download_link: `https://files.oaiusercontent.com/${id}?sig=test` });
const sample = (): ImportPayload => ({ draft_id: randomUUID(), request_id: randomUUID(), title: "Example", text: "Text", kind: "carousel", openaiFileIdRefs: [image("file-a"), image("file-b")], file_order: ["file-b", "file-a"] });
afterEach(() => vi.unstubAllGlobals());
describe("publication boundaries", () => {
  it("accepts only exact HTTPS callbacks, not prefixes or hostile URLs", () => {
    const allowed = ["https://chatgpt.com/aip/g-test/oauth/callback"];
    expect(validRedirect(allowed[0], allowed)).toBe(true);
    for (const uri of [allowed[0]+"/extra", allowed[0]+"?next=evil", "http://chatgpt.com/aip/g-test/oauth/callback", "https://chatgpt.com.evil.test/aip/g-test/oauth/callback", "javascript:alert(1)"]) expect(validRedirect(uri, allowed)).toBe(false);
  });
  it("hashes high-entropy credentials and verifies S256", () => {
    const value = secret(); expect(value).toHaveLength(43); expect(secret()).not.toBe(value);
    expect(hash(value)).not.toContain(value); expect(equalSecret(value, value)).toBe(true);
    expect(equalSecret(value, "wrong")).toBe(false);
    const challenge = createHash("sha256").update(value).digest("base64url");
    expect(verifyChallenge(value, challenge)).toBe(true); expect(verifyChallenge(secret(), challenge)).toBe(false);
  });
  it("blocks SSRF, credentials, spoofed domains, and redirecting downloads", async () => {
    for (const url of ["http://files.oaiusercontent.com/a", "https://127.0.0.1/a", "https://files.oaiusercontent.com.evil.test/a", "https://user:pass@files.oaiusercontent.com/a", "https://files.oaiusercontent.com:8080/a"]) expect(allowedImageUrl(url)).toBe(false);
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302 })); vi.stubGlobal("fetch", fetch);
    await expect(downloadImage("https://files.oaiusercontent.com/a")).rejects.toThrow();
    expect(fetch.mock.calls[0][1].redirect).toBe("error");
  });
  it("requires actual supported image signatures", () => {
    expect(imageMime(Buffer.from("<svg onload='evil'>"))).toBeNull();
    expect(imageMime(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]))).toBe("image/png");
    expect(imageMime(Buffer.from([255,216,255,0,0,0,0,0,0,0,0,0]))).toBe("image/jpeg");
  });
  it("bounds streaming image size even without content-length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(10 * 1024 * 1024 + 1))));
    await expect(downloadImage("https://files.oaiusercontent.com/a")).rejects.toThrow("Image too large");
  });
  it("requires exact ordered file membership and carousel bounds", () => {
    const payload = sample(); expect(validateImport(payload)).toBe(true);
    expect(validateImport({ ...payload, file_order: ["file-a", "file-a"] })).toBe(false);
    expect(validateImport({ ...payload, file_order: ["file-a", "file-x"] })).toBe(false);
    expect(validateImport({ ...payload, kind: "image" })).toBe(false);
    expect(validateImport({ ...payload, draft_id: "other-workspace" })).toBe(false);
    expect(validateImport({ ...payload, text: "x".repeat(20001) })).toBe(false);
    expect(validateImport({ ...payload, openaiFileIdRefs: ["sandbox:/image.png"] })).toBe(false);
  });
  it("ignores refreshed signed URLs in idempotency identity but detects changed content/order", () => {
    const payload = sample();
    const retry = { ...payload, openaiFileIdRefs: payload.openaiFileIdRefs.map(f => ({ ...f, download_link: f.download_link + "2" })) };
    expect(importIdentity(payload)).toBe(importIdentity(retry));
    expect(importIdentity(payload)).not.toBe(importIdentity({ ...payload, text: "revised" }));
    expect(importIdentity(payload)).not.toBe(importIdentity({ ...payload, file_order: [...payload.file_order].reverse() }));
  });
  it("rejects unbounded or unexpected brand/context fields", () => {
    expect(validateContext(DEFAULT_CONTEXT)).toBe(true);
    expect(validateContext({ ...DEFAULT_CONTEXT, slideCount: 11 })).toBe(false);
    expect(validateContext({ ...DEFAULT_CONTEXT, kbIds: ["bad"] })).toBe(false);
    expect(validateContext({ ...DEFAULT_CONTEXT, brand: { tone: "x".repeat(2001) } })).toBe(false);
  });
});
