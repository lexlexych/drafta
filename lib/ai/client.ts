import "server-only";

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { resolveProvider, type AiProvider } from "./config";

export const AI_REQUEST_TIMEOUT_MS = 30_000;

export type AiMessage = ChatCompletionMessageParam;

export type GenerateCompletionOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly provider: AiProvider,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

function errorMetadata(error: unknown): {
  code: string;
  status?: number;
} {
  if (typeof error !== "object" || error === null) {
    return { code: "request_failed" };
  }

  const candidate = error as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
  };
  const status =
    typeof candidate.status === "number" ? candidate.status : undefined;

  if (candidate.name === "APIConnectionTimeoutError") {
    return { code: "timeout", status };
  }

  return {
    code:
      typeof candidate.code === "string" && candidate.code.length > 0
        ? candidate.code
        : "request_failed",
    status,
  };
}

function providerError(
  provider: AiProvider,
  error: unknown,
): AiProviderError {
  const { code, status } = errorMetadata(error);
  const statusSuffix = status === undefined ? "" : ` (HTTP ${status})`;

  // Deliberately omit the upstream error message: SDK/transport messages may
  // contain request headers or other sensitive configuration.
  return new AiProviderError(
    `AI provider request failed${statusSuffix}.`,
    provider,
    code,
    status,
  );
}

export async function generateCompletion(
  messages: readonly AiMessage[],
  options: GenerateCompletionOptions = {},
): Promise<string> {
  const config = resolveProvider();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
    timeout: AI_REQUEST_TIMEOUT_MS,
  });

  try {
    const completion = await client.chat.completions.create({
      model: options.model ?? config.defaultModel,
      messages: [...messages],
      ...(options.temperature === undefined
        ? {}
        : { temperature: options.temperature }),
      ...(options.maxTokens === undefined
        ? {}
        : { max_tokens: options.maxTokens }),
    });
    const content = completion.choices[0]?.message.content;

    if (typeof content !== "string" || content.length === 0) {
      throw new AiProviderError(
        "AI provider returned an empty completion.",
        config.provider,
        "empty_response",
      );
    }

    return content;
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }

    throw providerError(config.provider, error);
  }
}
