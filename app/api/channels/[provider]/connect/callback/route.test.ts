import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// route.ts transitively imports server-only modules (lib/channels/zernio,
// lib/db/server, lib/channels/connect-state) — neutralize the marker so this
// file can import and exercise the real route, mirroring
// app/api/webhooks/[provider]/route.test.ts (T-03).
vi.mock("server-only", () => ({}));

process.env.CHANNEL_CONNECT_STATE_SECRET = "test-connect-state-secret";

// The DB layer is mocked: this suite tests the route's own logic — signed
// state + nonce CSRF, provider resolution, callback parsing, redirect targets
// — not the create query (covered by lib/db/channel-connections.test.ts). No
// local Supabase needed, so it runs under plain `npm test`.
const createChannelConnectionMock = vi.fn();
vi.mock("@/lib/db/channel-connections", () => ({
  createChannelConnection: (...args: unknown[]) =>
    createChannelConnectionMock(...args),
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({}),
}));

import {
  CONNECT_STATE_NONCE_COOKIE,
  signConnectState,
} from "@/lib/channels/connect-state";

import { GET } from "./route";

const NONCE = "nonce_under_test";

function mintState(overrides?: Partial<Parameters<typeof signConnectState>[0]>): string {
  return signConnectState({
    workspaceId: "ws_1",
    platform: "telegram",
    name: "Telegram Магазин",
    nonce: NONCE,
    ...overrides,
  });
}

async function callCallback(opts: {
  provider?: string;
  search: Record<string, string>;
  cookieNonce?: string;
}) {
  const provider = opts.provider ?? "zernio";
  const url = new URL(`http://localhost/api/channels/${provider}/connect/callback`);
  for (const [key, value] of Object.entries(opts.search)) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {};
  if (opts.cookieNonce !== undefined) {
    headers.cookie = `${CONNECT_STATE_NONCE_COOKIE}=${opts.cookieNonce}`;
  }

  const request = new NextRequest(url, { headers });
  const response = await GET(request, {
    params: Promise.resolve({ provider }),
  });

  return new URL(response.headers.get("location") as string);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/channels/[provider]/connect/callback", () => {
  it("creates the connection and redirects with a success banner on the happy path", async () => {
    createChannelConnectionMock.mockResolvedValue({ ok: true, data: {} });

    const location = await callCallback({
      search: { state: mintState(), account_id: "acct_tg_98213" },
      cookieNonce: NONCE,
    });

    expect(createChannelConnectionMock).toHaveBeenCalledWith(
      expect.anything(),
      "ws_1",
      {
        provider: "zernio",
        platform: "telegram",
        externalId: "acct_tg_98213",
        name: "Telegram Магазин",
      },
    );
    expect(location.pathname).toBe("/settings");
    expect(location.searchParams.get("section")).toBe("channels");
    expect(location.searchParams.get("connect")).toBe("connected");
  });

  it("redirects with reason=duplicate when the account is already connected", async () => {
    createChannelConnectionMock.mockResolvedValue({
      ok: false,
      error: "Этот аккаунт уже подключён к рабочему пространству.",
    });

    const location = await callCallback({
      search: { state: mintState(), account_id: "acct_dup" },
      cookieNonce: NONCE,
    });

    expect(location.searchParams.get("connect")).toBe("error");
    expect(location.searchParams.get("reason")).toBe("duplicate");
  });

  it("redirects with reason=failed on a generic create failure", async () => {
    createChannelConnectionMock.mockResolvedValue({
      ok: false,
      error: "Не удалось создать подключение.",
    });

    const location = await callCallback({
      search: { state: mintState(), account_id: "acct_x" },
      cookieNonce: NONCE,
    });

    expect(location.searchParams.get("reason")).toBe("failed");
  });

  it("rejects a missing state without touching the database", async () => {
    const location = await callCallback({
      search: { account_id: "acct_x" },
      cookieNonce: NONCE,
    });

    expect(location.searchParams.get("connect")).toBe("error");
    expect(location.searchParams.get("reason")).toBe("state");
    expect(createChannelConnectionMock).not.toHaveBeenCalled();
  });

  it("rejects a nonce that doesn't match the cookie (CSRF)", async () => {
    const location = await callCallback({
      search: { state: mintState(), account_id: "acct_x" },
      cookieNonce: "a-different-nonce",
    });

    expect(location.searchParams.get("reason")).toBe("state");
    expect(createChannelConnectionMock).not.toHaveBeenCalled();
  });

  it("rejects a tampered state signature", async () => {
    const location = await callCallback({
      search: { state: mintState() + "x", account_id: "acct_x" },
      cookieNonce: NONCE,
    });

    expect(location.searchParams.get("reason")).toBe("state");
  });

  it("redirects with reason=provider for an unknown provider", async () => {
    const location = await callCallback({
      provider: "does-not-exist",
      search: { state: mintState(), account_id: "acct_x" },
      cookieNonce: NONCE,
    });

    expect(location.searchParams.get("reason")).toBe("provider");
    expect(createChannelConnectionMock).not.toHaveBeenCalled();
  });

  it("redirects with reason=callback when the provider omits the account id", async () => {
    const location = await callCallback({
      search: { state: mintState() },
      cookieNonce: NONCE,
    });

    expect(location.searchParams.get("reason")).toBe("callback");
    expect(createChannelConnectionMock).not.toHaveBeenCalled();
  });
});
