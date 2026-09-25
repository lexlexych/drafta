import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-level encryption of channel credentials (bot tokens, webhook
 * secrets) before they are written to `channel_connection_secrets`
 * (docs/architecture/05-channels.md#telegram-напрямую-bot-api,
 * docs/architecture/13-environments-secrets.md).
 *
 * AES-256-GCM with a random 96-bit IV per value. The serialized form is
 * `v1.<iv>.<tag>.<ciphertext>` (base64url parts) — the version prefix leaves
 * room for key rotation without guessing which format a stored value is in.
 *
 * The key is `CREDENTIALS_ENCRYPTION_KEY`: 32 random bytes, base64-encoded
 * (`openssl rand -base64 32`). Read lazily, so importing this module never
 * requires it — only actually encrypting or decrypting does.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function getCredentialsEncryptionKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      "Missing required environment variable: CREDENTIALS_ENCRYPTION_KEY",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64-encoded.",
    );
  }

  return key;
}

export function encryptCredentials(
  value: Record<string, unknown>,
  key: Buffer = getCredentialsEncryptionKey(),
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Decrypts a value produced by `encryptCredentials`. Throws on a wrong key,
 * a tampered value or an unknown format — never returns a partial result.
 * The error message never includes the value itself.
 */
export function decryptCredentials(
  serialized: string,
  key: Buffer = getCredentialsEncryptionKey(),
): Record<string, unknown> {
  const parts = serialized.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unsupported encrypted credentials format.");
  }

  const [, ivPart, tagPart, ciphertextPart] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  let plaintext: string;
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt channel credentials.");
  }

  const parsed: unknown = JSON.parse(plaintext);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Decrypted channel credentials are not an object.");
  }

  return parsed as Record<string, unknown>;
}
