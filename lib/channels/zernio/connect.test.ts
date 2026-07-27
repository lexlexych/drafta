import { describe, expect, it } from "vitest";

import { parseZernioConnectCallback, ZernioConnectCallbackError } from "./connect";

describe("parseZernioConnectCallback", () => {
  it("extracts the connected account's external id, platform and handle", () => {
    const result = parseZernioConnectCallback({
      connected: "whatsapp",
      accountId: "acct_wa_31207",
      username: "+491234567",
      profileId: "prof_1",
    });

    expect(result.externalAccountId).toBe("acct_wa_31207");
    expect(result.platform).toBe("whatsapp");
    expect(result.accountUsername).toBe("+491234567");
    expect(result.credentials).toBeUndefined();
  });

  it("leaves the account handle undefined when the provider omits it", () => {
    const result = parseZernioConnectCallback({
      connected: "instagram",
      accountId: "acct_ig_1",
      username: "   ",
    });

    expect(result.accountUsername).toBeUndefined();
  });

  it("leaves platform undefined when Zernio reports an unknown one", () => {
    const result = parseZernioConnectCallback({
      connected: "tiktok",
      accountId: "acct_x",
    });

    expect(result.externalAccountId).toBe("acct_x");
    expect(result.platform).toBeUndefined();
  });

  it("throws when the provider reports an error", () => {
    expect(() =>
      parseZernioConnectCallback({ error: "access_denied" }),
    ).toThrow(ZernioConnectCallbackError);
    expect(() => parseZernioConnectCallback({ denied: "1" })).toThrow(
      ZernioConnectCallbackError,
    );
  });

  it("throws when the account id is missing", () => {
    expect(() => parseZernioConnectCallback({ connected: "telegram" })).toThrow(
      ZernioConnectCallbackError,
    );
    expect(() => parseZernioConnectCallback({ accountId: "  " })).toThrow(
      ZernioConnectCallbackError,
    );
  });
});
