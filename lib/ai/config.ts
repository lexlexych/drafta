export const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";

export type AiModelOption = {
  value: string;
  label: string;
};

export const MISTRAL_MODEL_OPTIONS: readonly AiModelOption[] = [
  { value: DEFAULT_MISTRAL_MODEL, label: "Mistral Small (EU)" },
  { value: "mistral-large-latest", label: "Mistral Large (EU)" },
];

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

function cloneModelOptions(
  options: readonly AiModelOption[],
): AiModelOption[] {
  return options.map((option) => ({ ...option }));
}

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
 * Returns the short, server-configured model allowlist used by AI settings.
 * Mistral always wins when its key is configured. OpenRouter's configured
 * model is exposed only in an OpenRouter-only environment; API keys never
 * leave this module or become client props.
 */
export function getAiModelOptions(
  env: AiEnvironment = {
    MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  },
): AiModelOption[] {
  if (readEnvValue(env, "MISTRAL_API_KEY")) {
    return cloneModelOptions(MISTRAL_MODEL_OPTIONS);
  }

  const openRouterApiKey = readEnvValue(env, "OPENROUTER_API_KEY");
  const openRouterModel = readEnvValue(env, "OPENROUTER_MODEL");

  if (openRouterApiKey && openRouterModel) {
    return [
      {
        value: openRouterModel,
        label: `OpenRouter · ${openRouterModel}`,
      },
    ];
  }

  // Keep settings usable before production secrets are configured. The
  // actual AI client still refuses to run without a provider key.
  return cloneModelOptions(MISTRAL_MODEL_OPTIONS);
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
