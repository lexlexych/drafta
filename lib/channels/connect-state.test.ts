import { afterEach, describe, expect, it, vi } from "vitest";

// connect-state.ts imports "server-only", which throws outside a Next.js
// build — neutralized here so the module can be imported and unit-tested,
// same convention as lib/db/channel-connections.test.ts (T-04).
vi.mock("server-only", () => ({}));

process.env.CHANNEL_CONNECT_STATE_SECRET = "test-connect-state-secret";

import {
  CONNECT_STATE_TTL_SECONDS,
  createConnectNonce,
  signConnectState,
  verifyConnectState,
} from "./connect-state";

afterEach(() => {
  vi.useRealTimers();
});

describe("lib/channels/connect-state", () => {
  const payload = {
    workspaceId: "ws_1",
    platform: "telegram" as const,
    nonce: "nonce_abc",
  };

  it("round-trips a signed state and returns its fields", () => {
    const token = signConnectState(payload);
    const result = verifyConnectState(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.workspaceId).toBe("ws_1");
    expect(result.state.platform).toBe("telegram");
    expect(result.state.nonce).toBe("nonce_abc");
    expect(typeof result.state.exp).toBe("number");
  });

  it("rejects a tampered signature", () => {
    const token = signConnectState(payload);
    const [body, signature] = token.split(".");
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");

    const result = verifyConnectState(`${body}.${flipped}`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bad-signature");
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = signConnectState(payload);
    const [, signature] = token.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ ...payload, workspaceId: "ws_attacker", exp: 9999999999 }),
    ).toString("base64url");

    const result = verifyConnectState(`${forgedBody}.${signature}`);

    expect(result.ok).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(verifyConnectState("not-a-token").ok).toBe(false);
    expect(verifyConnectState("only.two.parts.here").ok).toBe(false);
  });

  it("rejects an expired state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00Z"));
    const token = signConnectState(payload);

    // Jump past the TTL — the same signature now reads as expired.
    vi.setSystemTime(Date.now() + (CONNECT_STATE_TTL_SECONDS + 1) * 1000);
    const result = verifyConnectState(token);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expired");
  });

  it("createConnectNonce returns distinct, non-empty values", () => {
    const a = createConnectNonce();
    const b = createConnectNonce();

    expect(a).not.toBe("");
    expect(a).not.toBe(b);
  });
});
