import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_SCOPE = "knowledge:read publications:write";
export function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function secret() { return randomBytes(32).toString("base64url"); }
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export function validRedirect(uri: string, allowed: string[]) {
  try { const u = new URL(uri); return u.protocol === "https:" && !u.username && !u.password && !u.hash && allowed.includes(uri); }
  catch { return false; }
}
export function verifyChallenge(verifier: string, challenge: string) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
    && equalSecret(createHash("sha256").update(verifier).digest("base64url"), challenge);
}
export function allowedImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === "files.oaiusercontent.com" || url.hostname === "file.oaiusercontent.com");
  } catch { return false; }
}
export function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (Buffer.from(bytes.subarray(0,4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8,12)).toString() === "WEBP") return "image/webp";
  return null;
}
