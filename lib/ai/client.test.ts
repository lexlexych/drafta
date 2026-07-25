import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const openAiMock = vi.hoisted(() => ({
  create: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    chat = { completions: { create: openAiMock.create } };

    constructor(options: unknown) {
      openAiMock.constructor(options);
    }
  },
}));

import {
  AI_REQUEST_TIMEOUT_MS,
  AiProviderError,
  generateCompletion,
  generateCompletionWithUsage,
} from "./client";
import {
  AiConfigurationError,
  DEFAULT_MISTRAL_MODEL,
  MISTRAL_BASE_URL,
} from "./config";

const messages = [{ role: "user" as const, content: "Hello" }];

beforeEach(() => {
  vi.stubEnv("MISTRAL_API_KEY", "mistral-secret");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("OPENROUTER_MODEL", "");
  openAiMock.create.mockResolvedValue({
    choices: [{ message: { content: "Hallo!" } }],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("generateCompletion", () => {
  it("uses the selected provider with no SDK retries and a request timeout", async () => {
    await expect(generateCompletion(messages)).resolves.toBe("Hallo!");

    expect(openAiMock.constructor).toHaveBeenCalledWith({
      apiKey: "mistral-secret",
      baseURL: MISTRAL_BASE_URL,
      maxRetries: 0,
      timeout: AI_REQUEST_TIMEOUT_MS,
    });
  });

  it("lets an explicit model override the provider default", async () => {
    await generateCompletion(messages, {
      model: "custom-model",
      temperature: 0.2,
      maxTokens: 256,
    });

    expect(openAiMock.create).toHaveBeenCalledWith({
      model: "custom-model",
      messages,
      temperature: 0.2,
      max_tokens: 256,
    });
  });

  it("uses the provider default for the AI settings auto model", async () => {
    await generateCompletion(messages, { model: "" });

    expect(openAiMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: DEFAULT_MISTRAL_MODEL }),
    );
  });

  it("ignores the workspace model when OpenRouter is selected", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-secret");
    vi.stubEnv("OPENROUTER_MODEL", "mistralai/mistral-small-2603");

    await generateCompletion(messages, { model: "mistral-large-latest" });

    expect(openAiMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "mistralai/mistral-small-2603",
      }),
    );
  });

  it("does not switch to OpenRouter after a Mistral request failure", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-secret");
    vi.stubEnv("OPENROUTER_MODEL", "vendor/fallback-model");
    openAiMock.create.mockRejectedValue({
      status: 503,
      code: "service_unavailable",
      message: "upstream failure containing mistral-secret",
    });

    const error = await generateCompletion(messages).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({
      provider: "mistral",
      code: "service_unavailable",
      status: 503,
    });
    expect((error as Error).message).not.toContain("mistral-secret");
    expect(openAiMock.constructor).toHaveBeenCalledTimes(1);
    expect(openAiMock.create).toHaveBeenCalledTimes(1);
  });

  it("throws a deferred configuration error when neither key exists", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");

    await expect(generateCompletion(messages)).rejects.toBeInstanceOf(
      AiConfigurationError,
    );
    expect(openAiMock.constructor).not.toHaveBeenCalled();
  });
});

describe("generateCompletionWithUsage", () => {
  it("reports the token counts alongside the provider and the model used", async () => {
    openAiMock.create.mockResolvedValue({
      choices: [{ message: { content: "Hallo!" } }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    });

    await expect(generateCompletionWithUsage(messages)).resolves.toEqual({
      text: "Hallo!",
      provider: "mistral",
      model: DEFAULT_MISTRAL_MODEL,
      usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
    });
  });

  it("reports the model the provider actually got, not the one requested", async () => {
    // Under OpenRouter the env model wins; accounting must record that one.
    vi.stubEnv("MISTRAL_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-secret");
    vi.stubEnv("OPENROUTER_MODEL", "mistralai/mistral-small-2603");
    openAiMock.create.mockResolvedValue({
      choices: [{ message: { content: "Hallo!" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const result = await generateCompletionWithUsage(messages, {
      model: "mistral-large-latest",
    });

    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("mistralai/mistral-small-2603");
  });

  it("derives the total when the provider omits it", async () => {
    openAiMock.create.mockResolvedValue({
      choices: [{ message: { content: "Hallo!" } }],
      usage: { prompt_tokens: 90, completion_tokens: 10 },
    });

    const { usage } = await generateCompletionWithUsage(messages);

    expect(usage).toEqual({
      promptTokens: 90,
      completionTokens: 10,
      totalTokens: 100,
    });
  });

  it("still answers when the provider reports no usage at all", async () => {
    // A missing reading must stay missing rather than becoming a zero: an
    // absent number and a free call are different facts.
    openAiMock.create.mockResolvedValue({
      choices: [{ message: { content: "Hallo!" } }],
    });

    const result = await generateCompletionWithUsage(messages);

    expect(result.text).toBe("Hallo!");
    expect(result.usage).toBeNull();
  });

  it("treats a malformed usage object as no reading", async () => {
    openAiMock.create.mockResolvedValue({
      choices: [{ message: { content: "Hallo!" } }],
      usage: { prompt_tokens: "many", completion_tokens: null },
    });

    await expect(
      generateCompletionWithUsage(messages).then((result) => result.usage),
    ).resolves.toBeNull();
  });
});
