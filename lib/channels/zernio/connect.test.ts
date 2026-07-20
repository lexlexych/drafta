import { describe, expect, it } from "vitest";

import {
  buildZernioConnectUrl,
  parseZernioConnectCallback,
  ZernioConnectCallbackError,
} from "./connect";

const config = {
  connectUrl: "https://connect.zernio.example/oauth/authorize",
  apiKey: "zk_test_123",
};

describe("buildZernioConnectUrl", () => {
  it("builds the hosted-connect URL with client, platform, redirect and state", () => {
    const url = new URL(
      buildZernioConnectUrl(config, {
        workspaceId: "ws_1",
        platform: "whatsapp",
        redirectUrl: "https://app.drafta.example/api/channels/zernio/connect/callback",
        state: "signed.state.token",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://connect.zernio.example/oauth/authorize",
    );
    expect(url.searchParams.get("client")).toBe("zk_test_123");
    expect(url.searchParams.get("platform")).toBe("whatsapp");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.drafta.example/api/channels/zernio/connect/callback",
    );
    expect(url.searchParams.get("state")).toBe("signed.state.token");
  });
});

describe("parseZernioConnectCallback", () => {
  it("extracts the connected account's external id", () => {
    const result = parseZernioConnectCallback({ account_id: "acct_wa_31207" });

    expect(result.externalAccountId).toBe("acct_wa_31207");
    expect(result.credentials).toBeUndefined();
  });

  it("throws when the provider reports an error", () => {
    expect(() =>
      parseZernioConnectCallback({ error: "access_denied" }),
    ).toThrow(ZernioConnectCallbackError);
  });

  it("throws when the account id is missing", () => {
    expect(() => parseZernioConnectCallback({})).toThrow(
      ZernioConnectCallbackError,
    );
    expect(() => parseZernioConnectCallback({ account_id: "  " })).toThrow(
      ZernioConnectCallbackError,
    );
  });
});
