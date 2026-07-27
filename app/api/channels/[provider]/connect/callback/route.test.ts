import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// route.ts transitively imports server-only modules (lib/channels/zernio,
// lib/db/server, lib/channels/connect-state) — neutralize the marker so this
// file can import and exercise the real route, mirroring
// app/api/webhooks/[provider]/route.test.ts (T-03).
vi.mock("server-only", () => ({}));

process.env.CHANNEL_CONNECT_STATE_SECRET = "test-connect-state-secret";

// The DB layer is mocked: this suite tests the route's own logic — signed
// cookie state + nonce CSRF, provider resolution, callback parsing, redirect
// targets — not the create query (covered by lib/db/channel-connections.test.ts).
const createChannelConnectionMock = vi.fn();
vi.mock("@/lib/db/channel-connections", () => ({
  createChannelConnection: (...args: unknown[]) =>
    createChannelConnectionMock(...args),
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({}),
}));

import {
  CONNECT_STATE_COOKIE,
  CONNECT_STATE_NONCE_PARAM,
  signConnectState,
} from "@/lib/channels/connect-state";

import { GET } from "./route";

const NONCE = "nonce_under_test";

function mintState(overrides?: Partial<Parameters<typeof signConnectState>[0]>): string {
  return signConnectState({
    workspaceId: "ws_1",
    platform: "telegram",
    nonce: NONCE,
    ...overrides,
  });
}

async function callCallback(opts: {
  provider?: string;
  search: Record<string, string>;
  cookieToken?: string;
}) {
  const provider = opts.provider ?? "zernio";
  const url = new URL(`http://localhost/api/channels/${provider}/connect/callback`);
  for (const [key, value] of Object.entries(opts.search)) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {};
  if (opts.cookieToken !== undefined) {
    headers.cookie = `${CONNECT_STATE_COOKIE}=${opts.cookieToken}`;
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
  it("names the connection after the authorized account and redirects with a success banner", async () => {
    createChannelConnectionMock.mockResolvedValue({ ok: true, data: {} });

    const location = await callCallback({
      search: {
        [CONNECT_STATE_NONCE_PARAM]: NONCE,
        connected: "telegram",
        accountId: "acct_tg_98213",
        username: "tonwerk_shop",
      },
      cookieToken: mintState(),
    });

    expect(createChannelConnectionMock).toHaveBeenCalledWith(
      expect.anything(),
      "ws_1",
      {
        provider: "zernio",
        platform: "telegram",
        externalId: "acct_tg_98213",
        name: "tonwerk_shop",
      },
    );
    expect(location.pathname).toBe("/settings");
    expect(location.searchParams.get("section")).toBe("channels");
    expect(location.searchParams.get("connect")).toBe("connected");
  });

  it("falls back to the platform label when the provider reports no account name", async () => {
    createChannelConnectionMock.mockResolvedValue({ ok: true, data: {} });

    await callCallback({
      search: {
        [CONNECT_STATE_NONCE_PARAM]: NONCE,
        connected: "telegram",
        accountId: "acct_tg_98213",
      },
      cookieToken: mintState(),
    });

    expect(createChannelConnectionMock).toHaveBeenCalledWith(
      expect.anything(),
      "ws_1",
      expect.objectContaining({ name: "Telegram" }),
    );
  });

  it("redirects with reason=duplicate when the account is already connected", async () => {
    createChannelConnectionMock.mockResolvedValue({
      ok: false,
      error: "Этот аккаунт уже подключён к рабочему пространству.",
    });

    const location = await callCallback({
      search: { [CONNECT_STATE_NONCE_PARAM]: NONCE, accountId: "acct_dup" },
      cookieToken: mintState(),
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
      search: { [CONNECT_STATE_NONCE_PARAM]: NONCE, accountId: "acct_x" },
      cookieToken: mintState(),
    });

    expect(location.searchParams.get("reason")).toBe("failed");
  });

  it("rejects a missing state cookie without touching the database", async () => {
    const location = await callCallback({
      search: { [CONNECT_STATE_NONCE_PARAM]: NONCE, accountId: "acct_x" },
    });

    expect(location.searchParams.get("connect")).toBe("error");
    expect(location.searchParams.get("reason")).toBe("state");
    expect(createChannelConnectionMock).not.toHaveBeenCalled();
  });

  it("rejects a URL nonce that doesn't match the cookie state (CSRF)", async () => {
    const location = await callCallback({
      search: { [CONNECT_STATE_NONCE_PARAM]: "a-different-nonce", accountId: "acct_x" },
      cookieToken: mintState(),
    });

    expect(location.searchParams.get("reason")).toBe("state");
    expect(createChannelConnectionMock).not.toHaveBeenCalled();
  });

  it("rejects a tampered state cookie", async () => {
    const location = await callCallback({
      search: { [CONNECT_STATE_NONCE_PARAM]: NONCE, accountId: "acct_x" },
      cookieToken: mintState() + "x",
    });

    expect(location.searchParams.get("reason")).toBe("state");
  });

  it("rejects when the reported platform doesn't match the pending state", async () => {
    const location = await callCallback({
      search: {
        [CONNECT_STATE_NONCE_PARAM]: NONCE,
        connected: "whatsapp",
        accountId: "acct_x",
      },
      cookieToken: mintState({ platform: "telegram" }),
    });

    expect(location.searchParams.get("reason")).toBe("state");
    expect(createChannelConnectionMock).not.toHaveBeenCalled();
  });

  it("redirects with reason=provider for an unknown provider", async () => {
    const location = await callCallback({
      provider: "does-not-exist",
      search: { [CONNECT_STATE_NONCE_PARAM]: NONCE, accountId: "acct_x" },
      cookieToken: mintState(),
    });

    expect(location.searchParams.get("reason")).toBe("provider");
    expect(createChannelConnectionMock).not.toHaveBeenCalled();
  });

  it("redirects with reason=callback when the provider omits the account id", async () => {
    const location = await callCallback({
      search: { [CONNECT_STATE_NONCE_PARAM]: NONCE, connected: "telegram" },
      cookieToken: mintState(),
    });

    expect(location.searchParams.get("reason")).toBe("callback");
    expect(createChannelConnectionMock).not.toHaveBeenCalled();
  });
});
