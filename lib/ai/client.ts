import "server-only";

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
  resolveProvider,
  selectProviderModel,
  type AiProvider,
} from "./config";
import { createExchangeRecorder, type AiExchange } from "./exchange";

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
  /**
   * The verbatim request/response bodies, for `lib/db/ai-request-log.ts`.
   * `null` only if the recorder never saw a request.
   */
  exchange: AiExchange | null;
};

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly provider: AiProvider,
    readonly code: string,
    readonly status?: number,
    /**
     * Carried on the error so a failed call can still be logged. The model is
     * separate from the request body because `selectProviderModel` may override
     * what the caller asked for (OpenRouter pins its own), and the error may
     * predate a request body existing at all.
     */
    readonly model?: string,
    readonly exchange?: AiExchange | null,
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
  model: string,
  exchange: AiExchange | null,
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
    model,
    exchange,
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
 * The full provider round trip: the answer, what it cost (`lib/db/ai-usage.ts`)
 * and the verbatim bodies it travelled in (`lib/db/ai-request-log.ts`). Callers
 * that only need the text keep using `generateCompletion` below.
 */
export async function generateCompletionWithUsage(
  messages: readonly AiMessage[],
  options: GenerateCompletionOptions = {},
): Promise<GenerateCompletionResult> {
  const config = resolveProvider();
  const model = selectProviderModel(config, options.model);
  // Wraps `fetch` so the exact bodies can be logged; see lib/ai/exchange.ts.
  const recorder = createExchangeRecorder();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
    timeout: AI_REQUEST_TIMEOUT_MS,
    fetch: recorder.fetch,
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
        undefined,
        model,
        recorder.read(),
      );
    }

    return {
      text: content,
      provider: config.provider,
      model,
      usage: readUsage(completion.usage),
      exchange: recorder.read(),
    };
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }

    throw providerError(config.provider, model, recorder.read(), error);
  }
}

export async function generateCompletion(
  messages: readonly AiMessage[],
  options: GenerateCompletionOptions = {},
): Promise<string> {
  const { text } = await generateCompletionWithUsage(messages, options);

  return text;
}
