import "server-only";

import type { AiExchange, AiUsage } from "@/lib/ai";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import type { AiUsageOperation, AiUsageSurface } from "@/lib/db/ai-usage";

/**
 * Verbatim provider exchanges (`public.ai_request_log`) — what was sent to the
 * LLM and what came back, byte for byte, next to the token counts for the same
 * call.
 *
 * Written from the Inngest pipelines and from the translation action, hence the
 * admin client; no other role has a grant on the table. The text stored here is
 * the masked text the provider was given (lib/ai/masking.ts), which is what
 * "the request, 1:1" means — but it is still conversation content, so rows are dropped after
 * `AI_REQUEST_LOG_RETENTION_DAYS` by the `cleanup-ai-request-log` cron.
 */

/** Matches the retention promised in the table comment and in §15 of the docs. */
export const AI_REQUEST_LOG_RETENTION_DAYS = 30;

export type RecordAiRequestInput = {
  workspaceId: string;
  operation: AiUsageOperation;
  surface: AiUsageSurface;
  provider: string;
  model: string;
  draftId?: string;
  exchange: AiExchange | null;
  usage: AiUsage | null;
  /** `AiProviderError.code` when the call failed; omitted on success. */
  errorCode?: string;
};

/**
 * Records one provider round trip. Never throws, for the same reason
 * `recordAiUsage` does not: a log that cannot be written must not take a
 * customer's draft down with it.
 *
 * A call with no captured exchange is skipped rather than stored as an empty
 * row — `request` is `not null` precisely because a log row without the request
 * has nothing to say.
 */
export async function recordAiRequest(
  input: RecordAiRequestInput,
): Promise<void> {
  if (!input.exchange) {
    return;
  }

  try {
    const supabase = createAdminSupabaseClient();
    const { error } = await supabase.from("ai_request_log").insert({
      workspace_id: input.workspaceId,
      operation: input.operation,
      surface: input.surface,
      provider: input.provider,
      model: input.model,
      draft_id: input.draftId ?? null,
      request: input.exchange.requestBody,
      response: input.exchange.responseBody,
      status_code: input.exchange.statusCode,
      error_code: input.errorCode ?? null,
      duration_ms: input.exchange.durationMs,
      // Null rather than zero when the provider reported nothing — see AiUsage.
      prompt_tokens: input.usage?.promptTokens ?? null,
      completion_tokens: input.usage?.completionTokens ?? null,
      total_tokens: input.usage?.totalTokens ?? null,
    });

    if (error) {
      console.error("[ai-request-log] failed to record provider call", error);
    }
  } catch (error) {
    console.error("[ai-request-log] failed to record provider call", error);
  }
}

/**
 * Deletes everything logged before `cutoffIso`. Unlike the write path this one
 * throws: it runs inside an Inngest step, where a failure should be retried and
 * visible rather than swallowed.
 */
export async function deleteAiRequestLogsBefore(
  cutoffIso: string,
): Promise<number> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("ai_request_log")
    .delete()
    .lt("created_at", cutoffIso)
    .select("id");

  if (error) {
    const code = error.code ? ` (${error.code})` : "";
    throw new Error(`Pruning ai_request_log failed${code}.`);
  }

  return data?.length ?? 0;
}
