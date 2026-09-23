import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseZernioConnectCallback, ZernioConnectCallbackError } from "./connect";
import { parseZernioWebhook } from "./parse";

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)),
    "utf8",
  );
}

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

  /**
   * Inbound webhooks resolve a connection by `(provider, external_id)`, and
   * `external_id` is exactly what this parser returns from the connect
   * callback. If Zernio named the same account differently in the two places,
   * every WhatsApp message would land as "unknown connection" instead of in
   * the inbox — so pin both halves to one account id.
   *
   * This guards the code path, not Zernio's behaviour: the live callback still
   * has to be checked against a real webhook on the first connection.
   */
  it("returns the same account id the WhatsApp webhook reports", () => {
    const [event] = parseZernioWebhook({
      rawBody: readFixture("whatsapp-dm.json"),
      headers: {},
    }).events;

    expect(event.platform).toBe("whatsapp");
    expect(event.externalAccountId).toBe("acct_wa_31207");

    const connected = parseZernioConnectCallback({
      connected: "whatsapp",
      accountId: "acct_wa_31207",
      username: "+49 151 2345678",
    });

    expect(connected.externalAccountId).toBe(event.externalAccountId);
  });

  /**
   * Same guard for Facebook: the account id comes back from Zernio's hosted
   * Page picker, and has to be the one its Messenger and comment webhooks
   * carry — not the Page's own Graph id.
   */
  it("returns the same account id the Facebook webhooks report", () => {
    const events = ["facebook-dm.json", "facebook-comment.json"].flatMap(
      (name) =>
        parseZernioWebhook({ rawBody: readFixture(name), headers: {} }).events,
    );

    const connected = parseZernioConnectCallback({
      connected: "facebook",
      profileId: "prof_1",
      accountId: "acct_fb_55120",
      username: "tonwerk.berlin",
    });

    expect(connected.platform).toBe("facebook");
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.platform).toBe("facebook");
      expect(event.externalAccountId).toBe(connected.externalAccountId);
    }
  });

  it("treats a declined Facebook consent as a failed connect", () => {
    expect(() =>
      parseZernioConnectCallback({ error: "oauth_denied", platform: "facebook" }),
    ).toThrow(ZernioConnectCallbackError);
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
