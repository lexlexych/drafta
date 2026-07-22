import { describe, expect, it } from "vitest";

import {
  AiConfigurationError,
  DEFAULT_MISTRAL_MODEL,
  getAiModelOptions,
  MISTRAL_BASE_URL,
  OPENROUTER_BASE_URL,
  resolveProvider,
  selectProviderModel,
} from "./config";

describe("resolveProvider", () => {
  it("prioritizes Mistral when both provider keys are configured", () => {
    expect(
      resolveProvider({
        MISTRAL_API_KEY: "mistral-secret",
        OPENROUTER_API_KEY: "openrouter-secret",
        OPENROUTER_MODEL: "vendor/fallback-model",
      }),
    ).toEqual({
      provider: "mistral",
      baseURL: MISTRAL_BASE_URL,
      apiKey: "mistral-secret",
      defaultModel: DEFAULT_MISTRAL_MODEL,
    });
  });

  it("uses OpenRouter and its configured model when Mistral is absent", () => {
    expect(
      resolveProvider({
        OPENROUTER_API_KEY: "openrouter-secret",
        OPENROUTER_MODEL: "vendor/fallback-model",
      }),
    ).toEqual({
      provider: "openrouter",
      baseURL: OPENROUTER_BASE_URL,
      apiKey: "openrouter-secret",
      defaultModel: "vendor/fallback-model",
    });
  });

  it("requires OPENROUTER_MODEL with an OpenRouter key", () => {
    expect(() =>
      resolveProvider({ OPENROUTER_API_KEY: "openrouter-secret" }),
    ).toThrowError(
      new AiConfigurationError(
        "OPENROUTER_MODEL must be set when OPENROUTER_API_KEY is configured.",
      ),
    );
  });

  it("fails only when provider configuration is resolved", () => {
    expect(() => resolveProvider({})).toThrowError(AiConfigurationError);
  });
});

describe("getAiModelOptions", () => {
  it("keeps the Mistral allowlist when both providers are configured", () => {
    expect(
      getAiModelOptions({
        MISTRAL_API_KEY: "mistral-secret",
        OPENROUTER_API_KEY: "openrouter-secret",
        OPENROUTER_MODEL: "vendor/fallback-model",
      }).map((option) => option.value),
    ).toEqual(["mistral-small-latest", "mistral-large-latest"]);
  });

  it("exposes only the configured OpenRouter model without Mistral", () => {
    expect(
      getAiModelOptions({
        OPENROUTER_API_KEY: "openrouter-secret",
        OPENROUTER_MODEL: "vendor/fallback-model",
      }),
    ).toEqual([
      {
        value: "vendor/fallback-model",
        label: "OpenRouter · vendor/fallback-model",
      },
    ]);
  });
});

describe("selectProviderModel", () => {
  it("allows a workspace model override for Mistral", () => {
    expect(
      selectProviderModel(
        {
          provider: "mistral",
          baseURL: MISTRAL_BASE_URL,
          apiKey: "mistral-secret",
          defaultModel: DEFAULT_MISTRAL_MODEL,
        },
        "mistral-large-latest",
      ),
    ).toBe("mistral-large-latest");
  });

  it("always uses OPENROUTER_MODEL and ignores the workspace model", () => {
    expect(
      selectProviderModel(
        {
          provider: "openrouter",
          baseURL: OPENROUTER_BASE_URL,
          apiKey: "openrouter-secret",
          defaultModel: "mistralai/mistral-small-2603",
        },
        "mistral-large-latest",
      ),
    ).toBe("mistralai/mistral-small-2603");
  });
});
