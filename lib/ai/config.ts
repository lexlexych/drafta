export const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";

export type AiProvider = "mistral" | "openrouter";

export type AiProviderConfig = {
  provider: AiProvider;
  baseURL: string;
  apiKey: string;
  defaultModel: string;
};

type AiEnvironment = Partial<
  Record<
    "MISTRAL_API_KEY" | "OPENROUTER_API_KEY" | "OPENROUTER_MODEL",
    string
  >
>;

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

function readEnvValue(
  env: AiEnvironment,
  name: "MISTRAL_API_KEY" | "OPENROUTER_API_KEY" | "OPENROUTER_MODEL",
): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

/**
 * Selects exactly one provider from the current environment. Provider
 * selection is configuration-only: request failures never trigger failover.
 */
export function resolveProvider(
  env: AiEnvironment = {
    MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  },
): AiProviderConfig {
  const mistralApiKey = readEnvValue(env, "MISTRAL_API_KEY");
  if (mistralApiKey) {
    return {
      provider: "mistral",
      baseURL: MISTRAL_BASE_URL,
      apiKey: mistralApiKey,
      defaultModel: DEFAULT_MISTRAL_MODEL,
    };
  }

  const openRouterApiKey = readEnvValue(env, "OPENROUTER_API_KEY");
  if (openRouterApiKey) {
    const openRouterModel = readEnvValue(env, "OPENROUTER_MODEL");
    if (!openRouterModel) {
      throw new AiConfigurationError(
        "OPENROUTER_MODEL must be set when OPENROUTER_API_KEY is configured.",
      );
    }

    return {
      provider: "openrouter",
      baseURL: OPENROUTER_BASE_URL,
      apiKey: openRouterApiKey,
      defaultModel: openRouterModel,
    };
  }

  throw new AiConfigurationError(
    "Configure MISTRAL_API_KEY or OPENROUTER_API_KEY with OPENROUTER_MODEL before calling the AI client.",
  );
}
