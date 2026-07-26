import "server-only";

import type { AiUsage } from "@/lib/ai";
import { createAdminSupabaseClient } from "@/lib/db/admin";

/**
 * Token accounting for LLM calls (`public.ai_usage`), the data behind the
 * dashboard's spend block.
 *
 * Written from the Inngest pipelines only, which run without a user session —
 * hence the admin client. `authenticated` has no insert grant on the table at
 * all, so this is the single write path by design.
 */

/** Classification is the cheap pinned model; draft generation is the costly one. */
export type AiUsageOperation = "classification" | "draft";

/** Comments are never classified today, but the column keeps both surfaces honest. */
export type AiUsageSurface = "message" | "comment";

export type RecordAiUsageInput = {
  workspaceId: string;
  operation: AiUsageOperation;
  surface: AiUsageSurface;
  provider: string;
  model: string;
  usage: AiUsage | null;
};

/**
 * Records one provider call. Never throws: cost accounting is strictly
 * secondary to answering the customer, so a failed insert (or a provider that
 * reported no `usage` at all) must not take a draft down with it. A missing
 * reading is skipped rather than stored as a zero — see `AiUsage`.
 */
export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  if (!input.usage) {
    return;
  }

  try {
    const supabase = createAdminSupabaseClient();
    const { error } = await supabase.from("ai_usage").insert({
      workspace_id: input.workspaceId,
      operation: input.operation,
      surface: input.surface,
      provider: input.provider,
      model: input.model,
      prompt_tokens: input.usage.promptTokens,
      completion_tokens: input.usage.completionTokens,
      total_tokens: input.usage.totalTokens,
    });

    if (error) {
      console.error("[ai-usage] failed to record token usage", error);
    }
  } catch (error) {
    console.error("[ai-usage] failed to record token usage", error);
  }
}
