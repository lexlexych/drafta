import { describe, expect, it, vi } from "vitest";

import { createExchangeRecorder } from "./exchange";

const url = "https://api.mistral.ai/v1/chat/completions";

const requestInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: {
    authorization: "Bearer mistral-secret",
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});

describe("createExchangeRecorder", () => {
  it("captures the request and response bodies verbatim", async () => {
    const responseBody = {
      id: "cmpl-1",
      choices: [{ message: { content: "Hallo!" } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    };
    const recorder = createExchangeRecorder(async () =>
      Response.json(responseBody),
    );

    await recorder.fetch(
      url,
      requestInit({ model: "mistral-small-latest", messages: [] }),
    );

    const exchange = recorder.read();

    expect(exchange).toMatchObject({
      requestBody: { model: "mistral-small-latest", messages: [] },
      responseBody,
      statusCode: 200,
    });
    expect(exchange?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("never captures headers, which carry the provider key", async () => {
    const recorder = createExchangeRecorder(async () => Response.json({}));

    await recorder.fetch(url, requestInit({ model: "m" }));

    expect(JSON.stringify(recorder.read())).not.toContain("mistral-secret");
  });

  it("leaves the response readable for the SDK", async () => {
    const recorder = createExchangeRecorder(async () =>
      Response.json({ choices: [] }),
    );

    const response = await recorder.fetch(url, requestInit({}));

    await expect(response.json()).resolves.toEqual({ choices: [] });
  });

  it("captures a provider error body", async () => {
    const recorder = createExchangeRecorder(async () =>
      Response.json({ error: { message: "invalid api key" } }, { status: 401 }),
    );

    await recorder.fetch(url, requestInit({}));

    expect(recorder.read()).toMatchObject({
      statusCode: 401,
      responseBody: { error: { message: "invalid api key" } },
    });
  });

  it("keeps a non-JSON body as text rather than dropping it", async () => {
    const recorder = createExchangeRecorder(
      async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    );

    await recorder.fetch(url, requestInit({}));

    expect(recorder.read()).toMatchObject({
      statusCode: 502,
      responseBody: { raw: "<html>502 Bad Gateway</html>" },
    });
  });

  it("records a transport failure with no status and rethrows", async () => {
    const recorder = createExchangeRecorder(async () => {
      throw new Error("connection reset");
    });

    await expect(recorder.fetch(url, requestInit({ model: "m" }))).rejects.toThrow(
      "connection reset",
    );

    expect(recorder.read()).toMatchObject({
      requestBody: { model: "m" },
      responseBody: null,
      statusCode: null,
    });
  });

  it("reports nothing when no request was made", () => {
    expect(createExchangeRecorder(vi.fn()).read()).toBeNull();
  });
});
