import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decryptCredentials,
  encryptCredentials,
  getCredentialsEncryptionKey,
} from "./credentials";

const key = randomBytes(32);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("channel credentials encryption", () => {
  it("round-trips an object", () => {
    const value = { botToken: "123:abc", webhookSecret: "s3cret" };
    const encrypted = encryptCredentials(value, key);

    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(encrypted).not.toContain("123:abc");
    expect(decryptCredentials(encrypted, key)).toEqual(value);
  });

  it("uses a fresh IV for every value", () => {
    const value = { botToken: "123:abc" };
    expect(encryptCredentials(value, key)).not.toBe(encryptCredentials(value, key));
  });

  it("rejects a tampered value", () => {
    const parts = encryptCredentials({ botToken: "123:abc" }, key).split(".");
    const ciphertext = Buffer.from(parts[3], "base64url");
    ciphertext[0] ^= 0xff;
    parts[3] = ciphertext.toString("base64url");

    expect(() => decryptCredentials(parts.join("."), key)).toThrow(
      "Unable to decrypt channel credentials.",
    );
  });

  it("rejects a value encrypted with another key", () => {
    const encrypted = encryptCredentials({ botToken: "123:abc" }, key);
    expect(() => decryptCredentials(encrypted, randomBytes(32))).toThrow();
  });

  it("rejects an unknown format", () => {
    expect(() => decryptCredentials("plain-text", key)).toThrow(
      "Unsupported encrypted credentials format.",
    );
  });

  it("requires a 32-byte base64 key in the environment", () => {
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "");
    expect(() => getCredentialsEncryptionKey()).toThrow(
      "Missing required environment variable: CREDENTIALS_ENCRYPTION_KEY",
    );

    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", Buffer.from("short").toString("base64"));
    expect(() => getCredentialsEncryptionKey()).toThrow("must be 32 bytes");

    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", key.toString("base64"));
    expect(getCredentialsEncryptionKey().equals(key)).toBe(true);
  });
});
