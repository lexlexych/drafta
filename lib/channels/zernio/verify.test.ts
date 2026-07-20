import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyZernioSignature } from "./verify";

const SECRET = "test-webhook-secret";
const RAW_BODY = JSON.stringify({
  id: "wh_evt_1",
  event: "message.received",
});

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyZernioSignature", () => {
  it("accepts a correctly signed request", () => {
    const signature = sign(RAW_BODY, SECRET);

    expect(
      verifyZernioSignature(
        { rawBody: RAW_BODY, headers: { "x-zernio-signature": signature } },
        SECRET,
      ),
    ).toBe(true);
  });

  it("accepts the legacy X-Late-Signature header alias", () => {
    const signature = sign(RAW_BODY, SECRET);

    expect(
      verifyZernioSignature(
        { rawBody: RAW_BODY, headers: { "x-late-signature": signature } },
        SECRET,
      ),
    ).toBe(true);
  });

  it("is case-insensitive on the hex signature value", () => {
    const signature = sign(RAW_BODY, SECRET).toUpperCase();

    expect(
      verifyZernioSignature(
        { rawBody: RAW_BODY, headers: { "x-zernio-signature": signature } },
        SECRET,
      ),
    ).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const signature = sign(RAW_BODY, "wrong-secret");

    expect(
      verifyZernioSignature(
        { rawBody: RAW_BODY, headers: { "x-zernio-signature": signature } },
        SECRET,
      ),
    ).toBe(false);
  });

  it("rejects when the body was tampered with after signing", () => {
    const signature = sign(RAW_BODY, SECRET);
    const tamperedBody = RAW_BODY.replace(
      "message.received",
      "message.deleted",
    );

    expect(
      verifyZernioSignature(
        {
          rawBody: tamperedBody,
          headers: { "x-zernio-signature": signature },
        },
        SECRET,
      ),
    ).toBe(false);
  });

  it("rejects a request with no signature header at all", () => {
    expect(
      verifyZernioSignature({ rawBody: RAW_BODY, headers: {} }, SECRET),
    ).toBe(false);
  });

  it("rejects a signature of the wrong length instead of throwing", () => {
    expect(
      verifyZernioSignature(
        {
          rawBody: RAW_BODY,
          headers: { "x-zernio-signature": "not-a-real-signature" },
        },
        SECRET,
      ),
    ).toBe(false);
  });

  it("rejects when no webhook secret is configured", () => {
    const signature = sign(RAW_BODY, SECRET);

    expect(
      verifyZernioSignature(
        { rawBody: RAW_BODY, headers: { "x-zernio-signature": signature } },
        "",
      ),
    ).toBe(false);
  });
});
