import "server-only";

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
  resolveProvider,
  selectProviderModel,
  type AiProvider,
} from "./config";

export const AI_REQUEST_TIMEOUT_MS = 30_000;

export type AiMessage = ChatCompletionMessageParam;

export type GenerateCompletionOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

/**
 * Token counts as reported by the provider. Not every OpenAI-compatible
 * endpoint returns a `usage` object, so callers must treat it as optional and
 * never let a missing one turn into a zero — an absent reading and a genuinely
 * free call are different facts, and only the former should stay unrecorded.
 */
export type AiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type GenerateCompletionResult = {
  text: string;
  provider: AiProvider;
  /** The model actually used, after `selectProviderModel` had its say. */
  model: string;
  usage: AiUsage | null;
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

function readUsage(usage: unknown): AiUsage | null {
  if (typeof usage !== "object" || usage === null) {
    return null;
  }

  const candidate = usage as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  const promptTokens = candidate.prompt_tokens;
  const completionTokens = candidate.completion_tokens;

  if (typeof promptTokens !== "number" || typeof completionTokens !== "number") {
    return null;
  }

  return {
    promptTokens,
    completionTokens,
    // Providers are inconsistent about sending the sum, so derive it when the
    // field is missing rather than reporting a total of zero.
    totalTokens:
      typeof candidate.total_tokens === "number"
        ? candidate.total_tokens
        : promptTokens + completionTokens,
  };
}

/**
 * The full provider round trip: the answer plus what it cost. Used wherever
 * the spend has to be recorded (`lib/db/ai-usage.ts`); callers that only need
 * the text keep using `generateCompletion` below.
 */
export async function generateCompletionWithUsage(
  messages: readonly AiMessage[],
  options: GenerateCompletionOptions = {},
): Promise<GenerateCompletionResult> {
  const config = resolveProvider();
  const model = selectProviderModel(config, options.model);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
    timeout: AI_REQUEST_TIMEOUT_MS,
  });

  try {
    const completion = await client.chat.completions.create({
      model,
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

    return {
      text: content,
      provider: config.provider,
      model,
      usage: readUsage(completion.usage),
    };
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }

    throw providerError(config.provider, error);
  }
}

export async function generateCompletion(
  messages: readonly AiMessage[],
  options: GenerateCompletionOptions = {},
): Promise<string> {
  const { text } = await generateCompletionWithUsage(messages, options);

  return text;
}
